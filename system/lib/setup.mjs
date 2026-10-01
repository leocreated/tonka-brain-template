// Deterministic helpers behind the guided setup interview. The conversation
// itself is run by the agent following system/setup/GUIDE.md; these helpers
// store progress, enforce the privacy gate, and write the reviewed result.
//
// Two modes:
// - First-time setup (no context/setup.md yet): every topic is answered or
//   skipped, then all context files are composed from the local drafts.
// - Revision (the brain is ready): "setup reopen <topic>" revises only that
//   topic. The new text replaces just its section in the committed file, so
//   every other topic and every hand edit elsewhere stays as it is. This works
//   on any device, because it starts from the portable records, not from the
//   local drafts of the device that ran the first setup.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, writeFileAtomic, nowIso, today, sha256 } from './util.mjs';
import { parseFrontmatter, setFrontmatterField } from './frontmatter.mjs';
import { scanText } from './secrets.mjs';
import { assertBrainIgnored, brainPath, visibilityGate } from './visibility.mjs';
import { writeIndex } from './indexer.mjs';

export const SETUP_VERSION = 1;
export const MEMORY_POLICIES = {
  'ask-first': 'Agents propose a record and save it only after I say yes.',
  'save-routine': 'Agents may save routine decisions, lessons and papercuts on their own, and ask first for anything about people or sensitive topics.',
  'manual-only': 'Agents never write records unless I explicitly ask in that moment.',
};

export const SECTIONS = [
  { id: 'work', title: 'Work and roles', skippable: true },
  { id: 'goals', title: 'Goals and time horizons', skippable: true },
  { id: 'projects', title: 'Current projects', skippable: true },
  { id: 'preferences', title: 'Preferences and communication', skippable: true },
  { id: 'people', title: 'People and context (voluntary)', skippable: true },
  { id: 'tools', title: 'Agents, devices and tools', skippable: true },
  { id: 'rhythms', title: 'Working rhythms', skippable: true },
  { id: 'memory', title: 'Memory saving policy and sensitivity boundaries', skippable: false },
];
const SECTION_IDS = SECTIONS.map((s) => s.id);
const MAX_DRAFT_BYTES = 12000;
export const READY_MARKER = 'context/setup.md';

// Where each topic lives in the portable files: one level-2 section each.
export const TOPIC_TARGETS = {
  work: { file: 'context/profile.md', heading: 'Work and roles' },
  rhythms: { file: 'context/profile.md', heading: 'Working rhythms' },
  tools: { file: 'context/profile.md', heading: 'Agents, devices and tools' },
  goals: { file: 'context/priorities.md', heading: 'Goals and time horizons' },
  projects: { file: 'context/priorities.md', heading: 'Current projects' },
  preferences: { file: 'context/preferences.md', heading: 'Preferences and communication' },
  people: { file: 'people/overview.md', heading: 'People and context' },
  memory: { file: 'context/memory-policy.md', heading: 'Sensitivity boundaries and notes' },
};
const FILE_TITLES = {
  'context/profile.md': 'Profile',
  'context/priorities.md': 'Priorities',
  'context/preferences.md': 'Preferences',
  'people/overview.md': 'People overview',
  'context/memory-policy.md': 'Memory policy',
};
const PEOPLE_INTRO = 'Shared voluntarily during setup. Keep only what helps agents work with you.';
const POLICY_LINE = /^Policy: \*\*[^*\n]*\*\*\..*$/gm;

function statePath(root) {
  return brainPath(root, 'setup', 'state.json');
}
export function draftPath(root, id) {
  return brainPath(root, 'setup', 'drafts', `${id}.md`);
}

export function loadState(root) {
  const s = readJson(statePath(root));
  if (s && s.version === SETUP_VERSION) return { revision: null, ...s };
  const sections = {};
  for (const id of SECTION_IDS) sections[id] = { status: 'pending' };
  return { version: SETUP_VERSION, startedAt: null, sections, memoryPolicy: null, reviewedHash: null, finalizedAt: null, revision: null };
}

function saveState(root, state) {
  assertBrainIgnored(root);
  if (!state.startedAt) state.startedAt = nowIso();
  writeJson(statePath(root), state);
}

export function readyInfo(root) {
  const file = path.join(root, READY_MARKER);
  if (!fs.existsSync(file)) return { ready: false };
  const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  const v = Number(fm.data.setup_version);
  if (!fm.errors.length && Number.isInteger(v) && v >= 1) {
    return { ready: true, setupVersion: v, completed: fm.data.date || null, memoryPolicy: fm.data.memory_policy || null };
  }
  return { ready: false, problem: `${READY_MARKER} exists but has no valid setup_version` };
}

function sectionOrThrow(id) {
  const s = SECTIONS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown section "${id}". Sections: ${SECTION_IDS.join(', ')}`);
  return s;
}

function checkDraftText(text) {
  if (!text.trim()) throw new Error('draft is empty; use "skip" to skip a section explicitly');
  if (Buffer.byteLength(text) > MAX_DRAFT_BYTES) {
    throw new Error(`draft is over ${MAX_DRAFT_BYTES} bytes. Store a short synthesized summary, not a transcript.`);
  }
  const hits = scanText(text);
  if (hits.length) {
    const rules = [...new Set(hits.map((h) => h.rule))].join(', ');
    throw new Error(`draft looks like it contains a credential (${rules}). Remove it; TONKA never stores secrets.`);
  }
}

// ---- Sections inside portable files ---------------------------------------

function readPortable(root, rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n') : null;
}

function bodyStart(lines) {
  if (lines[0] !== undefined && lines[0].replace(/^﻿/, '').trim() === '---') {
    for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') return i + 1;
  }
  return 0;
}

// The section under "## <heading>", found exactly once outside frontmatter.
function locateSection(lines, heading) {
  const hits = [];
  for (let i = bodyStart(lines); i < lines.length; i++) if (lines[i].trim() === `## ${heading}`) hits.push(i);
  if (hits.length !== 1) return null;
  let end = lines.length;
  for (let i = hits[0] + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { head: hits[0], end };
}

export function sectionText(text, heading) {
  const lines = text.split('\n');
  const loc = locateSection(lines, heading);
  return loc ? lines.slice(loc.head + 1, loc.end).join('\n').trim() : null;
}

export function replaceSection(text, heading, body) {
  const lines = text.split('\n');
  const loc = locateSection(lines, heading);
  if (!loc) return null;
  return [...lines.slice(0, loc.head + 1), '', ...body.trim().split('\n'), '', ...lines.slice(loc.end)].join('\n');
}

function currentPolicy(root) {
  const text = readPortable(root, TOPIC_TARGETS.memory.file);
  const fromFile = text ? parseFrontmatter(text).data.memory_policy : null;
  const policy = fromFile || readyInfo(root).memoryPolicy;
  return policy in MEMORY_POLICIES ? policy : null;
}

// ---- Commands -------------------------------------------------------------

function activeRevision(state) {
  return state.revision && Object.keys(state.revision.topics || {}).length ? state.revision : null;
}

function revisionOrder(rev) {
  return SECTION_IDS.filter((id) => rev.topics[id]);
}

export function answerSection(root, id, { text = null, policy = null } = {}) {
  sectionOrThrow(id);
  assertBrainIgnored(root);
  const ready = readyInfo(root).ready;
  const state = loadState(root);
  if (ready && !(activeRevision(state) && state.revision.topics[id])) {
    throw new Error(`this brain is already set up. To revise "${id}", run first: node system/bin/brain.mjs setup reopen ${id}`);
  }
  const gate = visibilityGate(root, { refresh: false });
  if (!gate.ok) throw new Error(`privacy gate first: ${gate.reason}`);
  const file = draftPath(root, id);
  if (text !== null) writeFileAtomic(file, text.endsWith('\n') ? text : `${text}\n`);
  if (!fs.existsSync(file)) throw new Error(`no draft found at .brain/setup/drafts/${id}.md; write one or pass --from <file>`);
  checkDraftText(fs.readFileSync(file, 'utf8'));
  if (ready) {
    if (id === 'memory') {
      const chosen = policy || state.revision.policy || currentPolicy(root);
      if (!chosen || !(chosen in MEMORY_POLICIES)) throw new Error(`memory section needs --policy ${Object.keys(MEMORY_POLICIES).join('|')}`);
      state.revision.policy = chosen;
    }
    state.revision.topics[id] = { status: 'answered', updatedAt: nowIso() };
    saveState(root, state);
    return state;
  }
  if (id === 'memory') {
    const chosen = policy || state.memoryPolicy;
    if (!chosen || !(chosen in MEMORY_POLICIES)) {
      throw new Error(`memory section needs --policy ${Object.keys(MEMORY_POLICIES).join('|')}`);
    }
    state.memoryPolicy = chosen;
  }
  state.sections[id] = { status: 'answered', updatedAt: nowIso() };
  saveState(root, state);
  return state;
}

// During a revision, "skip" drops the topic from the revision and leaves its
// committed text untouched. Returns { state, cancelled }.
export function skipSection(root, id) {
  const s = sectionOrThrow(id);
  const state = loadState(root);
  if (readyInfo(root).ready) {
    if (!(activeRevision(state) && state.revision.topics[id])) {
      throw new Error(`this brain is already set up and "${id}" is not being revised, so there is nothing to skip.`);
    }
    delete state.revision.topics[id];
    state.revision.reviewedHash = null;
    if (!Object.keys(state.revision.topics).length) state.revision = null;
    saveState(root, state);
    return { state, cancelled: true };
  }
  if (!s.skippable) throw new Error(`"${id}" cannot be skipped. Choose a policy; manual-only is the most conservative.`);
  state.sections[id] = { status: 'skipped', updatedAt: nowIso() };
  saveState(root, state);
  return { state, cancelled: false };
}

// On a ready brain this starts (or extends) a targeted revision and copies
// the topic's current committed text into its draft as a starting point.
// Returns { state, revision, seeded }.
export function reopenSection(root, id) {
  sectionOrThrow(id);
  const state = loadState(root);
  if (readyInfo(root).ready) {
    assertBrainIgnored(root);
    const rev = activeRevision(state) || { startedAt: nowIso(), topics: {}, policy: null, reviewedHash: null };
    rev.topics[id] = { status: 'pending', updatedAt: nowIso() };
    rev.reviewedHash = null;
    state.revision = rev;
    const t = TOPIC_TARGETS[id];
    const text = readPortable(root, t.file);
    const current = text === null ? null : sectionText(text, t.heading);
    const draft = draftPath(root, id);
    if (current) writeFileAtomic(draft, `${current}\n`);
    else fs.rmSync(draft, { force: true });
    saveState(root, state);
    return { state, revision: true, seeded: Boolean(current) };
  }
  state.sections[id] = { status: 'pending', updatedAt: nowIso() };
  state.reviewedHash = null;
  saveState(root, state);
  return { state, revision: false, seeded: false };
}

export function setupStatus(root) {
  const state = loadState(root);
  const ready = readyInfo(root);
  const vis = visibilityGate(root, { refresh: false });
  const joined = fs.existsSync(brainPath(root, 'machine.json'));
  if (ready.ready) {
    const rev = activeRevision(state);
    const revPending = rev ? revisionOrder(rev).filter((id) => rev.topics[id].status !== 'answered') : [];
    let next;
    if (rev && !vis.ok) next = 'Privacy gate first: node system/bin/brain.mjs setup visibility';
    else if (rev && revPending.length) next = `Revising "${revPending[0]}": interview that topic again (system/setup/interview.md), save the draft, then: node system/bin/brain.mjs setup answer ${revPending[0]}`;
    else if (rev && !rev.reviewedHash) next = 'Show the revised result: node system/bin/brain.mjs setup review';
    else if (rev) next = 'After the user approves: node system/bin/brain.mjs setup finalize --approve';
    else if (!joined) next = 'Brain is ready (set up on another device). On this device run: node system/bin/brain.mjs join';
    else next = 'Brain is ready. Daily use: see system/docs/daily-habits.md. Optional tools: system/setup/integrations.md. To revise one topic: node system/bin/brain.mjs setup reopen <topic>';
    return {
      ready, visibility: vis, state, pending: revPending, next,
      revision: rev ? revisionOrder(rev).map((id) => ({ id, status: rev.topics[id].status })) : null,
    };
  }
  const pending = SECTIONS.filter((s) => state.sections[s.id]?.status !== 'answered' && state.sections[s.id]?.status !== 'skipped');
  let next;
  if (!vis.ok) next = 'Privacy gate first: node system/bin/brain.mjs setup visibility';
  else if (pending.length) next = `Interview section "${pending[0].id}" (${pending[0].title}). See system/setup/interview.md`;
  else if (!state.reviewedHash) next = 'Show the synthesized result: node system/bin/brain.mjs setup review';
  else next = 'After the user approves: node system/bin/brain.mjs setup finalize --approve';
  return { ready, visibility: vis, state, pending: pending.map((s) => s.id), next, revision: null };
}

// ---- First-time setup -----------------------------------------------------

function draftOrSkip(root, state, id) {
  const st = state.sections[id]?.status;
  if (st === 'skipped') return `_Skipped during setup on ${today()}._`;
  if (st !== 'answered') return null;
  return fs.readFileSync(draftPath(root, id), 'utf8').trim();
}

function fm(title, extra = {}) {
  const lines = ['---', `title: ${title}`, `date: ${today()}`, 'status: active', 'tags: [setup]'];
  for (const [k, v] of Object.entries(extra)) lines.push(`${k}: ${v}`);
  lines.push('---', '');
  return lines.join('\n');
}

function memoryPolicyFile(policy, notes) {
  return `${fm('Memory policy', { memory_policy: policy })}# Memory policy\n\n`
    + `Policy: **${policy}**. ${MEMORY_POLICIES[policy]}\n\n`
    + `## Sensitivity boundaries and notes\n\n${notes}\n\n`
    + '## Agent-native memory\n\nSome agents keep their own memory outside this repository, controlled by their own settings. '
    + 'This policy governs what agents write into this brain. TONKA never changes agent or global settings; review those yourself.\n';
}

function peopleFile(notes) {
  return `${fm('People overview')}# People overview\n\n${PEOPLE_INTRO}\n\n## People and context\n\n${notes}\n`;
}

// Compose the portable files the user reviews before finalizing.
export function composeOutputs(root) {
  const state = loadState(root);
  const missing = SECTIONS.filter((s) => !['answered', 'skipped'].includes(state.sections[s.id]?.status));
  if (missing.length) throw new Error(`sections not handled yet: ${missing.map((s) => s.id).join(', ')}`);
  const g = (id) => draftOrSkip(root, state, id);
  const files = {};
  files['context/profile.md'] = `${fm('Profile')}# Profile\n\n## Work and roles\n\n${g('work')}\n\n## Working rhythms\n\n${g('rhythms')}\n\n## Agents, devices and tools\n\n${g('tools')}\n`;
  files['context/priorities.md'] = `${fm('Priorities')}# Priorities\n\n## Goals and time horizons\n\n${g('goals')}\n\n## Current projects\n\n${g('projects')}\n`;
  files['context/preferences.md'] = `${fm('Preferences')}# Preferences\n\n## Preferences and communication\n\n${g('preferences')}\n`;
  files['context/memory-policy.md'] = memoryPolicyFile(state.memoryPolicy, g('memory'));
  if (state.sections.people?.status === 'answered') files['people/overview.md'] = peopleFile(g('people'));
  const handled = SECTIONS.map((s) => `- ${s.id}: ${state.sections[s.id].status}`).join('\n');
  files[READY_MARKER] = `${fm('Brain setup', { setup_version: SETUP_VERSION, memory_policy: state.memoryPolicy })}# Brain setup\n\n`
    + 'This file marks the brain as set up. Other devices detect it and join instead of repeating the interview.\n\n'
    + `## Sections\n\n${handled}\n`;
  const hash = sha256(JSON.stringify(Object.entries(files).sort()));
  return { files, hash, state };
}

// ---- Revision of a ready brain --------------------------------------------

// A file that does not exist yet gets only the revised topics; TONKA never
// invents the topics nobody answered.
function freshFile(rel, topics, drafts, policy) {
  if (rel === TOPIC_TARGETS.memory.file) return memoryPolicyFile(policy, drafts.memory);
  if (rel === TOPIC_TARGETS.people.file) return peopleFile(drafts.people);
  const title = FILE_TITLES[rel];
  return `${fm(title)}# ${title}\n\n${topics.map((id) => `## ${TOPIC_TARGETS[id].heading}\n\n${drafts[id]}\n`).join('\n')}`;
}

export function composeRevision(root, state = loadState(root)) {
  const rev = activeRevision(state);
  if (!rev) throw new Error('this brain is already set up and no topic is being revised. To revise one: node system/bin/brain.mjs setup reopen <topic>');
  const topics = revisionOrder(rev);
  const waiting = topics.filter((id) => rev.topics[id].status !== 'answered');
  if (waiting.length) throw new Error(`revised topics not answered yet: ${waiting.join(', ')} (answer them, or "setup skip <topic>" to leave one unchanged)`);
  const drafts = Object.fromEntries(topics.map((id) => [id, fs.readFileSync(draftPath(root, id), 'utf8').trim()]));
  const policy = topics.includes('memory') ? rev.policy : null;
  const files = {};
  const proposals = {};
  const notes = [];
  const byFile = new Map();
  for (const id of topics) byFile.set(TOPIC_TARGETS[id].file, [...(byFile.get(TOPIC_TARGETS[id].file) || []), id]);
  for (const [rel, ids] of byFile) {
    const headings = ids.map((id) => `"${TOPIC_TARGETS[id].heading}"`).join(', ');
    const current = readPortable(root, rel);
    if (current === null) {
      files[rel] = freshFile(rel, ids, drafts, policy);
      notes.push(`${rel} does not exist yet; it will be created with only the revised topic(s)`);
      continue;
    }
    let next = current;
    for (const id of ids) next = next === null ? null : replaceSection(next, TOPIC_TARGETS[id].heading, drafts[id]);
    if (next !== null && policy && rel === TOPIC_TARGETS.memory.file) {
      const lines = next.match(POLICY_LINE) || [];
      next = lines.length === 1 ? next.replace(POLICY_LINE, `Policy: **${policy}**. ${MEMORY_POLICIES[policy]}`) : null;
      if (next !== null) next = setFrontmatterField(next, 'memory_policy', policy);
    }
    if (next === null) {
      proposals[rel] = freshFile(rel, ids, drafts, policy);
      notes.push(`${rel} has no single section heading for ${headings} (edited by hand?), so it stays exactly as it is; the revised text goes to .brain/setup/proposed/${rel} for you to merge`);
      continue;
    }
    if (next === current) {
      notes.push(`${rel}: revised text is the same as the committed text; nothing changes`);
      continue;
    }
    files[rel] = setFrontmatterField(next, 'updated', today());
    notes.push(`${rel}: only section(s) ${headings}${policy && rel === TOPIC_TARGETS.memory.file ? ' and the policy line' : ''} change; everything else in the file stays as it is`);
  }
  const marker = readPortable(root, READY_MARKER);
  if (marker !== null) {
    let next = marker;
    if (policy && parseFrontmatter(marker).data.memory_policy !== policy) next = setFrontmatterField(next, 'memory_policy', policy);
    for (const id of topics) next = next.replace(new RegExp(`^- ${id}: skipped$`, 'm'), `- ${id}: answered`);
    if (next !== marker) {
      files[READY_MARKER] = setFrontmatterField(next, 'updated', today());
      notes.push(`${READY_MARKER}: topic list${policy ? ' and memory policy' : ''} updated`);
    }
  }
  const hash = sha256(JSON.stringify([Object.entries(files).sort(), Object.entries(proposals).sort()]));
  return { files, proposals, notes, hash, topics, state };
}

// ---- Review and finalize --------------------------------------------------

export function reviewSetup(root) {
  if (readyInfo(root).ready) {
    const c = composeRevision(root);
    c.state.revision.reviewedHash = c.hash;
    saveState(root, c.state);
    return { files: c.files, proposals: c.proposals, notes: c.notes, hash: c.hash, revision: c.topics };
  }
  const { files, hash, state } = composeOutputs(root);
  state.reviewedHash = hash;
  saveState(root, state);
  return { files, proposals: {}, notes: [], hash, revision: null };
}

function generatedRecordPath(root) {
  return brainPath(root, 'setup', 'generated.json');
}

function writeProposal(root, rel, content) {
  const proposed = brainPath(root, 'setup', 'proposed', rel);
  writeFileAtomic(proposed, content);
  return { path: rel, proposed: path.relative(root, proposed).split(path.sep).join('/') };
}

function finalizeRevision(root) {
  const gate = visibilityGate(root, { refresh: true });
  if (!gate.ok) throw new Error(`privacy gate failed: ${gate.reason}`);
  const c = composeRevision(root);
  if (c.state.revision.reviewedHash !== c.hash) throw new Error('drafts or files changed since the last review. Run "setup review" again and get approval.');
  const written = [];
  for (const [rel, content] of Object.entries(c.files)) {
    writeFileAtomic(path.join(root, rel), content);
    written.push(rel);
  }
  const preserved = Object.entries(c.proposals).map(([rel, content]) => writeProposal(root, rel, content));
  c.state.revision = null;
  c.state.lastRevisionAt = nowIso();
  saveState(root, c.state);
  writeIndex(root);
  return { written, preserved, unchanged: [], gate, revision: c.topics };
}

export function finalizeSetup(root, { approve = false } = {}) {
  if (!approve) throw new Error('finalize needs --approve, given only after the user has reviewed "setup review" output');
  assertBrainIgnored(root);
  if (readyInfo(root).ready) return finalizeRevision(root);
  const gate = visibilityGate(root, { refresh: true });
  if (!gate.ok) throw new Error(`privacy gate failed: ${gate.reason}`);
  const { files, hash, state } = composeOutputs(root);
  if (state.reviewedHash !== hash) throw new Error('drafts changed since the last review. Run "setup review" again and get approval.');
  const generated = readJson(generatedRecordPath(root), {});
  const written = [];
  const preserved = [];
  const unchanged = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) {
      const current = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
      if (current === content) {
        unchanged.push(rel);
        generated[rel] = sha256(content);
        continue;
      }
      if (!(generated[rel] && sha256(current) === generated[rel])) {
        preserved.push(writeProposal(root, rel, content));
        continue;
      }
    }
    writeFileAtomic(abs, content);
    generated[rel] = sha256(content);
    written.push(rel);
  }
  writeJson(generatedRecordPath(root), generated);
  const machine = brainPath(root, 'machine.json');
  if (!fs.existsSync(machine)) {
    writeJson(machine, { joinedAt: nowIso(), lastJoinRun: null, platform: process.platform, node: process.versions.node, setUpHere: true });
  }
  state.finalizedAt = nowIso();
  saveState(root, state);
  writeIndex(root);
  return { written, preserved, unchanged, gate, revision: null };
}
