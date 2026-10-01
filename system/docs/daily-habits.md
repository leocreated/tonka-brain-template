# Daily habits

A brain helps only if it stays small, current and easy to search. These habits keep it that way. `brain` means `node system/bin/brain.mjs`.

## Starting a session

1. The agent reads `AGENTS.md` (Claude Code reaches it through `CLAUDE.md`).
2. It reads the context files: profile, preferences, priorities, memory policy.
3. For anything specific, it searches `INDEX.md` or `INDEX.jsonl` first and opens only the matching records. Searching the index is faster and cheaper than reading folders.

A good opening line for any agent: "Read the brain context, check the index for anything about <topic>, then help me with <task>."

## During work

Follow the memory policy you chose (`context/memory-policy.md`).

- **One dated record per item.** One decision per file in `decisions/`, one lesson per file in `lessons/`, one recurring friction per file in `papercuts/`. Small records are easy to find, link and archive.
- **Write the useful part first.** Decisions start with what was decided; lessons start with the rule; papercuts start with the friction.
- **Edit rather than duplicate.** If a record already covers it, update that record and its `date` or `updated`.
- **Keep product rules in product repositories.** A project record links to the code repository; that repository's own instructions govern code work.
- **No secrets, ever.** Say where a secret lives, not what it is.

## Ending a session (closeout)

1. Ask the agent: "What should we record from this session?" Save only what passes your memory policy.
2. Archive anything finished, fixed or replaced: `brain archive <path> --status <done|resolved|superseded>`.
3. `brain index` then `brain check`.
4. Review `git status` and `git diff`, then commit yourself.

## Weekly

- Skim `INDEX.md`. Close or archive stale notes, resolved papercuts and finished projects.
- Check `priorities.md` still matches what you are doing.
- `brain doctor` on the device you use most.

## Archiving consistently

- Archive instead of deleting. `brain archive` moves the file to `archives/<same path>`, sets the final status and an `archived` date, and rebuilds the index.
- A replaced decision gets `--superseded-by <new record path>` so the trail stays clear.
- Archived records leave the index. Search `archives/` directly when you need history.

## Practical daily checks

| Check | Command | When |
| --- | --- | --- |
| Index fresh and records valid | `brain check` | Before committing (the hook does this too) |
| Nothing secret staged | `brain guard` | Before committing (the hook does this too) |
| Clone healthy | `brain doctor` | Weekly, or after moving to a new device |
| Full sweep of tracked files | `brain guard --all` | Monthly, or after importing old notes |
