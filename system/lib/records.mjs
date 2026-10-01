// Record discovery and metadata validation.
import fs from 'node:fs';
import path from 'node:path';
import { COMPARTMENTS, walk } from './util.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

export const STATUS_VOCAB = ['active', 'draft', 'open', 'paused', 'done', 'resolved', 'superseded', 'archived'];
export const REQUIRED_FIELDS = ['title', 'date', 'status'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TAG_RE = /^[a-z0-9][a-z0-9-]*$/;
const EXCLUDED_DIRS = new Set(['examples', 'templates', 'node_modules']);

export function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Decide whether a repository-relative posix path is an indexable source record.
export function isRecordPath(rel) {
  const parts = rel.split('/');
  if (parts.length < 2 || !COMPARTMENTS.includes(parts[0])) return false;
  if (parts.some((p) => p.startsWith('.'))) return false;
  if (parts.slice(0, -1).some((p) => EXCLUDED_DIRS.has(p.toLowerCase()))) return false;
  const base = parts[parts.length - 1];
  if (base.toLowerCase() === 'readme.md') return false;
  return base.toLowerCase().endsWith('.md');
}

export function listRecordFiles(root) {
  const files = [];
  const skipped = [];
  for (const comp of COMPARTMENTS) {
    if (!fs.existsSync(path.join(root, comp))) continue;
    const res = walk(root, comp, {
      skip: (rel) => rel.split('/').pop().startsWith('.'),
    });
    for (const rel of res.files) if (isRecordPath(rel)) files.push(rel);
    for (const rel of res.links) skipped.push({ path: rel, reason: 'symlink (not followed)' });
  }
  files.sort(compareRecordPaths);
  return { files, skipped };
}

export function compareRecordPaths(a, b) {
  const ca = COMPARTMENTS.indexOf(a.split('/')[0]);
  const cb = COMPARTMENTS.indexOf(b.split('/')[0]);
  if (ca !== cb) return ca - cb;
  return a < b ? -1 : a > b ? 1 : 0;
}

// Validate one parsed frontmatter object. Pure function so tests can use it.
export function checkMetadata(parsed) {
  const errors = parsed.errors.map((e) => `line ${e.line}: ${e.message}`);
  const warnings = [];
  const missing = [];
  const d = parsed.data;
  const out = { title: null, date: null, status: 'unknown', tags: [], summary: null };
  if (!parsed.hasFrontmatter) warnings.push('no frontmatter block');

  if (typeof d.title === 'string' && d.title.trim()) out.title = d.title.trim();
  else if ('title' in d) errors.push('title must be a non-empty string');
  else missing.push('title');

  if ('date' in d) {
    if (isValidDate(d.date)) out.date = d.date;
    else errors.push(`date "${String(d.date)}" is not a real YYYY-MM-DD date`);
  } else missing.push('date');

  if ('status' in d) {
    if (typeof d.status === 'string' && STATUS_VOCAB.includes(d.status)) out.status = d.status;
    else errors.push(`status "${String(d.status)}" is not one of: ${STATUS_VOCAB.join(', ')}`);
  } else missing.push('status');

  if ('tags' in d) {
    if (!Array.isArray(d.tags)) errors.push('tags must be a list like [planning, health]');
    else {
      for (const t of d.tags) {
        if (!TAG_RE.test(t)) errors.push(`tag "${t}" must be lowercase letters, digits and hyphens`);
      }
      out.tags = d.tags.filter((t) => TAG_RE.test(t));
    }
  }
  if ('updated' in d && !isValidDate(d.updated)) errors.push(`updated "${String(d.updated)}" is not a real YYYY-MM-DD date`);
  if ('summary' in d) {
    if (typeof d.summary === 'string') out.summary = d.summary.trim() || null;
    else errors.push('summary must be a string');
  }
  for (const f of missing) warnings.push(`missing ${f}`);
  out.metadata = errors.length ? 'invalid' : missing.length || !parsed.hasFrontmatter ? 'incomplete' : 'complete';
  return { fields: out, errors, warnings, missing };
}

export function analyzeRecord(root, rel) {
  return analyzeBuffer(rel, fs.readFileSync(path.join(root, rel)));
}

// Analyze record content that may not be on disk (for example a staged blob).
export function analyzeBuffer(rel, buf) {
  const base = { path: rel, compartment: rel.split('/')[0] };
  if (buf.includes(0)) {
    return {
      ...base, title: null, date: null, status: 'unknown', tags: [], summary: null,
      metadata: 'invalid', errors: ['file is not UTF-8 text'], warnings: [], missing: [],
    };
  }
  const parsed = parseFrontmatter(buf.toString('utf8'));
  const res = checkMetadata(parsed);
  return { ...base, ...res.fields, errors: res.errors, warnings: res.warnings, missing: res.missing };
}

export function validateAll(root, { strict = false } = {}) {
  const { files, skipped } = listRecordFiles(root);
  return validateAnalyzed(files.map((rel) => analyzeRecord(root, rel)), skipped, { strict });
}

// Validation over already analyzed records (working tree or staged snapshot).
export function validateAnalyzed(recs, skipped, { strict = false } = {}) {
  const problems = [];
  for (const r of recs) {
    for (const e of r.errors) problems.push({ path: r.path, level: 'error', message: e });
    for (const w of r.warnings) problems.push({ path: r.path, level: strict ? 'error' : 'warning', message: w });
  }
  for (const s of skipped) problems.push({ path: s.path, level: strict ? 'error' : 'warning', message: s.reason });
  const errorCount = problems.filter((p) => p.level === 'error').length;
  return { count: recs.length, problems, ok: errorCount === 0, errorCount };
}
