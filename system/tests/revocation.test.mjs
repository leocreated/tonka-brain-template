// A public or internal result from gh revokes earlier attestation and cached
// private proof. It keeps blocking while gh cannot check that repository
// again, and only a later live private result clears it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeBrain, brain, gitc, write, cleanup, sh, GH_URL } from './helpers.mjs';

after(cleanup);

const recPath = (fx) => path.join(fx.dir, '.brain', 'visibility.json');
const saved = (fx) => JSON.parse(fs.readFileSync(recPath(fx), 'utf8'));
const newNote = (fx, title = 'Synthetic personal note') => brain(fx, ['new', 'note', title]);
const notePath = (fx, slug) => path.join(fx.dir, 'notes', `2026-09-30-${slug}.md`);
const attest = (fx) => brain(fx, ['setup', 'visibility', '--attest-private']);
const tracked = (fx) => gitc(fx.dir, fx.env, 'status', '--porcelain', '--untracked-files=all').trim();
const SECTIONS = ['work', 'goals', 'projects', 'preferences', 'people', 'tools', 'rhythms'];

function answerAll(fx) {
  for (const id of SECTIONS) {
    const r = brain(fx, ['setup', 'answer', id, '--from', '-'], `- ${id} summary for Robin Example\n`);
    assert.equal(r.status, 0, r.stderr);
  }
  const m = brain(fx, ['setup', 'answer', 'memory', '--policy', 'ask-first', '--from', '-'], 'Never save health topics.\n');
  assert.equal(m.status, 0, m.stderr);
}

function stageNote(fx, slug) {
  write(fx.dir, `notes/2026-09-30-${slug}.md`, `---\ntitle: ${slug}\ndate: 2026-09-30\nstatus: active\n---\nBody.\n`);
  assert.equal(brain(fx, ['index']).status, 0);
  gitc(fx.dir, fx.env, 'add', '-A');
}

for (const exposure of ['public', 'internal']) {
  const SHOUT = exposure.toUpperCase();

  test(`${exposure} then offline: authoring stays blocked and the old attestation does not return`, () => {
    const fx = makeBrain({ label: `revoke ${exposure} authoring`, ghMode: 'fail' });
    assert.equal(attest(fx).status, 0);
    assert.equal(newNote(fx, 'Before').status, 0);
    fx.gh.set(exposure);
    assert.equal(newNote(fx, 'While exposed').status, 1);
    fx.gh.set('fail');
    const r = newNote(fx, 'Offline again');
    assert.equal(r.status, 1, 'the old attestation must not let a new note through');
    assert.equal(saved(fx).attestation, null, 'the contradicted attestation is revoked');
    assert.match(r.stderr, new RegExp(`push destination is ${exposure}: remote "origin" \\(github\\.com/example-user/brain\\) is ${SHOUT} according to gh's last check`));
    assert.ok(!fs.existsSync(notePath(fx, 'offline-again')));
    const v = brain(fx, ['setup', 'visibility']);
    assert.equal(v.status, 1);
    assert.match(v.stdout, new RegExp(`Visibility: ${exposure} \\(cached gh result, not a current live check\\)`));
    assert.match(v.stdout, new RegExp(`${exposure} \\(last gh result, from 2\\d{3}-\\d\\d-\\d\\d; gh could not check it now\\)`));
    // A new attestation cannot override a still-known exposure.
    const att = attest(fx);
    assert.equal(att.status, 1);
    assert.match(att.stderr, new RegExp(`gh last reported remote "origin" \\(github\\.com/example-user/brain\\) as ${exposure}`));
    assert.equal(saved(fx).attestation, null);
    assert.equal(newNote(fx, 'After refused attest').status, 1);
    // The doctor and the no-refresh gate see it too.
    assert.match(brain(fx, ['doctor', '--no-refresh']).stdout, new RegExp(`visibility: push destination is ${exposure}`));
  });

  test(`${exposure} then offline: setup finalize is refused`, () => {
    const fx = makeBrain({ label: `revoke ${exposure} finalize`, ghMode: 'fail' });
    assert.equal(attest(fx).status, 0);
    answerAll(fx);
    assert.equal(brain(fx, ['setup', 'review']).status, 0);
    fx.gh.set(exposure);
    assert.equal(brain(fx, ['setup', 'finalize', '--approve']).status, 1);
    fx.gh.set('fail');
    const fin = brain(fx, ['setup', 'finalize', '--approve']);
    assert.equal(fin.status, 1, fin.stdout);
    assert.match(fin.stderr, new RegExp(`privacy gate failed: push destination is ${exposure}`));
    assert.equal(attest(fx).status, 1);
    assert.equal(brain(fx, ['setup', 'finalize', '--approve']).status, 1);
    assert.equal(tracked(fx), '');
    // Drafts cannot be revised in the meantime either.
    assert.match(brain(fx, ['setup', 'answer', 'work', '--from', '-'], 'more\n').stderr, /privacy gate first: push destination is/);
  });

  test(`${exposure} then offline: a real hooked commit is blocked`, () => {
    const fx = makeBrain({ label: `revoke ${exposure} hook`, ghMode: 'fail' });
    assert.equal(brain(fx, ['hooks', 'install']).status, 0);
    assert.equal(attest(fx).status, 0);
    stageNote(fx, 'first');
    let c = sh(fx.dir, 'git', ['commit', '-q', '-m', 'first'], fx.env);
    assert.equal(c.status, 0, c.stderr);
    const head = gitc(fx.dir, fx.env, 'rev-parse', 'HEAD');
    stageNote(fx, 'second');
    fx.gh.set(exposure);
    c = sh(fx.dir, 'git', ['commit', '-q', '-m', 'second'], fx.env);
    assert.notEqual(c.status, 0);
    fx.gh.set('fail');
    c = sh(fx.dir, 'git', ['commit', '-q', '-m', 'second'], fx.env);
    assert.notEqual(c.status, 0, 'the old attestation must not let the commit through');
    assert.match(c.stderr, new RegExp(`TONKA guard: push destination is ${exposure}`));
    assert.equal(attest(fx).status, 1);
    c = sh(fx.dir, 'git', ['commit', '-q', '-m', 'second'], fx.env);
    assert.notEqual(c.status, 0);
    assert.equal(gitc(fx.dir, fx.env, 'rev-parse', 'HEAD'), head);
  });
}

test('only a later live private result clears a known exposure', () => {
  const fx = makeBrain({ label: 'revoke recovery' });
  assert.equal(brain(fx, ['hooks', 'install']).status, 0);
  assert.equal(brain(fx, ['setup', 'visibility']).status, 0, 'fresh live private proof');
  fx.gh.set('public');
  assert.equal(newNote(fx, 'Exposed').status, 1);
  const rec = saved(fx);
  assert.equal(rec.destinations[0].provenAt, null, 'the private proof is revoked');
  // The earlier private proof is recent, but it does not come back offline.
  fx.gh.set('fail');
  const r = newNote(fx, 'Offline');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is PUBLIC according to gh's last check/);
  assert.doesNotMatch(r.stderr, /cached\/offline evidence/);
  // The repository was made private and gh can see it again.
  fx.gh.set('private');
  assert.equal(newNote(fx, 'Recovered').status, 0);
  stageNote(fx, 'recovered-commit');
  const c = sh(fx.dir, 'git', ['commit', '-q', '-m', 'recovered'], fx.env);
  assert.equal(c.status, 0, c.stderr);
  // After recovery the usual offline continuity applies, labelled as cached.
  fx.gh.set('fail');
  assert.equal(newNote(fx, 'Offline after recovery').status, 0);
  const v = brain(fx, ['setup', 'visibility']);
  assert.equal(v.status, 0);
  assert.match(v.stdout, /Visibility: private \(cached gh proof, not a current live check\)/);
  // An attestation made after a public result also does not survive one.
  const fy = makeBrain({ label: 'revoke attest recovery', ghMode: 'fail' });
  assert.equal(attest(fy).status, 0);
  fy.gh.set('internal');
  assert.equal(newNote(fy).status, 1);
  fy.gh.set('private');
  assert.equal(newNote(fy, 'Proven').status, 0);
  assert.equal(saved(fy).attestation, null, 'live proof, not the old attestation, is what counts now');
  assert.equal(saved(fy).method, 'gh');
});

test('changing the destinations neither hides a known exposure nor revives old consent', () => {
  const fx = makeBrain({ label: 'revoke changed set', ghMode: 'fail' });
  assert.equal(attest(fx).status, 0);
  fx.gh.set('public');
  assert.equal(newNote(fx).status, 1);
  fx.gh.set('fail');
  // Adding a destination makes a new set; the exposed one is still in it.
  gitc(fx.dir, fx.env, 'remote', 'add', 'nas', '/srv/git/brain.git');
  assert.equal(attest(fx).status, 1, 'a new attestation for the new set cannot cover a known public destination');
  assert.match(newNote(fx).stderr, /is PUBLIC according to gh's last check/);
  // The same repository through another URL form is still the same repository.
  // (The scp-style URL is assembled so the release check does not read it as
  // an email address.)
  gitc(fx.dir, fx.env, 'remote', 'set-url', '--push', 'origin', `git${'@'}github.com:Example-User/brain.git`);
  assert.equal(attest(fx).status, 1);
  assert.equal(newNote(fx).status, 1);
  // Removing the exposed destination needs a fresh attestation for what remains.
  gitc(fx.dir, fx.env, 'remote', 'set-url', '--push', 'origin', GH_URL('example-user/elsewhere'));
  const unknown = newNote(fx, 'Elsewhere');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /visibility is unknown/);
  assert.equal(attest(fx).status, 0, 'fresh, explicit attestation for a set with no known exposure');
  assert.equal(newNote(fx, 'Elsewhere').status, 0);
  // Pointing back at the exposed repository blocks again: neither that
  // attestation nor the first one covers it.
  gitc(fx.dir, fx.env, 'remote', 'set-url', '--push', 'origin', GH_URL());
  const back = newNote(fx, 'Back');
  assert.equal(back.status, 1);
  assert.match(back.stderr, /is PUBLIC according to gh's last check/);
  gitc(fx.dir, fx.env, 'remote', 'remove', 'nas');
  assert.equal(newNote(fx, 'Back').status, 1, 'the original destination set does not revive the original attestation');
  assert.equal(attest(fx).status, 1);
});

test('an attestation for one set does not come back when that set returns', () => {
  const fx = makeBrain({ label: 'attest no revival', ghMode: 'fail' });
  assert.equal(attest(fx).status, 0);
  assert.equal(newNote(fx, 'First').status, 0);
  gitc(fx.dir, fx.env, 'remote', 'add', 'nas', '/srv/git/brain.git');
  assert.equal(newNote(fx, 'Second').status, 1);
  gitc(fx.dir, fx.env, 'remote', 'remove', 'nas');
  const r = newNote(fx, 'Third');
  assert.equal(r.status, 1, 'returning to the attested set needs a new attestation');
  assert.match(r.stderr, /visibility is unknown/);
});

test('a record from before this rule, with an attestation beside a public result, stays blocked', () => {
  const fx = makeBrain({ label: 'revoke older record', ghMode: 'fail' });
  assert.equal(attest(fx).status, 0);
  fx.gh.set('public');
  assert.equal(newNote(fx).status, 1);
  // Rewrite the record the way the previous version saved it: the
  // attestation kept, no exposure map, the public result only on the
  // destination.
  const rec = saved(fx);
  delete rec.exposures;
  rec.attestation = { fingerprint: rec.fingerprint, at: rec.checkedAt, destinations: 1 };
  fs.writeFileSync(recPath(fx), JSON.stringify(rec));
  fx.gh.set('fail');
  const r = newNote(fx, 'Offline');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is PUBLIC according to gh's last check/);
  assert.equal(saved(fx).attestation, null);
});
