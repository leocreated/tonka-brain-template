# Interview topics

Question bank for step 4 of `GUIDE.md`. Pick the questions that fit; do not read them all out. Each topic ends with a short draft saved through `brain setup answer <topic>`.

General style: one question at a time, open wording, reflect back what you heard, and move on when you have enough. If the user says "skip", run `brain setup skip <topic>` without pressing.

## work

Goal: what the user does and in which roles, so agents pitch help at the right level.

- What do you do, and for whom? (job, business, studies, side projects)
- Which roles do you switch between in a typical week?
- What kind of work do you want agents to help with most? Least?
- Is there anything about your work that agents should treat as confidential or keep out of this brain?

Capture: roles, domains, the help they want. Skip: employer secrets, client names they do not want stored.

## goals

Goal: what matters over different time horizons, so agents can prioritize.

- What are you trying to get done this week or this month?
- What would make this quarter or this year a success?
- Is there a longer horizon goal that should shape everyday choices?
- What are you deliberately not doing right now?

Capture: goals grouped by horizon, explicit non-goals.

## projects

Goal: a short list of active projects and where their real home is.

- Which projects are active right now? Which are paused?
- For each: what does done look like, and where does the work live (repository, documents, tracker)?
- Which project gets priority when they conflict?

Capture: name, one-line goal, status, where it lives. Product code rules stay in the product repository; just note the link. After setup the user can create one record per project with `brain new project "Name"`.

## preferences

Goal: how the user likes to work with agents.

- How do you like answers: short and direct, or with background? Bullets or prose?
- How much should an agent do before checking in with you?
- What annoys you in how agents or tools communicate?
- Any language, tone or formatting preferences?

Capture: concrete, actionable preferences.

## people

Goal (voluntary): only people context that helps agents help the user.

Start by saying this topic is optional and that only information the user is comfortable storing should be shared.

- Are there people you work with often whom an agent should know about, such as a manager, collaborators or clients?
- For each, what is useful to know: their role, how they like to communicate, current topics?

Capture: names (or roles only, if the user prefers) and work-relevant context. Never ask about health, family, finances or other sensitive topics. If the user shares something sensitive, ask whether they really want it stored.

## tools

Goal: the agents, devices and tools in play, without hardcoding anything.

- Which coding agents or assistants do you use (for example Claude Code, Codex, others)? For what?
- Which devices do you work from? Give each a label you are happy to see in notes; no hostnames or serial numbers needed.
- Do you use a multi-agent tool such as Orca, or work with one agent at a time?
- Which other tools matter: editor, notes app, task tracker, calendar?

Capture: tools and roles, device labels. Do not record account names, keys or hostnames.

## rhythms

Goal: when and how the user works.

- When do you do your best focused work? When are you unavailable?
- Do you have weekly routines, such as planning or review?
- How do you like to start and end a working session with an agent?

Capture: times, routines, start and end habits.

## memory

Goal: the user chooses what agents may save, and what is off limits. This topic cannot be skipped; a policy must be chosen.

Explain the three policies:

- `ask-first` (recommended): agents propose a record and save it only after the user says yes.
- `save-routine`: agents may save routine decisions, lessons and papercuts on their own, and ask first for anything about people or sensitive topics.
- `manual-only`: agents never write records unless the user explicitly asks in that moment.

Then ask:

- Which policy do you want? You can change it later by editing `context/memory-policy.md`.
- Are there topics that must never be saved? (for example health, finances, family, a specific client)
- Anything else agents should know about how to treat your information?

Also explain: some agents keep their own memory outside this repository (in your user folder, controlled by the agent's own settings). This policy covers the brain only. TONKA never changes those settings; if you want to review them, check your agent's documentation.

Save with `brain setup answer memory --policy <choice>`; the draft holds the boundaries and notes (write "No extra boundaries." if there are none).
