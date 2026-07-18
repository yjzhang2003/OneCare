# 万护 OneCare Technology Stack

## Status

The 万护 OneCare TypeScript web baseline and Feishu custom-app login were implemented on 2026-07-17. A guided Feishu experience page and a stateless single-chat text bot webhook were added on 2026-07-18. The current application remains a single-enterprise demonstration; IoT and VOC data, service-system integrations, AI analysis, persistence, and production Feishu bot activation remain unimplemented.

The production deployment is available at `https://onecare-loop.vercel.app`. The canonical OAuth callback is `https://onecare-loop.vercel.app/api/auth/feishu/callback`, and the verified bot event callback is `https://onecare.ohmyfeishu.top/api/feishu/events`. URL Verification, permissions, event subscriptions and custom menus have been configured externally; the employee-bot branch is not considered active until its code is deployed to Production, the application version is published, and a real enterprise member completes acceptance testing.

## Implemented Baseline

万护 OneCare uses one TypeScript modular monolith:

- Node.js 24 LTS;
- Next.js 16 App Router;
- React Server Components by default;
- Route Handlers for OAuth and verified Feishu event endpoints;
- signed, database-free HTTP-only website sessions;
- the official `@larksuiteoapi/node-sdk` for event dispatch and message replies;
- Vitest and React Testing Library;
- Vercel as the selected web host.

Python is outside this repository's architecture.

This is the smallest deployable shape that supports a real website login while preserving boundaries for later persistence, tenant isolation, service-domain modules, and Feishu integration.

## Repository Shape

The repository contains one deployable Next.js project. Authentication protocol code lives under `src/features/auth`; deterministic bot behavior, event verification, and reply adapters live under `src/features/feishu-bot`; HTTP orchestration lives under `app/api/auth` and `app/api/feishu/events`; pages remain responsible only for presentation and session-aware navigation.

A separate TypeScript worker is deferred until real asynchronous bot or AI workloads require independent scaling. The current short deterministic reply uses Next.js `after()` after the event acknowledgement. If later AI infrastructure exposes an external API, the website will consume it through a typed TypeScript adapter and slow durable work must move to a queue or worker.

## Current Feishu Login

The current demonstration uses one Feishu custom application owned by one enterprise:

- authorization: `https://accounts.feishu.cn/open-apis/authen/v1/authorize`;
- token exchange: `https://accounts.feishu.cn/oauth/v3/token`;
- user information: `https://open.feishu.cn/open-apis/authen/v1/user_info`.

The server creates a 10-minute, single-use OAuth `state` Cookie and rejects missing or mismatched values before exchanging the authorization code. It retrieves only the stable `open_id`, display name, and optional avatar URL, then creates an eight-hour HMAC-SHA-256 website session.

The App Secret, user access token, and session secret remain server-side. Feishu access tokens are used for one request chain and are not persisted. Email and mobile are neither requested nor used as identity keys.

Because this is a custom application, only users in the owning enterprise and in the application's availability scope can log in.

`/login` is the canonical website experience gateway. It presents the OneCare enterprise invitation QR, the OAuth identity check, and the instructions for finding the bot in Feishu. `/dashboard` is retained only as a compatibility redirect to `/login`; login does not reveal a second website dashboard.

## Future Multi-Enterprise Model

The longer-term demonstration architecture still targets one Feishu store application installed by multiple enterprises. Its shared App ID and validated `tenant_key` will identify tenant context and enforce tenant-specific data access.

That store-app path requires the appropriate ISV and marketplace process and is not claimed by the current build. Migrating to it will require persistent user and tenant mappings, installation lifecycle handling, tenant tokens, event verification, and tenant-aware repositories.

Feishu's one-click agent-application SDK remains outside the intended product flow because it creates or updates separate applications rather than one shared product application.

## Hosting and Runtime

Vercel is the selected host for the Next.js application and Node.js Route Handlers. Production secrets are configured as Vercel environment variables and are never passed as public `NEXT_PUBLIC_*` values.

The Feishu event callback has a stricter network placement requirement than the rest of the site. `vercel.json` deploys only `app/api/feishu/events/route.ts` to Hong Kong (`hkg1`) so Feishu's China-side verification and event delivery do not traverse to Vercel's default Washington, D.C. (`iad1`) compute region. Other Node.js routes retain the project default. Deployment inspection must confirm the emitted `api/feishu/events` function region before production callback validation.

The first production deployment establishes the canonical domain. The exact `/api/auth/feishu/callback` URL on that domain must then be added to the Feishu developer console and stored as `FEISHU_REDIRECT_URI` before the final production deployment.

Authentication routes explicitly use the Node.js runtime. The repository pins Node 24 and overrides Next.js's transitive PostCSS dependency to a compatible patched release because the upstream pinned version is affected by GHSA-qx2v-qp2m-jg93.

## Persistence and Tenant Isolation

The current build has no database and stores no device, VOC, service, refresh-token, or persistent user-profile records.

PostgreSQL and Drizzle remain the intended system-of-record stack when persistence begins. At that point every tenant-owned row must carry an internal tenant identifier derived from validated Feishu installation or identity data. Missing tenant context defaults to no access. PostgreSQL row-level security may be added as defense in depth after the first schema is specified.

## Feishu Events and Bot

`POST /api/feishu/events` implements the HTTP surface for a lightweight employee demonstration bot. It validates the raw-body signature, Verification Token, and Encrypt Key; supports URL Verification; accepts authenticated `im.message.receive_v1` events whose message is `p2p` text and `im.chat.access_event.bot_p2p_chat_entered_v1` events with a valid `chat_id`; acknowledges accepted events before scheduling work with Next.js `after()`; and uses the official Node SDK to reply to the original message or proactively send a welcome card to the entered chat. Authenticated but unregistered group lifecycle events are acknowledged and ignored.

The bot script is deterministic and stateless. It recognizes eight employee menu commands in Chinese, English or the configured bilingual form: help, operations center, pending services, ticket creation, progress, today's tasks, AI diagnosis and parts, and result submission. Every business result is explicitly simulated. It does not call an LLM, retrieve a knowledge base, read IoT data, create a real work order, or persist message text, user identifiers, tokens or event IDs. The V2 chat-entry event sends a concise card on every entry because there is no durable 24-hour welcome deduplication. Feishu retries can also produce duplicate demonstration messages; persistence is required before real service operations.

The stable public callback, matching server secrets and URL Verification are complete. Production activation of this employee-bot revision still requires deploying the branch, publishing the corresponding application version, confirming the availability scope, and acceptance testing both chat entry and all menu actions with a real enterprise member. A Vercel Preview protected by Deployment Protection cannot be configured as the live callback.

## Testing Baseline

- Vitest covers environment validation, OAuth state, signed sessions, Feishu OAuth adapters, deterministic bot scripts, event verification, SDK reply adapters, and Route Handlers.
- A separate built-runtime Vitest suite starts the output of `next build` with `next start` and exercises authentication routes, login redirects, and the Feishu URL Verification challenge across the real Next.js production boundary.
- React Testing Library covers the landing page, guided login page, reusable Feishu role banner, and role-workspace presentation contracts.
- External Feishu calls are injected in tests and never reach the network.
- Production behavior is implemented test-first.
- A production build, dependency audit, secret scan, and live deployment smoke test are required before release.

Playwright browser checks cover the public experience page and role-entry layout at desktop and mobile widths. A persistent non-personal enterprise identity is still required to automate the real OAuth and bot-conversation path; those external acceptance checks remain manual.

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
