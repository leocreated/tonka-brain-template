// Maintainer release workflow: export the committed tree, then check that
// exact tree before it becomes public. Heuristic; still review it by eye.
import fs from 'node:fs';
import path from 'node:path';
import { RECORD_DIRS, MANIFEST_PATH, walk, isInside } from './util.mjs';
import { git, readBlobs } from './git.mjs';
import { scanBuffer, forbiddenFilename } from './secrets.mjs';
import { buildIndex } from './indexer.mjs';
import { checkManifest } from './manifest.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

const EM_DASH = String.fromCharCode(0x2014);
const ALLOWED_EMAIL = /^(contributors@users\.noreply\.github\.com|[^@\s]+@(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|example|test|invalid))$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const HOME_PATH = /(?:[A-Za-z]:[\\/]+Users[\\/]+|\/Users\/|\/home\/)([A-Za-z0-9._-]+)/g;
const HOME_OK = /^(you|user|username|me|runner|public|default|shared|example|name)$/i;
export const REQUIRED_FILES = [
  'README.md', 'AGENTS.md', 'CLAUDE.md', 'MAP.md', 'LICENSE', 'package.json',
  'INDEX.md', 'INDEX.jsonl', MANIFEST_PATH, '.gitignore',
  'system/setup/GUIDE.md',
  '.agents/skills/brain-setup/SKILL.md',
  '.agents/skills/brain-setup/agents/openai.yaml',
  '.claude/skills/brain-setup/SKILL.md',
];

function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function loadDenylist(file) {
  if (!file) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

export function releaseCheck(dir, { denylist = null } = {}) {
  const root = path.resolve(dir);
  const terms = loadDenylist(denylist).map((t) => t.toLowerCase());
  const findings = [];
  const add = (p, rule, line = null) => findings.push({ path: p, rule, line });
  const res = walk(root, '', { skip: (rel) => rel === '.git' });
  for (const l of res.links) add(l, 'symlink');
  for (const o of res.other) add(o, 'not a regular file');

  for (const rel of res.files) {
    const lower = rel.toLowerCase();
    terms.forEach((t, i) => {
      if (lower.includes(t)) add(rel, `denylist term #${i + 1} in file name`);
    });
    for (const m of rel.matchAll(EMAIL)) if (!ALLOWED_EMAIL.test(m[0])) add(rel, 'email address in file name');
    const bad = forbiddenFilename(rel);
    if (bad) add(rel, `forbidden file name (${bad})`);
    const parts = rel.split('/');
    if (parts[0] === '.brain') add(rel, 'local .brain state must never ship');
    if (RECORD_DIRS.includes(parts[0]) && !(parts.length === 2 && parts[1] === 'README.md')) add(rel, 'unexpected record (template compartments hold only README.md)');

    const buf = fs.readFileSync(path.join(root, rel));
    const scan = scanBuffer(buf);
    if (scan.binary) add(rel, 'binary file (not supported in v1)');
    for (const f of scan.findings) add(rel, `credential shape: ${f.rule}`, f.line);
    if (scan.binary) continue;
    const text = scan.encoding === 'utf8' ? buf.toString('utf8') : buf.toString(scan.encoding === 'utf16le' ? 'utf16le' : 'latin1');
    if (scan.encoding !== 'utf8') add(rel, `text encoding ${scan.encoding} (ship UTF-8 only)`);
    for (const m of text.matchAll(EMAIL)) if (!ALLOWED_EMAIL.test(m[0])) add(rel, 'email address', lineOf(text, m.index));
    for (const m of text.matchAll(HOME_PATH)) if (!HOME_OK.test(m[1]) && !m[1].startsWith('<')) add(rel, 'personal home path', lineOf(text, m.index));
    let idx = text.indexOf(EM_DASH);
    while (idx >= 0) {
      add(rel, 'em dash', lineOf(text, idx));
      idx = text.indexOf(EM_DASH, idx + 1);
    }
    const ltext = text.toLowerCase();
    terms.forEach((t, i) => {
      let j = ltext.indexOf(t);
      while (j >= 0) {
        add(rel, `denylist term #${i + 1}`, lineOf(text, j));
        j = ltext.indexOf(t, j + 1);
      }
    });
    if (parts[0] === 'system' && parts[1] === 'examples' && rel.endsWith('.md') && parts[parts.length - 1] !== 'README.md') {
      const fm = parseFrontmatter(text);
      if (fm.data.example !== 'true' || !/fictional/i.test(text)) add(rel, 'example must set "example: true" and say it is fictional');
    }
  }

  for (const req of REQUIRED_FILES) if (!fs.existsSync(path.join(root, req))) add(req, 'required file missing');
  const built = buildIndex(root);
  if (built.recs.length) add('INDEX.jsonl', 'template must ship with an empty index');
  for (const [name, exp] of [['INDEX.jsonl', built.jsonl], ['INDEX.md', built.md]]) {
    const p = path.join(root, name);
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') !== exp) add(name, 'index is not the generated empty index');
  }
  const mc = checkManifest(root, { strict: true });
  for (const p of mc.problems) add(p.path, `manifest: ${p.issue}`);
  const lic = fs.existsSync(path.join(root, 'LICENSE')) ? fs.readFileSync(path.join(root, 'LICENSE'), 'utf8') : '';
  if (!/MIT License/.test(lic) || !/TONKA contributors/.test(lic)) add('LICENSE', 'expected MIT License, copyright TONKA contributors');
  return { ok: findings.length === 0, findings, files: res.files.length };
}

// Write the committed HEAD tree (not the working tree) into an empty folder.
export function releaseExport(root, outDir) {
  const out = path.resolve(outDir);
  if (isInside(path.resolve(root), out)) throw new Error('export folder must be outside this repository');
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error('export folder must be empty or not exist');
  const r = git(root, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']);
  if (!r.ok) throw new Error(`git ls-tree failed: ${r.stderr.trim()}`);
  const entries = r.stdout.split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    const [mode, type, sha] = line.slice(0, tab).split(' ');
    return { mode, type, sha, path: line.slice(tab + 1) };
  });
  const odd = entries.filter((e) => e.type !== 'blob' || e.mode === '120000');
  if (odd.length) throw new Error(`refusing to export symlinks or submodules: ${odd.map((e) => e.path).join(', ')}`);
  const blobs = readBlobs(root, entries.map((e) => e.sha));
  fs.mkdirSync(out, { recursive: true });
  for (const e of entries) {
    const dst = path.join(out, e.path);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, blobs.get(e.sha));
    if (e.mode === '100755') {
      try {
        fs.chmodSync(dst, 0o755);
      } catch {
        /* best effort on Windows */
      }
    }
  }
  const dirty = git(root, ['status', '--porcelain']).stdout.trim() !== '';
  return { out, files: entries.length, head: git(root, ['rev-parse', 'HEAD']).stdout.trim(), dirty };
}
