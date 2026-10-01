# Record format

Every record is a Markdown file that starts with a small frontmatter block. TONKA reads metadata only from that block. Text in the body, even a line like `status: done`, never changes the metadata.

```markdown
---
title: Hold the weekly review on Friday afternoon
date: 2026-03-14
status: active          # comments are fine after whitespace
tags: [habits, planning]
summary: "Friday 15:00, 45 minutes: index first"
---
# Hold the weekly review on Friday afternoon

Body text...
```

## Fields

| Field | Required | Rules |
| --- | --- | --- |
| `title` | yes | Non-empty text |
| `date` | yes | A real calendar date, `YYYY-MM-DD`. For dated records, the day it happened; otherwise the last review |
| `status` | yes | One of `active`, `draft`, `open`, `paused`, `done`, `resolved`, `superseded`, `archived` |
| `tags` | no | A list of lowercase slugs: `[planning, health-admin]` |
| `summary` | no | One line shown in the index |
| `updated` | no | `YYYY-MM-DD` |
| `superseded_by`, `archived` | no | Set by `brain archive` |

Other keys are allowed and kept, as long as they follow the syntax below.

Suggested status by compartment: decisions and lessons `active` then `superseded`; papercuts `open` then `resolved`; projects `active`, `paused`, `done`; notes and references `active`.

## Missing and invalid metadata

- A missing `status` is shown as `unknown` in the index, and a missing `date` as `undated`. Each index entry has `metadata`: `complete`, `incomplete` (a required field is missing) or `invalid` (a field is malformed). Nothing missing is ever guessed or filled in.
- `brain validate` lists errors (malformed values, unknown status, impossible dates) and warnings (missing fields). `brain validate --strict` and `brain check --strict` treat warnings as errors.
- The pre-commit hook blocks invalid records but allows incomplete ones.

## Frontmatter syntax (a small, strict subset of YAML)

The block starts with a `---` line as the very first line and ends at the next `---` line. Inside it, each non-empty line is one of:

| Form | Example | Notes |
| --- | --- | --- |
| Comment | `# note to self` | Whole line |
| Plain value | `title: Weekly review` | A trailing ` # comment` (whitespace before `#`) is removed. `C#` stays as is |
| Double-quoted | `title: "Plan: phase two"` | Escapes `\"`, `\\`, `\n`, `\t`. Use quotes when a value contains `: ` or starts with a special character |
| Single-quoted | `title: 'It''s done'` | `''` is a literal quote |
| List | `tags: [a, "b c", 'd']` | Flat lists only |
| Empty | `summary:` | Empty string |

Not supported, and reported with a line number rather than guessed: indented or nested values, multi-line values, block scalars (`|`, `>`), anchors and aliases (`&`, `*`), tags (`!`), flow maps (`{}`), `- item` lists, duplicate keys, and `key:value` without a space.

Why a subset: records stay readable by any YAML tool, while TONKA's own parser stays small, dependency-free and predictable. The parser and its tests are in `system/lib/frontmatter.mjs` and `system/tests/frontmatter.test.mjs`.

## What gets indexed

`brain index` writes `INDEX.jsonl` (one JSON object per line, sorted) and `INDEX.md` from Markdown files under `context/`, `people/`, `projects/`, `decisions/`, `lessons/`, `papercuts/`, `notes/`, `references/` and `infra/`, at any depth. It skips `README.md` files, anything inside `examples/`, `templates/` or hidden folders, symlinks, `archives/`, and `.brain/`. Output is deterministic, so `brain index --check` can compare it byte for byte.
