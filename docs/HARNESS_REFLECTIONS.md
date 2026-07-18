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

### 2026-07-17 — Preview completed web branches before review

- Task: Build the first multi-page OneCare homepage phase and hand it to the user for visual confirmation.
- Evidence: The branch passed tests, production build, runtime checks, and local browser inspection, but the user could not see it because the existing production URL still served the previous merged version. The user then explicitly granted standing authority to create a Vercel Preview whenever a completed branch changes website content.
- Problem: Local completion alone leaves a repeated review gap for a visual product; users must ask separately for a viewable URL, while deploying directly to Production would be too broad and could change the stable Feishu callback surface.
- `AGENTS.md` change: Add a standing Vercel Preview rule for completed branches with user-visible web changes: validate locally, create a Preview deployment on the linked OneCare project, verify the URL and changed marker, and report it for confirmation. Keep Production deployment, preview secrets, environment changes, GitHub pushes, and merges outside that standing authority.
- Expected benefit: Every completed visual branch becomes directly reviewable without risking the stable production site or requiring repeated deployment instructions.
- Rollback condition: Append a superseding reflection and remove or narrow the rule if Preview deployments create material cost, expose content that should remain local, conflict with a new hosting workflow, or the user withdraws standing authority.
- Status: applied

### 2026-07-18 — Record the Chinese product name

- Task: Add the user-confirmed Chinese scheme name “万护” to the current OneCare website and documentation.
- Evidence: The user explicitly set the Chinese name to “万护” and instructed this branch to add it wherever appropriate while retaining the existing OneCare product and deployment identity.
- Problem: `AGENTS.md` would continue to describe the product only as OneCare, so future contributors could omit the approved Chinese name from new user-facing work.
- `AGENTS.md` change: Update the product baseline name to “万护 OneCare” without changing repository, technology, security, testing, Feishu, or deployment rules.
- Expected benefit: Future specifications and interface work consistently start from the approved bilingual brand name.
- Rollback condition: Append a superseding reflection and revise the baseline if the user changes or withdraws the Chinese product name.
- Status: applied
