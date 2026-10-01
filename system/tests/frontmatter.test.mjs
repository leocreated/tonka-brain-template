import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, setFrontmatterField, formatValue } from '../lib/frontmatter.mjs';
import { checkMetadata, isValidDate } from '../lib/records.mjs';

const doc = (fm, body = '# Body\n') => `---\n${fm}\n---\n${body}`;

test('plain values, trailing comments and hash without whitespace', () => {
  const p = parseFrontmatter(doc('title: Learn C# basics   # a comment\nstatus: active # done later?\ndate: 2026-02-03'));
  assert.deepEqual(p.errors, []);
  assert.equal(p.data.title, 'Learn C# basics');
  assert.equal(p.data.status, 'active');
  assert.equal(p.data.date, '2026-02-03');
});

test('double and single quoted values keep # and colons, handle escapes', () => {
  const p = parseFrontmatter(doc([
    'title: "Plan: phase #2 \\"final\\""   # comment after quotes',
    "summary: 'It''s fine # not a comment'",
    'path: "C:\\\\work\\\\notes"',
  ].join('\n')));
  assert.deepEqual(p.errors, []);
  assert.equal(p.data.title, 'Plan: phase #2 "final"');
  assert.equal(p.data.summary, "It's fine # not a comment");
  assert.equal(p.data.path, 'C:\\work\\notes');
});

test('inline lists with quoted items and comments', () => {
  const p = parseFrontmatter(doc('tags: [alpha, "beta gamma", \'delta\']  # three tags\nempty: []'));
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.data.tags, ['alpha', 'beta gamma', 'delta']);
  assert.deepEqual(p.data.empty, []);
});

test('body text never overrides metadata', () => {
  const p = parseFrontmatter(doc('title: X\nstatus: open\ndate: 2026-01-01', '# X\n\nstatus: done\n---\nstatus: resolved\n'));
  assert.equal(p.data.status, 'open');
  const r = checkMetadata(p);
  assert.equal(r.fields.status, 'open');
});

test('missing status is reported as unknown, never guessed', () => {
  const r = checkMetadata(parseFrontmatter(doc('title: X\ndate: 2026-01-01', 'status: active\n')));
  assert.equal(r.fields.status, 'unknown');
  assert.equal(r.fields.metadata, 'incomplete');
  assert.ok(r.warnings.includes('missing status'));
});

test('no frontmatter at all is incomplete', () => {
  const p = parseFrontmatter('# Just a heading\nstatus: active\n');
  assert.equal(p.hasFrontmatter, false);
  const r = checkMetadata(p);
  assert.equal(r.fields.metadata, 'incomplete');
  assert.equal(r.fields.status, 'unknown');
});

test('unsupported YAML is rejected with line numbers', () => {
  const p = parseFrontmatter(doc([
    'title: ok',
    'nested:',
    '  child: value',
    'block: |',
    'anchor: &a value',
    'map: {a: 1}',
    'bad: Plan: two',
    'nospace:value',
    'title: duplicate',
    'list: [a, , b]',
    'open: "unterminated',
    '- item',
  ].join('\n')));
  const lines = p.errors.map((e) => e.line);
  assert.deepEqual(lines, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.equal(p.data.title, 'ok');
});

test('unclosed frontmatter is an error', () => {
  const p = parseFrontmatter('---\ntitle: x\n');
  assert.equal(p.errors.length, 1);
});

test('CRLF and BOM are handled', () => {
  const p = parseFrontmatter('\uFEFF---\r\ntitle: Windows file\r\nstatus: active\r\n---\r\nbody\r\n');
  assert.deepEqual(p.errors, []);
  assert.equal(p.data.title, 'Windows file');
});

test('dates must be real calendar dates', () => {
  assert.equal(isValidDate('2026-02-28'), true);
  assert.equal(isValidDate('2024-02-29'), true);
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('2026-13-01'), false);
  assert.equal(isValidDate('26-01-01'), false);
  const r = checkMetadata(parseFrontmatter(doc('title: X\ndate: 2026-02-30\nstatus: active')));
  assert.equal(r.fields.metadata, 'invalid');
});

test('status vocabulary and tag format are enforced', () => {
  const r = checkMetadata(parseFrontmatter(doc('title: X\ndate: 2026-01-01\nstatus: finished\ntags: [Good, ok-tag]')));
  assert.equal(r.fields.status, 'unknown');
  assert.equal(r.errors.length, 2);
  assert.deepEqual(r.fields.tags, ['ok-tag']);
  const s = checkMetadata(parseFrontmatter(doc('title: X\ndate: 2026-01-01\nstatus: active\ntags: planning')));
  assert.ok(s.errors.some((e) => e.includes('must be a list')));
});

test('setFrontmatterField replaces one key and preserves the rest', () => {
  const src = doc('title: X   # keep me\nstatus: active # old\ndate: 2026-01-01');
  const out = setFrontmatterField(src, 'status', 'superseded');
  assert.match(out, /title: X {3}# keep me/);
  assert.match(out, /^status: superseded$/m);
  const added = setFrontmatterField(out, 'superseded_by', 'decisions/2026-02-01-new.md');
  assert.equal(parseFrontmatter(added).data.superseded_by, 'decisions/2026-02-01-new.md');
  assert.equal(formatValue('a: b'), '"a: b"');
  assert.equal(parseFrontmatter(doc(`t: ${formatValue('say "hi" # now')}`)).data.t, 'say "hi" # now');
});
