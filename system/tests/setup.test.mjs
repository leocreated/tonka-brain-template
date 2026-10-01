import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeBrain, brain, gitc, write, cleanup, fake, fakeGh, makeEnv, GH_URL } from './helpers.mjs';

after(cleanup);

const SECTIONS = ['work', 'goals', 'projects', 'preferences', 'people', 'tools', 'rhythms'];

function answerAll(fx, { skip = [] } = {}) {
  for (const id of SECTIONS) {
    const r = skip.includes(id)
      ? brain(fx, ['setup', 'skip', id])
      : brain(fx, ['setup', 'answer', id, '--from', '-'], `- ${id} summary for Robin Example\n`);
    assert.equal(r.status, 0, r.stderr);
  }
  const m = brain(fx, ['setup', 'answer', 'memory', '--policy', 'ask-first', '--from', '-'], 'Never save health topics.\n');
  assert.equal(m.status, 0, m.stderr);
}

const tracked = (fx) => gitc(fx.dir, fx.env, 'status', '--porcelain', '--untracked-files=all').trim();

test('public repository: no answers accepted and no tracked writes', () => {
  const fx = makeBrain({ label: 'public', ghMode: 'public' });
  const v = brain(fx, ['setup', 'visibility']);
  assert.equal(v.status, 1);
  assert.match(v.stdout, /public/);
  assert.match(v.stdout, /private copy/);
  const a = brain(fx, ['setup', 'answer', 'work', '--from', '-'], 'personal detail\n');
  assert.equal(a.status, 1);
  assert.match(a.stderr, /privacy gate first/);
  const att = brain(fx, ['setup', 'visibility', '--attest-private']);
  assert.equal(att.status, 1, 'attestation must not override live public proof');
  assert.equal(tracked(fx), '');
  assert.ok(!fs.existsSync(path.join(fx.dir, '.brain', 'setup', 'drafts', 'work.md')));
});

test('unknown visibility needs an explicit attestation, recorded as such', () => {
  const fx = makeBrain({ label: 'unknown', ghMode: 'fail' });
  const v = brain(fx, ['setup', 'visibility']);
  assert.equal(v.status, 1);
  assert.match(v.stdout, /unknown/);
  assert.equal(brain(fx, ['setup', 'answer', 'work', '--from', '-'], 'x\n').status, 1);
  const att = brain(fx, ['setup', 'visibility', '--attest-private']);
  assert.equal(att.status, 0, att.stderr);
  assert.match(att.stdout, /attestation, not live proof/);
  const rec = JSON.parse(fs.readFileSync(path.join(fx.dir, '.brain', 'visibility.json'), 'utf8'));
  assert.equal(rec.method, 'attestation');
  answerAll(fx);
  assert.equal(brain(fx, ['setup', 'review']).status, 0);
  // gh starts working and reports public: live proof beats the attestation.
  fx.gh.set('public');
  const fin = brain(fx, ['setup', 'finalize', '--approve']);
  assert.equal(fin.status, 1);
  assert.match(fin.stderr, /privacy gate failed/);
  assert.equal(tracked(fx), '');
});

test('local-only clone (no remote) can proceed by attestation', () => {
  const fx = makeBrain({ label: 'local', remote: false });
  assert.match(brain(fx, ['setup', 'visibility']).stdout, /no git remote/);
  assert.equal(brain(fx, ['setup', 'visibility', '--attest-private']).status, 0);
  answerAll(fx, { skip: SECTIONS });
  assert.equal(brain(fx, ['setup', 'review']).status, 0);
  assert.equal(brain(fx, ['setup', 'finalize', '--approve']).status, 0);
  assert.match(fs.readFileSync(path.join(fx.dir, 'context', 'profile.md'), 'utf8'), /Skipped during setup on 2026-09-30/);
  assert.ok(!fs.existsSync(path.join(fx.dir, 'people', 'overview.md')), 'skipped people topic writes no people file');
});

test('private: resumable interview, review gate, finalize without commit', () => {
  const fx = makeBrain({ label: 'private' });
  let s = brain(fx, ['setup', 'status']);
  assert.match(s.stdout, /Privacy gate first/);
  assert.equal(brain(fx, ['setup', 'visibility']).status, 0);
  // Partial progress, then a new process resumes from the next topic.
  write(fx.dir, '.brain/setup/drafts/work.md', 'Product designer at an invented studio.\n');
  assert.equal(brain(fx, ['setup', 'answer', 'work']).status, 0);
  assert.equal(brain(fx, ['setup', 'skip', 'goals']).status, 0);
  s = brain(fx, ['setup', 'status', '--json']);
  const st = JSON.parse(s.stdout);
  assert.deepEqual(st.pending.slice(0, 1), ['projects']);
  assert.equal(st.state.sections.goals.status, 'skipped');
  assert.equal(tracked(fx), '', 'drafts stay in ignored local state');
  // memory cannot be skipped and needs a policy
  assert.equal(brain(fx, ['setup', 'skip', 'memory']).status, 1);
  assert.match(brain(fx, ['setup', 'answer', 'memory', '--from', '-'], 'x\n').stderr, /--policy/);
  // credential-shaped and transcript-sized drafts are refused
  const bad = brain(fx, ['setup', 'answer', 'tools', '--from', '-'], `my key is ${fake.github()}\n`);
  assert.equal(bad.status, 1);
  assert.ok(!bad.stderr.includes(fake.github()));
  assert.equal(brain(fx, ['setup', 'answer', 'tools', '--from', '-'], 'x'.repeat(13000)).status, 1);
  // finalize before everything is handled fails
  assert.equal(brain(fx, ['setup', 'finalize', '--approve']).status, 1);
  answerAll(fx);
  assert.equal(brain(fx, ['setup', 'finalize', '--approve']).status, 1, 'no review yet');
  const rv = brain(fx, ['setup', 'review']);
  assert.equal(rv.status, 0);
  assert.match(rv.stdout, /===== context\/memory-policy.md =====/);
  assert.equal(tracked(fx), '', 'review writes nothing tracked');
  // changing a draft after review requires another review
  brain(fx, ['setup', 'answer', 'goals', '--from', '-'], 'Ship the beta this quarter.\n');
  assert.match(brain(fx, ['setup', 'finalize', '--approve']).stderr, /changed since the last review/);
  brain(fx, ['setup', 'review']);
  assert.match(brain(fx, ['setup', 'finalize']).stderr, /--approve/);
  const fin = brain(fx, ['setup', 'finalize', '--approve']);
  assert.equal(fin.status, 0, fin.stderr);
  assert.match(fin.stdout, /Nothing was committed/);
  for (const f of ['context/profile.md', 'context/priorities.md', 'context/preferences.md', 'context/memory-policy.md', 'context/setup.md', 'people/overview.md']) {
    assert.ok(fs.existsSync(path.join(fx.dir, f)), f);
  }
  assert.equal(gitc(fx.dir, fx.env, 'rev-list', '--count', 'HEAD').trim(), '1', 'no commit was made');
  assert.equal(brain(fx, ['check', '--strict']).status, 0, 'generated records are valid and indexed');
  const idx = fs.readFileSync(path.join(fx.dir, 'INDEX.jsonl'), 'utf8');
  assert.match(idx, /context\/memory-policy.md/);
  assert.match(brain(fx, ['setup', 'status']).stdout, /Brain ready: yes/);
});

test('rerun preserves hand edits and is safe to repeat', () => {
  const fx = makeBrain({ label: 'rerun' });
  brain(fx, ['setup', 'visibility']);
  answerAll(fx);
  brain(fx, ['setup', 'review']);
  assert.equal(brain(fx, ['setup', 'finalize', '--approve']).status, 0);
  gitc(fx.dir, fx.env, 'add', '-A');
  gitc(fx.dir, fx.env, 'commit', '-q', '-m', 'setup');
  // A ready brain with nothing reopened has nothing to review or rewrite.
  const again = brain(fx, ['setup', 'review']);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /no topic is being revised/);
  assert.equal(brain(fx, ['setup', 'finalize', '--approve']).status, 1);
  assert.match(brain(fx, ['setup', 'answer', 'work', '--from', '-'], 'x\n').stderr, /setup reopen work/);
  assert.equal(tracked(fx), '');
  // The user edits profile.md by hand, then revises the work topic: the
  // revision replaces only that section and the hand edit stays in place.
  const profile = path.join(fx.dir, 'context', 'profile.md');
  fs.appendFileSync(profile, '\nMy own hand-written note.\n');
  assert.equal(brain(fx, ['setup', 'reopen', 'work']).status, 0);
  brain(fx, ['setup', 'answer', 'work', '--from', '-'], 'New role summary.\n');
  assert.equal(brain(fx, ['setup', 'review']).status, 0);
  const fin = brain(fx, ['setup', 'finalize', '--approve']);
  assert.equal(fin.status, 0, fin.stderr);
  assert.match(fin.stdout, /wrote {5}context\/profile\.md/);
  const text = fs.readFileSync(profile, 'utf8');
  assert.match(text, /My own hand-written note/);
  assert.match(text, /## Work and roles\n\nNew role summary\.\n\n## Working rhythms/);
  assert.doesNotMatch(text, /work summary for Robin Example/);
  assert.match(text, /rhythms summary for Robin Example/);
  // If the user restructured the file so the section cannot be found, the
  // file is left alone and the revision becomes a proposal.
  fs.writeFileSync(profile, text.replace('## Work and roles', '## What I do'));
  const handEdited = fs.readFileSync(profile, 'utf8');
  brain(fx, ['setup', 'reopen', 'work']);
  brain(fx, ['setup', 'answer', 'work', '--from', '-'], 'Another role summary.\n');
  assert.match(brain(fx, ['setup', 'review']).stdout, /stays exactly as it is/);
  const fin2 = brain(fx, ['setup', 'finalize', '--approve']);
  assert.equal(fin2.status, 0, fin2.stderr);
  assert.match(fin2.stdout, /preserved context\/profile\.md/);
  assert.equal(fs.readFileSync(profile, 'utf8'), handEdited);
  const proposed = fs.readFileSync(path.join(fx.dir, '.brain', 'setup', 'proposed', 'context', 'profile.md'), 'utf8');
  assert.match(proposed, /Another role summary/);
});

test('second device revises one topic from the portable records', () => {
  // Device A completes setup and pushes it.
  const a = makeBrain({ label: 'revise a' });
  assert.equal(brain(a, ['setup', 'visibility']).status, 0);
  answerAll(a, { skip: ['goals', 'people', 'rhythms'] });
  assert.equal(brain(a, ['setup', 'review']).status, 0);
  assert.equal(brain(a, ['setup', 'finalize', '--approve']).status, 0);
  gitc(a.dir, a.env, 'add', '-A');
  gitc(a.dir, a.env, 'commit', '-q', '-m', 'setup');
  gitc(a.dir, a.env, 'push', '-q', a.bare, 'main');
  // Device B: fresh clone with no local setup state, joins.
  const homeB = path.join(a.base, 'device b home');
  fs.mkdirSync(homeB);
  const ghB = fakeGh(homeB, 'private');
  const b = { dir: path.join(a.base, 'device b clone'), env: makeEnv(homeB, { TONKA_GH_BIN: ghB.script }) };
  gitc(a.base, b.env, 'clone', '-q', a.bare, b.dir);
  gitc(b.dir, b.env, 'remote', 'set-url', '--push', 'origin', GH_URL());
  assert.equal(brain(b, ['join', '--no-hooks']).status, 0);
  const read = (rel) => fs.readFileSync(path.join(b.dir, rel), 'utf8');
  // Hand edits on B that the revision must keep.
  fs.appendFileSync(path.join(b.dir, 'context', 'preferences.md'), '\n## My own notes\n\nKeep this paragraph.\n');
  fs.appendFileSync(path.join(b.dir, 'context', 'profile.md'), '\nHand note under tools.\n');
  const untouched = ['context/profile.md', 'context/priorities.md', 'context/memory-policy.md', 'context/setup.md'];
  const before = Object.fromEntries(untouched.map((f) => [f, read(f)]));

  const ro = brain(b, ['setup', 'reopen', 'preferences']);
  assert.equal(ro.status, 0, ro.stderr);
  assert.match(ro.stdout, /Only this topic's section will change/);
  assert.equal(fs.readFileSync(path.join(b.dir, '.brain', 'setup', 'drafts', 'preferences.md'), 'utf8'), '- preferences summary for Robin Example\n', 'draft starts from the committed text');
  const st = JSON.parse(brain(b, ['setup', 'status', '--json']).stdout);
  assert.deepEqual(st.pending, ['preferences'], 'only the reopened topic is pending');
  assert.match(st.next, /setup answer preferences/);
  assert.equal(brain(b, ['setup', 'answer', 'preferences', '--from', '-'], 'Direct answers, no small talk.\n').status, 0);
  const rv = brain(b, ['setup', 'review']);
  assert.equal(rv.status, 0, rv.stderr);
  assert.match(rv.stdout, /Targeted revision of: preferences/);
  assert.doesNotMatch(rv.stdout, /===== context\/profile\.md/);
  const fin = brain(b, ['setup', 'finalize', '--approve']);
  assert.equal(fin.status, 0, fin.stderr);
  const prefs = read('context/preferences.md');
  assert.match(prefs, /## Preferences and communication\n\nDirect answers, no small talk\.\n/);
  assert.doesNotMatch(prefs, /preferences summary for Robin Example/);
  assert.match(prefs, /## My own notes\n\nKeep this paragraph\./);
  assert.match(prefs, /^updated: 2026-09-30$/m);
  for (const f of untouched) assert.equal(read(f), before[f], `${f} unchanged`);
  assert.equal(brain(b, ['check', '--strict']).status, 0);
  assert.match(brain(b, ['setup', 'status']).stdout, /Brain is ready\. Daily use/);

  // A topic skipped at setup can be filled in later; a reopened topic can be
  // dropped again; the memory policy can change.
  assert.match(brain(b, ['setup', 'reopen', 'goals']).stdout, /starting point/);
  brain(b, ['setup', 'answer', 'goals', '--from', '-'], 'Finish the invented course by spring.\n');
  brain(b, ['setup', 'reopen', 'rhythms']);
  assert.match(brain(b, ['setup', 'skip', 'rhythms']).stdout, /no longer being revised/);
  brain(b, ['setup', 'reopen', 'memory']);
  assert.equal(brain(b, ['setup', 'answer', 'memory', '--policy', 'manual-only', '--from', '-'], 'Never save health topics.\n').status, 0);
  assert.equal(brain(b, ['setup', 'review']).status, 0);
  assert.equal(brain(b, ['setup', 'finalize', '--approve']).status, 0);
  const pri = read('context/priorities.md');
  assert.match(pri, /## Goals and time horizons\n\nFinish the invented course by spring\.\n/);
  assert.match(pri, /## Current projects\n\n- projects summary for Robin Example/);
  assert.match(read('context/profile.md'), /Skipped during setup on 2026-09-30/, 'rhythms left as committed');
  assert.match(read('context/memory-policy.md'), /^memory_policy: manual-only$/m);
  assert.match(read('context/memory-policy.md'), /^Policy: \*\*manual-only\*\*\./m);
  assert.match(read('context/setup.md'), /^memory_policy: manual-only$/m);
  assert.match(read('context/setup.md'), /^- goals: answered$/m);
  assert.match(read('context/setup.md'), /^- rhythms: skipped$/m);
  assert.equal(brain(b, ['check', '--strict']).status, 0);
});

test('refuses to use .brain when it is not ignored', () => {
  const fx = makeBrain({ label: 'ignore' });
  fs.writeFileSync(path.join(fx.dir, '.gitignore'), 'node_modules/\n');
  const r = brain(fx, ['setup', 'visibility']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not ignored/);
});
