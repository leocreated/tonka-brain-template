// release-export must refuse any folder inside the repository, however the
// path is spelled. macOS temp folders are the everyday case: /var is a link
// to /private/var, so the same folder has two names. These tests build the
// same shape with a link (a junction on Windows) in the OS temp folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, cleanup, makeBrain, brain, gitc } from './helpers.mjs';
import { releaseExport } from '../lib/release.mjs';

after(cleanup);

// Create a directory link, or return false where this system does not allow it.
function link(target, at) {
  try {
    fs.symlinkSync(target, at, 'junction');
    return true;
  } catch {
    return false;
  }
}

// A committed brain plus a second name for its parent folder.
function aliased(t, label) {
  const fx = makeBrain({ label, remote: false });
  const alias = path.join(tmpDir(`${label} alias`), 'base link');
  if (!link(fx.base, alias)) {
    t.skip('cannot create directory links here');
    return null;
  }
  return { fx, alias, aliasDir: path.join(alias, path.basename(fx.dir)) };
}

const OUTSIDE = /export folder must be outside this repository/;

test('refuses a folder inside the repo named through an aliased parent (the macOS /var shape)', (t) => {
  const s = aliased(t, 'alias out');
  if (!s) return;
  const r = brain(s.fx, ['release-export', '--out', path.join(s.aliasDir, 'inside', 'deeper')]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, OUTSIDE);
  assert.ok(!fs.existsSync(path.join(s.fx.dir, 'inside')), 'nothing was created inside the repo');
  assert.equal(gitc(s.fx.dir, s.fx.env, 'status', '--porcelain'), '');
});

test('refuses when the repository itself is named through an alias', (t) => {
  const s = aliased(t, 'alias root');
  if (!s) return;
  assert.throws(() => releaseExport(s.aliasDir, path.join(s.fx.dir, 'inside')), OUTSIDE);
  assert.ok(!fs.existsSync(path.join(s.fx.dir, 'inside')));
});

test('refuses the repository folder itself under another name', (t) => {
  const s = aliased(t, 'alias equal');
  if (!s) return;
  assert.throws(() => releaseExport(s.fx.dir, s.aliasDir), OUTSIDE);
  assert.throws(() => releaseExport(s.aliasDir, s.fx.dir), OUTSIDE);
});

test('refuses a link outside the repo that points into it', (t) => {
  const fx = makeBrain({ label: 'link in', remote: false });
  const ext = tmpDir('link in ext');
  const into = path.join(ext, 'to system');
  if (!link(path.join(fx.dir, 'system'), into)) return t.skip('cannot create directory links here');
  assert.throws(() => releaseExport(fx.dir, path.join(into, 'new export')), OUTSIDE);
  assert.ok(!fs.existsSync(path.join(fx.dir, 'system', 'new export')));
});

test('refuses a broken link instead of guessing where it leads', (t) => {
  const fx = makeBrain({ label: 'dangling', remote: false });
  const ext = tmpDir('dangling ext');
  const dangling = path.join(ext, 'dangling');
  if (!link(path.join(fx.dir, 'not yet'), dangling)) return t.skip('cannot create directory links here');
  assert.throws(() => releaseExport(fx.dir, path.join(dangling, 'out')), /is a broken link/);
  assert.ok(!fs.existsSync(path.join(fx.dir, 'not yet')));
});

test('an export outside the repo still works through an aliased parent', (t) => {
  const fx = makeBrain({ label: 'alias ok', remote: false });
  const real = tmpDir('alias ok target');
  const alias = path.join(tmpDir('alias ok link'), 'target link');
  if (!link(real, alias)) return t.skip('cannot create directory links here');
  const r = releaseExport(fx.dir, path.join(alias, 'release out'));
  const tracked = gitc(fx.dir, fx.env, 'ls-files', '-z').split('\0').filter(Boolean);
  assert.equal(r.files, tracked.length);
  for (const rel of ['AGENTS.md', 'system/bin/brain.mjs']) assert.ok(fs.existsSync(path.join(real, 'release out', rel)), rel);
  assert.equal(fs.realpathSync.native(r.out), r.out, 'reports the real folder it wrote');
});

// A child whose name merely starts with two dots is still inside: only a
// whole '..' segment leads out. These must be refused before anything is made.
const DOTTED = ['..export', '...export', '.. export'].flatMap((n) => [[n], [n, 'nested'], ['inside', n, 'nested']]);

test('refuses inside children whose names start with dots, before creating anything', () => {
  const fx = makeBrain({ label: 'dotted', remote: false });
  for (const parts of DOTTED) {
    const out = path.join(fx.dir, ...parts);
    assert.throws(() => releaseExport(fx.dir, out), OUTSIDE, parts.join('/'));
    assert.ok(!fs.existsSync(path.join(fx.dir, parts[0])), `nothing created for ${parts.join('/')}`);
  }
  const r = brain(fx, ['release-export', '--out', path.join(fx.dir, '..cli-export', 'nested')]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, OUTSIDE);
  assert.ok(!fs.existsSync(path.join(fx.dir, '..cli-export')));
  assert.equal(gitc(fx.dir, fx.env, 'status', '--porcelain'), '');
});

test('refuses dotted inside children named through an aliased parent', (t) => {
  const s = aliased(t, 'alias dotted');
  if (!s) return;
  for (const name of ['..export', '...export']) {
    assert.throws(() => releaseExport(s.fx.dir, path.join(s.aliasDir, name, 'nested')), OUTSIDE, name);
    assert.throws(() => releaseExport(s.aliasDir, path.join(s.fx.dir, name)), OUTSIDE, name);
    assert.ok(!fs.existsSync(path.join(s.fx.dir, name)), name);
  }
});

test('dotted names outside the repo, siblings and traversal paths still export', () => {
  const fx = makeBrain({ label: 'dotted ok', remote: false });
  const outs = [
    path.join(fx.dir, '..', '..sibling export'),
    path.join(fx.dir, '..', 'my brain2'),
    path.join(fx.dir, 'inside', '..', '..', 'traversal export'),
    path.join(tmpDir('dotted ext'), '..export', 'nested'),
  ];
  for (const out of outs) {
    const r = releaseExport(fx.dir, out);
    assert.ok(r.files > 0, out);
    assert.ok(fs.existsSync(path.join(r.out, 'AGENTS.md')), out);
  }
  assert.ok(!fs.existsSync(path.join(fx.dir, 'inside')));
  assert.equal(gitc(fx.dir, fx.env, 'status', '--porcelain'), '');
});
