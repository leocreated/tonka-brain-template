# Ownership and write contract

The short version is in `AGENTS.md` section 4. This page explains it for both ways of working.

## Working with one agent

- The agent owns the edits it makes in the current task, nothing else.
- It runs `git status` before writing and never reverts, reformats or overwrites changes it did not make.
- It does not commit or push unless you ask in that session. You review the diff and commit.
- When a task spans several sessions, a short note (`brain new note "Handoff: topic"`) tells the next session what is done.

## Working with several agents (Orca or similar)

Tools like Orca run several agents at once, each in its own git worktree. The brain stays consistent if everyone follows these rules:

| Rule | Why |
| --- | --- |
| One integration owner per task | Exactly one agent (or you) merges work into the main branch |
| Concurrent writers use separate worktrees or branches | Two agents never edit the same checkout at the same time |
| One owner per file in a task | If two agents need the same record, one owns it and the other proposes changes |
| Generated files have one writer | The integration owner runs `brain index` (and, for template maintainers, `brain manifest --write`) after merging. Never hand-merge `INDEX.*` |
| Stage only owned paths | `git add <your files>`, never `git add -A` across someone else's work |
| Explicit handoffs | Moving a task to another agent or device includes what is done, what is not, and who owns it now |
| Main checkout is for integration | Day-to-day agent work happens in task worktrees; the main checkout receives merged results |

### Merge conflicts in generated files

If `INDEX.md` or `INDEX.jsonl` conflict during a merge, do not edit them. Resolve the record files, then run `brain index` and stage the regenerated index.

## Template-owned versus user-owned

| Owner | Paths | Updates |
| --- | --- | --- |
| Template | Paths listed in `system/template-manifest.json`: `system/`, root documents, agent adapters, compartment READMEs | Updated by `brain update` unless you modified them |
| You | Every record in the compartments and `archives/`, `INDEX.*`, anything you add | Never touched by updates |
| This device | `.brain/` | Never committed |
