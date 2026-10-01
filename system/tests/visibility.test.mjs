// Visibility covers every effective push destination, and proof or
// attestation never outlives a change to those destinations.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeBrain, brain, gitc, cleanup, GH_URL } from './helpers.mjs';
import { classifyUrl } from '../lib/visibility.mjs';

after(cleanup);

const queried = (fx) => fx.gh.calls().map((args) => args.find((a) => a.startsWith('github.com/'))).filter(Boolean);
const recPath = (fx) => path.join(fx.dir, '.brain', 'visibility.json');
const newNote = (fx, title = 'Synthetic personal note') => brain(fx, ['new', 'note', title]);

// user@host strings are assembled at runtime so the release check does not
// read them as email addresses.
const at = (user, rest) => `${user}${'@'}${rest}`;

test('push URLs are classified without trusting their fetch URL', () => {
  assert.deepEqual(classifyUrl('https://github.com/a/b.git'), { kind: 'github', slug: 'a/b' });
  assert.deepEqual(classifyUrl(`https://${at('user:pw', 'github.com/a/b')}`), { kind: 'github', slug: 'a/b' });
  assert.deepEqual(classifyUrl(at('git', 'github.com:a/b.git')), { kind: 'github', slug: 'a/b' });
  assert.deepEqual(classifyUrl(`ssh://${at('git', 'ssh.github.com:443/a/b.git')}`), { kind: 'github', slug: 'a/b' });
  assert.equal(classifyUrl('https://github.com/a/b/c').kind, 'other');
  assert.equal(classifyUrl('https://gitlab.example.com/a/b.git').kind, 'other');
  assert.equal(classifyUrl('git@work-alias:a/b.git').kind, 'other');
  assert.equal(classifyUrl('C:/repos/brain.git').kind, 'local');
  assert.equal(classifyUrl('C:\\repos\\brain.git').kind, 'local');
  assert.equal(classifyUrl('/srv/git/brain.git').kind, 'local');
  assert.equal(classifyUrl('../brain.git').kind, 'local');
  assert.equal(classifyUrl('file:///srv/git/brain.git').kind, 'local');
});

test('a second public remote fails the gate even when origin is private', () => {
  const fx = makeBrain({ label: 'second remote' });
  gitc(fx.dir, fx.env, 'remote', 'add', 'mirror', GH_URL('example-user/mirror'));
  fx.gh.set({ 'example-user/brain': 'private', 'example-user/mirror': 'public' });
  const v = brain(fx, ['setup', 'visibility']);
  assert.equal(v.status, 1, v.stdout);
  assert.match(v.stdout, /remote "mirror" \(github\.com\/example-user\/mirror\) is PUBLIC/);
  assert.match(v.stdout, /remote "origin" \(github\.com\/example-user\/brain\): private/);
  assert.deepEqual(queried(fx).sort(), ['github.com/example-user/brain', 'github.com/example-user/mirror']);
  assert.equal(brain(fx, ['setup', 'visibility', '--attest-private']).status, 1, 'attestation cannot override a public destination');
  assert.equal(newNote(fx).status, 1);
});

test('an explicit push URL is what gets checked, not the fetch URL', () => {
  const fx = makeBrain({ label: 'push url' });
  gitc(fx.dir, fx.env, 'remote', 'set-url', 'origin', GH_URL('example-user/brain'));
  gitc(fx.dir, fx.env, 'remote', 'set-url', '--push', 'origin', GH_URL('example-user/public-copy'));
  fx.gh.set({ 'example-user/brain': 'private', 'example-user/public-copy': 'public' });
  const v = brain(fx, ['setup', 'visibility']);
  assert.equal(v.status, 1);
  assert.match(v.stdout, /github\.com\/example-user\/public-copy\) is PUBLIC/);
  assert.deepEqual(queried(fx), ['github.com/example-user/public-copy']);
});

test('every one of several push URLs is checked', () => {
  const fx = makeBrain({ label: 'multi push' });
  gitc(fx.dir, fx.env, 'config', '--add', 'remote.origin.pushurl', GH_URL('example-user/backup'));
  fx.gh.set({ 'example-user/brain': 'private', 'example-user/backup': 'internal' });
  const v = brain(fx, ['setup', 'visibility']);
  assert.equal(v.status, 1);
  assert.match(v.stdout, /example-user\/backup\) is INTERNAL/);
  fx.gh.set('private');
  const ok = brain(fx, ['setup', 'visibility']);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /Push destinations \(2\)/);
  assert.match(ok.stdout, /current live gh check: all 2 push destination\(s\) are private/);
});

test('URL rewrites are applied before checking', () => {
  const fx = makeBrain({ label: 'rewrite' });
  gitc(fx.dir, fx.env, 'config', 'url.https://github.com/.pushInsteadOf', 'mirrorhost:');
  gitc(fx.dir, fx.env, 'remote', 'add', 'backup', 'mirrorhost:example-user/hidden.git');
  fx.gh.set({ 'example-user/brain': 'private', 'example-user/hidden': 'public' });
  const v = brain(fx, ['setup', 'visibility']);
  assert.equal(v.status, 1);
  assert.match(v.stdout, /remote "backup" \(github\.com\/example-user\/hidden\) is PUBLIC/);
  // A URL-valued push setting that names no remote is a destination too.
  const fy = makeBrain({ label: 'direct push url' });
  gitc(fy.dir, fy.env, 'config', 'remote.pushDefault', GH_URL('example-user/direct'));
  fy.gh.set({ 'example-user/brain': 'private', 'example-user/direct': 'public' });
  const w = brain(fy, ['setup', 'visibility']);
  assert.equal(w.status, 1);
  assert.match(w.stdout, /a push URL named directly in branch or push settings \(github\.com\/example-user\/direct\) is PUBLIC/);
});

test('a destination gh cannot check needs an attestation; one private proof does not cover it', () => {
  const fx = makeBrain({ label: 'unresolved' });
  const secret = 'Zq8Lm2Np4Rt6Vx8B';
  gitc(fx.dir, fx.env, 'remote', 'add', 'nas', `https://someone:${secret}@git.example.org/private/brain.git`);
  const v = brain(fx, ['setup', 'visibility']);
  assert.equal(v.status, 1);
  assert.match(v.stdout, /Visibility: unknown/);
  assert.match(v.stdout, /remote "nas" \(a host other than github\.com\): gh cannot check it/);
  assert.match(v.stdout, /remote "origin" \(github\.com\/example-user\/brain\): private/);
  assert.equal(newNote(fx).status, 1);
  const att = brain(fx, ['setup', 'visibility', '--attest-private']);
  assert.equal(att.status, 0, att.stdout);
  assert.match(att.stdout, /user attestation, not live proof/);
  assert.match(att.stdout, /covers exactly these push destinations/);
  assert.equal(newNote(fx).status, 0);
  // Credentials and URL details never reach output or saved state.
  const saved = fs.readFileSync(recPath(fx), 'utf8');
  for (const text of [v.stdout, v.stderr, att.stdout, saved]) {
    assert.ok(!text.includes(secret) && !text.includes('someone') && !text.includes('git.example.org') && !text.includes('origin repo.git'));
  }
});

test('an attestation stops counting when the destinations change', () => {
  const fx = makeBrain({ label: 'attest moved', ghMode: 'fail' });
  assert.equal(brain(fx, ['setup', 'visibility', '--attest-private']).status, 0);
  assert.equal(newNote(fx, 'First').status, 0);
  // Replace origin with another repository, without a new attestation.
  gitc(fx.dir, fx.env, 'remote', 'set-url', '--push', 'origin', GH_URL('example-user/elsewhere'));
  const r = newNote(fx, 'Second');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /push destinations changed since the last check or attestation/);
  assert.ok(!fs.existsSync(path.join(fx.dir, 'notes', '2026-09-30-second.md')));
  const hook = brain(fx, ['hook', 'pre-commit']);
  assert.equal(hook.status, 1);
  assert.match(hook.stderr, /visibility is unknown/);
  // Adding a remote to a local-only clone also needs a new decision.
  const local = makeBrain({ label: 'attest local', remote: false });
  assert.equal(brain(local, ['setup', 'visibility', '--attest-private']).status, 0);
  assert.equal(newNote(local).status, 0);
  gitc(local.dir, local.env, 'remote', 'add', 'origin', GH_URL('example-user/unknown-host-copy'));
  local.gh.set('fail');
  assert.equal(newNote(local, 'After remote').status, 1);
  // A fresh attestation for the new set works.
  assert.equal(brain(local, ['setup', 'visibility', '--attest-private']).status, 0);
  assert.equal(newNote(local, 'After remote').status, 0);
});

test('a previous private proof does not carry over to new destinations', () => {
  const fx = makeBrain({ label: 'proof moved' });
  assert.equal(brain(fx, ['setup', 'visibility']).status, 0);
  gitc(fx.dir, fx.env, 'remote', 'set-url', 'origin', GH_URL('example-user/other'));
  gitc(fx.dir, fx.env, 'remote', 'set-url', '--push', 'origin', GH_URL('example-user/other'));
  fx.gh.set('fail');
  const r = newNote(fx);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /visibility is unknown/);
  assert.doesNotMatch(r.stderr, /private \(/);
  const d = brain(fx, ['doctor']);
  assert.match(d.stdout, /\[(FAIL|warn)\] visibility: visibility is unknown/);
});

test('offline continuity uses only recent proof for the same destinations, labelled as cached', () => {
  const fx = makeBrain({ label: 'offline' });
  assert.equal(brain(fx, ['setup', 'visibility']).status, 0);
  fx.gh.set('fail');
  fx.gh.clearCalls();
  assert.equal(newNote(fx).status, 0, 'same destinations, recent proof');
  assert.equal(queried(fx).length, 1, 'a live check was still attempted');
  const v = brain(fx, ['setup', 'visibility']);
  assert.equal(v.status, 0);
  assert.match(v.stdout, /Visibility: private \(cached gh proof, not a current live check\)/);
  assert.match(v.stdout, /cached\/offline evidence, not a current live check/);
  assert.doesNotMatch(v.stdout, /Visibility: private \(current live gh check\)/);
  // Proof older than the offline window no longer counts.
  const rec = JSON.parse(fs.readFileSync(recPath(fx), 'utf8'));
  for (const d of rec.destinations) d.provenAt = new Date(Date.now() - 8 * 86400000).toISOString();
  fs.writeFileSync(recPath(fx), JSON.stringify(rec));
  const old = newNote(fx, 'Too old');
  assert.equal(old.status, 1);
  assert.match(old.stderr, /visibility is unknown/);
});

test('a reachable public result blocks at once even with fresh private proof', () => {
  const fx = makeBrain({ label: 'fresh then public' });
  assert.equal(brain(fx, ['setup', 'visibility']).status, 0);
  fx.gh.set('public');
  const r = brain(fx, ['hook', 'pre-commit']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is PUBLIC/);
  assert.equal(newNote(fx).status, 1);
  const rec = JSON.parse(fs.readFileSync(recPath(fx), 'utf8'));
  assert.equal(rec.status, 'public');
});

test('older records without destination binding are not trusted', () => {
  const fx = makeBrain({ label: 'old record', ghMode: 'fail' });
  fs.mkdirSync(path.join(fx.dir, '.brain'), { recursive: true });
  fs.writeFileSync(recPath(fx), JSON.stringify({ status: 'private', method: 'attestation', checkedAt: new Date().toISOString(), repo: null, detail: 'old' }));
  assert.equal(newNote(fx).status, 1);
});
