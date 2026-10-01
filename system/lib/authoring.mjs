// Create and archive records from the shipped templates.
import fs from 'node:fs';
import path from 'node:path';
import { COMPARTMENTS, today, slugify, writeFileAtomic, toPosix, isInside } from './util.mjs';
import { formatValue, parseFrontmatter, setFrontmatterField } from './frontmatter.mjs';
import { isRecordPath, isValidDate } from './records.mjs';
import { visibilityGate } from './visibility.mjs';
import { writeIndex } from './indexer.mjs';

export const RECORD_TYPES = {
  decision: { dir: 'decisions', dated: true },
  lesson: { dir: 'lessons', dated: true },
  papercut: { dir: 'papercuts', dated: true },
  note: { dir: 'notes', dated: true },
  person: { dir: 'people', dated: false },
  project: { dir: 'projects', dated: false },
  reference: { dir: 'references', dated: false },
  infra: { dir: 'infra', dated: false },
  context: { dir: 'context', dated: false },
};
export const ARCHIVE_STATUSES = ['done', 'resolved', 'superseded', 'archived'];

function requirePrivate(root) {
  const gate = visibilityGate(root, { refresh: true, force: true });
  if (!gate.ok) throw new Error(`privacy gate: ${gate.reason}`);
}

export function newRecord(root, type, title, { date = today() } = {}) {
  const t = RECORD_TYPES[type];
  if (!t) throw new Error(`unknown type "${type}". Types: ${Object.keys(RECORD_TYPES).join(', ')}`);
  if (!title || !title.trim()) throw new Error('a title is required');
  if (!isValidDate(date)) throw new Error(`invalid date "${date}"`);
  requirePrivate(root);
  const name = t.dated ? `${date}-${slugify(title)}.md` : `${slugify(title)}.md`;
  const rel = `${t.dir}/${name}`;
  const abs = path.join(root, rel);
  if (fs.existsSync(abs)) throw new Error(`${rel} already exists`);
  const tpl = fs.readFileSync(path.join(root, 'system', 'templates', `${type}.md`), 'utf8');
  const body = tpl
    .replace(/^title: .*$/m, `title: ${formatValue(title.trim())}`)
    .replace(/^date: .*$/m, `date: ${date}`)
    .replace(/\{\{title\}\}/g, title.trim());
  writeFileAtomic(abs, body);
  writeIndex(root);
  return rel;
}

export function archiveRecord(root, relIn, { status, supersededBy = null } = {}) {
  if (!ARCHIVE_STATUSES.includes(status)) throw new Error(`--status must be one of ${ARCHIVE_STATUSES.join(', ')}`);
  const abs = path.resolve(root, relIn);
  if (!isInside(root, abs)) throw new Error('path is outside this brain');
  const rel = toPosix(path.relative(root, abs));
  if (!isRecordPath(rel) || !COMPARTMENTS.includes(rel.split('/')[0])) throw new Error(`${rel} is not an active record`);
  if (fs.lstatSync(abs).isSymbolicLink()) throw new Error('refusing to archive a symlink');
  const dest = path.join(root, 'archives', rel);
  if (fs.existsSync(dest)) throw new Error(`archives/${rel} already exists`);
  let text = fs.readFileSync(abs, 'utf8');
  if (parseFrontmatter(text).errors.length) throw new Error(`${rel} has invalid frontmatter; fix it first (brain validate)`);
  text = setFrontmatterField(text, 'status', status);
  text = setFrontmatterField(text, 'archived', today());
  if (supersededBy) text = setFrontmatterField(text, 'superseded_by', supersededBy);
  writeFileAtomic(dest, text);
  fs.rmSync(abs);
  writeIndex(root);
  return `archives/${rel}`;
}
