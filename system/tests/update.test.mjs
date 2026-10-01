import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeBrain, brain, tmpDir, copyTemplate, write, cleanup, gitc } from './helpers.mjs';
import { writeManifest } from '../lib/manifest.mjs';
import { manifestPathProblem } from '../lib/update.mjs';

after(cleanup);

function release(version, edit) {
  const dir = copyTemplate(path.join(tmpDir('release'), `tonka release ${version}`));
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  pkg.version = version;
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  if (edit) edit(dir);
  writeManifest(dir);
  return dir;
}

function setupBrain(label) {
  const fx = makeBrain({ label });
  write(fx.dir, 'decisions/2026-09-01-keep.md', '---\ntitle: Keep me\ndate: 2026-09-01\nstatus: active\n---\nmine\n');
  brain(fx, ['index']);
  return fx;
}

test('dry run plans safe updates, conflicts and additions without writing', () => {
  const fx = setupBrain('update plan');
  fs.appendFileSync(path.join(fx.dir, 'system', 'docs', 'skills.md'), '\nMy local edit.\n');
  const rel = release('1.1.0', (d) => {
    fs.appendFileSync(path.join(d, 'system', 'docs', 'skills.md'), '\nUpstream change.\n');
    fs.appendFileSync(path.join(d, 'system', 'docs', 'hooks.md'), '\nUpstream hooks change.\n');
    write(d, 'system/docs/new-page.md', '# New page\n');
    fs.rmSync(path.join(d, 'system', 'docs', 'releasing.md'));
  });
  const before = gitc(fx.dir, fx.env, 'status', '--porcelain');
  const r = brain(fx, ['update', '--from', rel]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Update 1\.0\.0 -> 1\.1\.0/);
  assert.match(r.stdout, /conflict-modified\s+system\/docs\/skills\.md/);
  assert.match(r.stdout, /update\s+system\/docs\/hooks\.md/);
  assert.match(r.stdout, /add\s+system\/docs\/new-page\.md/);
  assert.match(r.stdout, /remove\s+system\/docs\/releasing\.md/);
  assert.match(r.stdout, /Dry run only/);
  assert.equal(gitc(fx.dir, fx.env, 'status', '--porcelain'), before);
});

test('apply keeps local edits and records, backs up and writes a receipt', () => {
  const fx = setupBrain('update apply');
  const skills = path.join(fx.dir, 'system', 'docs', 'skills.md');
  fs.appendFileSync(skills, '\nMy local edit.\n');
  const rel = release('1.1.0', (d) => {
    fs.appendFileSync(path.join(d, 'system', 'docs', 'skills.md'), '\nUpstream change.\n');
    fs.appendFileSync(path.join(d, 'system', 'docs', 'hooks.md'), '\nUpstream hooks change.\n');
    write(d, 'decisions/2026-09-01-keep.md', 'upstream must never write records\n');
  });
  // The release smuggles a record file; it is not in the manifest, so it is ignored.
  const r = brain(fx, ['update', '--from', rel, '--apply']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(skills, 'utf8'), /My local edit/);
  assert.doesNotMatch(fs.readFileSync(skills, 'utf8'), /Upstream change/);
  assert.match(fs.readFileSync(path.join(fx.dir, 'system', 'docs', 'hooks.md'), 'utf8'), /Upstream hooks change/);
  assert.match(fs.readFileSync(path.join(fx.dir, 'decisions', '2026-09-01-keep.md'), 'utf8'), /mine/);
  const dir = r.stdout.match(/conflict copies: (\.brain\/updates\/\S+)/)[1];
  const receipt = JSON.parse(fs.readFileSync(path.join(fx.dir, dir, 'receipt.json'), 'utf8'));
  assert.equal(receipt.to, '1.1.0');
  assert.ok(fs.existsSync(path.join(fx.dir, dir, 'backup', 'system', 'docs', 'hooks.md')));
  assert.match(fs.readFileSync(path.join(fx.dir, dir, 'incoming', 'system', 'docs', 'skills.md'), 'utf8'), /Upstream change/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fx.dir, 'system', 'template-manifest.json'), 'utf8')).version, '1.1.0');
  // A second apply of the same release changes nothing and still keeps the conflict.
  const again = brain(fx, ['update', '--from', rel]);
  assert.match(again.stdout, /conflict-modified\s+system\/docs\/skills\.md/);
  assert.doesNotMatch(again.stdout, /\bupdate\s+system/);
  assert.equal(brain(fx, ['check']).status, 0);
});

test('tampered files abort the whole update', () => {
  const fx = setupBrain('update tamper');
  const rel = release('1.1.0', (d) => fs.appendFileSync(path.join(d, 'system', 'docs', 'hooks.md'), '\nchange\n'));
  fs.appendFileSync(path.join(rel, 'system', 'lib', 'util.mjs'), '\n// injected after the manifest was written\n');
  const r = brain(fx, ['update', '--from', rel, '--apply']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /system\/lib\/util\.mjs: content does not match manifest hash/);
  assert.doesNotMatch(fs.readFileSync(path.join(fx.dir, 'system', 'docs', 'hooks.md'), 'utf8'), /\nchange\n/);
});

test('manifest path escapes and unsafe entries are rejected', () => {
  for (const bad of ['../outside.md', '/etc/passwd', 'C:/x.md', 'system\\x.md', 'a//b.md', 'decisions/2026-01-01-x.md',
    'INDEX.md', '.git/config', 'system/.BRAIN/x', 'system/con.txt', 'system/x. ', 'system/template-manifest.json']) {
    assert.ok(manifestPathProblem(bad), `${bad} should be rejected`);
  }
  assert.equal(manifestPathProblem('system/docs/x.md'), null);
  assert.equal(manifestPathProblem('decisions/README.md'), null);
  const fx = setupBrain('update escape');
  const rel = release('1.1.0');
  const mf = path.join(rel, 'system', 'template-manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  m.files.push({ path: '../escape.md', sha256: 'a'.repeat(64) });
  fs.writeFileSync(mf, JSON.stringify(m));
  const r = brain(fx, ['update', '--from', rel]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /manifest rejected/);
  assert.ok(!fs.existsSync(path.join(fx.base, 'escape.md')));
});

test('schema, name, downgrade and expected manifest hash are enforced', () => {
  const fx = setupBrain('update meta');
  const older = release('0.9.0');
  assert.match(brain(fx, ['update', '--from', older]).stderr, /older than installed/);
  const rel = release('1.1.0');
  assert.match(brain(fx, ['update', '--from', rel, '--manifest-sha256', 'f'.repeat(64)]).stderr, /does not match the expected value/);
  const mf = path.join(rel, 'system', 'template-manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  fs.writeFileSync(mf, JSON.stringify({ ...m, schema: 2 }));
  assert.match(brain(fx, ['update', '--from', rel]).stderr, /schema 2 is not supported/);
  fs.writeFileSync(mf, JSON.stringify({ ...m, name: 'something-else' }));
  assert.match(brain(fx, ['update', '--from', rel]).stderr, /expected "tonka-brain-template"/);
  assert.match(brain(fx, ['update', '--from', fx.dir]).stderr, /separate folder/);
});

test('symlinks in the package or the local path are refused', (t) => {
  const fx = setupBrain('update links');
  const rel = release('1.1.0', (d) => fs.appendFileSync(path.join(d, 'system', 'docs', 'hooks.md'), '\nchange\n'));
  const outside = path.join(tmpDir('outside'), 'outside docs');
  fs.mkdirSync(outside);
  fs.cpSync(path.join(rel, 'system', 'docs'), outside, { recursive: true });
  fs.rmSync(path.join(rel, 'system', 'docs'), { recursive: true });
  try {
    fs.symlinkSync(outside, path.join(rel, 'system', 'docs'), 'junction');
  } catch {
    t.skip('cannot create links here');
    return;
  }
  const r = brain(fx, ['update', '--from', rel]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /symlink in package/);
  // Local side: a linked template folder becomes a conflict, never written through.
  const rel2 = release('1.2.0', (d) => fs.appendFileSync(path.join(d, 'system', 'docs', 'hooks.md'), '\nchange two\n'));
  const localDocs = path.join(fx.dir, 'system', 'docs');
  const target = path.join(tmpDir('target'), 'docs target');
  fs.cpSync(localDocs, target, { recursive: true });
  fs.rmSync(localDocs, { recursive: true });
  fs.symlinkSync(target, localDocs, 'junction');
  const r2 = brain(fx, ['update', '--from', rel2, '--apply']);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /conflict-symlink\s+system\/docs\/hooks\.md/);
  assert.doesNotMatch(fs.readFileSync(path.join(target, 'hooks.md'), 'utf8'), /change two/);
});
