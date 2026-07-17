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

### 2026-07-17 — Align current phase and Feishu application model

- Task: Review and complete the Vercel-hosted Feishu login demonstration.
- Evidence: The approved `2026-07-17-vercel-feishu-login-design.md`, implemented OAuth routes, published Feishu version 1.0.1, and production Vercel deployment all use one enterprise custom application for a single enterprise. During final review, `AGENTS.md` still described the current phase as repository setup and required a store application across multiple enterprises.
- Problem: Future contributors could treat already deployed capabilities as unimplemented or incorrectly replace the accepted custom-app boundary with the deferred ISV/store-app model.
- `AGENTS.md` change: Describe the current phase as a deployed single-enterprise custom-app demonstration, keep persistence/AI/bot work explicitly planned, and label the store-app multi-enterprise model as deferred rather than current.
- Expected benefit: Future specifications and reviews start from the actual deployed product boundary without weakening tenant isolation or overstating unfinished integrations.
- Rollback condition: Append a superseding reflection and revise the baseline when the product actually migrates to a published store application or adopts a different approved Feishu distribution model.
- Status: applied
