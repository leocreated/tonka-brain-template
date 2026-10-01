# Optional integrations

The brain is complete without any of these. Offer this list after setup, let the user pick, and handle one item at a time with an explicit yes. Nothing here runs on a schedule unless the user later creates that schedule themselves.

| # | Integration | What it changes | Undo |
| --- | --- | --- | --- |
| 1 | Pre-commit privacy guard | This clone's local `core.hooksPath` | `brain hooks uninstall` |
| 2 | Private CI check | Adds one workflow file to your repository | Delete the file |
| 3 | Agent skills | Files you choose to add under `.agents/skills/` or `.claude/skills/`, or provider plugins you install | Remove them |
| 4 | Orca multi-agent workflow | Nothing in the brain; you install Orca yourself if you want it | Uninstall Orca |
| 5 | Agent-native memory review | Nothing automatic; you review your agent's own settings | Not applicable |
| 6 | Reminders or routines | Nothing automatic; you create them in your own calendar or tool | Remove them |
| 7 | Template updates | Template files, only when you run an update | Backups in `.brain/updates/` |

## 1. Pre-commit privacy guard

Recommended. See `system/docs/hooks.md`. Run `node system/bin/brain.mjs hooks install` on each clone where you want it.

## 2. Private CI check

If your private repository is on GitHub and you want a check on every push, copy `system/integrations/brain-check.yml` to `.github/workflows/brain-check.yml` and commit it. It runs `brain check` and a full secret-shape sweep (`brain guard --all`). Private repositories use your GitHub Actions minutes. The template's own CI workflow skips private repositories, so you are not charged for it.

## 3. Agent skills

See `system/docs/skills.md` for practical suggestions (session closeout, planning interview, design review, provider skill tools, Orca's skills). Add only what you will use.

## 4. Orca multi-agent workflow

See `system/docs/orca-workflow.md`. Useful if you run several agents in parallel or across devices. Installing Orca is optional and done by you.

## 5. Agent-native memory review

Some agents keep memory outside this repository. If you want that to match your brain's memory policy, review your agent's own memory settings using its documentation. TONKA does not change them.

## 6. Reminders or routines

Weekly reviews and closeouts help (`system/docs/daily-habits.md`). If you want a reminder, create it yourself in your calendar or your agent tool. Setup never creates schedules.

## 7. Template updates

See `system/docs/updates.md`. Updates are manual, from a release folder you choose, with a dry run first.
