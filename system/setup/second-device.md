# Joining from a second device

When the brain is already set up (it has `context/setup.md`), another device does not repeat the interview. It joins: portable records stay exactly as they are, and only this clone's local settings are configured.

## Steps

1. Clone your private brain repository (not the public template):
   `git clone <your private repository URL> my-brain`
2. Check prerequisites: `git --version`, and `node --version` showing 22 or newer. Installing and signing in to `gh` gives live privacy proof but is optional.
3. From the clone, run `node system/bin/brain.mjs join`, or ask your agent to run setup (`/brain-setup` in Claude Code, `$brain-setup` in Codex, or "read system/setup/GUIDE.md and follow it"). The guide routes a ready brain to this page.

## What `join` does

- Confirms the brain is ready. If it is not, it stops and points to the setup guide.
- Never writes tracked files. Your records, context and index are left untouched.
- Records this device in ignored local state (`.brain/machine.json`: join time, platform and Node version, no hostname).
- Checks every push destination of this clone with gh and records the result in `.brain/visibility.json`. If gh cannot check one of them, run `node system/bin/brain.mjs setup visibility` to see the list, and after confirming every listed destination is private, `node system/bin/brain.mjs setup visibility --attest-private`. Privacy matters on every clone: the pre-commit guard refuses commits until visibility is proven or attested on that clone, and a proof or attestation stops counting when the clone's remotes or push URLs change.
- Installs the per-clone pre-commit hook, unless you pass `--no-hooks` or a hook setup already exists. Hooks are not copied by `git clone`, so each device must enable its own. If you already use another hook manager or `core.hooksPath`, `join` leaves it alone and prints a one-line snippet you can add to your existing hook (`system/docs/hooks.md`).
- Prints `doctor` diagnostics.

## Diagnostics

`node system/bin/brain.mjs doctor` reports, for this clone:

| Check | Meaning when not ok |
| --- | --- |
| node, git | Missing or too old |
| local state | `.brain/` is not ignored; restore `.gitignore` |
| setup | Brain not set up yet |
| visibility | Not proven or attested private on this clone |
| pre-commit hook | Not installed here, or another hook setup is in the way |
| index | Stale; run `node system/bin/brain.mjs index` |
| records | Frontmatter errors or missing fields; run `validate` |
| template files | Template files edited locally (allowed) |
| this device | `join` has not been run here |

## Revising a topic from this device

You do not need the first device's setup drafts. Pull first, then follow step 7 of `system/setup/GUIDE.md`: `setup reopen <topic>` starts from the committed text, and finalizing changes only that topic's section. The other topics, and anything you edited by hand elsewhere, stay as they are. Commit and push the result as usual.

## Moving work between devices

- Commit and push from one device before pulling on another. Uncommitted drafts in `.brain/` do not travel.
- If an agent task moves to another device, write a short handoff note (`brain new note "Handoff: topic"`) saying what is done and what is not, and commit it.
- Device-specific settings belong in `.brain/` (ignored), never in tracked records.
