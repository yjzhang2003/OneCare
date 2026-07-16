# Auto Insight Repository Governance and Tech Stack Design

## Status

Approved documentation design. The documentation implementation was completed on 2026-07-16; application implementation has not started.

## Objective

Establish a lightweight repository operating guide and a documented TypeScript technology baseline before application development begins.

This change produces documentation only. It does not scaffold the website, connect data sources, implement Feishu authentication, or implement the Feishu agent.

## Product Context

Auto Insight will eventually be deployed for one enterprise, but the demonstration must support users from multiple Feishu enterprises using the same website and the same Auto Insight bot.

The future product shape is:

- users sign in to the website with Feishu;
- authenticated users operate Auto Insight through the website;
- enterprises install and use one shared Auto Insight Feishu application;
- the website and Feishu bot share tenant-aware product services;
- automotive insight data and AI model integration are intentionally deferred.

## Repository Baseline

- Hosting: GitHub.
- Remote: `https://github.com/yjzhang2003/Auto-Insight.git`.
- Default branch: `main`.
- Current content: a single product challenge brief in `README.md`.
- Current code, tests, deployment configuration, and package manifests: none.

## Deliverables

### Root `AGENTS.md`

Create a concise operating guide adapted from the referenced `software_evaluate/AGENTS.md` without copying Gitee-, Python-, deployment-, or legacy-project-specific rules.

It will define:

- the product and repository baseline;
- required reading before non-trivial changes;
- when a written specification is required;
- test-first implementation expectations once code exists;
- GitHub and Git safety boundaries;
- Feishu authentication and multi-tenant red lines;
- a controlled harness reflection loop;
- completion and reporting requirements.

The document must remain short enough to be read at the start of every agent task.

### `docs/TECH_STACK.md`

Record the selected technology stack, its rationale, the Feishu constraints that shaped it, deployment boundaries, and deferred choices.

The document will distinguish current decisions from future implementation work so that architecture notes are not mistaken for completed functionality.

### `docs/HARNESS_REFLECTIONS.md`

Create a small, append-only reflection log and template for durable repository workflow improvements.

Each entry must include:

- observed evidence;
- the workflow problem;
- the proposed or applied `AGENTS.md` change;
- expected benefit;
- rollback condition.

## Selected Technology Architecture

### Runtime and Language

- TypeScript across the web application, server routes, Feishu integration, tests, and future workers.
- Node.js 24 LTS as the production baseline.
- Python is explicitly excluded from this repository architecture.

Node.js 24 is LTS as of 2026-07-16, while Node.js 26 is still Current. Production applications should use an LTS release according to the Node.js release policy.

### Web Application

- Next.js App Router.
- React Server Components by default.
- Client Components only for interactive views.
- Route Handlers for Feishu OAuth callbacks and HTTP event endpoints.
- A single TypeScript repository rather than separate frontend and backend frameworks.

This keeps the initial repository compact while preserving clear boundaries between UI, application services, Feishu adapters, and persistence.

### Persistence

- PostgreSQL as the system of record.
- Drizzle ORM for TypeScript schema definition, queries, and migrations.
- Every tenant-owned record must carry an internal tenant identifier mapped from Feishu `tenant_key`.
- Tenant filtering must be enforced in service and repository boundaries from the first multi-tenant table.

Database schema implementation and hosting provider selection are deferred until the application scaffold is approved.

### Feishu Login

- OAuth authorization-code flow.
- Authorization endpoint: `https://accounts.feishu.cn/open-apis/authen/v1/authorize`.
- Token endpoint: `https://accounts.feishu.cn/oauth/v3/token`.
- The callback validates a server-generated, single-use `state` value before exchanging the code.
- App secrets and Feishu access tokens remain server-side.
- The application creates its own secure website session after retrieving Feishu user information.
- User identity is based on stable Feishu identifiers, not email or mobile number.

### Shared Multi-Enterprise Feishu Agent

- The target integration is one Feishu store application installed by multiple enterprises.
- The App ID is shared; each tenant is distinguished by `tenant_key` and tenant-specific access tokens.
- The agent is not created independently for each website user.
- Feishu's one-click agent-app creation SDK is not part of the product flow because it creates or updates separate applications.

### Event Delivery

- Store applications receive Feishu events through a public HTTP endpoint.
- WebSocket long connections are not used because Feishu restricts that mode to custom applications.
- The event endpoint verifies the request, deduplicates by event identity, persists or queues accepted work, and returns within Feishu's three-second window.
- AI work and other slow processing run asynchronously after acknowledgement.

The initial documentation change will describe this boundary but will not select or install a queue. A queue is chosen only when bot processing is implemented and its workload is known.

## Alternatives Considered

### Next.js plus NestJS

Rejected for the current phase because separate frontend and backend frameworks add modules, transport contracts, build configuration, and deployment units before the product requires them.

### React plus FastAPI

Rejected because the repository must use TypeScript only. It would also create two language toolchains and weaken reuse of Feishu Node SDK types.

### One Feishu Custom App per Enterprise

Rejected for the demonstration because the requirement is one shared bot across multiple enterprises. A custom app is appropriate for the later single-enterprise deployment but is not the multi-enterprise target model.

## Harness Reflection Rules

The harness may update `AGENTS.md` after completing a task only when the improvement is durable, repository-specific, supported by concrete evidence, and useful beyond the current task.

The harness must not use self-modification to:

- weaken security, testing, tenant isolation, or user-authorization requirements;
- broaden the user's requested scope;
- change product requirements;
- justify an action already taken contrary to current instructions;
- copy machine-specific or unrelated repository rules into this project.

Every applied change must be recorded in `docs/HARNESS_REFLECTIONS.md`, included in the Git diff, and reported in the task summary. A rule that causes repeated friction without measurable benefit must be reverted or narrowed using the same reflection process.

## Error and Security Boundaries

- OAuth callbacks reject missing, expired, reused, or mismatched `state`.
- Feishu credentials never enter client-rendered code or logs.
- Tenant context is derived from validated Feishu identity or installation data, never from an unchecked client parameter.
- Event handlers acknowledge only verified events and process duplicates idempotently.
- Multi-tenant data must default to no access when tenant context is absent.
- Documentation must not claim unfinished integrations are working.

## Testing Strategy for Future Implementation

- Vitest for TypeScript unit and integration tests.
- React Testing Library for interactive component behavior.
- Playwright for the critical browser login and tenant-isolation flows once real pages exist.
- Contract fixtures for Feishu OAuth callbacks and event payloads.
- Tests are written and observed failing before production behavior is added.
- External Feishu calls are isolated behind adapters so core behavior can be tested deterministically.

No test framework will be installed by this documentation-only change.

## Official References

- [Feishu browser web application authorization guide](https://open.feishu.cn/document/sso/web-application-end-user-consent/guide?lang=zh-CN)
- [Feishu authorization code endpoint](https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code?lang=zh-CN)
- [Feishu user access token v3](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3)
- [Feishu user information endpoint](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/user_info/get)
- [Feishu custom app and store app differences](https://open.feishu.cn/document/server-docs/im-v1/faq?lang=zh-CN)
- [Feishu long-connection restrictions](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case)
- [Feishu event callback optimization](https://open.feishu.cn/document/event-subscription-guide/event-subscriptions/event-callback-optimization-guide?lang=zh-CN)
- [Feishu one-click agent application overview](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview)
- [Next.js App Router documentation](https://nextjs.org/docs/app/getting-started)
- [Node.js release status](https://nodejs.org/en/about/previous-releases)

## Acceptance Criteria

The later documentation implementation is complete when:

- root `AGENTS.md` accurately describes GitHub `main`, states the TypeScript-only boundary, and contains no Gitee- or Python-toolchain-specific instructions;
- the repository explicitly selects the TypeScript modular-monolith approach;
- `docs/TECH_STACK.md` documents OAuth v3, store-app multi-tenancy, HTTP callbacks, and the future single-enterprise path;
- `docs/HARNESS_REFLECTIONS.md` defines an auditable self-improvement loop;
- no application code, dependency manifests, data-source integrations, or AI integrations are added;
- all links and local document references are valid;
- Git status shows only the intended documentation files.
