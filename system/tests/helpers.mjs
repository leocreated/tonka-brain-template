// Test fixtures. Everything is created under the OS temp folder in paths
// that contain spaces, never inside the repository. Git runs with an
// isolated, empty global config so the developer's own settings never leak
// in or get modified.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPT_ROOT, INDEX_FILES, MANIFEST_PATH } from '../lib/util.mjs';
import { templateFiles } from '../lib/manifest.mjs';

export const REPO = SCRIPT_ROOT;
const created = [];

export function tmpDir(label = 'fixture') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `tonka test ${label} `));
  created.push(base);
  return base;
}

export function cleanup() {
  for (const d of created.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

// The fictional GitHub repository fixtures push to (by URL only; tests never
// reach the network, see GIT_ALLOW_PROTOCOL in makeEnv).
export const GH_URL = (slug = 'example-user/brain') => `https://github.com/${slug}.git`;

// A fake `gh` written in JavaScript. It answers per repository, from a file
// next to it, so a test can flip visibility without changing the environment.
// set('private') applies to every repository; set({ 'owner/repo': 'public',
// '*': 'private' }) answers per repository. Every call is logged.
export function fakeGh(dir, mode = 'private') {
  const script = path.join(dir, 'fake gh.mjs');
  const modeFile = path.join(dir, 'fake-gh-mode.json');
  const logFile = path.join(dir, 'fake-gh-calls.log');
  const set = (m) => fs.writeFileSync(modeFile, JSON.stringify(typeof m === 'string' ? { '*': m } : m));
  set(mode);
  fs.writeFileSync(script, `import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
fs.appendFileSync(path.join(here, 'fake-gh-calls.log'), JSON.stringify(args) + '\\n');
const modes = JSON.parse(fs.readFileSync(path.join(here, 'fake-gh-mode.json'), 'utf8'));
const target = args.find((a) => a.startsWith('github.com/'));
// Like gh, a call that names no repository gets the fixture's default one.
const slug = target ? target.slice('github.com/'.length) : 'example-user/brain';
const mode = modes[slug] || modes['*'] || 'fail';
if (mode === 'fail') { process.stderr.write('not logged in'); process.exit(1); }
const vis = mode.toUpperCase();
process.stdout.write(JSON.stringify({ visibility: vis, isPrivate: vis === 'PRIVATE', nameWithOwner: slug }));
`);
  return {
    script,
    set,
    calls: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    clearCalls: () => fs.rmSync(logFile, { force: true }),
  };
}

export function makeEnv(home, extra = {}) {
  const globalConfig = path.join(home, 'global gitconfig');
  if (!fs.existsSync(globalConfig)) fs.writeFileSync(globalConfig, '');
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k.startsWith('TONKA_')) delete env[k];
  return {
    ...env,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test Author',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test Author',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_TERMINAL_PROMPT: '0',
    // Only local transports: a push to a fictional github.com URL fails fast.
    GIT_ALLOW_PROTOCOL: 'file',
    TONKA_TODAY: '2026-09-30',
    ...extra,
  };
}

export function sh(cwd, cmd, args, env, input) {
  const r = spawnSync(cmd, args, { cwd, env, input, encoding: 'utf8', windowsHide: true });
  if (r.error) throw r.error;
  return r;
}

export function gitc(cwd, env, ...args) {
  const r = sh(cwd, 'git', args, env);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

// Copy the template-owned files (plus index and manifest) into dest.
export function copyTemplate(dest, from = REPO) {
  const files = [...templateFiles(from).files, ...INDEX_FILES, MANIFEST_PATH];
  for (const rel of files) {
    const src = path.join(from, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(dest, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  return dest;
}

// A git repository holding a fresh copy of the template, committed once.
// remote: true gives origin a local bare repository to fetch from and a
// fictional github.com push URL (so gh decides visibility); 'local' keeps only
// the bare repository; false means no remote. Tests push to fx.bare directly.
export function makeBrain({ label = 'brain', ghMode = 'private', remote = true } = {}) {
  const base = tmpDir(label);
  const home = path.join(base, 'home dir');
  fs.mkdirSync(home);
  const gh = fakeGh(home, ghMode);
  const env = makeEnv(home, { TONKA_GH_BIN: gh.script });
  const dir = path.join(base, 'my brain');
  fs.mkdirSync(dir);
  copyTemplate(dir);
  gitc(dir, env, 'init', '-q', '-b', 'main');
  gitc(dir, env, 'add', '-A');
  gitc(dir, env, 'commit', '-q', '-m', 'template');
  let bare = null;
  if (remote) {
    bare = path.join(base, 'origin repo.git');
    gitc(base, env, 'init', '-q', '--bare', '-b', 'main', bare);
    gitc(dir, env, 'remote', 'add', 'origin', bare);
    gitc(dir, env, 'push', '-q', 'origin', 'main');
    if (remote !== 'local') gitc(dir, env, 'remote', 'set-url', '--push', 'origin', GH_URL());
  }
  return { base, home, dir, env, gh, bare };
}

export function brain(fx, args, input) {
  return sh(fx.dir, process.execPath, [path.join(fx.dir, 'system', 'bin', 'brain.mjs'), ...args], fx.env, input);
}

export function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

// Credential-shaped strings are assembled at runtime so that no
// credential-shaped literal exists in the source tree.
export const fake = {
  aws: () => ['AK', 'IA', 'Q7ZX', '4MPL', '2K9R', 'TBW3'].join(''),
  github: () => `${'gh'}${'p_'}${'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5'}`,
  privateKey: () => `${'-----BEGIN '}${'OPENSSH PRIV'}${'ATE KEY-----'}\nb3BlbnNzaC1rZXktdjEAAAAA\n${'-----END '}${'OPENSSH PRIV'}${'ATE KEY-----'}\n`,
  anthropic: () => `${'sk-'}${'ant-'}api03-${'Zq8Lm2Np4Rt6Vx8Bz0Dc2Fg4Hj6Kl8Mn0'}`,
  assignment: () => `${'api'}_key = "${'q9Xz7Lm3Kp2Vt8Rn4Wb6Yc1Hd5Fg0Js'}"`,
};
