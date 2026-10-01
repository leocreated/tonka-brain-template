// Template-owned file manifest. User records are never part of it.
import fs from 'node:fs';
import path from 'node:path';
import { RECORD_DIRS, INDEX_FILES, MANIFEST_PATH, TEMPLATE_NAME, walk, contentHash, readJson, writeJson } from './util.mjs';

export const MANIFEST_SCHEMA = 1;
const TOP_SKIP = new Set(['.git', '.brain', 'node_modules']);

// Which paths count as template-owned in a tree.
export function isTemplatePath(rel) {
  const parts = rel.split('/');
  if (TOP_SKIP.has(parts[0])) return false;
  if (parts.length === 1 && INDEX_FILES.includes(rel)) return false;
  if (rel === MANIFEST_PATH) return false;
  if (RECORD_DIRS.includes(parts[0])) return parts.length === 2 && parts[1] === 'README.md';
  return true;
}

export function templateFiles(root) {
  const res = walk(root, '', { skip: (rel) => TOP_SKIP.has(rel.split('/')[0]) });
  return {
    files: res.files.filter(isTemplatePath).sort(),
    links: res.links.filter(isTemplatePath),
    other: res.other,
  };
}

export function readPackageVersion(root) {
  const pkg = readJson(path.join(root, 'package.json'), {});
  return pkg.version || '0.0.0';
}

export function buildManifest(root) {
  const { files, links } = templateFiles(root);
  if (links.length) throw new Error(`symlinks are not allowed in the template: ${links.join(', ')}`);
  return {
    schema: MANIFEST_SCHEMA,
    name: TEMPLATE_NAME,
    version: readPackageVersion(root),
    hash: 'sha256 of file bytes, CRLF normalized to LF for text files',
    files: files.map((rel) => ({ path: rel, sha256: contentHash(fs.readFileSync(path.join(root, rel))) })),
  };
}

export function writeManifest(root) {
  const m = buildManifest(root);
  writeJson(path.join(root, MANIFEST_PATH), m);
  return m;
}

export function loadManifest(root) {
  return readJson(path.join(root, MANIFEST_PATH));
}

// Compare a tree with its manifest. strict adds "unlisted" template files.
export function checkManifest(root, { strict = false } = {}) {
  const m = loadManifest(root);
  if (!m || !Array.isArray(m.files)) return { ok: false, problems: [{ path: MANIFEST_PATH, issue: 'missing or unreadable manifest' }] };
  const problems = [];
  const listed = new Set();
  for (const f of m.files) {
    listed.add(f.path);
    const abs = path.join(root, f.path);
    if (!fs.existsSync(abs)) problems.push({ path: f.path, issue: 'missing' });
    else if (contentHash(fs.readFileSync(abs)) !== f.sha256) problems.push({ path: f.path, issue: 'modified' });
  }
  if (strict) {
    if (m.version !== readPackageVersion(root)) problems.push({ path: MANIFEST_PATH, issue: `version ${m.version} does not match package.json` });
    for (const rel of templateFiles(root).files) if (!listed.has(rel)) problems.push({ path: rel, issue: 'not in manifest' });
  }
  return { ok: problems.length === 0, problems, manifest: m };
}
