# Using the brain with Orca (optional)

Orca is a desktop environment for running several coding agents (Claude Code, Codex and others) in parallel, each in its own git worktree, with terminals, diffs and coordination tools in one place. It is free and MIT licensed: https://github.com/stablyai/orca, website https://onorca.dev. Installing it is entirely optional; the brain works with a single agent in a plain terminal.

Command names below come from the Orca CLI. Orca changes quickly, so check the live help before relying on exact flags: `orca --help`, `orca <group> --help`, and the version-matched guides `orca skills list` and `orca skills get <name>`.

## Why it fits a brain

- **Isolation.** Each task gets its own worktree (`orca worktree create`), so parallel agents never edit the same checkout.
- **Integration owner.** The main checkout is reserved for integrating finished work. One agent or person merges and regenerates `INDEX.*`.
- **Supervised workers.** Orca's orchestration commands (`orca orchestration ...`) let a coordinator agent create tasks, dispatch them to worker terminals, exchange messages, ask blocking questions and receive completion reports. Load the guide with `orca skills get orchestration`.
- **Cross-device.** Orca can connect to Orca runtimes on other machines (`orca environment ...`), so a long task can run on another computer while you check in from elsewhere.

## A simple pattern

1. Add the brain repository to Orca (`orca repo add` with its path), or open it in the app.
2. For each piece of work, create a clearly named worktree, for example `weekly-review-2026-10-02`.
3. Start an agent in that worktree. It follows `AGENTS.md`: reads context, searches the index, writes only its own records.
4. When the task is done, the integration owner merges the branch, runs `node system/bin/brain.mjs index`, checks, and commits.
5. Continue the same task later in the same worktree instead of creating a new one.

## Rules that matter with several agents

All of them are in `system/docs/ownership.md`: one integration owner per task, separate worktrees for concurrent writers, one writer for generated files, stage only owned paths, explicit handoffs. Do not move an active task to another device without a handoff note.

## Orca's own skills

Orca ships agent guides for its CLI. `orca skills list` shows them, `orca skills get orca-cli` and `orca skills get orchestration` print them, and `orca skills install` installs them globally (through a community skills CLI) for your agents. Installing them is optional, changes your user-level agent setup rather than the brain, and is your call.
