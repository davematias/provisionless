---
name: backlog-ticket
description: Turn an idea into a provisionless ticket in the sibling projects-backlog repo via an interactive planning discussion, then commit and push. Use when the user asks to add, create, or file a ticket/task/backlog item, or invokes this skill with an idea.
---

# Backlog ticket

Interactive workflow for turning an idea into a committed Backlog.md task in the `provisionless` project of the sibling backlog repo. Never skip a phase. Never write task files directly — all task changes go through the `backlog` CLI so metadata and history stay consistent.

The backlog repo lives at `/Users/david/work/projects-backlog`; the project folder is `/Users/david/work/projects-backlog/provisionless`. Run every `backlog` command with `BACKLOG_CWD=/Users/david/work/projects-backlog/provisionless`.

## Step 1: Get the idea

If the invocation already contains an idea, use it. Otherwise ask with the question tool: "What's the ticket idea?"

## Step 2: Load context and search for duplicates

1. `backlog instructions overview` — required first read.
2. `backlog instructions task-creation` — follow its guidance for scoping and writing tasks.
3. `backlog search "<key terms>" --plain` and, if needed, `backlog task list --search "..." --limit 20 --plain` — check whether the work is already tracked. If a similar task exists, show it to the user and ask whether to proceed anyway.

## Step 3: Spec discussion (plan phase — read-only)

In this phase make NO changes: do not create tasks, do not edit files, do not commit. Discuss the plan back and forth with the user until they explicitly approve.

Propose a full task spec:

- **Title**
- **Description** — why the task exists (problem/trigger/user need) plus context a future agent cannot recover from the code. No implementation plan or speculative approach.
- **Acceptance criteria** — specific, testable, independent.
- **Metadata** — type, priority, labels, milestone (only if the project config supports/uses them; otherwise omit).
- **Structure** — single atomic task vs. subtasks (`-p`, same goal and subsystem) vs. separate tasks with dependencies (`--dep`, independent components). Propose accordingly.

Push back, don't just transcribe. Raise an objection when the idea:

- is vague, non-testable, or has acceptance criteria that can't be verified
- is not atomic (two independent outcomes → propose splitting into tasks with dependencies)
- contradicts an existing task, decision, or the repo's architecture
- is oversized for one ticket, or so small it clutters the backlog
- rests on a premise that seems wrong (verify against the codebase before agreeing)

State the concern and a concrete alternative; let the user decide. Keep iterating until an explicit approval, then continue.

## Step 4: Create the tasks

Use `backlog task create` with the approved spec, e.g.:

```bash
backlog task create "<title>" -d "<description>" \
  --ac "<criterion 1>" --ac "<criterion 2>" \
  [--type ...] [--priority ...] [--labels ...] [--milestone ...] \
  [-p <existing-task-id>] [--dep <existing-task-id>] [--ref <url-or-path>]
```

- Parent/depends-on values must be existing task IDs returned by `backlog task create` / `list` / `view` — never milestone IDs.
- Never reference task IDs from other projects in the backlog repo.

Show each created task back with `backlog task view <ID> --plain` so the user can confirm what was actually written.

## Step 5: Commit and push

From `/Users/david/work/projects-backlog`:

1. `git status` — verify only the new/changed backlog files from this workflow are present; stage only those.
2. Commit following repo style (imperative, references the task ID): `Add TASK-N: <title>` (for multiple tasks: `Add TASK-N, TASK-M: <title>`).
3. Push: `git push origin main`.

If there are unrelated dirty files, do not commit them; mention them. Report the task IDs, commit hash, and push result to the user.
