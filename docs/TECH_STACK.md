# Auto Insight Technology Stack

## Status

Decision accepted on 2026-07-16. This document describes the target architecture; it does not mean the application or integrations already exist.

## Decision Summary

Auto Insight will use a TypeScript modular monolith:

- Node.js 24 LTS;
- Next.js App Router;
- React Server Components by default;
- Client Components only for interactive views;
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

Before exchanging the code, the server rejects a missing, expired, reused, or mismatched server-generated `state`. The server then retrieves Feishu identity, maps the user and tenant, and creates an application session. User identity keys use stable Feishu identifiers; email addresses and mobile numbers are attributes, not identity keys. Secrets and Feishu access tokens never enter client-rendered code.

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
