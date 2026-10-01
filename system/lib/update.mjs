// Conflict-aware template update from a local release folder the user chose.
// Nothing is downloaded and no code from the package is executed: the
// updater already installed in this brain reads the package as data.
import fs from 'node:fs';
import path from 'node:path';
import { MANIFEST_PATH, TEMPLATE_NAME, contentHash, sha256, symlinkInPath, isInside, writeFileAtomic, writeJson, stamp, nowIso, toPosix } from './util.mjs';
import { MANIFEST_SCHEMA, isTemplatePath, loadManifest } from './manifest.mjs';
import { assertBrainIgnored, brainPath } from './visibility.mjs';

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

export function manifestPathProblem(p) {
  if (typeof p !== 'string' || !p.length || p.length > 300) return 'invalid path value';
  // eslint-disable-next-line no-control-regex
  if (/[\\\x00-\x1f:*?"<>|]/.test(p)) return 'path contains a forbidden character';
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return 'absolute path';
  const parts = p.split('/');
  for (const s of parts) {
    if (s === '' || s === '.' || s === '..') return 'empty, "." or ".." segment';
    if (/[. ]$/.test(s)) return 'segment ends with a dot or space';
    if (RESERVED.test(s)) return 'reserved device name';
    if (['.git', '.brain', 'node_modules'].includes(s.toLowerCase())) return `"${s}" is never template-owned`;
  }
  if (!isTemplatePath(p)) return 'path is not template-owned (user records, INDEX files and the manifest are excluded)';
  return null;
}

function semverParts(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v));
  return m ? m.slice(1).map(Number) : null;
}

export function compareVersions(a, b) {
  const x = semverParts(a);
  const y = semverParts(b);
  if (!x || !y) return NaN;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export function validateManifestObject(m) {
  const problems = [];
  if (!m || typeof m !== 'object') return ['manifest is not a JSON object'];
  if (m.schema !== MANIFEST_SCHEMA) {
    problems.push(`manifest schema ${m.schema} is not supported by this updater (supports ${MANIFEST_SCHEMA}). Follow that release's manual upgrade notes.`);
  }
  if (m.name !== TEMPLATE_NAME) problems.push(`manifest name is "${m.name}", expected "${TEMPLATE_NAME}"`);
  if (!semverParts(m.version)) problems.push('manifest version is not MAJOR.MINOR.PATCH');
  if (!Array.isArray(m.files)) return [...problems, 'manifest has no files list'];
  const seen = new Set();
  for (const f of m.files) {
    const why = manifestPathProblem(f && f.path);
    if (why) problems.push(`${JSON.stringify(f && f.path)}: ${why}`);
    if (!f || !/^[0-9a-f]{64}$/.test(f.sha256 || '')) problems.push(`${JSON.stringify(f && f.path)}: missing or malformed sha256`);
    const key = String(f && f.path).toLowerCase();
    if (seen.has(key)) problems.push(`${JSON.stringify(f && f.path)}: duplicate path (case-insensitive)`);
    seen.add(key);
  }
  return problems;
}

function localHash(root, rel) {
  const abs = path.join(root, rel);
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return { exists: false };
  }
  if (!st.isFile()) return { exists: true, irregular: true };
  return { exists: true, hash: contentHash(fs.readFileSync(abs)) };
}

export function planUpdate(root, pkgDir, opts = {}) {
  const pkgRoot = fs.realpathSync(path.resolve(pkgDir));
  if (pkgRoot === fs.realpathSync(root)) throw new Error('the release package must be a separate folder, not this brain');
  const mfAbs = path.join(pkgRoot, MANIFEST_PATH);
  if (symlinkInPath(pkgRoot, MANIFEST_PATH)) throw new Error('package manifest path contains a symlink');
  if (!fs.existsSync(mfAbs)) throw new Error(`package has no ${MANIFEST_PATH}`);
  const raw = fs.readFileSync(mfAbs);
  const manifestSha256 = sha256(raw);
  if (opts.manifestSha256 && opts.manifestSha256.toLowerCase() !== manifestSha256) {
    throw new Error(`manifest SHA-256 ${manifestSha256} does not match the expected value you supplied`);
  }
  let incoming;
  try {
    incoming = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error('package manifest is not valid JSON');
  }
  const mProblems = validateManifestObject(incoming);
  if (mProblems.length) throw new Error(`package manifest rejected:\n  ${mProblems.join('\n  ')}`);

  const tamper = [];
  for (const f of incoming.files) {
    const link = symlinkInPath(pkgRoot, f.path);
    if (link) {
      tamper.push(`${f.path}: symlink in package (${link})`);
      continue;
    }
    const abs = path.join(pkgRoot, f.path);
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch {
      tamper.push(`${f.path}: missing from package`);
      continue;
    }
    if (!st.isFile()) tamper.push(`${f.path}: not a regular file`);
    else if (!isInside(pkgRoot, fs.realpathSync(abs))) tamper.push(`${f.path}: resolves outside the package`);
    else if (contentHash(fs.readFileSync(abs)) !== f.sha256) tamper.push(`${f.path}: content does not match manifest hash`);
  }
  if (tamper.length) throw new Error(`package failed integrity checks; nothing was changed:\n  ${tamper.join('\n  ')}`);

  const baseline = loadManifest(root);
  const baseOk = baseline && Array.isArray(baseline.files);
  const baseMap = new Map();
  if (baseOk) for (const f of baseline.files) if (!manifestPathProblem(f.path)) baseMap.set(f.path, f.sha256);
  const fromVersion = baseOk ? baseline.version : null;
  const cmp = fromVersion ? compareVersions(incoming.version, fromVersion) : 1;
  if (cmp < 0 && !opts.allowDowngrade) {
    throw new Error(`package version ${incoming.version} is older than installed ${fromVersion}; pass --allow-downgrade if you really mean it`);
  }

  const actions = [];
  const newPaths = new Set();
  for (const f of incoming.files) {
    newPaths.add(f.path);
    const link = symlinkInPath(root, f.path);
    const local = localHash(root, f.path);
    const base = baseMap.get(f.path);
    let type;
    if (link || local.irregular) type = 'conflict-symlink';
    else if (!local.exists) type = base ? 'skip-deleted-locally' : 'add';
    else if (local.hash === f.sha256) type = 'same';
    else if (base && local.hash === base) type = 'update';
    else type = base ? 'conflict-modified' : 'conflict-exists';
    actions.push({ path: f.path, type });
  }
  for (const [p, h] of baseMap) {
    if (newPaths.has(p)) continue;
    const local = localHash(root, p);
    if (symlinkInPath(root, p) || local.irregular) actions.push({ path: p, type: 'conflict-symlink' });
    else if (!local.exists) continue;
    else if (local.hash === h) actions.push({ path: p, type: 'remove' });
    else actions.push({ path: p, type: 'keep-removed-upstream-modified' });
  }
  actions.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { pkgRoot, incoming, manifestSha256, fromVersion, toVersion: incoming.version, baselinePresent: !!baseOk, actions };
}

export function summarize(plan) {
  const counts = {};
  for (const a of plan.actions) counts[a.type] = (counts[a.type] || 0) + 1;
  return counts;
}

export function applyUpdate(root, plan) {
  assertBrainIgnored(root);
  const dir = brainPath(root, 'updates', stamp());
  const done = [];
  for (const a of plan.actions) {
    const src = path.join(plan.pkgRoot, a.path);
    const dst = path.join(root, a.path);
    if (a.type === 'add' || a.type === 'update') {
      if (a.type === 'update') writeFileAtomic(path.join(dir, 'backup', a.path), fs.readFileSync(dst));
      writeFileAtomic(dst, fs.readFileSync(src));
      try {
        fs.chmodSync(dst, fs.statSync(src).mode & 0o777);
      } catch {
        /* permissions are best effort on Windows */
      }
      done.push(a);
    } else if (a.type === 'remove') {
      writeFileAtomic(path.join(dir, 'backup', a.path), fs.readFileSync(dst));
      fs.rmSync(dst);
      done.push(a);
    } else if (a.type === 'conflict-modified' || a.type === 'conflict-exists' || a.type === 'skip-deleted-locally') {
      writeFileAtomic(path.join(dir, 'incoming', a.path), fs.readFileSync(src));
    }
  }
  const mfDst = path.join(root, MANIFEST_PATH);
  if (fs.existsSync(mfDst)) writeFileAtomic(path.join(dir, 'backup', MANIFEST_PATH), fs.readFileSync(mfDst));
  writeFileAtomic(mfDst, fs.readFileSync(path.join(plan.pkgRoot, MANIFEST_PATH)));
  const receipt = {
    at: nowIso(),
    from: plan.fromVersion,
    to: plan.toVersion,
    manifestSha256: plan.manifestSha256,
    package: plan.pkgRoot,
    counts: summarize(plan),
    actions: plan.actions,
  };
  writeJson(path.join(dir, 'receipt.json'), receipt);
  return { dir: toPosix(path.relative(root, dir)), applied: done.length, receipt };
}
