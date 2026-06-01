# Using Codex On This Project

## What Codex Can See

Codex can read and edit files in this local repository. It can also read files that are attached or pasted into the current thread.

Codex cannot automatically read prior ChatGPT project conversations. Important context from those conversations should be saved into repository files like this one.

## Recommended Memory Files

Use these files as the project memory:

- `PROJECT_STATUS.md`: current project state, feature status, branch notes, and safety rules.
- `BACKLOG.md`: larger backlog, prior decisions, things tried, and open questions.
- `RUNBOOK.md`: how to run the bot and test safely.
- `TODO.md`: prioritized next tasks.
- `SCHEMA.md`: Supabase table assumptions.

When starting a new Codex thread, say:

```text
Read PROJECT_STATUS.md, BACKLOG.md, RUNBOOK.md, TODO.md, and SCHEMA.md, then help me continue.
```

## When To Start A New Thread

Start a new Codex thread when the work changes to a distinct task, such as:

- Review the Twitch OAuth flow.
- Fix EventSub credentials.
- Build `/unlinktwitch`.
- Build `/twitchcollection`.
- Refactor collection helpers.
- Debug a specific error.
- Create documentation.

Stay in the same thread when:

- You are still working on the same feature.
- You are debugging a failure from the current change.
- You want Codex to continue from the current work session.

## Best Workflow

1. Start with orientation.
   Ask Codex to read the memory files and check `git status`.

2. Keep tasks focused.
   Ask for one feature, bug, or review at a time.

3. Let Codex inspect before editing.
   Codex should read nearby code, current diffs, and existing patterns first.

4. Keep project memory updated.
   When a meaningful decision is made, update one of the memory files.

5. Test against `.env.test`.
   Do not use production resources unless that is explicitly intended.

6. Be careful with Twitch redeems.
   EventSub and live redeem testing should only happen when it is safe for the channel.

## Useful Prompts

```text
Read the memory files and summarize where we are.
```

```text
Review the current diff for bugs before we test live redeems.
```

```text
Implement the next task from TODO.md and update the memory files afterward.
```

```text
Before editing, explain what files you plan to touch.
```

```text
Check whether this is safe to run against .env.test.
```
