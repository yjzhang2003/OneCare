# OneCare Technology Stack

## Status

The TypeScript web baseline and Feishu custom-app login were implemented on 2026-07-17. The current application is a single-enterprise demonstration; IoT and VOC data, service-system integrations, AI analysis, persistence, and the Feishu agent remain unimplemented.

The production deployment is available at `https://auto-insight-omega.vercel.app`. Feishu custom-app version 1.0.1 and the exact production redirect URL are published, and the login, protected dashboard, logout, and post-logout redirect behavior have been manually verified with a real enterprise member.

## Implemented Baseline

OneCare uses one TypeScript modular monolith:

- Node.js 24 LTS;
- Next.js 16 App Router;
- React Server Components by default;
- Route Handlers for OAuth endpoints;
- signed, database-free HTTP-only website sessions;
- Vitest and React Testing Library;
- Vercel as the selected web host.

Python is outside this repository's architecture.

This is the smallest deployable shape that supports a real website login while preserving boundaries for later persistence, tenant isolation, service-domain modules, and Feishu integration.

## Repository Shape

The repository contains one deployable Next.js project. Authentication protocol code lives under `src/features/auth`; HTTP orchestration lives under `app/api/auth`; pages remain responsible only for presentation and session-aware navigation.

A separate TypeScript worker is deferred until real asynchronous bot or AI workloads require independent scaling. If later AI infrastructure exposes an external API, the website will consume it through a typed TypeScript adapter.

## Current Feishu Login

The current demonstration uses one Feishu custom application owned by one enterprise:

- authorization: `https://accounts.feishu.cn/open-apis/authen/v1/authorize`;
- token exchange: `https://accounts.feishu.cn/oauth/v3/token`;
- user information: `https://open.feishu.cn/open-apis/authen/v1/user_info`.

The server creates a 10-minute, single-use OAuth `state` Cookie and rejects missing or mismatched values before exchanging the authorization code. It retrieves only the stable `open_id`, display name, and optional avatar URL, then creates an eight-hour HMAC-SHA-256 website session.

The App Secret, user access token, and session secret remain server-side. Feishu access tokens are used for one request chain and are not persisted. Email and mobile are neither requested nor used as identity keys.

Because this is a custom application, only users in the owning enterprise and in the application's availability scope can log in.

## Future Multi-Enterprise Model

The longer-term demonstration architecture still targets one Feishu store application installed by multiple enterprises. Its shared App ID and validated `tenant_key` will identify tenant context and enforce tenant-specific data access.

That store-app path requires the appropriate ISV and marketplace process and is not claimed by the current build. Migrating to it will require persistent user and tenant mappings, installation lifecycle handling, tenant tokens, event verification, and tenant-aware repositories.

Feishu's one-click agent-application SDK remains outside the intended product flow because it creates or updates separate applications rather than one shared product application.

## Hosting and Runtime

Vercel is the selected host for the Next.js application and Node.js Route Handlers. Production secrets are configured as Vercel environment variables and are never passed as public `NEXT_PUBLIC_*` values.

The first production deployment establishes the canonical domain. The exact `/api/auth/feishu/callback` URL on that domain must then be added to the Feishu developer console and stored as `FEISHU_REDIRECT_URI` before the final production deployment.

Authentication routes explicitly use the Node.js runtime. The repository pins Node 24 and overrides Next.js's transitive PostCSS dependency to a compatible patched release because the upstream pinned version is affected by GHSA-qx2v-qp2m-jg93.

## Persistence and Tenant Isolation

The current build has no database and stores no device, VOC, service, refresh-token, or persistent user-profile records.

PostgreSQL and Drizzle remain the intended system-of-record stack when persistence begins. At that point every tenant-owned row must carry an internal tenant identifier derived from validated Feishu installation or identity data. Missing tenant context defaults to no access. PostgreSQL row-level security may be added as defense in depth after the first schema is specified.

## Feishu Events and Agent

No event endpoint or Feishu agent is implemented yet.

For the future store application, events must use a verified public HTTP callback. The endpoint must verify requests, deduplicate events, persist or enqueue accepted work, and acknowledge within three seconds. AI inference and other slow work execute asynchronously after acknowledgement. Queue technology remains deferred until that workload is specified.

## Testing Baseline

- Vitest covers environment validation, OAuth state, signed sessions, Feishu adapters, and Route Handlers.
- A separate built-runtime Vitest suite starts the output of `next build` with `next start` and exercises the authentication routes across the real Next.js production boundary.
- React Testing Library covers the landing page and dashboard presentation contracts.
- External Feishu calls are injected in tests and never reach the network.
- Production behavior is implemented test-first.
- A production build, dependency audit, secret scan, and live deployment smoke test are required before release.

Playwright browser tests remain deferred until a persistent non-personal test identity is available. The current production flow has been manually verified in Edge with a real enterprise member after publishing the Feishu redirect URL.

## Deferred Decisions

- queue and background-job implementation;
- PostgreSQL hosting and migration workflow;
- AI model and orchestration provider;
- IoT, VOC, customer-service, work-order, parts, and follow-up data sources;
- analytics and visualization libraries;
- store-app ISV and marketplace path;
- final multi-service deployment topology.

Each deferred item requires a focused specification before implementation.

## Official References

- [Feishu browser authorization guide](https://open.feishu.cn/document/sso/web-application-end-user-consent/guide?lang=zh-CN)
- [Feishu authorization code](https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code?lang=zh-CN)
- [Feishu user access token v3](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3)
- [Feishu user information](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/user_info/get)
- [Feishu custom and store application differences](https://open.feishu.cn/document/server-docs/im-v1/faq?lang=zh-CN)
- [Feishu event callback optimization](https://open.feishu.cn/document/event-subscription-guide/event-subscriptions/event-callback-optimization-guide?lang=zh-CN)
- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js Cookie API](https://nextjs.org/docs/app/api-reference/functions/cookies)
- [Vercel CLI deployment](https://vercel.com/docs/cli/deploy)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Node.js releases](https://nodejs.org/en/about/previous-releases)
