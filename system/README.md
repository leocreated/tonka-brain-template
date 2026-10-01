# system

Template-owned machinery for the brain. Everything here is listed in `system/template-manifest.json` and can be updated with `brain update` (your edits are preserved as conflicts).

| Folder | Contents |
| --- | --- |
| `setup/` | `GUIDE.md` (the canonical setup guide), interview topics, second-device join, optional integrations |
| `docs/` | Daily habits, record format, ownership, privacy, hooks, updates, Orca workflow, skills, releasing |
| `templates/` | Record templates used by `brain new` |
| `examples/` | Fictional example records (never indexed) |
| `integrations/` | Optional files you can copy in, such as a private CI check |
| `bin/brain.mjs` | The command line helper. Run `node system/bin/brain.mjs help` |
| `lib/` | Helper modules (Node 22 or newer, no dependencies) |
| `hooks/` | The per-clone pre-commit hook |
| `tests/` | Tests: `npm test` |
| `template-manifest.json` | Template-owned files and their hashes, used by updates |

## Design notes

- No runtime dependencies. Everything uses the Node standard library and the `git` executable, so a fresh clone works without `npm install`.
- Small cohesive modules, one per concern: frontmatter parsing, records, index, secrets, visibility, setup, hooks, guard, manifest, update, release, doctor.
- Helpers never commit, push, change global configuration, or schedule anything.
- Local state lives in `.brain/`, which must stay ignored by git; helpers that write there check that first.
