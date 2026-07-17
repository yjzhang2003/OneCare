# Agent Operating Guide

Read this file before changing the repository. Keep work scoped, evidence-based, and easy for the next contributor to verify.

## Project Baseline

- Product: Auto Insight, an AI-assisted automotive user-insight platform.
- Repository: GitHub `https://github.com/yjzhang2003/Auto-Insight.git`.
- Default branch: `main`.
- Language boundary: TypeScript only. Do not add Python code or Python tooling.
- Current phase: deployed single-enterprise website demonstration using one Feishu enterprise custom application. PostgreSQL persistence, real automotive data, AI analysis, and Feishu bot/agent behavior remain planned; do not describe them as implemented.

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
