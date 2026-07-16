# Repository Governance and TypeScript Tech Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a concise repository operating guide, a TypeScript-only technology decision, and an auditable harness reflection log without scaffolding application code.

**Architecture:** Documentation establishes a Next.js modular-monolith target shaped by Feishu store-app multi-tenancy, OAuth v3, and public HTTP event callbacks. Root instructions remain short; detailed technical rationale and mutable harness evidence live under `docs/`.

**Tech Stack:** Markdown documentation for a future TypeScript, Node.js 24 LTS, Next.js App Router, PostgreSQL, Drizzle ORM, Vitest, React Testing Library, and Playwright application.

## Global Constraints

- Use TypeScript only; do not introduce Python code or Python tooling.
- Keep the repository on GitHub with `main` as the default branch.
- Target one shared Feishu store application across multiple enterprises for the demonstration.
- Use Feishu OAuth v3 and server-side credential handling.
- Use public HTTP callbacks for store-app events; do not design around WebSocket long connections.
- Do not scaffold application code, package manifests, data integrations, AI integrations, or deployment configuration in this change.
- Keep `AGENTS.md` concise enough to read before every agent task.

---

## File Structure

- `AGENTS.md`: root-level operating rules and durable red lines.
- `docs/TECH_STACK.md`: selected stack, official evidence, architecture boundaries, and deferred decisions.
- `docs/HARNESS_REFLECTIONS.md`: append-only evidence log and template for controlled `AGENTS.md` improvements.
- `docs/superpowers/specs/2026-07-16-repository-governance-and-tech-stack-design.md`: approved source specification; do not modify unless implementation reveals a contradiction.
- `docs/superpowers/plans/2026-07-16-repository-governance-and-tech-stack.md`: this execution plan and progress record.

### Task 1: Repository Operating Guide and Harness Reflection Loop

**Files:**
- Create: `AGENTS.md`
- Create: `docs/HARNESS_REFLECTIONS.md`
- Modify: `docs/superpowers/plans/2026-07-16-repository-governance-and-tech-stack.md`

**Interfaces:**
- Consumes: repository facts from `README.md` and the approved design specification.
- Produces: mandatory operating rules that future agents read and an audit location for later self-improvement.

- [x] **Step 1: Record the documentation validation baseline**

Run:

```bash
test ! -e AGENTS.md
test ! -e docs/HARNESS_REFLECTIONS.md
```

Expected: both commands exit `0`, proving the deliverables do not already exist and the change is additive.

- [x] **Step 2: Create the harness reflection log**

Create `docs/HARNESS_REFLECTIONS.md` with this complete structure:

```markdown
# Harness Reflections

This append-only log records evidence for durable changes to `AGENTS.md`. It is not a product backlog and must not be used to change product requirements.

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

No reflections have been recorded yet.
```

- [x] **Step 3: Create the concise root operating guide**

Create `AGENTS.md` with these sections and exact rules:

```markdown
# Agent Operating Guide

Read this file before changing the repository. Keep work scoped, evidence-based, and easy for the next contributor to verify.

## Project Baseline

- Product: Auto Insight, an AI-assisted automotive user-insight platform.
- Repository: GitHub `https://github.com/yjzhang2003/Auto-Insight.git`.
- Default branch: `main`.
- Language boundary: TypeScript only. Do not add Python code or Python tooling.
- Current phase: architecture and repository setup. Do not describe planned integrations as implemented.

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
- The demonstration uses one store application across multiple enterprises.
- Derive tenant context from validated Feishu identity or installation data, never an unchecked client parameter.
- Store-app events use verified public HTTP callbacks and return within Feishu's deadline; slow work runs asynchronously.
- Treat missing tenant context as no access.

## Git and GitHub Safety

- Use local Git and GitHub workflows; do not copy Gitee-specific commands or branch rules.
- Do not discard, reset, or overwrite unrelated changes.
- Do not push, open pull requests, merge, or alter remote state unless the user asks.
- Report every commit, known failure, and unverified assumption.

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
```

- [x] **Step 4: Validate the governance documents**

Run:

```bash
test -f AGENTS.md
test -f docs/HARNESS_REFLECTIONS.md
rg -n "GitHub|TypeScript only|OAuth|tenant|Harness Reflection" AGENTS.md
rg -n "Evidence|Rollback condition|Status" docs/HARNESS_REFLECTIONS.md
! rg -n "/opt/anaconda|pytest|Gitee WebHook|DEPLOY_BRANCH=master" AGENTS.md docs/HARNESS_REFLECTIONS.md
git diff --check
```

Expected: both files exist; required rules are found; inherited repository-specific forbidden text is absent; `git diff --check` exits `0`.

- [x] **Step 5: Mark Task 1 complete and commit**

Update Task 1 checkboxes in this plan, then run:

```bash
git add AGENTS.md docs/HARNESS_REFLECTIONS.md docs/superpowers/plans/2026-07-16-repository-governance-and-tech-stack.md
git commit -m "docs: add repository operating guide"
```

Expected: one commit containing only the operating guide, reflection log, and plan progress.

### Task 2: TypeScript and Feishu Technology Decision

**Files:**
- Create: `docs/TECH_STACK.md`
- Modify: `docs/superpowers/plans/2026-07-16-repository-governance-and-tech-stack.md`

**Interfaces:**
- Consumes: Feishu, Next.js, and Node.js official references listed in the approved specification.
- Produces: the architecture baseline referenced by `AGENTS.md` and future feature specifications.

- [ ] **Step 1: Record the missing-document baseline**

Run:

```bash
test ! -e docs/TECH_STACK.md
```

Expected: exits `0` because the technology decision has not yet been created.

- [ ] **Step 2: Create the technology stack decision**

Create `docs/TECH_STACK.md` with the following complete sections and decisions:

```markdown
# Auto Insight Technology Stack

## Status

Decision accepted on 2026-07-16. This document describes the target architecture; it does not mean the application or integrations already exist.

## Decision Summary

Auto Insight will use a TypeScript modular monolith:

- Node.js 24 LTS;
- Next.js App Router;
- React Server Components by default;
- Route Handlers for server endpoints;
- PostgreSQL;
- Drizzle ORM;
- Vitest, React Testing Library, and Playwright when implementation begins.

Python is outside this repository's architecture.

## Why this stack

One TypeScript codebase is the smallest architecture that can support the website, OAuth callbacks, Feishu HTTP events, tenant-aware application services, and a later asynchronous worker. It avoids a premature split between frontend and backend frameworks while preserving module boundaries.

Node.js 24 is an LTS release as of the decision date. Next.js recommends the App Router for current applications and provides Route Handlers for HTTP endpoints.

## Repository Shape

The initial application should remain one deployable Next.js project with feature modules for identity, tenants, insights, and Feishu integration. Extract a separate TypeScript worker only when real asynchronous bot or AI workloads require independent scaling.

Do not add a Python service. If later AI infrastructure exposes an external API, consume it through a typed TypeScript adapter.

## Feishu Login

Website login uses the OAuth authorization-code flow:

- authorization: `https://accounts.feishu.cn/open-apis/authen/v1/authorize`;
- token exchange: `https://accounts.feishu.cn/oauth/v3/token`;
- user information: `https://open.feishu.cn/open-apis/authen/v1/user_info`.

The server generates and validates a single-use `state`, exchanges the code, retrieves stable Feishu identity, maps the user and tenant, and creates an application session. Secrets and Feishu access tokens never enter client-rendered code.

## Multi-Enterprise Application Model

The demonstration targets one Feishu store application installed by multiple enterprises. The App ID is shared, while `tenant_key` identifies each tenant and is required for tenant-specific access tokens and data isolation.

This is intentionally different from Feishu's one-click agent application SDK, which creates or updates separate applications. Auto Insight users use one shared bot.

The later production deployment may be restricted to one enterprise without changing domain interfaces: it becomes a deployment and installation constraint, not a rewrite of user or tenant models.

## Feishu Events

Store applications receive events at a public HTTP endpoint. Feishu WebSocket long connections are limited to custom applications and are not the foundation of this design.

The event endpoint must verify requests, deduplicate events, persist or enqueue accepted work, and respond within three seconds. AI inference and other slow work execute asynchronously after acknowledgement.

Queue technology is deliberately deferred until bot workloads are implemented.

## Persistence and Tenant Isolation

PostgreSQL is the system of record. Drizzle owns TypeScript schemas and migrations.

Every tenant-owned row carries an internal tenant ID mapped from validated Feishu `tenant_key`. Repository and service interfaces require tenant context, and absent tenant context defaults to no access. PostgreSQL row-level security may be added as defense in depth after the first schema is designed.

## Testing Baseline

- Vitest: domain, service, adapter, and route tests.
- React Testing Library: interactive component behavior.
- Playwright: critical login, authorization, and tenant-isolation browser flows.
- Contract fixtures: Feishu OAuth and event payload compatibility.

Production behavior is implemented test-first. Feishu network calls stay behind typed adapters so tests remain deterministic.

## Deferred Decisions

- hosting provider and region;
- queue and background-job implementation;
- application session library;
- AI model and orchestration provider;
- automotive data sources;
- analytics and visualization libraries;
- final deployment topology.

These decisions require their own specifications when product requirements are known.

## Official References

- [Feishu browser authorization guide](https://open.feishu.cn/document/sso/web-application-end-user-consent/guide?lang=zh-CN)
- [Feishu authorization code](https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code?lang=zh-CN)
- [Feishu user access token v3](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3)
- [Feishu user information](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/user_info/get)
- [Feishu custom and store application differences](https://open.feishu.cn/document/server-docs/im-v1/faq?lang=zh-CN)
- [Feishu long-connection restrictions](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case)
- [Feishu event callback optimization](https://open.feishu.cn/document/event-subscription-guide/event-subscriptions/event-callback-optimization-guide?lang=zh-CN)
- [Feishu one-click agent application](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview)
- [Next.js App Router](https://nextjs.org/docs/app/getting-started)
- [Node.js releases](https://nodejs.org/en/about/previous-releases)
```

- [ ] **Step 3: Validate architecture requirements**

Run:

```bash
test -f docs/TECH_STACK.md
rg -n "TypeScript modular monolith|Node.js 24 LTS|Next.js App Router|PostgreSQL|Drizzle" docs/TECH_STACK.md
rg -n "oauth/v3/token|store application|tenant_key|public HTTP|three seconds" docs/TECH_STACK.md
rg -n "Python is outside|Do not add a Python service" docs/TECH_STACK.md
rg -n "not the foundation of this design" docs/TECH_STACK.md
! rg -n "open-apis/authen/v2/oauth/token" docs/TECH_STACK.md
git diff --check
```

Expected: all selected-stack and Feishu constraints are found, deprecated token endpoint is absent, WebSocket is explicitly rejected as the foundation, and whitespace validation passes.

- [ ] **Step 4: Validate official reference URLs**

Run:

```bash
for url in $(rg -o 'https://[^)]+' docs/TECH_STACK.md); do curl -L --fail --silent --show-error --output /dev/null "$url"; done
```

Expected: exits `0`; every official reference returns a successful HTTP response after redirects.

- [ ] **Step 5: Mark Task 2 complete and commit**

Update Task 2 checkboxes in this plan, then run:

```bash
git add docs/TECH_STACK.md docs/superpowers/plans/2026-07-16-repository-governance-and-tech-stack.md
git commit -m "docs: record TypeScript and Feishu stack"
```

Expected: one commit containing the technology decision and plan progress.

### Task 3: Cross-Document Verification

**Files:**
- Modify if validation exposes a mismatch: `AGENTS.md`
- Modify if validation exposes a mismatch: `docs/TECH_STACK.md`
- Modify if validation exposes a mismatch: `docs/HARNESS_REFLECTIONS.md`
- Modify: `docs/superpowers/plans/2026-07-16-repository-governance-and-tech-stack.md`

**Interfaces:**
- Consumes: all documentation delivered by Tasks 1 and 2.
- Produces: a consistent, navigable documentation baseline ready for application planning.

- [ ] **Step 1: Verify every required local document exists**

Run:

```bash
test -f README.md
test -f AGENTS.md
test -f docs/TECH_STACK.md
test -f docs/HARNESS_REFLECTIONS.md
test -f docs/superpowers/specs/2026-07-16-repository-governance-and-tech-stack-design.md
test -f docs/superpowers/plans/2026-07-16-repository-governance-and-tech-stack.md
```

Expected: all commands exit `0`.

- [ ] **Step 2: Verify decisions remain consistent across documents**

Run:

```bash
rg -n "TypeScript only|TypeScript modular monolith" AGENTS.md docs/TECH_STACK.md
rg -n "store application|store app" AGENTS.md docs/TECH_STACK.md docs/superpowers/specs/2026-07-16-repository-governance-and-tech-stack-design.md
rg -n "oauth/v3/token|v3 token" AGENTS.md docs/TECH_STACK.md docs/superpowers/specs/2026-07-16-repository-governance-and-tech-stack-design.md
rg -n "HARNESS_REFLECTIONS.md" AGENTS.md docs/superpowers/specs/2026-07-16-repository-governance-and-tech-stack-design.md
! rg -n "/opt/anaconda|pytest|Gitee WebHook|DEPLOY_BRANCH=master|open-apis/authen/v2/oauth/token" AGENTS.md docs/TECH_STACK.md docs/HARNESS_REFLECTIONS.md
```

Expected: selected decisions appear in their intended documents and inherited or deprecated instructions are absent.

- [ ] **Step 3: Review the final diff and repository state**

Run:

```bash
git diff --check
git status --short --branch
git log -3 --oneline --decorate
```

Expected: no whitespace errors; only intended plan progress or validation fixes are uncommitted; recent commits show the specification and documentation commits.

- [ ] **Step 4: Apply and document only validation-driven corrections**

If a Step 1-3 command fails, change only the smallest documentation text required to make the approved specification and delivered files consistent, then rerun all Task 3 validation commands.

Expected: every command passes without expanding scope or adding application files.

- [ ] **Step 5: Mark Task 3 complete and commit final progress if needed**

Update Task 3 checkboxes. If this changes the plan or fixes documentation, run:

```bash
git add AGENTS.md docs/TECH_STACK.md docs/HARNESS_REFLECTIONS.md docs/superpowers/plans/2026-07-16-repository-governance-and-tech-stack.md
git commit -m "docs: verify repository architecture baseline"
```

If there are no uncommitted changes after marking progress, do not create an empty commit.

Expected: `git status --short` is empty and all accepted deliverables are committed.
