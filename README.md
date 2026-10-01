# TONKA BRAIN TEMPLATE

A template for a private "brain" repository: small Markdown records about how you work, what you are working on and what you have decided, organized so coding agents such as Claude Code and Codex can find the right context quickly and add to it safely.

- **Private by design.** Setup proves (or records your attestation) that every place this clone pushes to is private before any personal answer is written to a tracked file.
- **Guided setup.** A conversational, resumable, skippable interview builds your profile, priorities, preferences and memory policy. You review everything before it is saved.
- **Fast to search.** A generated index (`INDEX.md`, `INDEX.jsonl`) lets agents search first and open only what they need.
- **Works alone or with many agents.** One agent contract (`AGENTS.md`) with clear ownership rules for single-agent use and for multi-agent tools such as Orca.
- **Light.** Git and Node 22 or newer. No dependencies to install, no background services, nothing scheduled.

## What you need

- Git.
- Node.js 22 or newer. Install the current LTS release from https://nodejs.org.
- Recommended: the GitHub CLI (`gh`), signed in, so setup can prove your repository is private.
- An agent: Claude Code, Codex, or any agent that can read files and run commands.

## Make your private copy

Do not put personal notes into a public clone of this template. Create your own private repository from it instead (a copy, not a fork):

- **On GitHub:** open the template repository, choose "Use this template", then "Create a new repository", and select **Private**.
- **With gh:**
  ```sh
  gh repo create my-brain --private --template leocreated/tonka-brain-template --clone
  cd my-brain
  ```

If you already cloned the public template, setup will notice that the repository is public and stop before asking personal questions. Make a private copy as above, then clone that.

## Run setup

Open your private clone with your agent and start the setup skill:

| Agent | How to start |
| --- | --- |
| Claude Code | Type `/brain-setup` |
| Codex | Type `$brain-setup`, or pick it from `/skills` |
| Any agent (fallback) | Say: "Read system/setup/GUIDE.md and follow it to set up my brain." |

Each agent has its own skill syntax; the fallback works everywhere because all three routes lead to the same guide, `system/setup/GUIDE.md`. The skills are configured so they only run when you ask for them.

Setup takes roughly 20 to 40 minutes. You can skip any topic and stop at any time; progress is kept on that device in `.brain/` (ignored by git). Nothing is committed for you.

You can also follow the guide yourself with the helper: `node system/bin/brain.mjs setup status` shows where you are and what comes next.

## Use it every day

- Agents start by reading `AGENTS.md` and your context files, then search the index.
- One dated decision, lesson or papercut per file. Archive finished or superseded records instead of deleting them.
- Rebuild the index after changes: `node system/bin/brain.mjs index`.
- Product code and its rules stay in their own repositories; project records link to them.

More: `system/docs/daily-habits.md`. Folder map: `MAP.md`.

## A second device

Clone your private repository on the other device and run `node system/bin/brain.mjs join` (or start the setup skill, which detects a ready brain). It keeps your records as they are, checks privacy for that clone, sets up the per-clone pre-commit hook, and prints diagnostics. You can revise a single topic from any joined device without repeating the interview. See `system/setup/second-device.md`.

## Privacy, in short

- The pre-commit hook (per clone, opt-in) scans the exact staged content for credential shapes and secret file names, and blocks commits unless every push destination is proven (live, on each commit) or attested private. It never prints the matched text. It is a heuristic safety net, not a guarantee.
- Never store passwords, keys or recovery codes in the brain.
- Some agents keep their own memory outside this repository. TONKA does not change those settings.

Details: `system/docs/privacy.md` and `system/docs/hooks.md`.

## Optional extras

After setup, `system/setup/integrations.md` offers optional pieces, each chosen separately: the privacy hook, a private CI check, agent skills, the Orca multi-agent workflow, and template updates. None is required, and none runs on a schedule.

## Updating the template

Your brain is a copy, so updates are manual and conflict-aware: `node system/bin/brain.mjs update --from <release folder>` shows a dry run first, never touches your records, and keeps any template file you changed. See `system/docs/updates.md`.

## Command reference

`node system/bin/brain.mjs help` lists every command. Tests: `npm test`. Everything at once (maintainers): `npm run verify`.

## Maintainers

Release process and the exact-tree release check: `system/docs/releasing.md`.

## License

MIT. Copyright (c) 2026 TONKA contributors. See `LICENSE`. Your own records are yours; the license covers the template.
