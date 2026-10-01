// End to end: a fresh synthetic clone goes through setup on device A,
// commits through the hook, then device B clones and joins.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeBrain, brain, gitc, sh, makeEnv, fakeGh, cleanup, write, GH_URL } from './helpers.mjs';
import { sha256 } from '../lib/util.mjs';

after(cleanup);

function treeHashes(dir, env) {
  const files = gitc(dir, env, 'ls-files').split(/\r?\n/).filter(Boolean);
  return Object.fromEntries(files.map((f) => [f, sha256(fs.readFileSync(path.join(dir, f)))]));
}

test('setup on device A, join on device B, records preserved', () => {
  const a = makeBrain({ label: 'e2e' });
  // Device A: guided setup through the helper commands the guide uses.
  assert.match(brain(a, ['setup', 'status']).stdout, /Brain ready: no/);
  assert.equal(brain(a, ['setup', 'visibility']).status, 0);
  const answers = {
    work: 'Robin Example, invented solo developer.',
    goals: 'Ship an invented beta this quarter.',
    projects: '- Lantern Garden (fictional): active',
    preferences: 'Short answers, bullets.',
    tools: 'Two agents on a laptop labeled studio laptop.',
    rhythms: 'Deep work in the morning.',
  };
  for (const [id, text] of Object.entries(answers)) assert.equal(brain(a, ['setup', 'answer', id, '--from', '-'], `${text}\n`).status, 0);
  assert.equal(brain(a, ['setup', 'skip', 'people']).status, 0);
  assert.equal(brain(a, ['setup', 'answer', 'memory', '--policy', 'save-routine', '--from', '-'], 'Never save health topics.\n').status, 0);
  assert.equal(brain(a, ['setup', 'review']).status, 0);
  const fin = brain(a, ['setup', 'finalize', '--approve']);
  assert.equal(fin.status, 0, fin.stderr);
  assert.equal(brain(a, ['hooks', 'install']).status, 0);
  const dec = brain(a, ['new', 'decision', 'Use', 'Friday', 'reviews']);
  assert.equal(dec.status, 0, dec.stderr);
  assert.match(dec.stdout, /decisions\/2026-09-30-use-friday-reviews\.md/);
  gitc(a.dir, a.env, 'add', '-A');
  const commit = sh(a.dir, 'git', ['commit', '-q', '-m', 'Set up my brain'], a.env);
  assert.equal(commit.status, 0, commit.stderr);
  gitc(a.dir, a.env, 'push', '-q', a.bare, 'main');
  const doctorA = brain(a, ['doctor']);
  assert.equal(doctorA.status, 0, doctorA.stdout);
  assert.match(doctorA.stdout, /\[ok {2}\] setup: ready/);
  assert.match(doctorA.stdout, /\[ok {2}\] pre-commit hook: installed/);

  // Device B: separate home, separate global git config, fresh clone.
  const homeB = path.join(a.base, 'device b home');
  fs.mkdirSync(homeB);
  const ghB = fakeGh(homeB, 'private');
  const envB = makeEnv(homeB, { TONKA_GH_BIN: ghB.script });
  const dirB = path.join(a.base, 'device b clone');
  gitc(a.base, envB, 'clone', '-q', path.join(a.base, 'origin repo.git'), dirB);
  // As if cloned from GitHub: pushes are assessed against that repository.
  gitc(dirB, envB, 'remote', 'set-url', '--push', 'origin', GH_URL());
  const b = { dir: dirB, env: envB, base: a.base };
  assert.equal(sh(dirB, 'git', ['config', '--get', 'core.hooksPath'], envB).status, 1, 'hooks are not inherited by cloning');
  const before = treeHashes(dirB, envB);
  const stB = brain(b, ['setup', 'status']);
  assert.match(stB.stdout + stB.stderr, /On this device run: node system\/bin\/brain\.mjs join/);
  const join = brain(b, ['join']);
  assert.equal(join.status, 0, join.stdout + join.stderr);
  assert.match(join.stdout, /Portable records were left untouched/);
  assert.match(join.stdout, /Hook: installed for this clone/);
  assert.deepEqual(treeHashes(dirB, envB), before, 'join changed no tracked file');
  assert.equal(gitc(dirB, envB, 'status', '--porcelain').trim(), '');
  assert.ok(fs.existsSync(path.join(dirB, '.brain', 'machine.json')));
  assert.match(brain(b, ['setup', 'status']).stdout, /Brain is ready\. Daily use/);
  // Running join again is safe.
  assert.equal(brain(b, ['join']).status, 0);
  assert.deepEqual(treeHashes(dirB, envB), before);

  // Device B adds and archives records through the hook, A receives them.
  write(dirB, 'lessons/2026-09-30-write-rule-first.md', '---\ntitle: Write the rule first\ndate: 2026-09-30\nstatus: active\ntags: [records]\n---\nRule first.\n');
  assert.equal(brain(b, ['archive', 'decisions/2026-09-30-use-friday-reviews.md', '--status', 'superseded', '--superseded-by', 'lessons/2026-09-30-write-rule-first.md']).status, 0);
  gitc(dirB, envB, 'add', '-A');
  assert.equal(sh(dirB, 'git', ['commit', '-q', '-m', 'Lesson and archive'], envB).status, 0);
  gitc(dirB, envB, 'push', '-q', a.bare, 'main');
  gitc(a.dir, a.env, 'pull', '-q', '--ff-only', 'origin', 'main');
  assert.equal(brain(a, ['check', '--strict']).status, 0);
  const idx = fs.readFileSync(path.join(a.dir, 'INDEX.jsonl'), 'utf8');
  assert.match(idx, /lessons\/2026-09-30-write-rule-first\.md/);
  assert.doesNotMatch(idx, /use-friday-reviews/);
  const archived = fs.readFileSync(path.join(a.dir, 'archives', 'decisions', '2026-09-30-use-friday-reviews.md'), 'utf8');
  assert.match(archived, /^status: superseded$/m);
  assert.match(archived, /^superseded_by: lessons\/2026-09-30-write-rule-first\.md$/m);
});

test('join on an unready brain points to setup; join with an existing hook manager is non-destructive', () => {
  const fx = makeBrain({ label: 'join edge' });
  const r = brain(fx, ['join']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /has not completed setup/);
  write(fx.dir, 'context/setup.md', '---\ntitle: Brain setup\ndate: 2026-09-30\nstatus: active\nsetup_version: 1\n---\n');
  fs.writeFileSync(path.join(fx.dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
  const j = brain(fx, ['join']);
  assert.match(j.stdout, /Hook not installed: a pre-commit hook already exists/);
  assert.match(j.stdout, /\[warn\] pre-commit hook: conflict/);
  assert.equal(fs.readFileSync(path.join(fx.dir, '.git', 'hooks', 'pre-commit'), 'utf8'), '#!/bin/sh\nexit 0\n');
});
