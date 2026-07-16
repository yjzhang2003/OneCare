# Harness Reflections

This append-only log records evidence for durable changes to `AGENTS.md`. It is not a product backlog and must not be used to change product requirements.

Entries are immutable once appended: never edit or delete a prior entry, including its `Status`. Record a status transition, rollback, or correction as a new dated entry that references the original entry in its `Task` or `Evidence` field. Each `Status` therefore describes the entry when it was appended rather than mutable current state.

## When to add an entry

Add an entry only when a completed task exposes a repository-specific instruction that is missing, ambiguous, repeatedly wasteful, or unsafe. Do not add rules solely to justify a decision already made in the same task.

Before editing `AGENTS.md`, confirm that the proposed rule:

- is supported by concrete evidence;
- will help future tasks, not only the current task;
- does not weaken security, tests, tenant isolation, or user authority;
- does not broaden product scope;
- has a clear rollback condition.

Every applied change must appear in the task diff and final summary.

## Entry template

### YYYY-MM-DD — Short title

- Task:
- Evidence:
- Problem:
- `AGENTS.md` change:
- Expected benefit:
- Rollback condition:
- Status: proposed | applied | reverted

## Entries

The reflection log was initialized on 2026-07-16. Append new dated entries below this line.
