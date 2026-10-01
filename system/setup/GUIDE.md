# Brain setup guide (canonical)

This is the one setup guide for every agent. The Claude Code skill (`/brain-setup`), the Codex skill (`$brain-setup`) and a plain request such as "read system/setup/GUIDE.md and follow it" all lead here. If you are an agent, read this whole file before you start, then follow it step by step.

All commands run from the repository root. `brain` below means `node system/bin/brain.mjs`.

## Ground rules for the agent

- **Privacy first.** Do not ask personal questions, and never write personal answers into tracked files, until step 2 passes.
- **One topic at a time.** Ask open questions, listen, follow up briefly. This is a conversation, not a form.
- **Everything is skippable.** The user can skip any topic, pause at any point, and resume later. Skipping is recorded explicitly and counts as handled.
- **Synthesize, do not transcribe.** Save a short summary in the user's own words, not the conversation. Show each summary before saving it.
- **Ask only what helps.** Never ask for passwords, API keys, tokens, recovery codes, ID numbers, account numbers, or health, financial or family detail the user did not volunteer. If the user offers a secret, do not save it and say why.
- **Local first.** Drafts live in `.brain/` (ignored by git, this device only) until the user reviews and approves the result.
- **No automatic commits, pushes, global settings changes or schedules.** The user decides each of those.
- Use the helper commands below for state changes. They enforce the rules; do not edit `.brain/setup/state.json` by hand.

## Step 0: Check prerequisites

1. `git --version` must work, and this folder must be a git clone.
2. `node --version` must be 22 or newer. If Node is missing or older, ask the user to install the current LTS release from https://nodejs.org and stop until they have.
3. The GitHub CLI (`gh`) is recommended, not required. It provides live proof that the repository is private.

## Step 1: Find out where we are

Run `brain setup status`.

- **Brain ready, this device already set up or joined:** setup is complete. Offer to revise a topic (step 7) or show the optional integrations (step 9). Otherwise stop.
- **Brain ready, but this is a new device** (status says to run `join`): follow `system/setup/second-device.md`. Do not repeat the interview. After joining, single topics can be revised from this device too (step 7).
- **Revision in progress:** status lists the reopened topics; continue from the "Next" line (step 7).
- **Setup in progress:** tell the user which topics are done, then continue from the "Next" line.
- **Fresh brain:** continue with step 2.

## Step 2: Privacy gate (always before personal questions)

Explain briefly: "Your answers will become files in this repository, so first I need to confirm the repository is private."

Run `brain setup visibility` and act on the result. It lists every push destination of this clone (every push URL of every remote, after URL rewrites) and checks each github.com repository live with gh. One private repository never vouches for another destination.

| Result | What to do |
| --- | --- |
| `private` (current live gh check) | Gate passed. Continue. |
| `public` or `internal` | Stop the interview. Name the destination it lists. If the user cloned the public template directly, explain how to make a private copy (README section "Make your private copy"), clone that copy, and start again there. If it is their own repository, they can make it private on GitHub (Settings, General, Danger Zone, Change visibility), or remove that remote or push URL, and then you re-run the check. An attestation cannot override this result, and it stays in force while gh cannot check that repository: after making it private, re-run the check with gh working. |
| `unknown` | Explain which destinations could not be checked and why (gh not installed or not signed in, no remote yet, a host other than github.com, or a local path). Offer two options: (a) the user installs or signs in to gh themselves (`gh auth login`) and you re-run the check, or (b) if they know every listed destination is private or local only, they can attest to it. |

To record an attestation, read the listed destinations to the user and ask exactly: "Do you confirm that every destination listed here is private, or that this clone has no remote?" Only after a clear yes, run `brain setup visibility --attest-private`. Tell the user this is recorded as their attestation, not live proof; that it covers exactly these destinations, so adding or changing a remote or push URL needs a new check or attestation; and that the guard still checks live with gh whenever it can.

## Step 3: Explain the interview

Tell the user, in your own words:

- There are eight short topics. Most people take 20 to 40 minutes. Any topic can be skipped.
- Progress is saved on this device in `.brain/` after each topic, so they can stop and come back. (Drafts do not sync to other devices because they are not committed.)
- Nothing is written to tracked files until they review the full result and approve it.
- They choose how much agents may save later (the memory policy topic).

## Step 4: Interview, one topic at a time

Topics, in order (questions and guidance are in `system/setup/interview.md`):

1. `work`: work and roles
2. `goals`: goals and time horizons
3. `projects`: current projects
4. `preferences`: preferences and communication
5. `people`: people and context (voluntary)
6. `tools`: agents, devices and tools
7. `rhythms`: working rhythms
8. `memory`: memory saving policy and sensitivity boundaries

For each topic:

1. Ask two to four open questions, one at a time. Follow up only where it helps.
2. Write a short draft (bullet points are fine, ideally under 300 words) using the user's words.
3. Show the draft and ask: "Save this, change something, or skip this topic?"
4. To save: write the draft to `.brain/setup/drafts/<topic>.md`, then run `brain setup answer <topic>`. (Or pipe it: `brain setup answer <topic> --from -`.)
5. To skip: run `brain setup skip <topic>`.

The helper refuses drafts that look like they contain credentials or that are too long to be a summary. If that happens, shorten or clean the draft; never work around it.

For `memory`, the user must pick a policy (it cannot be skipped). Explain the three options from `interview.md`, then save with `brain setup answer memory --policy <ask-first|save-routine|manual-only>`. The draft holds their sensitivity boundaries (topics never to save) and any notes. Also explain that some agents keep their own memory outside this repository under their own settings; this policy covers what agents write into the brain, and TONKA never changes those agent settings.

If the user wants to stop, confirm progress is saved and tell them to ask again later; `brain setup status` will show where to resume.

## Step 5: Review

When every topic is answered or skipped, run `brain setup review`. It prints the files that would be written:

- `context/profile.md` (work, rhythms, tools)
- `context/priorities.md` (goals, projects)
- `context/preferences.md`
- `context/memory-policy.md`
- `people/overview.md` (only if the people topic was answered)
- `context/setup.md` (the marker other devices use to detect a ready brain)

Show the user the full text (or a faithful summary with an offer to show everything). Ask: "Does this look right? Anything to change or remove before I save it?"

To change something: edit the draft in `.brain/setup/drafts/`, run `brain setup answer <topic>` again, then `brain setup review` again. Finalizing refuses if drafts changed after the last review.

## Step 6: Finalize

Only after the user clearly approves, run `brain setup finalize --approve`.

It re-checks the privacy gate, writes the files, keeps any file the user already edited by hand (and puts the new proposal in `.brain/setup/proposed/` instead), and rebuilds the index. Report what it wrote or preserved.

Then:

1. Run `brain doctor` and explain anything that is not `ok`.
2. Show `git status` and explain what changed. Do not commit. Tell the user something like: "When you are happy, stage exactly the files you approved and commit them, for example `git add context/ INDEX.md INDEX.jsonl` (plus `people/overview.md` if it was written), then `git commit -m "Set up my brain"`." Name the files from the finalize output; do not suggest `git add -A`, which could sweep in unrelated changes. Commit for them only if they ask you to.

## Step 7: Revising later

A ready brain revises one topic at a time, on any device that has joined, without repeating the other topics. It works from the committed files, not from the drafts of the device that ran setup.

1. `brain setup reopen <topic>`. It copies that topic's current committed text into `.brain/setup/drafts/<topic>.md` as a starting point. Reopen more topics the same way if the user wants.
2. Show the user the current text, interview that topic again, and write the revised draft (same rules as step 4). Use only what the user tells you; do not fill in other topics.
3. `brain setup answer <topic>`. For `memory`, add `--policy <policy>` only if the user changes it; otherwise the current policy is kept.
4. `brain setup review`. It shows only the files that change and says which sections. To drop a reopened topic without changing it, run `brain setup skip <topic>`.
5. After the user approves, `brain setup finalize --approve`.

Finalizing replaces only the revised topic's section (the `## ` heading for that topic) and leaves every other section, and anything the user added elsewhere in the file, exactly as it is. If the user restructured a file so that heading no longer appears exactly once, that file is left untouched and the revised text goes to `.brain/setup/proposed/` for the user to merge. A topic skipped at setup can be filled in later the same way. Nothing is committed.

## Step 8: Pre-commit privacy guard (recommended, per clone)

Explain: "There is a small git hook that scans what you are about to commit for things that look like passwords or keys, checks the repository is still private, and checks the index is fresh. Hooks are set per clone, so each device enables it separately; one install covers every worktree of this clone, because they share its local git config. Want me to turn it on for this clone?"

If yes, run `brain hooks install`.

- If it reports a conflict (the user already has a hook setup), do not replace anything. Show the one-line snippet it prints and offer to help add it to their existing hook, with their permission.
- Details: `system/docs/hooks.md`.

## Step 9: Optional integrations

The brain is usable now. Offer `system/setup/integrations.md` as a menu. Go through only the items the user picks, one at a time, each with an explicit yes. Setup never enables schedules or background services.

## Finish

Point the user to `system/docs/daily-habits.md` for everyday use, and stop.
