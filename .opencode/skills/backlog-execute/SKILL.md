---
name: backlog-execute
description: Pick and execute a provisionless ticket from the sibling projects-backlog repo — show available tasks, recommend one, implement it, then update its status and commit/push back to the backlog repo. Use when the user asks to execute, work on, pick up, or do the next ticket/task from the backlog.
---

# Execute backlog ticket

Workflow for taking a ticket from the `provisionless` project in the sibling backlog repo, implementing it in this code repo, and keeping the backlog status committed and pushed. Never edit task files directly — all task changes go through the `backlog` CLI.

- Backlog project: `/Users/david/work/projects-backlog/provisionless` — run every `backlog` command with `BACKLOG_CWD` set to it.
- Code repo (where implementation happens): this repo (`/Users/david/work/provisionless`).
- Statuses: `To Do` → `In Progress` → `Done`. Terminal tasks stay in `Done` until the user runs periodic cleanup; do not archive.

## Step 1: Load context

1. `backlog instructions overview`
2. `backlog instructions task-execution` — the guide this workflow follows.

## Step 2: Show candidates and recommend

1. `backlog task list --ready --plain` — unblocked, non-terminal tasks. Also `backlog task list --status "In Progress" --plain` in case something was left mid-flight; unfinished in-progress work usually outranks new starts.
2. Present the list with the question tool (ID + title + priority + milestone, one option per task).
3. Mark one option with "(Recommended)" and justify it in one sentence: dependency order (unblocks the most downstream work), priority, milestone fit, smallest ready task. If nothing is ready (all blocked), say so, show what blocks what, and stop rather than picking a blocked task.

Wait for the user's explicit pick.

## Step 3: Claim it (and push the claim)

1. `backlog task view TASK-N --plain` — re-read the full task before mutating it. Confirm scope and dependencies are genuinely satisfied.
2. `backlog task edit TASK-N -s "In Progress" -a @david`
3. From `/Users/david/work/projects-backlog`: stage only this task's file, commit `Start TASK-N: <title>`, `git push origin main`.

## Step 4: Implement

Work in this code repo, keeping the backlog task as plan of record:

1. Research the current system (code, tests, conventions, recent history). Do not trust an implementation approach proposed at ticket-creation time — re-verify against reality.
2. Draft a plan and record it: `backlog task edit TASK-N --plan "1. ... "`. If the plan contains a material product/architecture decision, present it here and wait for approval before implementing.
3. Implement in short loops: focused slice → run relevant tests/checks → `--append-notes "..."` for progress and decisions.
4. Push back when needed: if the task premise turns out to be wrong, the ACs are unverifiable, or it's bigger than filed, stop and tell the user instead of silently working around it.
5. Scope changes: anything outside the acceptance criteria requires asking the user first — extend the task or file follow-up work (use the `backlog-ticket` skill for new tickets). Never create follow-up tasks silently.
6. Commit code in this repo only when the user asks.

## Step 5: Finalize the ticket

Follow `backlog instructions task-finalization`:

1. Objective verification for every acceptance criterion (tests, command output, real manual checks — never code presence alone).
2. `backlog task edit TASK-N --check-ac <i>` only for criteria the evidence proves; same for `--check-dod`.
3. `backlog task edit TASK-N --append-notes "Validation passed: <command>"`
4. `backlog task edit TASK-N --final-summary "<what changed, why, how verified>"`
5. `backlog task edit TASK-N -s "Done"`

If verification fails, fix and re-verify, or report the blocker; do not mark Done.

## Step 6: Push the status back to projects-backlog

From `/Users/david/work/projects-backlog`:

1. `git status` — stage only this task's backlog files from this workflow.
2. Commit: `Complete TASK-N: <title>`.
3. `git push origin main`.

If there are unrelated dirty files, do not commit them; mention them. Report: task ID and status, verification evidence, code-repo commit state (committed or left dirty), and the backlog push result.

## Privacy

Never reference the backlog repo by URL or path from files committed in this (public-facing) code repo.
