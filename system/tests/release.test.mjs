import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, tmpDir, copyTemplate, write, cleanup, fake, makeBrain, brain, gitc } from './helpers.mjs';
import { releaseCheck } from '../lib/release.mjs';
import { checkManifest } from '../lib/manifest.mjs';

after(cleanup);

const fresh = () => copyTemplate(path.join(tmpDir('release check'), 'export tree'));
const rules = (r) => r.findings.map((f) => `${f.path} ${f.rule}`);

test('the template tree itself passes the release check and strict manifest', () => {
  const r = releaseCheck(REPO);
  assert.deepEqual(rules(r), []);
  assert.equal(checkManifest(REPO, { strict: true }).ok, true);
});

test('a clean copy passes; each problem class is caught', (t) => {
  assert.equal(releaseCheck(fresh()).ok, true);
  const cases = [
    ['record', (d) => write(d, 'decisions/2026-01-01-real.md', '---\ntitle: x\n---\n'), /unexpected record/],
    ['hidden record', (d) => write(d, 'notes/.hidden.md', 'x'), /unexpected record/],
    ['secret', (d) => fs.appendFileSync(path.join(d, 'MAP.md'), `\n${fake.github()}\n`), /MAP\.md credential shape: github-token/],
    ['email', (d) => fs.appendFileSync(path.join(d, 'README.md'), `\nContact ${['someone', 'realmail.io'].join('@')}\n`), /README\.md email address/],
    ['home path', (d) => fs.appendFileSync(path.join(d, 'README.md'), `\nSee ${['C:', 'Users', 'somebody', 'notes'].join('\\')}\n`), /personal home path/],
    ['em dash', (d) => fs.appendFileSync(path.join(d, 'README.md'), `\nOne ${String.fromCharCode(0x2014)} two\n`), /em dash/],
    ['binary', (d) => fs.writeFileSync(path.join(d, 'system', 'logo.png'), Buffer.from([0x89, 0x50, 0, 0, 1])), /binary file/],
    ['utf16', (d) => fs.writeFileSync(path.join(d, 'system', 'notes16.md'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello', 'utf16le')])), /encoding utf16le/],
    ['env file', (d) => write(d, 'system/.env', 'A=1\n'), /forbidden file name/],
    ['brain state', (d) => write(d, '.brain/visibility.json', '{}'), /\.brain/],
    ['index', (d) => fs.writeFileSync(path.join(d, 'INDEX.jsonl'), '{"path":"x"}\n'), /INDEX\.jsonl index is not the generated empty index/],
    ['manifest drift', (d) => fs.appendFileSync(path.join(d, 'AGENTS.md'), '\nedit\n'), /AGENTS\.md manifest: modified/],
    ['unlisted file', (d) => write(d, 'system/extra.md', 'x\n'), /system\/extra\.md manifest: not in manifest/],
    ['example not marked', (d) => write(d, 'system/examples/people/x.md', '---\ntitle: X\n---\nreal person\n'), /example must set/],
  ];
  for (const [name, mutate, expected] of cases) {
    const d = fresh();
    mutate(d);
    const r = releaseCheck(d);
    assert.equal(r.ok, false, name);
    assert.ok(rules(r).some((x) => expected.test(x)), `${name}: ${rules(r).join('; ')}`);
  }
  const d = fresh();
  try {
    fs.symlinkSync(path.join(d, 'system'), path.join(d, 'linked'), 'junction');
    assert.ok(rules(releaseCheck(d)).some((x) => /linked symlink/.test(x)));
  } catch {
    t.diagnostic('symlink case skipped: cannot create links here');
  }
});

test('denylist terms are found without being printed, and must live outside the tree', () => {
  const d = fresh();
  fs.appendFileSync(path.join(d, 'README.md'), '\nThanks to Zebulon Quartzfield.\n');
  const list = path.join(tmpDir('deny'), 'private terms.txt');
  fs.writeFileSync(list, '# comment\nquartzfield\n');
  const r = releaseCheck(d, { denylist: list });
  assert.ok(rules(r).some((x) => x === 'README.md denylist term #1'));
  assert.ok(!JSON.stringify(r).toLowerCase().includes('quartzfield'));
});

test('release-export writes exactly the committed tree', () => {
  const fx = makeBrain({ label: 'export', remote: false });
  write(fx.dir, 'system/uncommitted.md', 'not committed\n');
  const out = path.join(fx.base, 'export out');
  const r = brain(fx, ['release-export', '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /NOT exported/);
  assert.ok(!fs.existsSync(path.join(out, 'system', 'uncommitted.md')));
  assert.equal(fs.readFileSync(path.join(out, 'AGENTS.md'), 'utf8'), fs.readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n'));
  const c = brain(fx, ['release-check', '--root', out]);
  assert.equal(c.status, 0, c.stdout);
  assert.equal(brain(fx, ['release-export', '--out', out]).status, 1, 'refuses a non-empty folder');
  assert.equal(brain(fx, ['release-export', '--out', path.join(fx.dir, 'inside')]).status, 1, 'refuses a folder inside the repo');
  gitc(fx.dir, fx.env, 'status', '--porcelain');
});
