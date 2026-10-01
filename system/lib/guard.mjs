// Personal brain guard: scans staged blobs (what will actually be committed),
// not the working tree. Reports rule ids and line numbers, never content.
import { git, readBlobs } from './git.mjs';
import { scanBuffer, forbiddenFilename } from './secrets.mjs';
import { COMPARTMENTS, INDEX_FILES } from './util.mjs';
import { isRecordPath, analyzeBuffer, compareRecordPaths } from './records.mjs';

function emptyTree(root) {
  const r = git(root, ['hash-object', '-t', 'tree', '--stdin'], { input: '' });
  return r.stdout.trim();
}

function splitZ(s) {
  return s.split('\0').filter((x) => x !== '');
}

// Entries staged for the next commit: [{ path, mode, sha }]
export function stagedEntries(root) {
  const hasHead = git(root, ['rev-parse', '--verify', '-q', 'HEAD']).ok;
  const base = hasHead ? 'HEAD' : emptyTree(root);
  const r = git(root, ['diff', '--cached', '--raw', '-z', '--no-renames', '--no-abbrev', '--diff-filter=ACMT', base]);
  if (!r.ok) throw new Error(`git diff --cached failed: ${r.stderr.trim()}`);
  const parts = splitZ(r.stdout);
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = parts[i].replace(/^:/, '').split(' ');
    out.push({ mode: meta[1], sha: meta[3], path: parts[i + 1] });
  }
  return out;
}

// Every entry in the git index, for a full sweep.
export function indexEntries(root) {
  const r = git(root, ['ls-files', '-s', '-z']);
  if (!r.ok) throw new Error(`git ls-files failed: ${r.stderr.trim()}`);
  return splitZ(r.stdout).map((line) => {
    const tab = line.indexOf('\t');
    const [mode, sha, stage] = line.slice(0, tab).split(' ');
    return { mode, sha, stage, path: line.slice(tab + 1) };
  });
}

// The records and index files exactly as the next commit would contain them,
// read from the git index rather than the working tree. A partially staged
// edit is therefore validated as staged, not as it looks on disk.
export function stagedSnapshot(root) {
  const regular = (e) => e.mode === '100644' || e.mode === '100755';
  const recEntries = [];
  const skipped = [];
  const wanted = [];
  for (const e of indexEntries(root)) {
    if (e.stage !== '0') continue;
    if (INDEX_FILES.includes(e.path)) {
      if (regular(e)) wanted.push(e);
    } else if (e.mode === '120000' && COMPARTMENTS.includes(e.path.split('/')[0])) {
      skipped.push({ path: e.path, reason: 'symlink (not followed)' });
    } else if (regular(e) && isRecordPath(e.path)) {
      recEntries.push(e);
      wanted.push(e);
    }
  }
  const blobs = readBlobs(root, wanted.map((e) => e.sha));
  const indexFiles = {};
  for (const e of wanted) {
    if (INDEX_FILES.includes(e.path)) indexFiles[e.path] = (blobs.get(e.sha) || Buffer.alloc(0)).toString('utf8').replace(/\r\n/g, '\n');
  }
  const recs = recEntries
    .map((e) => analyzeBuffer(e.path, blobs.get(e.sha) || Buffer.alloc(0)))
    .sort((a, b) => compareRecordPaths(a.path, b.path));
  return { recs, skipped, indexFiles };
}

export function scanEntries(root, entries) {
  const problems = [];
  const blobs = readBlobs(root, entries.filter((e) => e.mode === '100644' || e.mode === '100755').map((e) => e.sha));
  for (const e of entries) {
    if (e.mode === '120000') {
      problems.push({ path: e.path, rule: 'symlink', line: null });
      continue;
    }
    if (e.mode === '160000') {
      problems.push({ path: e.path, rule: 'submodule', line: null });
      continue;
    }
    const bad = forbiddenFilename(e.path);
    if (bad) problems.push({ path: e.path, rule: `forbidden-filename (${bad})`, line: null });
    const buf = blobs.get(e.sha);
    if (!buf) continue;
    for (const f of scanBuffer(buf).findings) problems.push({ path: e.path, rule: f.rule, line: f.line });
  }
  return problems;
}

export function formatProblems(problems) {
  return problems.map((p) => `  ${p.path}${p.line ? `:${p.line}` : ''}  ${p.rule}`).join('\n');
}
