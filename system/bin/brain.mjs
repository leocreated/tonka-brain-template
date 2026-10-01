#!/usr/bin/env node
// TONKA BRAIN TEMPLATE command line. Run `node system/bin/brain.mjs help`.
import fs from 'node:fs';
import path from 'node:path';
import { SCRIPT_ROOT } from '../lib/util.mjs';
import { git } from '../lib/git.mjs';
import { writeIndex, checkIndex, buildIndexFrom } from '../lib/indexer.mjs';
import { validateAll, validateAnalyzed } from '../lib/records.mjs';
import {
  setupStatus, answerSection, skipSection, reopenSection, reviewSetup, finalizeSetup,
  SECTIONS, MEMORY_POLICIES, READY_MARKER,
} from '../lib/setup.mjs';
import { refreshVisibility, attestPrivate, reasonFor, visibilityGate } from '../lib/visibility.mjs';
import { hookStatus, installHooks, uninstallHooks } from '../lib/hooks.mjs';
import { stagedEntries, indexEntries, scanEntries, formatProblems, stagedSnapshot } from '../lib/guard.mjs';
import { doctor, join, formatChecks } from '../lib/doctor.mjs';
import { writeManifest, checkManifest } from '../lib/manifest.mjs';
import { planUpdate, applyUpdate, summarize } from '../lib/update.mjs';
import { releaseCheck, releaseExport } from '../lib/release.mjs';
import { newRecord, archiveRecord, RECORD_TYPES } from '../lib/authoring.mjs';

const ROOT = SCRIPT_ROOT;
const BOOLEAN = new Set([
  'check', 'strict', 'json', 'approve', 'attest-private', 'apply', 'dry-run', 'write',
  'allow-downgrade', 'no-hooks', 'staged', 'all', 'no-refresh', 'help',
]);

const HELP = `TONKA BRAIN TEMPLATE helper (node system/bin/brain.mjs <command>)

Everyday
  index [--check]                 Rebuild INDEX.md and INDEX.jsonl, or only check freshness
  validate [--strict] [--json]    Check record frontmatter (strict: missing fields are errors)
  check [--strict]                validate + index --check (good for CI and daily use)
  new <type> <title...>           Create a record from system/templates (${Object.keys(RECORD_TYPES).join(', ')})
  archive <path> --status <s> [--superseded-by <path>]
                                  Move a record into archives/ with a final status
  doctor                          Diagnose this clone (visibility, hooks, index, records)

Setup (driven by system/setup/GUIDE.md)
  setup status [--json]           Progress, privacy gate and next step
  setup visibility [--attest-private]
                                  Check every push destination with gh, or attest to them
  setup answer <section> [--from <file>|-] [--policy <p>]
                                  Store a synthesized draft in ignored .brain/ state
  setup skip <section>            Skip a section explicitly (revision: leave it unchanged)
  setup reopen <section>          Mark a section pending again (ready brain: revise only it)
  setup review                    Print the synthesized files for the user to review
  setup finalize --approve        Write reviewed files (never commits)
  join [--no-hooks]               Second device: keep records, set up this clone

Privacy and hooks
  hooks status|install|uninstall  Per-clone pre-commit hook (never replaces existing hooks)
  guard [--staged|--all]          Scan staged (default) or all indexed blobs for credentials
  hook pre-commit                 Entry point used by the git hook

Template maintenance
  manifest [--write|--check] [--strict]
  update --from <folder> [--apply] [--manifest-sha256 <hex>] [--allow-downgrade]
  release-export --out <folder>
  release-check [--root <folder>] [--denylist <file outside the repo>]

Sections: ${SECTIONS.map((s) => s.id).join(', ')}
Memory policies: ${Object.keys(MEMORY_POLICIES).join(', ')}
`;

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (BOOLEAN.has(key)) flags[key] = true;
      else {
        const v = argv[i + 1];
        if (v === undefined || (v.startsWith('--') && v !== '-')) throw usage(`--${key} needs a value`);
        flags[key] = v;
        i++;
      }
    } else pos.push(a);
  }
  return { pos, flags };
}

function usage(msg) {
  const e = new Error(msg);
  e.exitCode = 2;
  return e;
}

const METHOD_LABEL = {
  gh: 'current live gh check',
  'gh-cached': 'cached gh proof, not a current live check',
  attestation: 'user attestation, not live proof',
  none: 'not proven',
};

const out = (s = '') => process.stdout.write(`${s}\n`);
const err = (s = '') => process.stderr.write(`${s}\n`);

function readInput(from) {
  if (from === '-') return fs.readFileSync(0, 'utf8');
  return fs.readFileSync(path.resolve(from), 'utf8');
}

function printValidation(res, json) {
  if (json) {
    out(JSON.stringify(res, null, 2));
    return;
  }
  for (const p of res.problems) out(`  ${p.level === 'error' ? 'ERROR' : 'warn '} ${p.path}: ${p.message}`);
  out(`${res.count} records checked: ${res.errorCount} errors, ${res.problems.length - res.errorCount} warnings`);
}

function cmdSetup(pos, flags) {
  const sub = pos[0] || 'status';
  if (sub === 'status') {
    const s = setupStatus(ROOT);
    if (flags.json) return out(JSON.stringify(s, null, 2));
    out('TONKA setup status');
    out(`  Brain ready: ${s.ready.ready ? `yes (setup_version ${s.ready.setupVersion})` : 'no'}`);
    out(`  Visibility gate: ${s.visibility.ok ? 'passed' : 'not passed'} (${s.visibility.reason})`);
    const line = (id, st) => {
      const box = st === 'answered' ? '[x]' : st === 'skipped' ? '[-]' : '[ ]';
      out(`    ${box} ${id.padEnd(12)} ${st.padEnd(9)} ${SECTIONS.find((x) => x.id === id).title}`);
    };
    if (s.ready.ready && s.revision) {
      out('  Revising these topics (every other topic stays as committed):');
      for (const t of s.revision) line(t.id, t.status);
    } else if (s.ready.ready) {
      out(`  Topics: handled in the committed setup (${READY_MARKER}); memory policy ${s.ready.memoryPolicy || 'unknown'}`);
    } else {
      out('  Sections:');
      for (const sec of SECTIONS) line(sec.id, s.state.sections[sec.id]?.status || 'pending');
      if (s.state.memoryPolicy) out(`  Memory policy: ${s.state.memoryPolicy}`);
    }
    out(`  Next: ${s.next}`);
    return;
  }
  if (sub === 'visibility') {
    const rec = flags['attest-private'] ? attestPrivate(ROOT) : refreshVisibility(ROOT);
    const method = rec.method === 'gh-cached' && rec.status !== 'private' ? 'cached gh result, not a current live check' : METHOD_LABEL[rec.method] || rec.method;
    out(`Visibility: ${rec.status} (${method})`);
    out(`  ${rec.detail}`);
    out(`Push destinations (${rec.destinations.length}):${rec.destinations.length ? '' : ' none (no git remote)'}`);
    for (const d of rec.destinations) {
      const how = d.status === 'unresolved' ? 'gh cannot check it'
        : d.status === 'unknown' ? 'gh could not check it now'
          : d.source === 'live' ? `${d.status} (current live gh check)`
            : d.status === 'private' ? `private (cached gh proof from ${String(d.provenAt || '').slice(0, 10)}, not a current live check)`
              : `${d.status} (last gh result, from ${String(d.observedAt || 'an earlier check').slice(0, 10)}; gh could not check it now)`;
      out(`  - ${d.label}: ${how}`);
    }
    if (rec.status !== 'private') {
      out(`Gate not passed: ${reasonFor(rec)}`);
      return 1;
    }
    out('Gate passed. Personal answers may now be written to tracked files after review.');
    if (rec.method === 'attestation') out('The attestation covers exactly these push destinations. Adding or changing a remote or push URL needs a new check or attestation.');
    return;
  }
  if (sub === 'answer') {
    const id = pos[1];
    if (!id) throw usage('setup answer <section>');
    const text = flags.from ? readInput(flags.from) : null;
    answerSection(ROOT, id, { text, policy: flags.policy || null });
    out(`Saved draft for "${id}" in ignored local state (.brain/setup/drafts/${id}.md).`);
    out(`Next: ${setupStatus(ROOT).next}`);
    return;
  }
  if (sub === 'skip') {
    if (!pos[1]) throw usage('setup skip <section>');
    const r = skipSection(ROOT, pos[1]);
    out(r.cancelled
      ? `"${pos[1]}" is no longer being revised; its committed text stays as it is. Next: ${setupStatus(ROOT).next}`
      : `Skipped "${pos[1]}" explicitly. Next: ${setupStatus(ROOT).next}`);
    return;
  }
  if (sub === 'reopen') {
    if (!pos[1]) throw usage('setup reopen <section>');
    const r = reopenSection(ROOT, pos[1]);
    if (!r.revision) {
      out(`Reopened "${pos[1]}".`);
      return;
    }
    out(`Revising "${pos[1]}" on this ready brain. Only this topic's section will change; every other topic and your edits elsewhere stay as they are.`);
    out(r.seeded
      ? `Its current committed text is in .brain/setup/drafts/${pos[1]}.md as a starting point.`
      : `No committed text was found for it, so write a new draft at .brain/setup/drafts/${pos[1]}.md.`);
    out(`Next: ${setupStatus(ROOT).next}`);
    return;
  }
  if (sub === 'review') {
    const { files, proposals, notes, revision } = reviewSetup(ROOT);
    out('Review these files before finalizing. Nothing has been written to tracked files yet.\n');
    if (revision) {
      out(`Targeted revision of: ${revision.join(', ')}. Topics that were not reopened are not touched.`);
      for (const n of notes) out(`  - ${n}`);
      out('');
    }
    for (const [rel, content] of Object.entries(files)) {
      out(`===== ${rel} =====`);
      out(content);
    }
    for (const [rel, content] of Object.entries(proposals)) {
      out(`===== ${rel} (kept as it is; this proposal goes to .brain/setup/proposed/) =====`);
      out(content);
    }
    out('If the user approves: node system/bin/brain.mjs setup finalize --approve');
    out('To change something: edit .brain/setup/drafts/<section>.md, run "setup answer <section>", then review again.');
    return;
  }
  if (sub === 'finalize') {
    const r = finalizeSetup(ROOT, { approve: !!flags.approve });
    for (const w of r.written) out(`  wrote     ${w}`);
    for (const u of r.unchanged) out(`  unchanged ${u}`);
    for (const p of r.preserved) out(`  preserved ${p.path} (your edits kept; proposed version at ${p.proposed})`);
    out(`Privacy gate: ${r.gate.reason}`);
    out('Index rebuilt. Nothing was committed. Review with "git status" and commit when you are ready.');
    if (r.revision) out(`Revision of ${r.revision.join(', ')} is complete.`);
    else out('Next: node system/bin/brain.mjs hooks install, then see system/setup/integrations.md (all optional).');
    return;
  }
  throw usage(`unknown setup command "${sub}"`);
}

function cmdHookPreCommit() {
  let failed = false;
  const problems = scanEntries(ROOT, stagedEntries(ROOT));
  if (problems.length) {
    err('TONKA guard: staged content looks like it contains credentials or secret files.');
    err(formatProblems(problems));
    err('Matched content is not shown. Unstage or fix these files (git restore --staged <path>).');
    failed = true;
  }
  const gate = visibilityGate(ROOT, { refresh: true });
  if (!gate.ok) {
    err(`TONKA guard: ${gate.reason}`);
    failed = true;
  }
  // Records and index are checked as staged, so a working copy that was
  // fixed but not restaged cannot vouch for different committed content.
  const snap = stagedSnapshot(ROOT);
  const val = validateAnalyzed(snap.recs, snap.skipped);
  if (!val.ok) {
    err('TONKA guard: some staged records have invalid frontmatter:');
    for (const p of val.problems.filter((x) => x.level === 'error')) err(`  ${p.path}: ${p.message}`);
    failed = true;
  }
  const expected = buildIndexFrom(snap.recs, snap.skipped);
  const want = { 'INDEX.jsonl': expected.jsonl, 'INDEX.md': expected.md };
  const stale = Object.keys(want).filter((name) => snap.indexFiles[name] !== want[name]);
  if (stale.length) {
    const onDisk = (name) => {
      try {
        return fs.readFileSync(path.join(ROOT, name), 'utf8').replace(/\r\n/g, '\n');
      } catch {
        return null;
      }
    };
    if (stale.every((name) => onDisk(name) === want[name])) {
      err('TONKA guard: the regenerated index is not staged. Run "git add INDEX.md INDEX.jsonl".');
    } else {
      err(`TONKA guard: staged ${stale.join(' and ')} out of date for the staged records. Run "node system/bin/brain.mjs index" and stage the result together with every record it lists (a record changed on disk but not restaged also counts).`);
    }
    failed = true;
  }
  if (failed) {
    err('Commit blocked. Bypassing with --no-verify skips every check above; only do that deliberately.');
    return 1;
  }
  return 0;
}

function run(argv) {
  const { pos, flags } = parseArgs(argv);
  const cmd = pos.shift();
  if (!cmd || cmd === 'help' || flags.help) {
    out(HELP);
    return 0;
  }
  switch (cmd) {
    case 'index': {
      if (flags.check) {
        const r = checkIndex(ROOT);
        out(r.fresh ? `Index is fresh (${r.built.recs.length} records).` : `Index is stale: ${r.stale.join(', ')}. Run: node system/bin/brain.mjs index`);
        return r.fresh ? 0 : 1;
      }
      const b = writeIndex(ROOT);
      for (const s of b.skipped) out(`  skipped ${s.path}: ${s.reason}`);
      const unknown = b.recs.filter((r) => r.metadata !== 'complete').length;
      out(`Index written: ${b.recs.length} records${unknown ? `, ${unknown} with incomplete or invalid metadata (see validate)` : ''}.`);
      return 0;
    }
    case 'validate': {
      const r = validateAll(ROOT, { strict: !!flags.strict });
      printValidation(r, flags.json);
      return r.ok ? 0 : 1;
    }
    case 'check': {
      const v = validateAll(ROOT, { strict: !!flags.strict });
      printValidation(v, false);
      const i = checkIndex(ROOT);
      out(i.fresh ? 'Index is fresh.' : `Index is stale: ${i.stale.join(', ')}.`);
      return v.ok && i.fresh ? 0 : 1;
    }
    case 'new': {
      const type = pos.shift();
      const rel = newRecord(ROOT, type, pos.join(' '), flags.date ? { date: flags.date } : {});
      out(`Created ${rel} and rebuilt the index.`);
      return 0;
    }
    case 'archive': {
      if (!pos[0]) throw usage('archive <path> --status <status>');
      const dest = archiveRecord(ROOT, pos[0], { status: flags.status, supersededBy: flags['superseded-by'] || null });
      out(`Moved to ${dest} and rebuilt the index.`);
      return 0;
    }
    case 'setup':
      return cmdSetup(pos, flags) || 0;
    case 'join': {
      const r = join(ROOT, { hooks: !flags['no-hooks'] });
      out(`Brain is ready (setup_version ${r.ready.setupVersion}). Portable records were left untouched.`);
      if (r.hookResult) out(r.hookResult.ok ? `Hook: ${r.hookResult.changed ? 'installed for this clone' : r.hookResult.status.state}` : `Hook not installed: ${r.hookResult.message}`);
      out(formatChecks(r.report.checks));
      return r.report.ok ? 0 : 1;
    }
    case 'doctor': {
      const r = doctor(ROOT, { refresh: !flags['no-refresh'] });
      out(formatChecks(r.checks));
      return r.ok ? 0 : 1;
    }
    case 'hooks': {
      const sub = pos[0] || 'status';
      if (sub === 'status') {
        const s = hookStatus(ROOT);
        out(`${s.state}: ${s.detail}`);
        for (const n of s.notes) out(`  note: ${n}`);
        return s.state === 'installed' || s.state === 'composed' ? 0 : 1;
      }
      if (sub === 'install') {
        const r = installHooks(ROOT);
        out(r.changed ? `Installed: ${r.status.detail}. Other clones, such as on another device, need their own install.` : `No change: ${r.status.state} (${r.status.detail}).`);
        return 0;
      }
      if (sub === 'uninstall') {
        const r = uninstallHooks(ROOT);
        out(r.changed ? 'Removed core.hooksPath from this clone.' : `No change: ${r.status.state}.`);
        return 0;
      }
      throw usage(`unknown hooks command "${sub}"`);
    }
    case 'hook': {
      if (pos[0] !== 'pre-commit') throw usage('hook pre-commit');
      return cmdHookPreCommit();
    }
    case 'guard': {
      const entries = flags.all ? indexEntries(ROOT) : stagedEntries(ROOT);
      const problems = scanEntries(ROOT, entries);
      if (problems.length) {
        out(`Found ${problems.length} problem(s) in ${flags.all ? 'indexed' : 'staged'} content (matched content not shown):`);
        out(formatProblems(problems));
        return 1;
      }
      out(`No credential shapes or secret file names in ${entries.length} ${flags.all ? 'indexed' : 'staged'} file(s). This is a heuristic, not a guarantee.`);
      return 0;
    }
    case 'manifest': {
      if (flags.write) {
        const m = writeManifest(ROOT);
        out(`Wrote system/template-manifest.json (${m.files.length} files, version ${m.version}).`);
        return 0;
      }
      const r = checkManifest(ROOT, { strict: !!flags.strict });
      for (const p of r.problems) out(`  ${p.path}: ${p.issue}`);
      out(r.ok ? 'Template files match the manifest.' : `${r.problems.length} difference(s) from the manifest.`);
      return r.ok ? 0 : 1;
    }
    case 'update': {
      if (!flags.from) throw usage('update --from <release folder>');
      const plan = planUpdate(ROOT, flags.from, { manifestSha256: flags['manifest-sha256'], allowDowngrade: !!flags['allow-downgrade'] });
      out(`Update ${plan.fromVersion || '(no installed manifest)'} -> ${plan.toVersion}`);
      out(`Package manifest SHA-256: ${plan.manifestSha256}`);
      out('  (A matching hash proves integrity against the value you compare with, not who made the package.)');
      for (const a of plan.actions) if (a.type !== 'same') out(`  ${a.type.padEnd(32)} ${a.path}`);
      const counts = summarize(plan);
      out(`Summary: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ') || 'nothing to do'}`);
      if (git(ROOT, ['status', '--porcelain']).stdout.trim()) out('Note: this working tree has uncommitted changes; commit or stash them first so the update is easy to review.');
      if (!flags.apply) {
        out('Dry run only. Re-run with --apply to write safe changes. Conflicts are never overwritten.');
        return 0;
      }
      const r = applyUpdate(ROOT, plan);
      out(`Applied ${r.applied} safe change(s). Receipt, backups and incoming conflict copies: ${r.dir}`);
      out('Nothing was committed. Review with "git diff".');
      return 0;
    }
    case 'release-export': {
      if (!flags.out) throw usage('release-export --out <folder>');
      const r = releaseExport(ROOT, flags.out);
      out(`Exported ${r.files} files from HEAD ${r.head} to ${r.out}`);
      if (r.dirty) out('Note: the working tree has uncommitted changes; they were NOT exported.');
      out(`Next: node system/bin/brain.mjs release-check --root "${r.out}"`);
      return 0;
    }
    case 'release-check': {
      const dir = flags.root ? path.resolve(flags.root) : ROOT;
      if (flags.denylist && fs.existsSync(flags.denylist) && path.resolve(flags.denylist).startsWith(path.resolve(dir) + path.sep)) {
        throw usage('keep the denylist outside the tree being checked');
      }
      const r = releaseCheck(dir, { denylist: flags.denylist || null });
      for (const f of r.findings) out(`  ${f.path}${f.line ? `:${f.line}` : ''}  ${f.rule}`);
      out(r.ok ? `Release check passed (${r.files} files). It is heuristic: still read the exact exported tree before publishing.` : `Release check failed: ${r.findings.length} finding(s).`);
      return r.ok ? 0 : 1;
    }
    default:
      throw usage(`unknown command "${cmd}". Run: node system/bin/brain.mjs help`);
  }
}

if (Number(process.versions.node.split('.')[0]) < 22) {
  err(`Warning: TONKA needs Node 22 or newer (found ${process.versions.node}). Install the current LTS release from https://nodejs.org.`);
}

try {
  process.exitCode = run(process.argv.slice(2)) || 0;
} catch (e) {
  err(`Error: ${e.message}`);
  process.exitCode = e.exitCode || 1;
}
