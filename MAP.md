# Map

Where things live in this brain. Records are Markdown files with a small frontmatter block (`system/docs/record-format.md`).

| Path | Holds | Indexed |
| --- | --- | --- |
| `context/` | Profile, preferences, priorities, memory policy, setup marker | yes |
| `people/` | One person per file, only useful and consented detail | yes |
| `projects/` | One project per file or folder; links to product repositories | yes |
| `decisions/` | One dated decision per file | yes |
| `lessons/` | One dated lesson per file | yes |
| `papercuts/` | One dated recurring friction per file | yes |
| `notes/` | Dated working notes | yes |
| `references/` | Pointers to docs, tools and accounts (never credentials); subfolders allowed | yes |
| `infra/` | Devices, tools, backups and recovery notes; subfolders allowed | yes |
| `archives/` | Finished, fixed or superseded records, same relative paths | no |
| `INDEX.md`, `INDEX.jsonl` | Generated index of active records. Search here first | generated |
| `AGENTS.md` | The one agent contract. `CLAUDE.md` imports it | no |
| `system/setup/` | Canonical setup guide, interview topics, second-device join, optional integrations | no |
| `system/docs/` | Habits, record format, ownership, privacy, hooks, updates, Orca, skills, releasing | no |
| `system/templates/` | Record templates used by `brain.mjs new` | no |
| `system/examples/` | Fictional example records | no |
| `system/bin/`, `system/lib/` | The `brain.mjs` helper (Node, no dependencies) | no |
| `system/hooks/` | The per-clone pre-commit hook | no |
| `system/tests/` | Tests for the helpers | no |
| `.agents/skills/brain-setup/` | Codex entry point (`$brain-setup`) | no |
| `.claude/skills/brain-setup/` | Claude Code entry point (`/brain-setup`) | no |
| `.brain/` | Local, per-device state. Ignored by git, never committed | no |

What is indexed: Markdown files under the active compartments, at any depth, except `README.md` files and anything inside `examples/` or `templates/` folders or hidden folders. Archives and local state are never indexed.
