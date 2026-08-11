# Agent Operating Guide

Read this file before changing the repository. Keep work scoped, evidence-based, and easy for the next contributor to verify.

## Project Baseline

- Product: 万护 OneCare, an AI-assisted end-to-end user-service loop concept for Hisense smart-home scenarios.
- Repository: GitHub `https://github.com/yjzhang2003/OneCare.git`.
- Default branch: `main`.
- Language boundary: TypeScript only. Do not add Python code or Python tooling.
- Current phase: deployed single-enterprise website demonstration using one Feishu enterprise custom application, plus a working VOC closed loop. Real VOC feedback lands in a Feishu Bitable; dual-track AI tagging (a Feishu aily skill, or a Bitable AI field shortcut, switched by `TAGGING_PROVIDER`) fills one shared `TagResult` contract; a Cron-driven, resumable shard job at `/api/voc/analyze` retags `分析失败` records up to a retry ceiling and requires `CRON_SECRET`; and a Feishu card workflow carries a ticket through `待跟进 → 跟进中 → 待闭环 → 已闭环` behind a synchronous triple check (record exists, operator is the assigned owner, the transition is legal) that writes nothing on rejection. A record that reaches `待跟进` with this pass's severity at `高` also triggers a war-room escalation (`docs/superpowers/specs/2026-08-12-onecare-voc-warroom-design.md`): a card to every 兜底 (fallback) owner with two buttons to approve or decline a Feishu group chat for that ticket. The approval logic, idempotent group creation, an in-group free-text Q&A skill grounded only in Bitable facts (a second aily skill, never invented answers), and closure-time transcript summarization are implemented and unit-tested (`src/features/warroom/`, `src/features/feishu-bot/war-room-actions.ts`, `src/features/tagging/answer-provider.ts`); the in-group Q&A and closure-summary paths are wired into `app/api/feishu/events/route.ts`, but the two approval buttons are not — that route still sends `voc_open_war_room`/`voc_decline_war_room` through the same owner-only `resolveVocCardAction` the four state actions use, which defines no transition for either action, so a real click today returns an error toast and creates nothing. Wiring that dispatch is unfinished work, not a design choice, and blocks spec §12 acceptance items 2–5. SLA nudging, reply rewriting, a similar-tickets panel, a second bot sharing one group, and automated group archival are out of scope by design; name resolution never calls the Contact API (`contact/v3/*` returns `99991672`, unauthorized, on this tenant) — Bitable's own person-field payload already carries a display name. `/` splits by identity: a tenant member who signs in gets a read-only operations workbench showing aggregate metrics, three distributions, and per-ticket rows carrying real feedback text and real owner names — the session gate is what makes showing those defensible — while an external visitor gets the unchanged pitch showcase and is never pushed toward login. Authorization starts from `/enter`, the path the Feishu app's web homepage points at, and a failed attempt returns to `/` carrying `auth=tried` so the entry point cannot bounce against the failure forever. `/api/voc/dashboard` now requires a session and reaches Bitable only after that check passes; the formerly public `/dashboard/voc` page was retired to a config-level 307 toward `/`. No web control changes ticket state: writes belong to the card path, whose identity comes from a signed event rather than a cookie. The workbench has no interactive filters and no pagination. These are documented, not unconditional: Bitable writes are best-effort (no CAS; a monotonic state-sequence comparison, not a database row lock), the owner/fallback table is an editable Bitable ACL rather than a role system, and the reported effort savings are a stated assumption, never a measurement or an annualized figure. PostgreSQL persistence, real IoT device data and predictive diagnosis, free-text AI customer service, automatic follow-up and satisfaction triggers, the periodic VOC insight skill, a programmatic xlsx import route, and multi-enterprise tenant isolation remain planned; do not describe them as implemented. The user, customer-service, and engineer role demos remain in-browser simulation — only the back-office VOC view is wired to real metrics.

## Required Reading

Before non-trivial work, read:

1. `README.md`
2. `docs/TECH_STACK.md`
3. The active specification and implementation plan under `docs/superpowers/`
4. Relevant documentation under `docs/`

## Specification and Planning

A written specification is required before user-facing features, behavior changes, APIs, data models, Feishu integration, tenant isolation, deployment changes, or broad refactors.

Small typo, formatting, and non-behavioral documentation fixes may skip a specification. State the reason in the work summary.

Keep implementation plans current when scope, task order, validation commands, or discovered constraints change.

## Development Discipline

Before editing:

1. Run `git status --short --branch`.
2. Read the active specification and plan.
3. Preserve unrelated user changes.
4. Identify the smallest verification that proves the requested behavior.

For behavior changes, follow RED → GREEN → REFACTOR:

1. Write a failing test.
2. Run it and confirm the expected failure.
3. Implement the smallest passing change.
4. Run targeted and relevant broader tests.
5. Refactor only while tests remain green.

If a test-first exception is necessary, document why and record replacement verification before implementation.

## Feishu Red Lines

- Use the current official Feishu documentation as the source of truth.
- Browser login uses OAuth authorization code flow and the v3 token endpoint.
- App secrets and Feishu tokens stay server-side and must not appear in logs or client bundles.
- The current demonstration uses one enterprise custom application and supports only its owning enterprise and configured availability scope.
- A shared store application for multiple enterprises is a deferred ISV path, not a current capability.
- Derive tenant context from validated Feishu identity or installation data, never an unchecked client parameter.
- Feishu events use verified public HTTP callbacks and return within Feishu's deadline; slow work runs asynchronously.
- Treat missing tenant context as no access.

## Git and GitHub Safety

- Use local Git and GitHub workflows; do not copy Gitee-specific commands or branch rules.
- Do not discard, reset, or overwrite unrelated changes.
- Do not push, open pull requests, merge, or alter remote state unless the user asks.
- Report every commit, known failure, and unverified assumption.

## Vercel Preview Handoff

The user has granted standing authority to create a Vercel Preview deployment when a completed branch changes user-visible website content.

Before handing off such a branch:

1. Complete the planned local tests, static checks, production build, and `git diff --check`.
2. Deploy the current branch to the repository's linked Vercel project without `--prod`.
3. If Deployment Protection is active, create a time-limited shareable link for the review window; never persist its bypass value in the repository.
4. Verify that the Preview returns HTTP 200 and contains a marker unique to the requested change.
5. Give the shareable Preview URL to the user for visual confirmation and state any Preview-only limitation.

This standing authority does not include Production deployment, environment-variable changes, copying Production secrets into Preview, Feishu redirect changes, GitHub pushes, pull requests, or merges. Preview authentication is not assumed to work unless its environment and redirect URL are separately configured and authorized.

## Harness Reflection

After non-trivial work, briefly assess whether repository instructions caused avoidable ambiguity, rework, or risk.

The harness may update `AGENTS.md` only for durable, repository-specific improvements supported by evidence. Before applying a change, add an entry to `docs/HARNESS_REFLECTIONS.md` with the evidence, rule change, expected benefit, and rollback condition.

Self-modification must not weaken security, testing, tenant isolation, or user authority; broaden scope; change product requirements; or justify a rule violation after the fact. Report every `AGENTS.md` change in the final summary.

## Completion

Before claiming completion:

1. Run the planned validation commands.
2. Run `git diff --check`.
3. Update affected specifications, plans, and documentation.
4. Report changed files, validation results, known gaps, and next steps without overstating readiness.
