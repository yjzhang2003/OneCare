# 万护 OneCare Technology Stack

## Status

The 万护 OneCare TypeScript web baseline and Feishu custom-app login were implemented on 2026-07-17. A guided Feishu experience page and stateless employee bot webhook were added on 2026-07-18. On 2026-07-19 the bot was upgraded locally to an all-Card-2.0 workbench with verified button callbacks; production deployment, callback subscription, app-version publication and real-member acceptance are still required. A VOC closed loop was added on 2026-08-11: real VOC feedback lands in a Feishu Bitable; dual-track AI tagging (a Feishu aily skill, or a Bitable AI field shortcut, selected by `TAGGING_PROVIDER`) fills one shared tagging contract; a Cron-driven, resumable shard job at `/api/voc/analyze` retags failed records under a retry ceiling; a Feishu card workflow carries a ticket through `待跟进 → 跟进中 → 待闭环 → 已闭环` behind a synchronous triple check. On the same day the landing page was split by identity: signing in from the Feishu client (via `/enter`, the app's web homepage) lands on a read-only operations workbench at `/` with real per-ticket detail, an external visitor still gets the pitch showcase, `/api/voc/dashboard` requires a session, and the formerly public `/dashboard/voc` page became a 307 toward `/`. On 2026-08-12 a VOC war room was added on top of the closed loop: a high-severity record escalates to a Feishu group-chat workflow with an approval card, an in-group free-text Q&A skill grounded in Bitable facts, and a closure-time transcript summary (see "VOC War Room" below and `docs/superpowers/specs/2026-08-12-onecare-voc-warroom-design.md`); the escalation card's own two approval buttons are implemented, unit-tested, and wired to the production card-callback route, so a real click creates a group. The current application remains a single-enterprise demonstration; PostgreSQL persistence, real IoT device data, other service-system integrations (customer service, work orders, parts, follow-up), and production activation of the employee bot workbench remain unimplemented.

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

The current build has no SQL database of its own. VOC feedback and its service-event state now live in a Feishu Bitable (see the VOC closed loop note above), not in a database this repository owns; Bitable has no transaction support or row locking, so writes there are best-effort rather than strongly consistent. Aside from that Bitable, the site still stores no device, refresh-token, or persistent user-profile records.

PostgreSQL and Drizzle remain the intended system-of-record stack when persistence begins. At that point every tenant-owned row must carry an internal tenant identifier derived from validated Feishu installation or identity data. Missing tenant context defaults to no access. PostgreSQL row-level security may be added as defense in depth after the first schema is specified.

## Feishu Events and Bot

`POST /api/feishu/events` implements the HTTP surface for a lightweight employee demonstration bot. It validates the raw-body signature, Verification Token, Encrypt Key, configured App ID and non-empty tenant context; supports URL Verification; accepts authenticated `im.message.receive_v1` p2p text events, `im.chat.access_event.bot_p2p_chat_entered_v1` events with a valid chat ID, and `card.action.trigger` callbacks normalized by the official SDK. Authenticated but unregistered group lifecycle events are acknowledged and ignored.

Every bot-authored business output is an `interactive` Card 2.0 message: chat entry, all eight Chinese/English/bilingual menu commands, unknown-input fallback, query views and operation results. Navigation actions acknowledge within the callback deadline and schedule a new card with Next.js `after()`; `create_ticket`, `confirm_parts` and `submit_result` synchronously return a complete raw replacement card plus toast. Callback actions are restricted to a closed allowlist and the fixed demo case. The SDK client logs at fatal-only level so upstream response objects are not emitted by default.

The bot remains deterministic and stateless. Every business result is explicitly simulated. It does not call an LLM, retrieve a knowledge base, read IoT data, create a real work order, or persist message text, user identifiers, tokens or event IDs. Card-local completed state is not shared with later menu messages. The chat-entry event sends the workbench on every entry because there is no durable welcome deduplication; persistence is required before real service operations.

The stable public callback, matching server secrets and URL Verification are complete. Production activation of this card-workbench revision still requires deploying the branch, adding `card.action.trigger` under the developer console's separate callback configuration with `https://onecare.ohmyfeishu.top/api/feishu/events`, publishing the corresponding application version, confirming the availability scope, and acceptance testing chat entry, all menu cards and every button with a real enterprise member on Feishu 7.20 or newer. A Vercel Preview protected by Deployment Protection cannot be configured as the live callback.

## VOC War Room

A high-severity VOC record (this pass's freshly computed severity, not the record's previously stored one — see `app/api/voc/analyze/route.ts`'s `escalateToWarRoom` and its `EscalationRecord` type, which excludes every AI-derived column precisely so this distinction cannot be typo'd away again) triggers an escalation card to every 兜底 (fallback) owner over the existing single-chat outbound path. Two card actions, `voc_open_war_room` and `voc_decline_war_room` (added to `VOC_CARD_ACTIONS` in `src/features/feishu-bot/card-types.ts`), carry the approve/decline decision. Design: `docs/superpowers/specs/2026-08-12-onecare-voc-warroom-design.md`.

- `src/features/warroom/naming.ts`: `warRoomName` (group naming), `warRoomDecision`/`DECLINED_MARKER` (the three-state `协同群 ID` column: empty / `oc_*` / the literal `declined`).
- `src/features/warroom/facts.ts`: `stripMention` (strips Feishu's literal `@_user_n` placeholder text ahead of the real question), `computeFactsAggregates` (same-dimension-last-7-days and same-model counts), `buildAnswerFacts` (serializes the ticket plus those aggregates to one JSON string, because aily custom skill parameters are String/Boolean/Float/Integer only — no array, no object).
- `src/features/feishu-bot/chat-client.ts`: `createWarRoomChat` (`POST im/v1/chats`), `listChatMessages` (`GET im/v1/messages`; every failure mode — network error, non-zero code, an empty group, an unparseable item — folds to an empty array rather than throwing, because a summary failure must never be able to block an already-landed closure), `createBotOpenIdProvider` (`GET bot/v3/info`, cached for the process lifetime, used to tell "this message actually `@`s the bot" apart from "the bot merely overheard it," since this app holds the sensitive 获取群组中所有消息 grant and receives every group message whether addressed or not).
- `src/features/feishu-bot/war-room-actions.ts`: `resolveWarRoomAction`, the approval/creation logic — record lookup, "owner or fallback" authorization (looser than the four state actions' owner-only rule, because approving an escalation is the fallback owner's job), and idempotence over the three-state column all run synchronously and return a `WarRoomActionOutcome` (`{ result, background? }`) rather than a bare `CardActionResult`: `result` is always the card-callback response, `background` is present only for a fresh "create" decision and packages group creation, the `协同群 ID` write, and the opening ticket card send as one deferred task (`createWarRoomInBackground`) — see the dispatch bullet below for why. A background failure DMs the operator via the injected `notifyOperator` instead of returning a toast, since the callback has already answered by the time it runs. Fully unit-tested in `war-room-actions.test.ts`, including that the four already-decided outcomes (missing record, unauthorized, exists, declined) never produce a `background`; called from `createResolveAction` in `app/api/feishu/events/route.ts`.
- `src/features/bitable/client.ts`: `findByWarRoomChatId`, a `POST records/search` exact-match lookup added specifically so the in-group Q&A handler can resolve "which ticket does this group belong to" in one bounded request instead of a `listRecords` full-table scan (the live table holds 3,628+ rows).
- `src/features/tagging/answer-provider.ts`: `createAnswerProvider`, a second aily skill call (`FEISHU_AILY_SKILL_ANSWER`) shaped like the tagging provider's skill-start call — same URL pattern, same doubly-encoded `input`, same `unwrapSkillOutput()` envelope handling — but returning prose for a human instead of a JSON tag payload for `parseTagPayload`. Every failure mode (timeout, non-`success` status, empty answer) collapses to `null`, never a thrown error and never an invented answer.
- `app/api/feishu/events/route.ts`: `createAnswerGroupQuestion` (wired into the `group_question` outcome that `event-handler.ts`'s `parseFeishuEvent` now emits for group text that actually mentions the bot), the closure-archival branch of `resolveVocCardAction`'s dispatch (`readTranscript`/`summarise` injected as `readWarRoomTranscript`/`summariseClosure`), and `createResolveAction`'s own routing of `voc_open_war_room`/`voc_decline_war_room` to `resolveWarRoomAction` (`fallbackOpenIds`/`createChat`/`sendToChat`/`notifyOperator` injected as `getFallbackOpenIds`, `createWarRoomChatForRecord`, `sendCardToWarRoomChat`, `notifyOperatorByDirectMessage`) are all live in `defaultDependencies` — every path in this bullet list runs in production.

**Dispatch, wired, synchronous section only through the idempotence decision**: `createResolveAction` in `app/api/feishu/events/route.ts` checks `voc_open_war_room`/`voc_decline_war_room` first and routes them to `resolveWarRoomAction`, before either action would otherwise reach `resolveVocCardAction` (`src/features/feishu-bot/card-actions.ts`) — the strict owner-only authorization and the missing `ACTION_TO_TRANSITION` entry there (still a `Partial`, still falling through to the inert `该操作暂不支持` toast for anything undefined) now only apply to the four state transitions, which is exactly what they were always meant to gate. `resolveWarRoomAction`'s own "owner or fallback" authorization is not re-implemented at the dispatch site; it runs exactly once, inside that function. `getFallbackOpenIds` reuses `app/api/voc/analyze/route.ts`'s own `listOwnerRules`/`fallbackOwnerOpenIds` rather than re-reading 负责人表 a second way.

A real click today does create a Feishu group, write `协同群 ID`, and post the ticket card into it, but not all inside the callback's own synchronous response. A 2026-08-12 real-tenant measurement (cross-border) put the full five-call chain — `getRecord` (651ms), `fallbackOpenIds` (742ms), `createChat` (195ms — a fast parameter-validation reject, not a real group create), `updateRecord` (753ms), `sendToChat` (384ms) — at ~2725ms against Feishu's ~3000ms card-callback deadline, with the two fastest numbers being the least representative of the real (slower) calls they stand in for. A timeout there is worse than merely slow: Feishu marks the callback failed while the group and the `协同群 ID` write have already landed, so the very next click reports "already exists" and the operator reasonably concludes their original click did nothing. `createResolveAction` therefore only awaits `resolveWarRoomAction`'s synchronous section (`getRecord` + `fallbackOpenIds`, ~1.4s measured, plus the idempotence/authorization decisions and, for a decline, its own write) before answering the callback; for a fresh "create" decision it answers with an interim toast and schedules `createWarRoomInBackground` (group creation, the `协同群 ID` write, the card post) with Next's `after()` — the same primitive already used elsewhere in this file for deferred work. A background-step failure DMs the operator directly (`notifyOperator`, the `openId` branch of `sendFeishuMessage`) with the same wording the old synchronous toasts used, since the toast channel has already been spent. Spec §12 acceptance items 2–5 pass, and the in-group Q&A / closure-archival paths above can now also be exercised end to end from a real approval click, not only against a `协同群 ID` written by hand.

**Two credentials, one aily app**: the aily skill-start API resolves which aily application a call belongs to from the calling credential, not the `app_id` in the URL path. `FEISHU_AILY_BOT_APP_ID`/`FEISHU_AILY_BOT_APP_SECRET` (`src/lib/env.ts`) hold the aily-published bot application's own credential, for tenants where that credential differs from the main Feishu app's; a real, published aily app id called with the main app's credential returns `2320008`. The two env vars must be set together or neither — enforced at env-read time, so a half-configured pair fails loudly instead of silently falling back and reappearing later as an opaque `2320008`.

**Verified but unauthorized**: `contact/v3/users/batch_get_id`, `/scopes`, and `/find_by_department` all returned `99991672` on this tenant on 2026-08-12. No code path resolves a display name from the Contact API; Bitable's own person-field payload already carries `name` alongside `id` (`src/features/bitable/field-map.ts`'s `personNames`), which is what `escalateToWarRoom`'s owner-name field and the rest of the owner-routing code already read.

## Testing Baseline

- Vitest covers environment validation, OAuth state, signed sessions, Feishu OAuth adapters, deterministic bot scripts, event verification, SDK reply adapters, and Route Handlers.
- Vitest also covers the VOC closed loop as pure functions injected with fake fetchers: content redaction, the service-event state machine (exhaustive legal/illegal transitions, idempotency, the retry ceiling), triage, metrics aggregation, the shared tagging-result contract, both tagging providers, the Bitable client and its schema guard, owner-rule resolution, and the analyze/dashboard Route Handlers.
- Vitest also covers the war room as pure functions and injected fakes: group naming and the three-state idempotence decision, `@`-mention stripping, fact/aggregate assembly, the escalation card's two-action triple check (including the owner-or-fallback relaxation), war-room chat creation and transcript reads, both aily answer-skill outcomes (answer vs. every failure mode collapsing to "cannot answer"), closure archival writing its state before attempting a summary, and — over the real `createResolveAction`, not a stub standing in for it — that `voc_open_war_room`/`voc_decline_war_room` reach `resolveWarRoomAction` while the four state actions keep reaching `resolveVocCardAction`, including the case that matters most: a fallback owner who is not a ticket owner can open the war room but is still rejected by the same ticket's state actions. It also covers the synchronous/background split directly: that a "create" decision returns its interim toast without having called `createChat`/`updateRecord`/`sendToChat` yet, that those three calls only happen once the returned `background` task is actually run, that the four already-decided outcomes (missing record, unauthorized, exists, declined) never produce a `background` at all — neither from `resolveWarRoomAction` itself nor through the full route — and that each of the three background failure modes DMs the operator via `notifyOperator` with wording naming which step failed. No test exercises a real Feishu tenant creating a chat — that boundary is always a fake fetcher, by design (see the project's "never create a real group" testing discipline).
- A separate built-runtime Vitest suite starts the output of `next build` with `next start` and exercises authentication routes, login redirects, and the Feishu URL Verification challenge across the real Next.js production boundary.
- React Testing Library covers the landing page, guided login page, reusable Feishu role banner, and role-workspace presentation contracts.
- External Feishu calls are injected in tests and never reach the network.
- Production behavior is implemented test-first.
- A production build, dependency audit, secret scan, and live deployment smoke test are required before release.

Playwright browser checks cover the public experience page and role-entry layout at desktop and mobile widths. A persistent non-personal enterprise identity is still required to automate the real OAuth and bot-conversation path; those external acceptance checks remain manual.

## Deferred Decisions

- queue and background-job implementation;
- PostgreSQL hosting and migration workflow;
- AI model and orchestration provider for free-text customer service and predictive diagnosis (VOC tagging itself now runs on a Feishu aily skill or a Bitable AI field shortcut; see the VOC closed loop note above);
- IoT, customer-service, work-order, parts, and follow-up data sources;
- analytics and visualization libraries;
- store-app ISV and marketplace path;
- final multi-service deployment topology;
- SLA nudging, reply rewriting, a similar-tickets panel, a second bot sharing one war-room group, and automated group dissolution/archival — all explicitly out of scope for the war room, not planned follow-ups.

Each deferred item requires a focused specification before implementation.

## Official References

- [Feishu browser authorization guide](https://open.feishu.cn/document/sso/web-application-end-user-consent/guide?lang=zh-CN)
- [Feishu authorization code](https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code?lang=zh-CN)
- [Feishu user access token v3](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3)
- [Feishu user information](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/user_info/get)
- [Feishu custom and store application differences](https://open.feishu.cn/document/server-docs/im-v1/faq?lang=zh-CN)
- [Feishu event callback optimization](https://open.feishu.cn/document/event-subscription-guide/event-subscriptions/event-callback-optimization-guide?lang=zh-CN)
- [Feishu Card 2.0 overview](https://open.feishu.cn/document/feishu-cards/feishu-card-overview)
- [Feishu card callback communication](https://open.feishu.cn/document/feishu-cards/card-callback-communication?lang=zh-CN)
- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js Cookie API](https://nextjs.org/docs/app/api-reference/functions/cookies)
- [Vercel CLI deployment](https://vercel.com/docs/cli/deploy)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Node.js releases](https://nodejs.org/en/about/previous-releases)
