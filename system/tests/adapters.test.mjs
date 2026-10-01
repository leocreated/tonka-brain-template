// Guards against drift between the agent entry points and the shared guide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';
import { parseFrontmatter } from '../lib/frontmatter.mjs';

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const GUIDE = 'system/setup/GUIDE.md';
const CODEX = '.agents/skills/brain-setup/SKILL.md';
const CLAUDE = '.claude/skills/brain-setup/SKILL.md';

function skill(rel) {
  const text = read(rel);
  const fm = parseFrontmatter(text);
  assert.deepEqual(fm.errors, [], rel);
  const body = text.split(/\r?\n/).slice(fm.bodyStartLine - 1).join('\n');
  return { fm: fm.data, body };
}

test('both skills are thin pointers to the one shared guide', () => {
  assert.ok(fs.existsSync(path.join(REPO, GUIDE)));
  const codex = skill(CODEX);
  const claude = skill(CLAUDE);
  for (const s of [codex, claude]) {
    assert.equal(s.fm.name, 'brain-setup');
    assert.ok(s.fm.description.length > 40 && s.fm.description.length <= 1024);
    assert.ok(!/[<>]/.test(s.fm.description));
    assert.ok(s.body.includes(GUIDE), 'points to the shared guide');
    assert.ok(s.body.split('\n').length <= 20, 'stays thin');
    assert.ok(!/## Step \d/.test(s.body), 'does not copy guide steps');
  }
  assert.equal(codex.body, claude.body, 'adapters do not drift apart');
  assert.equal(codex.fm.description, claude.fm.description);
});

test('Codex skill: minimal frontmatter, implicit invocation disabled', () => {
  const codex = skill(CODEX);
  assert.deepEqual(Object.keys(codex.fm).sort(), ['description', 'name']);
  const yaml = read('.agents/skills/brain-setup/agents/openai.yaml');
  assert.match(yaml, /^policy:\r?\n {2}allow_implicit_invocation: false\s*$/m);
  assert.match(yaml, /^interface:\r?\n/m);
  assert.match(yaml, /system\/setup\/GUIDE\.md/);
});

test('Claude Code skill: manual invocation only, no tool grants', () => {
  const claude = skill(CLAUDE);
  assert.equal(claude.fm['disable-model-invocation'], 'true');
  assert.ok(!('allowed-tools' in claude.fm), 'no broad allowed-tools grant');
  assert.deepEqual(Object.keys(claude.fm).sort(), ['description', 'disable-model-invocation', 'name']);
});

test('CLAUDE.md only imports AGENTS.md; docs describe each invocation accurately', () => {
  assert.equal(read('CLAUDE.md').trim(), '@AGENTS.md');
  const readme = read('README.md');
  assert.match(readme, /`\/brain-setup`/);
  assert.match(readme, /`\$brain-setup`/);
  assert.match(readme, /Read system\/setup\/GUIDE\.md and follow it/);
  const guide = read(GUIDE);
  assert.match(guide, /`\/brain-setup`/);
  assert.match(guide, /`\$brain-setup`/);
  assert.match(read('AGENTS.md'), /system\/setup\/GUIDE\.md/);
  // The guide stages approved files by name, never everything at once.
  assert.doesNotMatch(guide, /for example `git add -A`/);
  assert.match(guide, /stage exactly the files you approved/);
  assert.match(readme, /--template leocreated\/tonka-brain-template/);
});

test('every local path mentioned in the setup docs exists', () => {
  const docs = [GUIDE, 'system/setup/interview.md', 'system/setup/second-device.md', 'system/setup/integrations.md', 'AGENTS.md', 'README.md', 'MAP.md'];
  for (const d of docs) {
    for (const m of read(d).matchAll(/`((?:system|context|\.agents|\.claude)\/[A-Za-z0-9_./-]+\.(?:md|mjs|yml|yaml|json))`/g)) {
      const p = m[1];
      if (/^context\//.test(p) || p.includes('<')) continue;
      assert.ok(fs.existsSync(path.join(REPO, p)), `${d} mentions missing ${p}`);
    }
  }
});
