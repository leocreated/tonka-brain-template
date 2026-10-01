// Thin wrapper around the git executable. Never mutates user or global config.
import { spawnSync } from 'node:child_process';

export function git(cwd, args, opts = {}) {
  const r = spawnSync('git', args, {
    cwd,
    input: opts.input,
    encoding: opts.buffer ? undefined : 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    windowsHide: true,
    env: opts.env || process.env,
  });
  if (r.error) return { ok: false, status: -1, stdout: opts.buffer ? Buffer.alloc(0) : '', stderr: String(r.error.message) };
  return { ok: r.status === 0, status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function isGitRepo(cwd) {
  return git(cwd, ['rev-parse', '--is-inside-work-tree']).stdout.trim() === 'true';
}

export function gitTopLevel(cwd) {
  const r = git(cwd, ['rev-parse', '--show-toplevel']);
  return r.ok ? r.stdout.trim() : null;
}

export function isIgnored(cwd, rel) {
  return git(cwd, ['check-ignore', '-q', '--no-index', rel]).status === 0;
}

// Read many blobs at once. Returns Map(sha -> Buffer).
export function readBlobs(cwd, shas) {
  const map = new Map();
  if (!shas.length) return map;
  const unique = [...new Set(shas)];
  const r = git(cwd, ['cat-file', '--batch'], { input: `${unique.join('\n')}\n`, buffer: true });
  if (!r.ok) throw new Error(`git cat-file failed: ${String(r.stderr)}`);
  const out = r.stdout;
  let pos = 0;
  while (pos < out.length) {
    const nl = out.indexOf(0x0a, pos);
    if (nl < 0) break;
    const header = out.subarray(pos, nl).toString('utf8');
    const [sha, type, sizeText] = header.split(' ');
    if (type === 'missing' || sizeText === undefined) {
      pos = nl + 1;
      continue;
    }
    const size = Number(sizeText);
    map.set(sha, out.subarray(nl + 1, nl + 1 + size));
    pos = nl + 1 + size + 1;
  }
  return map;
}
