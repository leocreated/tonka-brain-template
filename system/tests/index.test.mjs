import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, cleanup, copyTemplate, write } from './helpers.mjs';
import { buildIndex, writeIndex, checkIndex } from '../lib/indexer.mjs';
import { validateAll, isRecordPath } from '../lib/records.mjs';

after(cleanup);

const rec = (title, extra = '') => `---\ntitle: ${title}\ndate: 2026-04-01\nstatus: active\n${extra}---\n# ${title}\n`;

function fixture() {
  const dir = copyTemplate(path.join(tmpDir('index'), 'brain copy'));
  write(dir, 'decisions/2026-04-01-pick-tool.md', rec('Pick a tool', 'tags: [tools]\nsummary: "Chose the simple one"\n'));
  write(dir, 'references/tools/editors/vim.md', rec('Editor notes'));
  write(dir, 'infra/devices/laptop/setup.md', rec('Laptop setup'));
  write(dir, 'projects/alpha/README.md', rec('Should be skipped'));
  write(dir, 'projects/alpha/plan.md', rec('Alpha plan'));
  write(dir, 'notes/examples/sample.md', rec('Example skipped'));
  write(dir, 'notes/templates/t.md', rec('Template skipped'));
  write(dir, 'notes/.hidden/secret.md', rec('Hidden skipped'));
  write(dir, 'archives/decisions/2025-01-01-old.md', rec('Archived skipped'));
  write(dir, '.brain/setup/drafts/work.md', 'local state');
  write(dir, 'lessons/2026-04-02-no-status.md', '---\ntitle: No status\ndate: 2026-04-02\n---\nstatus: active\n');
  write(dir, 'papercuts/2026-04-03-bad-date.md', '---\ntitle: Bad\ndate: 2026-04-31\nstatus: open\n---\n');
  write(dir, 'notes/2026-04-04-plain.txt', 'not markdown');
  return dir;
}

test('index walks compartments recursively and excludes non-records', () => {
  const dir = fixture();
  const b = buildIndex(dir);
  const paths = b.recs.map((r) => r.path);
  assert.deepEqual(paths, [
    'projects/alpha/plan.md',
    'decisions/2026-04-01-pick-tool.md',
    'lessons/2026-04-02-no-status.md',
    'papercuts/2026-04-03-bad-date.md',
    'references/tools/editors/vim.md',
    'infra/devices/laptop/setup.md',
  ]);
  const lesson = b.recs.find((r) => r.path.startsWith('lessons/'));
  assert.equal(lesson.status, 'unknown');
  assert.equal(lesson.metadata, 'incomplete');
  const bad = b.recs.find((r) => r.path.startsWith('papercuts/'));
  assert.equal(bad.metadata, 'invalid');
  assert.equal(bad.date, null);
  const first = JSON.parse(b.jsonl.split('\n')[1]);
  assert.deepEqual(Object.keys(first), ['path', 'compartment', 'title', 'date', 'status', 'tags', 'summary', 'metadata']);
  assert.equal(first.summary, 'Chose the simple one');
  assert.match(b.md, /\| unknown \| \[No status\]/);
});

test('isRecordPath rules', () => {
  assert.equal(isRecordPath('decisions/x.md'), true);
  assert.equal(isRecordPath('decisions/README.md'), false);
  assert.equal(isRecordPath('decisions/sub/readme.MD'), false);
  assert.equal(isRecordPath('archives/decisions/x.md'), false);
  assert.equal(isRecordPath('system/docs/x.md'), false);
  assert.equal(isRecordPath('notes/Examples/x.md'), false);
  assert.equal(isRecordPath('x.md'), false);
});

test('rebuild is deterministic and --check detects staleness', () => {
  const dir = fixture();
  writeIndex(dir);
  const first = fs.readFileSync(path.join(dir, 'INDEX.jsonl'), 'utf8');
  assert.equal(checkIndex(dir).fresh, true);
  writeIndex(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'INDEX.jsonl'), 'utf8'), first);
  write(dir, 'notes/2026-04-05-new.md', rec('New note'));
  const c = checkIndex(dir);
  assert.equal(c.fresh, false);
  assert.deepEqual(c.stale, ['INDEX.jsonl', 'INDEX.md']);
  // CRLF checkouts of the index still count as fresh.
  writeIndex(dir);
  const p = path.join(dir, 'INDEX.md');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\n/g, '\r\n'));
  assert.equal(checkIndex(dir).fresh, true);
});

test('validate: errors fail, warnings only fail in strict mode', () => {
  const dir = fixture();
  const loose = validateAll(dir);
  assert.equal(loose.ok, false);
  assert.ok(loose.problems.some((p) => p.level === 'error' && p.path.startsWith('papercuts/')));
  fs.rmSync(path.join(dir, 'papercuts/2026-04-03-bad-date.md'));
  assert.equal(validateAll(dir).ok, true);
  assert.equal(validateAll(dir, { strict: true }).ok, false);
});

test('symlinked records are skipped, not followed', (t) => {
  const dir = fixture();
  const target = path.join(tmpDir('outside'), 'outside');
  fs.mkdirSync(target);
  write(target, 'leak.md', rec('Outside'));
  try {
    fs.symlinkSync(target, path.join(dir, 'notes', 'linked'), 'junction');
  } catch {
    t.skip('cannot create links here');
    return;
  }
  const b = buildIndex(dir);
  assert.ok(!b.recs.some((r) => r.path.includes('linked')));
  assert.ok(b.skipped.some((s) => s.path === 'notes/linked'));
});
