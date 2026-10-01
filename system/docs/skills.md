# Agent skills: practical suggestions

Skills are folders of instructions an agent loads when you invoke them. They are optional. Add one only when you notice yourself repeating the same request. Nothing on this page is installed by setup.

## How each agent finds skills

| Agent | Project skills folder | Invoke explicitly | Docs |
| --- | --- | --- | --- |
| Claude Code | `.claude/skills/<name>/SKILL.md` | `/<name>` | https://code.claude.com/docs/en/skills |
| Codex | `.agents/skills/<name>/SKILL.md` (optional `agents/openai.yaml`) | `$<name>`, or browse with `/skills` | https://learn.chatgpt.com/docs/build-skills |
| Any other agent | Not discovered automatically | Ask it to read the instruction file | |

Invocation syntax differs per agent; no single slash command works everywhere. TONKA's own `brain-setup` skill shows the pattern: both adapters are a few lines that point to one shared guide (`system/setup/GUIDE.md`), so the instructions never drift apart. Copy that pattern for your own skills: put the real instructions in one file you own (for example `playbooks/closeout.md`), and make each adapter a thin pointer to it.

To keep a skill from triggering on its own:

- Claude Code: `disable-model-invocation: true` in the SKILL.md frontmatter.
- Codex: `allow_implicit_invocation: false` under `policy:` in `agents/openai.yaml`.

## Official skill tooling

- **Claude Code:** Anthropic publishes example skills, including a `skill-creator` skill, at https://github.com/anthropics/skills (most skills are Apache-2.0; check each skill's license). Claude Code can add that repository as a plugin marketplace with `/plugin marketplace add anthropics/skills` and then install from it with `/plugin`.
- **Codex:** Codex includes system skills for this: `$skill-creator` helps you write a skill, and `$skill-installer` installs skills from a source you name.

Both create skills that follow the same idea: a short `name` and `description`, concise instructions, and supporting files loaded only when needed.

## Skills worth considering

### Session closeout

Use at the end of a working session. The instructions can be short:

1. List what changed in this session (files, decisions, open questions).
2. Propose records according to `context/memory-policy.md`: one decision, lesson or papercut per file.
3. Archive anything finished, fixed or superseded.
4. Run `node system/bin/brain.mjs index` and `node system/bin/brain.mjs check`.
5. Show `git status` and stop. Do not commit unless asked.

### Focused planning interview

Use before a large or fuzzy task. The agent asks one question at a time to surface goals, constraints, risks and the definition of done, challenges weak assumptions, then writes a short plan (or a decision record) for you to approve. Keep it to a few rounds of questions; the goal is clarity, not ceremony.

### Design review (when you build interfaces)

If you build user interfaces, a design review skill can critique layout, hierarchy, accessibility and polish. One optional upstream option is Impeccable (https://impeccable.style/tutorials/getting-started/): it installs with `npx impeccable install`, needs Node 22.18 or newer, and its invocation differs by agent, so follow its own instructions. Its requirements are separate from TONKA's.

### Orca CLI and orchestration

If you use Orca, its version-matched guides teach agents to manage worktrees, terminals and supervised workers: `orca skills list`, `orca skills get orca-cli`, `orca skills get orchestration`. See `system/docs/orca-workflow.md`.

## Ground rules

- Verify the source and license of any third-party skill before installing it, and read its instructions: a skill can tell an agent to run commands.
- Prefer a few skills you actually use over a large collection.
- Keep personal skills in your private brain (or your user-level skills folder); never publish them with personal details inside.
