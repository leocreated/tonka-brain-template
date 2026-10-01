// Per-clone pre-commit hook management. Only ever touches this clone's local
// git config, and refuses to replace a hook setup it did not create.
import fs from 'node:fs';
import path from 'node:path';
import { git } from './git.mjs';

export const HOOKS_DIR = 'system/hooks';
const MARKER_LOOSE = /brain\.mjs"?\s+hook\s+pre-commit/;

export const COMPOSE_SNIPPET = [
  '# Add this line to your existing pre-commit hook (POSIX sh):',
  'node "$(git rev-parse --show-toplevel)/system/bin/brain.mjs" hook pre-commit || exit 1',
].join('\n');

function values(root, args) {
  const r = git(root, ['config', ...args, '--get-all', 'core.hooksPath']);
  return r.ok ? r.stdout.split(/\r?\n/).filter(Boolean) : [];
}

function hookCalls(file) {
  try {
    return MARKER_LOOSE.test(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

function sameHooksDir(root, value) {
  const abs = path.resolve(root, value);
  return path.relative(path.join(root, HOOKS_DIR), abs) === '';
}

export function hookStatus(root) {
  const local = values(root, ['--local']);
  const all = values(root, []);
  const nonLocal = all.filter((v) => !local.includes(v));
  const common = git(root, ['rev-parse', '--git-common-dir']).stdout.trim();
  const defaultDir = path.resolve(root, common, 'hooks');
  const defaultHook = path.join(defaultDir, 'pre-commit');
  const res = { local, nonLocal, defaultHook: fs.existsSync(defaultHook) ? defaultHook : null, notes: [] };

  if (local.length === 1 && sameHooksDir(root, local[0])) {
    if (nonLocal.length) res.notes.push(`a non-local core.hooksPath (${nonLocal.join(', ')}) is overridden in this clone`);
    if (!fs.existsSync(path.join(root, HOOKS_DIR, 'pre-commit'))) return { ...res, state: 'broken', detail: `${HOOKS_DIR}/pre-commit is missing` };
    return { ...res, state: 'installed', detail: `core.hooksPath=${HOOKS_DIR} in this clone's local git config (covers every worktree of this clone, no other clone)` };
  }
  const effective = all.length ? all[all.length - 1] : null;
  if (effective) {
    const hook = path.resolve(root, effective.replace(/^~(?=[/\\])/, process.env.HOME || process.env.USERPROFILE || '~'), 'pre-commit');
    if (hookCalls(hook)) return { ...res, state: 'composed', detail: `existing hooks at ${effective} already call the TONKA guard` };
    return { ...res, state: 'conflict', detail: `core.hooksPath is already set to "${effective}"; TONKA will not replace it` };
  }
  if (res.defaultHook) {
    if (hookCalls(res.defaultHook)) return { ...res, state: 'composed', detail: 'existing .git/hooks/pre-commit already calls the TONKA guard' };
    return { ...res, state: 'conflict', detail: 'a pre-commit hook already exists in the default hooks folder; TONKA will not replace it' };
  }
  return { ...res, state: 'not-installed', detail: 'no pre-commit hook is active in this clone' };
}

export function installHooks(root) {
  const st = hookStatus(root);
  if (st.state === 'installed' || st.state === 'composed') return { changed: false, status: st };
  if (st.state === 'conflict' || st.state === 'broken') {
    const err = new Error(`${st.detail}.\nCompose instead of replacing:\n${COMPOSE_SNIPPET}`);
    err.status = st;
    throw err;
  }
  const r = git(root, ['config', '--local', 'core.hooksPath', HOOKS_DIR]);
  if (!r.ok) throw new Error(`git config failed: ${r.stderr.trim()}`);
  return { changed: true, status: hookStatus(root) };
}

export function uninstallHooks(root) {
  const st = hookStatus(root);
  if (st.state !== 'installed') return { changed: false, status: st };
  const r = git(root, ['config', '--local', '--unset', 'core.hooksPath']);
  if (!r.ok) throw new Error(`git config failed: ${r.stderr.trim()}`);
  return { changed: true, status: hookStatus(root) };
}
