// Repository visibility. Every effective push destination of this clone is
// assessed: github.com repositories get a live check through the GitHub CLI,
// anything gh cannot check needs an explicit user attestation. Proof and
// attestation are bound to the exact destination set, so changing a remote or
// push URL always needs a new check or a new attestation. A public or internal
// result from gh is remembered per GitHub repository: it revokes any earlier
// attestation or cached proof, keeps blocking while gh cannot check that
// repository again, and only a later live private result clears it.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readJson, writeJson, nowIso, sha256 } from './util.mjs';
import { git, isIgnored } from './git.mjs';

export const BRAIN_DIR = '.brain';
const VISIBILITY_FILE = '.brain/visibility.json';
const RECORD_VERSION = 2;
// How long the last live private proof may stand in while gh cannot check
// (offline, signed out). Only for the identical destination set.
export const OFFLINE_DAYS = 7;
const DAY_MS = 86400000;

export function brainPath(root, ...parts) {
  return path.join(root, BRAIN_DIR, ...parts);
}

// .brain/ holds local state and drafts. Refuse to use it unless git ignores it.
export function assertBrainIgnored(root) {
  if (!isIgnored(root, '.brain/state-check.json')) {
    throw new Error('.brain/ is not ignored by git. Restore the ".brain/" line in .gitignore before continuing.');
  }
}

function runGh(root, args) {
  const bin = process.env.TONKA_GH_BIN || 'gh';
  // A .js/.mjs override runs under Node. It exists so tests and unusual
  // installs can point at a specific gh; it is never set by TONKA itself.
  const isScript = /\.(m?js)$/i.test(bin);
  const r = spawnSync(isScript ? process.execPath : bin, isScript ? [bin, ...args] : args, {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000,
  });
  if (r.error) return { ok: false, missing: r.error.code === 'ENOENT', stdout: '', stderr: '' };
  return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com', 'ssh.github.com']);
const GITHUB_SCHEMES = new Set(['https', 'http', 'ssh', 'git', 'git+ssh', 'ssh+git']);
const SLUG_PART = /^[A-Za-z0-9_.-]+$/;

// Classify one push URL without keeping or printing anything sensitive.
// Returns { kind: github|other|local, slug? }.
export function classifyUrl(url) {
  let scheme;
  let host;
  let rest;
  const full = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^/:?#]*)(?::\d*)?([^?#]*)/.exec(url);
  if (full) {
    scheme = full[1].toLowerCase();
    if (scheme === 'file') return { kind: 'local' };
    host = full[2].toLowerCase();
    rest = full[3];
  } else {
    // scp-like syntax: [user@]host:path. A single letter before the colon is
    // a Windows drive, and anything with a slash before the colon is a path.
    const scp = /^(?:[^@/\\]+@)?([^:/\\]+):(.*)$/.exec(url);
    if (!scp || /^[A-Za-z]$/.test(scp[1])) return { kind: 'local' };
    scheme = 'ssh';
    host = scp[1].toLowerCase();
    rest = scp[2];
  }
  if (GITHUB_HOSTS.has(host) && GITHUB_SCHEMES.has(scheme)) {
    const parts = rest.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '').split('/');
    if (parts.length === 2 && parts.every((p) => SLUG_PART.test(p) && p !== '.' && p !== '..')) {
      return { kind: 'github', slug: `${parts[0]}/${parts[1]}` };
    }
  }
  return { kind: 'other' };
}

// Apply url.<base>.pushInsteadOf, then url.<base>.insteadOf (longest match),
// the way git rewrites a push URL that is not a configured remote.
function rewritePushUrl(root, url) {
  const r = git(root, ['config', '--get-regexp', '^url\\..*\\.(pushinsteadof|insteadof)$']);
  const rules = { pushinsteadof: [], insteadof: [] };
  for (const line of r.ok ? r.stdout.split(/\r?\n/) : []) {
    const m = /^url\.(.*)\.(pushinsteadof|insteadof) (.*)$/i.exec(line);
    if (m) rules[m[2].toLowerCase()].push({ base: m[1], prefix: m[3] });
  }
  for (const kind of ['pushinsteadof', 'insteadof']) {
    const hit = rules[kind].filter((x) => x.prefix && url.startsWith(x.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
    if (hit) return hit.base + url.slice(hit.prefix.length);
  }
  return url;
}

function describe(dest) {
  const where = dest.remote ? `remote "${dest.remote}"` : 'a push URL named directly in branch or push settings';
  if (dest.kind === 'github') return `${where} (github.com/${dest.slug})`;
  if (dest.kind === 'local') return `${where} (a local or network path)`;
  if (dest.kind === 'unreadable') return `${where} (its URL could not be read)`;
  return `${where} (a host other than github.com)`;
}

// Every place a push from this clone can go: all push URLs of every remote
// (explicit pushurl values, several of them, and URL rewrites included), plus
// URL-valued push settings that name no configured remote. The raw URLs are
// used for classification and fingerprinting only, never printed or saved.
export function pushDestinations(root) {
  const remotes = git(root, ['remote']).stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const byUrl = new Map();
  const add = (remote, url) => {
    if (!url || byUrl.has(url)) return;
    byUrl.set(url, { remote, url });
  };
  const unreadable = [];
  for (const name of remotes) {
    const r = git(root, ['remote', 'get-url', '--push', '--all', name]);
    const urls = r.ok ? r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
    if (!urls.length) unreadable.push(name);
    for (const u of urls) add(name, u);
  }
  const cfg = git(root, ['config', '--get-regexp', '^(remote\\.pushdefault|branch\\..*\\.(pushremote|remote))$']);
  for (const line of cfg.ok ? cfg.stdout.split(/\r?\n/) : []) {
    const space = line.indexOf(' ');
    const value = space < 0 ? '' : line.slice(space + 1).trim();
    if (!value || value === '.' || remotes.includes(value)) continue;
    add(null, rewritePushUrl(root, value));
  }
  const dests = [...byUrl.values()].map((d) => {
    const c = classifyUrl(d.url);
    const dest = { id: sha256(`url\0${d.url}`).slice(0, 16), remote: d.remote, kind: c.kind, slug: c.slug || null };
    return { ...dest, label: describe(dest) };
  });
  for (const name of unreadable) {
    const dest = { id: sha256(`remote\0${name}`).slice(0, 16), remote: name, kind: 'unreadable', slug: null };
    dests.push({ ...dest, label: describe(dest) });
  }
  dests.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return dests;
}

export function destinationFingerprint(dests) {
  return sha256(`tonka-push-destinations-v1\n${dests.map((d) => d.id).join('\n')}`);
}

function ghVisibility(root, slug) {
  const r = runGh(root, ['repo', 'view', `github.com/${slug}`, '--json', 'visibility,isPrivate,nameWithOwner']);
  if (!r.ok) {
    return { status: 'unknown', why: r.missing ? 'GitHub CLI (gh) is not installed' : 'gh could not read it (not signed in, no access, or offline)' };
  }
  let data;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    return { status: 'unknown', why: 'gh returned output TONKA could not parse' };
  }
  const vis = String(data.visibility || '').toUpperCase();
  if (vis === 'PRIVATE' && data.isPrivate === true) return { status: 'private' };
  if (vis === 'INTERNAL') return { status: 'internal' };
  if (vis === 'PUBLIC' || data.isPrivate === false) return { status: 'public' };
  return { status: 'unknown', why: `gh reported visibility "${vis || 'none'}"` };
}

export function loadVisibility(root) {
  const rec = readJson(path.join(root, VISIBILITY_FILE));
  return rec && rec.version === RECORD_VERSION ? rec : null;
}

function save(root, rec) {
  assertBrainIgnored(root);
  writeJson(path.join(root, VISIBILITY_FILE), rec);
  return rec;
}

const withinOffline = (iso) => Boolean(iso) && Date.now() - Date.parse(iso) <= OFFLINE_DAYS * DAY_MS && Date.parse(iso) <= Date.now() + 60000;
const dateOf = (iso) => String(iso || '').slice(0, 10);
const EXPOSED = new Set(['public', 'internal']);
const isExposed = (r) => EXPOSED.has(r.status);
// GitHub repository names are case-insensitive, and the same repository can
// be reached through several URL forms.
const exposureKey = (slug) => `github:${String(slug).toLowerCase()}`;

// Public or internal results gh has reported, whatever destination set they
// were seen in. Records written before this map existed still carry the
// result on their destinations, so those count too.
function knownExposures(saved) {
  const out = {};
  if (!saved) return out;
  for (const d of Array.isArray(saved.destinations) ? saved.destinations : []) {
    if (d && d.kind === 'github' && d.slug && EXPOSED.has(d.status)) {
      out[exposureKey(d.slug)] = { status: d.status, observedAt: d.observedAt || d.checkedAt || saved.checkedAt || null };
    }
  }
  const map = saved.exposures && typeof saved.exposures === 'object' ? saved.exposures : {};
  for (const [key, e] of Object.entries(map)) {
    if (e && EXPOSED.has(e.status)) out[key] = { status: e.status, observedAt: typeof e.observedAt === 'string' ? e.observedAt : null };
  }
  return out;
}

// Assess the current destinations. `live` runs gh for github.com
// destinations now; otherwise only saved evidence is used: private proof for
// the same set, and known public or internal results for any set.
function assess(root, { live }) {
  const dests = pushDestinations(root);
  const fingerprint = destinationFingerprint(dests);
  const saved = loadVisibility(root);
  const same = Boolean(saved && saved.fingerprint === fingerprint);
  const changed = Boolean(saved && !same);
  const exposures = knownExposures(saved);
  const at = nowIso();
  const results = dests.map((d) => {
    const base = { id: d.id, remote: d.remote, kind: d.kind, slug: d.slug, label: d.label };
    const prev = same ? (saved.destinations || []).find((p) => p.id === d.id) : null;
    if (d.kind !== 'github') {
      return { ...base, status: 'unresolved', source: 'none', why: 'gh cannot check it' };
    }
    const key = exposureKey(d.slug);
    let why = 'not checked yet';
    if (live) {
      const r = ghVisibility(root, d.slug);
      if (EXPOSED.has(r.status)) {
        exposures[key] = { status: r.status, observedAt: at };
        return { ...base, status: r.status, source: 'live', checkedAt: at, observedAt: at, provenAt: null };
      }
      if (r.status === 'private') {
        delete exposures[key];
        return { ...base, status: 'private', source: 'live', checkedAt: at, provenAt: at };
      }
      why = r.why;
    }
    // gh did not answer now. A known public or internal result outranks any
    // older private proof or attestation until a live check says private.
    const known = exposures[key];
    if (known) return { ...base, status: known.status, source: 'cached', observedAt: known.observedAt, why };
    if (prev && prev.status === 'private' && withinOffline(prev.provenAt)) {
      return { ...base, status: 'private', source: 'cached', provenAt: prev.provenAt, ...(live ? { why } : {}) };
    }
    if (!live && prev && prev.status === 'private') why = `the last live proof is older than ${OFFLINE_DAYS} days`;
    return { ...base, status: 'unknown', source: 'none', why };
  });
  // An attestation is bound to its exact set and is revoked for good as soon
  // as any destination in the set is known to be public or internal.
  const valid = saved && saved.attestation && saved.attestation.fingerprint === fingerprint && !results.some(isExposed);
  const attestation = valid ? saved.attestation : null;
  return { dests, fingerprint, results, attestation, exposures, changed, saved, at };
}

function summarize(a) {
  const { results, attestation, changed } = a;
  const n = results.length;
  const exposed = results.find((r) => r.status === 'public') || results.find((r) => r.status === 'internal');
  if (exposed) {
    const shout = exposed.status.toUpperCase();
    return {
      status: exposed.status,
      method: exposed.source === 'live' ? 'gh' : 'gh-cached',
      detail: exposed.source === 'live'
        ? `${exposed.label} is ${shout} according to gh`
        : `${exposed.label} is ${shout} according to gh's last check${exposed.observedAt ? ` on ${dateOf(exposed.observedAt)}` : ''}; gh could not check it now, and it stays blocked until a live gh check shows it private`,
    };
  }
  const privateCount = results.filter((r) => r.status === 'private').length;
  if (n && privateCount === n) {
    const cached = results.filter((r) => r.source === 'cached');
    if (!cached.length) return { status: 'private', method: 'gh', detail: `current live gh check: all ${n} push destination(s) are private` };
    const oldest = cached.map((r) => r.provenAt).sort()[0];
    return {
      status: 'private',
      method: 'gh-cached',
      detail: `cached/offline evidence, not a current live check: gh proved these same ${n} push destination(s) private on ${dateOf(oldest)}, and could not check ${cached.length} of them now`,
    };
  }
  const open = results.filter((r) => r.status !== 'private');
  if (attestation) {
    const proven = privateCount ? `; ${privateCount} also proven private by gh` : '';
    return {
      status: 'private',
      method: 'attestation',
      detail: n
        ? `user attestation for these exact ${n} push destination(s), recorded ${dateOf(attestation.at)}, not live proof${proven}`
        : `user attestation that this clone has no remote, recorded ${dateOf(attestation.at)}, not live proof`,
    };
  }
  const why = n
    ? open.map((r) => `${r.label}: ${r.status === 'unresolved' ? 'gh cannot check this destination' : r.why}`).join('; ')
    : 'this clone has no git remote, so there is nothing to check live';
  return {
    status: 'unknown',
    method: 'none',
    detail: `${changed ? 'push destinations changed since the last check or attestation; ' : ''}${why}`,
  };
}

function record(a, s) {
  return {
    version: RECORD_VERSION,
    fingerprint: a.fingerprint,
    checkedAt: a.at,
    status: s.status,
    method: s.method,
    detail: s.detail,
    destinations: a.results.map(({ id, remote, kind, slug, label, status, source, provenAt, checkedAt, observedAt }) => ({
      id, remote, kind, slug, label, status, source, provenAt: provenAt || null, checkedAt: checkedAt || null, observedAt: observedAt || null,
    })),
    attestation: a.attestation,
    exposures: a.exposures,
  };
}

// Run a live check of every destination and record it.
export function refreshVisibility(root) {
  const a = assess(root, { live: true });
  return save(root, record(a, summarize(a)));
}

export function attestPrivate(root) {
  const a = assess(root, { live: true });
  const exposed = a.results.find(isExposed);
  if (exposed) {
    save(root, record(a, summarize(a)));
    if (exposed.source === 'live') {
      throw new Error(`Live check says ${exposed.label} is ${exposed.status}. Make it private (or remove that destination) first; an attestation cannot override live proof.`);
    }
    throw new Error(`gh last reported ${exposed.label} as ${exposed.status}${exposed.observedAt ? ` on ${dateOf(exposed.observedAt)}` : ''} and has not shown it private since. Make it private and run "node system/bin/brain.mjs setup visibility" while gh can check it, or remove that destination; an attestation cannot override a known public or internal result.`);
  }
  if (a.results.length && a.results.every((r) => r.status === 'private' && r.source === 'live')) {
    return save(root, record(a, summarize(a)));
  }
  a.attestation = { fingerprint: a.fingerprint, at: a.at, destinations: a.results.length };
  return save(root, record(a, summarize(a)));
}

export function reasonFor(rec) {
  if (rec.status === 'private') {
    if (rec.method === 'attestation') return `private by ${rec.detail}`;
    if (rec.method === 'gh-cached') return `private, from ${rec.detail}`;
    return `private (${rec.detail})`;
  }
  if (rec.status === 'unknown') {
    return `visibility is unknown (${rec.detail}). Prove it with gh, or, after confirming that every push destination listed by "node system/bin/brain.mjs setup visibility" is private, attest: node system/bin/brain.mjs setup visibility --attest-private`;
  }
  return `push destination is ${rec.status}: ${rec.detail}. Personal records only go to private repositories. If you cloned the public template directly, make a private copy first (see "Make your private copy" in README.md), clone that, and run setup there. If a second remote or push URL is public, remove it or make it private.`;
}

// Gate used before any tracked personal write and by the pre-commit hook.
// With refresh (the default) it always attempts a current live check when
// there are destinations gh can check. Without refresh it re-reads the
// destinations and uses only saved evidence: proof or attestation bound to
// that same set, and any known public or internal result.
export function visibilityGate(root, { refresh = true } = {}) {
  let rec;
  if (refresh) rec = refreshVisibility(root);
  else {
    const a = assess(root, { live: false });
    if (!a.saved) {
      return { ok: false, rec: null, reason: 'repository visibility has not been checked. Run: node system/bin/brain.mjs setup visibility' };
    }
    rec = record(a, summarize(a));
  }
  return { ok: rec.status === 'private', rec, reason: reasonFor(rec) };
}
