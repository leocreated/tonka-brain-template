// Diagnostics and second-device join.
import { readJson, writeJson, nowIso } from './util.mjs';
import { git, isGitRepo, isIgnored } from './git.mjs';
import { readyInfo } from './setup.mjs';
import { visibilityGate, assertBrainIgnored, brainPath } from './visibility.mjs';
import { hookStatus, installHooks } from './hooks.mjs';
import { checkIndex } from './indexer.mjs';
import { validateAll } from './records.mjs';
import { checkManifest } from './manifest.mjs';

export function doctor(root, { refresh = true } = {}) {
  const checks = [];
  const add = (level, name, detail) => checks.push({ level, name, detail });
  const major = Number(process.versions.node.split('.')[0]);
  add(major >= 22 ? 'ok' : 'fail', 'node', `Node ${process.versions.node}${major >= 22 ? '' : ' (TONKA needs Node 22 or newer; use a current LTS release)'}`);
  const gv = git(root, ['--version']);
  add(gv.ok ? 'ok' : 'fail', 'git', gv.ok ? gv.stdout.trim() : 'git not found on PATH');
  if (!gv.ok || !isGitRepo(root)) {
    add('fail', 'repository', 'this folder is not a git working tree');
    return { checks, ok: false };
  }
  const ignored = isIgnored(root, '.brain/x.json');
  add(ignored ? 'ok' : 'fail', 'local state', ignored ? '.brain/ is ignored by git' : '.brain/ is NOT ignored; restore .gitignore');
  const ready = readyInfo(root);
  add(ready.ready ? 'ok' : 'warn', 'setup', ready.ready ? `ready (setup_version ${ready.setupVersion}, memory policy ${ready.memoryPolicy || 'unknown'})` : (ready.problem || 'not set up yet; run the setup guide'));
  // Never write local state when .brain/ is not ignored.
  const vis = visibilityGate(root, { refresh: refresh && ignored });
  add(vis.ok ? 'ok' : (ready.ready ? 'fail' : 'warn'), 'visibility', vis.reason);
  const hs = hookStatus(root);
  const hookLevel = hs.state === 'installed' || hs.state === 'composed' ? 'ok' : hs.state === 'broken' ? 'fail' : 'warn';
  add(hookLevel, 'pre-commit hook', `${hs.state}: ${hs.detail}${hs.notes.length ? `; ${hs.notes.join('; ')}` : ''}`);
  const idx = checkIndex(root);
  add(idx.fresh ? 'ok' : 'warn', 'index', idx.fresh ? `fresh (${idx.built.recs.length} records)` : `stale: ${idx.stale.join(', ')}; run: node system/bin/brain.mjs index`);
  const val = validateAll(root);
  const warnCount = val.problems.length - val.errorCount;
  add(val.ok ? (warnCount ? 'warn' : 'ok') : 'fail', 'records', `${val.count} records, ${val.errorCount} errors, ${warnCount} warnings; details: node system/bin/brain.mjs validate`);
  const mc = checkManifest(root);
  add(mc.ok ? 'ok' : 'warn', 'template files', mc.ok ? `unmodified (version ${mc.manifest.version})` : `${mc.problems.length} template files differ from version ${mc.manifest ? mc.manifest.version : 'unknown'} (local edits are allowed; updates will preserve them)`);
  const machine = readJson(brainPath(root, 'machine.json'));
  add(machine ? 'ok' : 'warn', 'this device', machine ? `joined ${machine.joinedAt}` : 'no machine record; run join (second device) or setup');
  const remoteCount = git(root, ['remote']).stdout.split(/\r?\n/).filter(Boolean).length;
  add('ok', 'remotes', `${remoteCount} configured`);
  return { checks, ok: !checks.some((c) => c.level === 'fail') };
}

export function join(root, { hooks = true } = {}) {
  const ready = readyInfo(root);
  if (!ready.ready) {
    const err = new Error('this brain has not completed setup yet. Run the setup guide (system/setup/GUIDE.md) instead of join.');
    err.code = 'NOT_READY';
    throw err;
  }
  assertBrainIgnored(root);
  const machineFile = brainPath(root, 'machine.json');
  const prev = readJson(machineFile);
  writeJson(machineFile, {
    joinedAt: prev?.joinedAt || nowIso(),
    lastJoinRun: nowIso(),
    platform: process.platform,
    node: process.versions.node,
  });
  let hookResult = null;
  if (hooks) {
    try {
      hookResult = { ok: true, ...installHooks(root) };
    } catch (e) {
      hookResult = { ok: false, message: e.message };
    }
  }
  return { ready, hookResult, report: doctor(root) };
}

export function formatChecks(checks) {
  const tag = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };
  return checks.map((c) => `  [${tag[c.level]}] ${c.name}: ${c.detail}`).join('\n');
}

