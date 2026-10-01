import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeBrain, brain, gitc, write, cleanup, sh } from './helpers.mjs';

after(cleanup);

const globalConfig = (fx) => fx.env.GIT_CONFIG_GLOBAL;

test('install sets only the local hooksPath and is idempotent', () => {
  const fx = makeBrain({ label: 'hooks' });
  assert.match(brain(fx, ['hooks', 'status']).stdout, /not-installed/);
  const before = fs.readFileSync(globalConfig(fx), 'utf8');
  const r = brain(fx, ['hooks', 'install']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /covers every worktree of this clone/);
  assert.equal(gitc(fx.dir, fx.env, 'config', '--local', 'core.hooksPath').trim(), 'system/hooks');
  assert.equal(fs.readFileSync(globalConfig(fx), 'utf8'), before, 'global config untouched');
  assert.match(brain(fx, ['hooks', 'install']).stdout, /No change: installed/);
  assert.equal(brain(fx, ['hooks', 'uninstall']).status, 0);
  assert.equal(sh(fx.dir, 'git', ['config', '--local', 'core.hooksPath'], fx.env).status, 1);
});

test('existing global hooksPath is never replaced; composing is detected', () => {
  const fx = makeBrain({ label: 'global hooks' });
  const hooksDir = path.join(fx.home, 'my hooks');
  fs.mkdirSync(hooksDir);
  fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\necho mine\n');
  fs.writeFileSync(globalConfig(fx), `[core]\n\thooksPath = ${hooksDir.replace(/\\/g, '/')}\n`);
  const r = brain(fx, ['hooks', 'install']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already set/);
  assert.match(r.stderr, /hook pre-commit \|\| exit 1/);
  assert.equal(sh(fx.dir, 'git', ['config', '--local', 'core.hooksPath'], fx.env).status, 1, 'no local override written');
  fs.appendFileSync(path.join(hooksDir, 'pre-commit'), 'node "$(git rev-parse --show-toplevel)/system/bin/brain.mjs" hook pre-commit || exit 1\n');
  assert.match(brain(fx, ['hooks', 'status']).stdout, /^composed/);
});

test('existing .git/hooks/pre-commit is never replaced', () => {
  const fx = makeBrain({ label: 'default hook' });
  const hook = path.join(fx.dir, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 0\n');
  const r = brain(fx, ['hooks', 'install']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /default hooks folder/);
  assert.equal(fs.readFileSync(hook, 'utf8'), '#!/bin/sh\nexit 0\n');
});

test('the installed hook blocks secrets, unknown visibility and stale index', () => {
  const fx = makeBrain({ label: 'hook run' });
  assert.equal(brain(fx, ['hooks', 'install']).status, 0);
  // No visibility record yet on this clone: blocked.
  write(fx.dir, 'notes/2026-09-30-a.md', '---\ntitle: A\ndate: 2026-09-30\nstatus: active\n---\nHello\n');
  brain(fx, ['index']);
  gitc(fx.dir, fx.env, 'add', '-A');
  // Make the fake gh fail so the hook cannot silently prove visibility.
  fx.gh.set('fail');
  let c = sh(fx.dir, 'git', ['commit', '-q', '-m', 'a'], fx.env);
  assert.notEqual(c.status, 0);
  assert.match(c.stderr, /visibility is unknown/);
  fx.gh.set('private');
  c = sh(fx.dir, 'git', ['commit', '-q', '-m', 'a'], fx.env);
  assert.equal(c.status, 0, c.stderr);
  // Stale index blocks.
  write(fx.dir, 'notes/2026-09-30-b.md', '---\ntitle: B\ndate: 2026-09-30\nstatus: active\n---\n');
  gitc(fx.dir, fx.env, 'add', '-A');
  c = sh(fx.dir, 'git', ['commit', '-q', '-m', 'b'], fx.env);
  assert.notEqual(c.status, 0);
  assert.match(c.stderr, /out of date/);
  // Regenerated but unstaged index blocks.
  brain(fx, ['index']);
  c = sh(fx.dir, 'git', ['commit', '-q', '-m', 'b'], fx.env);
  assert.match(c.stderr, /not staged/);
  gitc(fx.dir, fx.env, 'add', 'INDEX.md', 'INDEX.jsonl');
  assert.equal(sh(fx.dir, 'git', ['commit', '-q', '-m', 'b'], fx.env).status, 0);
  // Repository turns public right after a fresh private proof: the hook
  // checks live on every commit, so the fresh cached proof does not help.
  assert.equal(brain(fx, ['setup', 'visibility']).status, 0);
  fx.gh.set('public');
  write(fx.dir, 'notes/2026-09-30-c.md', '---\ntitle: C\ndate: 2026-09-30\nstatus: active\n---\n');
  brain(fx, ['index']);
  gitc(fx.dir, fx.env, 'add', '-A');
  const head = gitc(fx.dir, fx.env, 'rev-parse', 'HEAD');
  c = sh(fx.dir, 'git', ['commit', '-q', '-m', 'c'], fx.env);
  assert.notEqual(c.status, 0);
  assert.match(c.stderr, /push destination is public: remote "origin" \(github\.com\/example-user\/brain\) is PUBLIC/);
  assert.equal(gitc(fx.dir, fx.env, 'rev-parse', 'HEAD'), head);
});

test('the hook validates and indexes the staged snapshot, not the working copy', () => {
  const fx = makeBrain({ label: 'partial staging' });
  assert.equal(brain(fx, ['hooks', 'install']).status, 0);
  assert.equal(brain(fx, ['setup', 'visibility']).status, 0);
  const rel = 'notes/metadata.md';
  const rec = (status, title = 'Metadata') => `---\ntitle: ${title}\ndate: 2026-09-30\nstatus: ${status}\n---\nBody.\n`;
  const count = () => gitc(fx.dir, fx.env, 'rev-list', '--count', 'HEAD').trim();
  const before = count();
  // Invalid metadata is staged; only the working copy is corrected.
  write(fx.dir, rel, rec('impossible'));
  gitc(fx.dir, fx.env, 'add', rel);
  write(fx.dir, rel, rec('active'));
  assert.equal(brain(fx, ['index']).status, 0);
  gitc(fx.dir, fx.env, 'add', 'INDEX.md', 'INDEX.jsonl');
  const direct = brain(fx, ['hook', 'pre-commit']);
  assert.equal(direct.status, 1);
  assert.match(direct.stderr, /staged records have invalid frontmatter/);
  assert.match(direct.stderr, /notes\/metadata\.md: status "impossible"/);
  let c = sh(fx.dir, 'git', ['commit', '-q', '-m', 'partial'], fx.env);
  assert.notEqual(c.status, 0, 'a real commit is blocked too');
  assert.equal(count(), before);
  // Valid but different staged metadata: the staged index describes the
  // working copy, not what would be committed.
  write(fx.dir, rel, rec('active', 'Staged title'));
  gitc(fx.dir, fx.env, 'add', rel);
  write(fx.dir, rel, rec('done', 'Working title'));
  brain(fx, ['index']);
  gitc(fx.dir, fx.env, 'add', 'INDEX.md', 'INDEX.jsonl');
  c = sh(fx.dir, 'git', ['commit', '-q', '-m', 'partial'], fx.env);
  assert.notEqual(c.status, 0);
  assert.match(c.stderr, /out of date for the staged records/);
  assert.equal(count(), before);
  // Staging the record the index describes makes the snapshot consistent.
  gitc(fx.dir, fx.env, 'add', rel);
  c = sh(fx.dir, 'git', ['commit', '-q', '-m', 'consistent'], fx.env);
  assert.equal(c.status, 0, c.stderr);
  assert.match(gitc(fx.dir, fx.env, 'show', `HEAD:${rel}`), /^status: done$/m);
  assert.match(gitc(fx.dir, fx.env, 'show', 'HEAD:INDEX.jsonl'), /"title":"Working title".*"status":"done"/);
  // A valid staged record whose regenerated index is left unstaged.
  write(fx.dir, 'notes/second.md', rec('active', 'Second'));
  gitc(fx.dir, fx.env, 'add', 'notes/second.md');
  brain(fx, ['index']);
  c = sh(fx.dir, 'git', ['commit', '-q', '-m', 'second'], fx.env);
  assert.match(c.stderr, /regenerated index is not staged/);
});
