// Small shared helpers. No dependencies beyond Node's standard library.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Active record compartments. Order is the display order in INDEX.md.
export const COMPARTMENTS = [
  'context', 'people', 'projects', 'decisions', 'lessons',
  'papercuts', 'notes', 'references', 'infra',
];
export const RECORD_DIRS = [...COMPARTMENTS, 'archives'];
export const INDEX_FILES = ['INDEX.md', 'INDEX.jsonl'];
export const MANIFEST_PATH = 'system/template-manifest.json';
export const TEMPLATE_NAME = 'tonka-brain-template';

// Root of the brain that contains this copy of the helpers.
export const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// A file "looks binary" when it has NUL bytes and is not UTF-16 text.
export function looksUtf16(buf) {
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) return true;
  const n = Math.min(buf.length, 4096);
  if (n < 4) return false;
  let oddNul = 0; let evenNul = 0;
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) { if (i % 2) oddNul++; else evenNul++; }
  }
  const half = n / 2;
  return (oddNul > half * 0.3 && evenNul < half * 0.05) || (evenNul > half * 0.3 && oddNul < half * 0.05);
}

export function isBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return !looksUtf16(buf);
  return false;
}

// Content hash used by the template manifest. Text files are hashed with
// CRLF normalized to LF so a checkout with Windows line endings still matches.
export function contentHash(buf) {
  if (isBinary(buf)) return sha256(buf);
  return sha256(Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1'));
}

export function today() {
  const forced = process.env.TONKA_TODAY;
  if (forced && /^\d{4}-\d{2}-\d{2}$/.test(forced)) return forced;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function stamp() {
  return nowIso().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function writeJson(file, value) {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

// Recursively list files under rootAbs/relDir without following symlinks.
// Returns { files: [posix rel paths], links: [...], other: [...] }.
export function walk(rootAbs, relDir = '', opts = {}) {
  const skip = opts.skip || (() => false);
  const out = { files: [], links: [], other: [] };
  const visit = (rel) => {
    const abs = path.join(rootAbs, rel);
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (skip(childRel, e)) continue;
      const st = fs.lstatSync(path.join(rootAbs, childRel));
      if (st.isSymbolicLink()) out.links.push(childRel);
      else if (st.isDirectory()) visit(childRel);
      else if (st.isFile()) out.files.push(childRel);
      else out.other.push(childRel);
    }
  };
  visit(relDir);
  return out;
}

// True when `child` resolves inside `parent` (both absolute).
export function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Check that no existing segment between rootAbs and rel is a symlink.
export function symlinkInPath(rootAbs, rel) {
  const parts = rel.split('/');
  let cur = rootAbs;
  for (const part of parts) {
    cur = path.join(cur, part);
    let st;
    try {
      st = fs.lstatSync(cur);
    } catch {
      return null;
    }
    if (st.isSymbolicLink()) return toPosix(path.relative(rootAbs, cur));
  }
  return null;
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '') || 'untitled';
}
