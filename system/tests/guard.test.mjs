import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeBrain, brain, gitc, write, cleanup, fake } from './helpers.mjs';
import { scanText, scanBuffer, forbiddenFilename } from '../lib/secrets.mjs';

after(cleanup);

test('credential shapes are detected; personal prose is allowed', () => {
  for (const [name, value] of Object.entries(fake)) {
    assert.ok(scanText(`line one\n${value()}\n`).length > 0, `${name} should be detected`);
  }
  const prose = [
    'My password manager is the family vault; never paste passwords here.',
    'The token for the bus is in my wallet. Secret santa list is in notes.',
    'password: see the password manager entry "Work VPN"',
    'api_key = <stored in the vault>',
    'Call Juniper about the 2026 plan; her number is in my phone.',
    'postgres://user:<password>@localhost/db',
    'sk-ant- is the prefix Anthropic keys use (documentation only).',
  ].join('\n');
  assert.deepEqual(scanText(prose), []);
});

test('UTF-16 text and binary blobs are decoded before scanning', () => {
  const secret = `notes\n${fake.github()}\n`;
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(secret, 'utf16le')]);
  assert.equal(scanBuffer(le).encoding, 'utf16le');
  assert.equal(scanBuffer(le).findings[0].rule, 'github-token');
  const noBom = Buffer.from(secret, 'utf16le');
  assert.equal(scanBuffer(noBom).findings.length, 1);
  const be = Buffer.from(secret, 'utf16le');
  be.swap16();
  assert.equal(scanBuffer(Buffer.concat([Buffer.from([0xfe, 0xff]), be])).findings.length, 1);
  const bin = Buffer.concat([Buffer.from([0, 1, 2, 3, 0, 0]), Buffer.from(fake.aws()), Buffer.from([0, 9])]);
  const r = scanBuffer(bin);
  assert.equal(r.binary, true);
  assert.equal(r.findings[0].rule, 'aws-access-key-id');
});

test('forbidden file names', () => {
  assert.ok(forbiddenFilename('.env'));
  assert.ok(forbiddenFilename('config/.env.local'));
  assert.equal(forbiddenFilename('.env.example'), null);
  assert.ok(forbiddenFilename('keys/id_ed25519'));
  assert.equal(forbiddenFilename('keys/id_ed25519.pub'), null);
  assert.ok(forbiddenFilename('certs/server.PEM'));
  assert.ok(forbiddenFilename('.npmrc'));
  assert.equal(forbiddenFilename('notes/passwords-policy.md'), null);
});

test('guard scans staged blobs, not the working tree, and never prints secrets', () => {
  const fx = makeBrain({ label: 'guard' });
  const secret = fake.aws();
  // Secret only in the working tree: nothing staged, guard passes.
  write(fx.dir, 'notes/2026-09-30-draft.md', `---\ntitle: Draft\ndate: 2026-09-30\nstatus: draft\n---\nkey ${secret}\n`);
  assert.equal(brain(fx, ['guard']).status, 0);
  // Stage it, then clean the working tree without restaging: still blocked.
  gitc(fx.dir, fx.env, 'add', 'notes/2026-09-30-draft.md');
  write(fx.dir, 'notes/2026-09-30-draft.md', '---\ntitle: Draft\ndate: 2026-09-30\nstatus: draft\n---\nclean now\n');
  const r = brain(fx, ['guard']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /notes\/2026-09-30-draft\.md:6 {2}aws-access-key-id/);
  assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret));
  // Restage the clean version: passes.
  gitc(fx.dir, fx.env, 'add', 'notes/2026-09-30-draft.md');
  assert.equal(brain(fx, ['guard']).status, 0);
  // UTF-16 file and a forbidden file name are caught.
  fs.writeFileSync(path.join(fx.dir, 'notes', 'export.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(fake.anthropic(), 'utf16le')]));
  write(fx.dir, '.env.local', 'NOTHING=here\n');
  gitc(fx.dir, fx.env, 'add', 'notes/export.txt', '.env.local');
  const r2 = brain(fx, ['guard']);
  assert.equal(r2.status, 1);
  assert.match(r2.stdout, /notes\/export\.txt:1 {2}anthropic-api-key/);
  assert.match(r2.stdout, /\.env\.local {2}forbidden-filename/);
  assert.ok(!r2.stdout.includes(fake.anthropic()));
  // guard --all sees everything in the index.
  assert.equal(brain(fx, ['guard', '--all']).status, 1);
});

test('guard works before the first commit', () => {
  const fx = makeBrain({ label: 'unborn', remote: false });
  gitc(fx.dir, fx.env, 'checkout', '-q', '--orphan', 'fresh');
  write(fx.dir, 'notes/k.md', fake.privateKey());
  gitc(fx.dir, fx.env, 'add', 'notes/k.md');
  const r = brain(fx, ['guard']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /private-key-block/);
});
