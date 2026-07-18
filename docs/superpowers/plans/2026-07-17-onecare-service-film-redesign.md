# OneCare Service Film Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose the OneCare homepage as a continuous service-signal story with restrained Chinese typography, four connected perspective scenes, one five-layer blueprint, a concise outcome section, and editorial team credits.

**Architecture:** Keep `LandingContent` as the server-friendly composition root and keep all showcase copy in the typed `content.ts` module. Replace the homepage-only `RoleCard` and `SignalFlow` components with focused `JourneyScene`, `ServiceBlueprint`, and `OutcomeStatement` components, then scope all new styling to `.landing-shell` so `/dashboard` and Feishu authentication remain unchanged.

**Tech Stack:** Node.js 24, Next.js 16 App Router, React 19, TypeScript 5.9, CSS, Vitest, React Testing Library, Vercel Preview.

## Global Constraints

- Implement only `/`; do not add `/experience/*` routes or links.
- Preserve `/api/auth/feishu/start`, `/dashboard`, OAuth cookies, sessions, Route Handlers, and all environment configuration.
- Do not add a UI framework, animation library, WebGL, image dependency, client state, AI SDK, analytics SDK, or database.
- Keep OneCare in the wordmark, metadata, repository, and URL; page copy may mention 海信.
- Keep the existing landing palette `#0B0D0C`, `#F5F7F5`, `#00A4A0`, `#DDF3F1`, and `#626A67`.
- Hero title: `clamp(48px, 5vw, 72px)` on desktop and at most `48px` on mobile.
- Section title: `clamp(34px, 4vw, 52px)`; perspective value: `clamp(22px, 2.4vw, 32px)`; body copy: at least `16px` with line-height at least `1.6`.
- Do not render four equal role cards, five equal architecture cards, three equal team cards, capsule capability tags, or placeholder portrait boxes.
- Keep business claims labeled as a prototype or goal; do not invent production metrics, identities, or integrations.
- Honor `prefers-reduced-motion`, preserve semantic reading order, and keep all critical content visible without hover, animation, or sticky positioning.
- After local verification, create a non-Production Vercel Preview and a time-limited shareable link; do not change Production, secrets, Feishu callbacks, GitHub PRs, or `main`.

---

## File Map

- `app/landing-content.test.tsx`: locks the new story structure, copy, auth links, and absence of retired card patterns.
- `app/landing-content.tsx`: composes the hero, journey, blueprint, outcomes, team credits, and existing authentication states.
- `app/globals.css`: provides the landing-scoped editorial layout, signal visuals, responsive fallbacks, and reduced-motion behavior.
- `src/features/showcase/content.ts`: owns readonly perspective scene copy, service layers, scenario events, outcome goals, and team data.
- `src/features/showcase/components/journey-scene.tsx`: renders one semantic perspective scene and its signal handoff.
- `src/features/showcase/components/service-blueprint.tsx`: renders the ordered five-layer service blueprint and scenario event annotations.
- `src/features/showcase/components/outcome-statement.tsx`: renders the three non-numeric scheme goals.
- `src/features/showcase/components/site-header.tsx`: updates the public navigation to the new chapter anchors.
- `src/features/showcase/components/site-footer.tsx`: updates footer anchors and retains the prototype boundary.
- `src/features/showcase/components/role-card.tsx`: removed after its only caller is replaced.
- `src/features/showcase/components/signal-flow.tsx`: removed after its only caller is replaced.
- `README.md`: records the service-film homepage presentation and Preview-only boundary.

### Task 1: Lock the continuous-story presentation contract

**Files:**
- Modify: `app/landing-content.test.tsx`

**Interfaces:**
- Consumes: `LandingContent({ user, authError })`.
- Produces: a failing contract for the new navigation, four journey scenes, blueprint, outcomes, team credits, and removed card classes.

- [x] **Step 1: Replace the first homepage test with the new contract**

Keep the signed-in and authentication-error tests unchanged. Replace only `presents the multi-page service story without dead perspective links` with:

```tsx
it("presents one continuous service journey without card-wall patterns", () => {
  const { container } = render(<LandingContent user={null} />);

  expect(
    screen.getByRole("heading", {
      name: "让每一次服务，都比问题更早一步",
    }),
  ).toBeInTheDocument();

  expect(screen.getByRole("link", { name: "服务旅程" })).toHaveAttribute(
    "href",
    "#journey",
  );
  expect(screen.getByRole("link", { name: "五层引擎" })).toHaveAttribute(
    "href",
    "#architecture",
  );
  expect(screen.getByRole("link", { name: "团队" })).toHaveAttribute(
    "href",
    "#team",
  );

  [
    "冰箱好像不太冷了",
    "一次理解，不再重复描述",
    "一次带对",
    "一次解决，持续学习",
  ].forEach((statement) => {
    expect(screen.getByText(statement)).toBeInTheDocument();
  });

  expect(
    screen.getByRole("list", { name: "OneCare 五层服务蓝图" }),
  ).toBeInTheDocument();
  ["感知", "诊断", "编排", "服务", "学习"].forEach((name) => {
    expect(screen.getByRole("heading", { name })).toBeInTheDocument();
  });

  ["更短服务周期", "更低重复上门", "更高用户满意"].forEach(
    (outcome) => {
      expect(screen.getByText(outcome)).toBeInTheDocument();
    },
  );

  expect(screen.getByText("成员 01")).toBeInTheDocument();
  expect(screen.getByText("成员 02")).toBeInTheDocument();
  expect(screen.getByText("成员 03")).toBeInTheDocument();
  expect(screen.getByText(/成员信息待补充/)).toBeInTheDocument();

  expect(screen.getByRole("link", { name: "使用飞书登录" })).toHaveAttribute(
    "href",
    "/api/auth/feishu/start",
  );
  expect(
    screen.getByText(/尚未接入真实业务数据或 AI 服务/),
  ).toBeInTheDocument();
  expect(container.querySelector('a[href^="/experience/"]')).toBeNull();
  expect(
    container.querySelector(".role-card, .signal-flow, .team-card"),
  ).toBeNull();
});
```

- [x] **Step 2: Run the targeted test and verify RED**

Run:

```bash
npm test -- app/landing-content.test.tsx
```

Expected: FAIL because `服务旅程`, `冰箱好像不太冷了`, the accessible blueprint list, and the new outcome copy are absent; the existing `.role-card`, `.signal-flow`, and `.team-card` elements are still present.

- [x] **Step 3: Commit the verified failing contract**

```bash
git add app/landing-content.test.tsx
git commit -m "test: define OneCare service film story"
```

### Task 2: Replace card components with journey and blueprint components

**Files:**
- Modify: `src/features/showcase/content.ts`
- Create: `src/features/showcase/components/journey-scene.tsx`
- Create: `src/features/showcase/components/service-blueprint.tsx`
- Create: `src/features/showcase/components/outcome-statement.tsx`
- Modify: `src/features/showcase/components/site-header.tsx`
- Modify: `src/features/showcase/components/site-footer.tsx`
- Modify: `app/landing-content.tsx`
- Delete: `src/features/showcase/components/role-card.tsx`
- Delete: `src/features/showcase/components/signal-flow.tsx`

**Interfaces:**
- Produces: `Perspective.sceneLine`, `Perspective.handoff`, `outcomes`, `JourneyScene({ perspective })`, `ServiceBlueprint({ layers, events })`, and `OutcomeStatement({ outcomes })`.
- Consumes: existing `Perspective.value`, `Perspective.capabilities`, `ServiceLayer`, `ScenarioStep`, `TeamMember`, `AuthUser`, and unchanged authentication URLs.

- [x] **Step 1: Extend the readonly content model and exact copy**

Add two properties to `Perspective`:

```ts
export type Perspective = Readonly<{
  index: string;
  title: string;
  value: string;
  sceneLine: string;
  handoff: string;
  capabilities: readonly string[];
}>;
```

Update the four existing entries without changing their existing `index`, `title`, `value`, or `capabilities`:

```ts
sceneLine: "冰箱好像不太冷了",
handoff: "设备异常 → 主动提醒",

sceneLine: "一次理解，不再重复描述",
handoff: "用户声音 → 服务上下文",

sceneLine: "一次带对",
handoff: "预诊建议 → 配件与上门计划",

sceneLine: "一次解决，持续学习",
handoff: "服务结果 → VOC 改善",
```

Add the outcome type and data after `ScenarioStep`:

```ts
export type Outcome = Readonly<{
  emphasis: string;
  label: string;
}>;

export const outcomes: readonly Outcome[] = [
  { emphasis: "更短", label: "服务周期" },
  { emphasis: "更低", label: "重复上门" },
  { emphasis: "更高", label: "用户满意" },
] as const;
```

- [x] **Step 2: Create `JourneyScene`**

Create `src/features/showcase/components/journey-scene.tsx`:

```tsx
import type { Perspective } from "../content";

export function JourneyScene({ perspective }: { perspective: Perspective }) {
  return (
    <article className={`journey-scene journey-scene--${perspective.index}`}>
      <div className="journey-scene__rail" aria-hidden="true">
        <span>{perspective.index}</span>
        <i />
      </div>
      <div className="journey-scene__copy">
        <p>{perspective.title}</p>
        <h3>{perspective.sceneLine}</h3>
        <p className="journey-scene__value">{perspective.value}</p>
      </div>
      <div className="journey-scene__evidence">
        <p>{perspective.handoff}</p>
        <ul aria-label={`${perspective.title}关键能力`}>
          {perspective.capabilities.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}
```

- [x] **Step 3: Create `ServiceBlueprint`**

Create `src/features/showcase/components/service-blueprint.tsx`:

```tsx
import type { ScenarioStep, ServiceLayer } from "../content";

type ServiceBlueprintProps = {
  layers: readonly ServiceLayer[];
  events: readonly ScenarioStep[];
};

export function ServiceBlueprint({ layers, events }: ServiceBlueprintProps) {
  return (
    <div className="blueprint-wrap">
      <ol className="service-blueprint" aria-label="OneCare 五层服务蓝图">
        {layers.map((layer, index) => (
          <li className="blueprint-layer" key={layer.index}>
            <div className="blueprint-layer__node" aria-hidden="true">
              <span>{layer.index}</span>
              <i />
            </div>
            <div className="blueprint-layer__heading">
              <small>{layer.english}</small>
              <h3>{layer.title}</h3>
            </div>
            <p className="blueprint-layer__event">{events[index]?.title}</p>
            <dl>
              <div>
                <dt>输入</dt>
                <dd>{layer.input}</dd>
              </div>
              <div>
                <dt>系统动作</dt>
                <dd>{layer.action}</dd>
              </div>
              <div>
                <dt>输出</dt>
                <dd>{layer.output}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
      <p className="blueprint-loop">学习结果回到感知，让下一次服务更早一步。</p>
    </div>
  );
}
```

- [x] **Step 4: Create `OutcomeStatement`**

Create `src/features/showcase/components/outcome-statement.tsx`:

```tsx
import type { Outcome } from "../content";

export function OutcomeStatement({
  outcomes,
}: {
  outcomes: readonly Outcome[];
}) {
  return (
    <div className="outcome-statement">
      {outcomes.map((outcome) => (
        <p key={outcome.label}>
          <strong>{outcome.emphasis}</strong>
          <span>{outcome.label}</span>
          <span className="sr-only">{`${outcome.emphasis}${outcome.label}`}</span>
        </p>
      ))}
    </div>
  );
}
```

If the existing stylesheet does not already contain `.sr-only`, add this utility in Task 3. The visually hidden full phrase makes the exact outcome accessible while the visible layout keeps emphasis and label separate.

- [x] **Step 5: Update public navigation and footer anchors**

Replace `navigation` in `site-header.tsx` with:

```ts
const navigation = [
  { href: "#journey", label: "服务旅程" },
  { href: "#architecture", label: "五层引擎" },
  { href: "#team", label: "团队" },
] as const;
```

Replace the footer nav children with:

```tsx
<a href="#journey">返回服务旅程</a>
<a href="#architecture">返回五层引擎</a>
<a href="#team">返回团队</a>
```

- [x] **Step 6: Recompose `LandingContent`**

Remove imports for `RoleCard` and `SignalFlow`; import `outcomes`, `JourneyScene`, `ServiceBlueprint`, and `OutcomeStatement`. Keep `errorMessages`, `LandingContentProps`, `errorMessage`, `workspaceHref`, the auth notice, and the exact login/workspace behavior unchanged.

Replace the content inside `<main>` with this structure:

```tsx
<section className="hero hero--service-film">
  <div className="hero-film__signal" aria-hidden="true">
    <span>−18°</span>
    <i />
    <span>04°</span>
  </div>
  <div className="hero-film__copy">
    <p className="eyebrow">ONECARE / SERVICE SIGNAL 001</p>
    <h1>
      <span>让每一次服务，</span>
      <span>都比问题更早一步</span>
    </h1>
    <p className="hero-intro">
      OneCare 面向海信智能家庭场景，把用户声音、设备信号与服务协同
      串成一条有感知、有判断、有行动、会学习的服务闭环。
    </p>
    <div className="hero-actions">
      <a className="primary-action" href="#journey">
        <span>跟随服务信号</span>
        <span className="action-arrow" aria-hidden="true">↓</span>
      </a>
      <a className="secondary-action" href={workspaceHref}>
        {user ? "进入工作台" : "使用飞书登录"}
        <span aria-hidden="true">↗</span>
      </a>
    </div>
    <p className="session-copy">
      {user ? `${user.name}，欢迎回来` : "方案原型 · 未接入真实业务数据"}
    </p>
  </div>
  <div className="hero-film__case" aria-hidden="true">
    <span>异常信号</span>
    <strong>冰箱温控异常</strong>
    <i />
  </div>
</section>

<section className="service-journey" id="journey" aria-labelledby="journey-title">
  <div className="journey-intro">
    <p>01 / FOUR PERSPECTIVES</p>
    <h2 id="journey-title">同一个问题，在四个角色之间连续流动</h2>
    <p>用户不必重复描述，服务上下文沿同一条信号链持续传递。</p>
  </div>
  <div className="journey-scenes">
    {perspectives.map((perspective) => (
      <JourneyScene key={perspective.index} perspective={perspective} />
    ))}
  </div>
</section>

<SectionFrame
  id="architecture"
  index="02"
  eyebrow="FIVE-LAYER ENGINE"
  title="感知—诊断—编排—服务—学习"
  intro="一次服务不是五个孤立模块，而是一条从问题信号到持续改善的闭环蓝图。"
  tone="dark"
>
  <ServiceBlueprint layers={serviceLayers} events={scenarioSteps} />
</SectionFrame>

<section className="outcome-section" aria-labelledby="outcome-title">
  <div>
    <p>03 / OUTCOME</p>
    <h2 id="outcome-title">一次就好</h2>
    <p>以下是 OneCare 的方案目标，不代表已经实现的生产指标。</p>
  </div>
  <OutcomeStatement outcomes={outcomes} />
  <p className="outcome-loop">本次解决 → 知识沉淀 → 下一次更早发现</p>
</section>

<SectionFrame
  id="team"
  index="04"
  eyebrow="TEAM CREDITS"
  title="三种能力，共同完成服务创新"
  intro="成员信息待补充；当前只展示参赛团队的能力互补关系。"
>
  <div className="team-credits">
    {teamMembers.map((member) => (
      <article className="team-credit" key={member.index}>
        <span>成员 {member.index}</span>
        <h3>{member.title}</h3>
        <p>{member.capabilities.join(" / ")}</p>
      </article>
    ))}
  </div>
</SectionFrame>
```

- [x] **Step 7: Remove retired components and run the targeted test**

Delete `role-card.tsx` and `signal-flow.tsx`, then run:

```bash
npm test -- app/landing-content.test.tsx
```

Expected: PASS for all tests in `app/landing-content.test.tsx`.

- [x] **Step 8: Commit the semantic redesign**

```bash
git add app/landing-content.tsx app/landing-content.test.tsx src/features/showcase
git commit -m "feat: turn OneCare homepage into a service journey"
```

### Task 3: Apply restrained editorial layout and signal motion

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: the classes from Task 2.
- Produces: a card-free desktop narrative, single-column mobile fallback, static reduced-motion view, and unchanged dashboard styling.

- [x] **Step 1: Add the accessibility utility and restrain shared landing headings**

Add near the global element rules:

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

Change landing section typography to:

```css
.section-frame__heading h2 {
  max-width: 860px;
  margin: 0;
  font-family: "Songti SC", "STSong", "Noto Serif CJK SC", serif;
  font-size: clamp(34px, 4vw, 52px);
  font-weight: 700;
  letter-spacing: -0.045em;
  line-height: 1.12;
  text-wrap: balance;
}

.section-frame__intro {
  max-width: 680px;
  margin: 24px 0 0;
  color: var(--muted);
  font-size: 16px;
  line-height: 1.75;
}
```

- [x] **Step 2: Replace the old landing hero and card-layout rules**

Remove landing-only rules for `.hero-copy > .status-tag`, `.role-grid`, `.role-card*`, `.signal-flow`, `.signal-layer*`, `#scenario`, `.scenario-*`, `.team-grid`, and `.team-card*`. Keep dashboard classes and shared auth/button/footer rules.

Add these required layout rules after `.secondary-action:hover`:

```css
.hero--service-film {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(300px, 0.7fr);
  min-height: min(760px, calc(100vh - 88px));
  overflow: hidden;
  background: var(--paper);
}

.hero-film__copy {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: clamp(72px, 9vw, 126px) clamp(28px, 6vw, 92px);
}

.hero--service-film h1 {
  max-width: 780px;
  margin: 0;
  font-family: "Songti SC", "STSong", "Noto Serif CJK SC", serif;
  font-size: clamp(48px, 5vw, 72px);
  font-weight: 700;
  letter-spacing: -0.055em;
  line-height: 1.08;
}

.hero--service-film h1 span {
  display: block;
}

.hero--service-film .hero-intro {
  font-size: 16px;
}

.hero-film__signal {
  position: absolute;
  z-index: 3;
  top: 32px;
  right: clamp(28px, 4vw, 64px);
  display: grid;
  grid-template-columns: auto minmax(90px, 13vw) auto;
  gap: 14px;
  align-items: center;
  color: var(--muted);
  font-size: 12px;
}

.hero-film__signal i,
.hero-film__case i {
  position: relative;
  display: block;
  height: 2px;
  overflow: hidden;
  background: color-mix(in srgb, var(--orange) 35%, transparent);
}

.hero-film__signal i::after,
.hero-film__case i::after {
  position: absolute;
  inset: 0 auto 0 0;
  width: 34%;
  background: var(--orange);
  content: "";
  animation: signal-sweep 3.8s ease-in-out infinite;
}

.hero-film__case {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 14px;
  padding: clamp(52px, 6vw, 88px) clamp(28px, 4vw, 64px);
  color: var(--paper);
  background:
    linear-gradient(rgba(245, 247, 245, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(245, 247, 245, 0.04) 1px, transparent 1px),
    var(--ink);
  background-size: 44px 44px;
}

.hero-film__case span {
  color: var(--orange);
  font-size: 12px;
}

.hero-film__case strong {
  max-width: 260px;
  font-family: "Songti SC", "STSong", serif;
  font-size: clamp(28px, 3vw, 42px);
  line-height: 1.2;
}

.service-journey {
  background: var(--paper);
  scroll-margin-top: 18px;
}

.journey-intro {
  display: grid;
  grid-template-columns: minmax(170px, 0.55fr) minmax(0, 1.45fr);
  gap: 36px;
  padding: clamp(72px, 9vw, 120px) clamp(22px, 4vw, 64px);
}

.journey-intro > p:first-child {
  margin: 8px 0 0;
  color: var(--orange);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.journey-intro h2 {
  max-width: 760px;
  margin: 0;
  font-family: "Songti SC", "STSong", serif;
  font-size: clamp(34px, 4vw, 52px);
  line-height: 1.12;
}

.journey-intro > p:last-child {
  grid-column: 2;
  max-width: 620px;
  margin: 18px 0 0;
  color: var(--muted);
  font-size: 16px;
  line-height: 1.75;
}

.journey-scene {
  position: relative;
  display: grid;
  grid-template-columns: 90px minmax(0, 1.2fr) minmax(260px, 0.8fr);
  gap: clamp(24px, 4vw, 64px);
  align-items: center;
  min-height: 72vh;
  padding: clamp(64px, 8vw, 112px) clamp(22px, 4vw, 64px);
  border-top: 1px solid var(--line);
}

.journey-scene--02,
.journey-scene--04 {
  color: var(--paper);
  background: var(--ink);
}

.journey-scene--03 {
  background: var(--paper-deep);
}

.journey-scene__rail {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: var(--orange);
}

.journey-scene__rail i {
  width: 2px;
  flex: 1;
  background: linear-gradient(var(--orange), transparent);
}

.journey-scene__copy > p:first-child,
.journey-scene__evidence > p {
  margin: 0;
  color: var(--orange);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.journey-scene h3 {
  max-width: 720px;
  margin: 18px 0 24px;
  font-family: "Songti SC", "STSong", serif;
  font-size: clamp(34px, 3.8vw, 48px);
  letter-spacing: -0.045em;
  line-height: 1.15;
}

.journey-scene__copy {
  position: sticky;
  top: 112px;
}

.journey-scene__value {
  max-width: 650px;
  margin: 0;
  color: var(--muted);
  font-size: clamp(22px, 2.4vw, 32px);
  line-height: 1.5;
}

.journey-scene--02 .journey-scene__value,
.journey-scene--04 .journey-scene__value {
  color: rgba(245, 247, 245, 0.68);
}

.journey-scene__evidence ul {
  margin: 28px 0 0;
  padding: 0;
  list-style: none;
}

.journey-scene__evidence li {
  padding: 14px 0;
  border-top: 1px solid currentColor;
  font-size: 16px;
}
```

- [x] **Step 3: Add blueprint, outcome, and team-credit rules**

Add:

```css
.blueprint-wrap {
  position: relative;
}

.service-blueprint {
  position: relative;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin: 0;
  padding: 44px 0 0;
  list-style: none;
}

.service-blueprint::before {
  position: absolute;
  top: 58px;
  right: 0;
  left: 0;
  height: 2px;
  background: rgba(245, 247, 245, 0.22);
  content: "";
}

.blueprint-layer {
  position: relative;
  padding: 0 clamp(14px, 2vw, 28px) 44px;
}

.blueprint-layer__node {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--orange);
  font-size: 12px;
}

.blueprint-layer__node i {
  width: 10px;
  height: 10px;
  background: var(--orange);
  border-radius: 50%;
  box-shadow: 0 0 0 7px rgba(0, 164, 160, 0.15);
}

.blueprint-layer__heading {
  margin-top: 54px;
}

.blueprint-layer__heading small {
  color: var(--orange);
  font-size: 11px;
  letter-spacing: 0.1em;
}

.blueprint-layer h3 {
  margin: 8px 0 0;
  font-family: "Songti SC", "STSong", serif;
  font-size: clamp(26px, 2.8vw, 38px);
}

.blueprint-layer__event {
  min-height: 52px;
  margin: 30px 0;
  color: var(--paper);
  font-size: 16px;
  line-height: 1.6;
}

.blueprint-layer dl,
.blueprint-layer dd {
  margin: 0;
}

.blueprint-layer dl {
  display: grid;
  gap: 18px;
}

.blueprint-layer dl div {
  padding-top: 12px;
  border-top: 1px solid rgba(245, 247, 245, 0.14);
}

.blueprint-layer dt {
  color: var(--orange);
  font-size: 12px;
}

.blueprint-layer dd {
  margin-top: 7px;
  color: rgba(245, 247, 245, 0.66);
  font-size: 14px;
  line-height: 1.65;
}

.blueprint-loop {
  margin: 0;
  padding: 24px 28px;
  color: var(--ink);
  background: var(--orange);
  font-size: 16px;
  font-weight: 700;
  text-align: center;
}

.outcome-section {
  padding: clamp(72px, 9vw, 120px) clamp(22px, 4vw, 64px);
  background: var(--paper-deep);
}

.outcome-section > div:first-child {
  max-width: 760px;
}

.outcome-section h2 {
  margin: 12px 0 20px;
  font-family: "Songti SC", "STSong", serif;
  font-size: clamp(34px, 4vw, 52px);
}

.outcome-section > div:first-child p {
  color: var(--muted);
  font-size: 16px;
  line-height: 1.7;
}

.outcome-statement {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin-top: 64px;
  border-top: 1px solid var(--ink);
}

.outcome-statement p {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 32px 24px;
  border-right: 1px solid var(--ink);
}

.outcome-statement p:last-child {
  border-right: 0;
}

.outcome-statement strong {
  font-family: "Songti SC", "STSong", serif;
  font-size: clamp(30px, 3vw, 42px);
}

.outcome-statement span:not(.sr-only) {
  font-size: 16px;
}

.outcome-loop {
  margin: 28px 0 0;
  color: var(--orange);
  font-size: 16px;
  text-align: right;
}

.team-credits {
  border-top: 1px solid var(--ink);
}

.team-credit {
  display: grid;
  grid-template-columns: 120px minmax(260px, 0.8fr) minmax(0, 1.2fr);
  gap: 32px;
  align-items: baseline;
  padding: 34px 0;
  border-bottom: 1px solid var(--ink);
}

.team-credit > span {
  color: var(--orange);
  font-size: 13px;
}

.team-credit h3 {
  margin: 0;
  font-family: "Songti SC", "STSong", serif;
  font-size: clamp(24px, 2.5vw, 34px);
}

.team-credit p {
  margin: 0;
  color: var(--muted);
  font-size: 16px;
  line-height: 1.7;
}

@keyframes signal-sweep {
  0%, 100% { transform: translateX(-110%); }
  55% { transform: translateX(300%); }
}
```

- [x] **Step 4: Replace retired responsive rules with narrative fallbacks**

Inside `@media (max-width: 900px)`, remove rules for the retired role, signal, scenario, and team classes, then add:

```css
.hero--service-film {
  grid-template-columns: 1fr;
}

.hero-film__case {
  min-height: 300px;
}

.journey-intro,
.journey-scene {
  grid-template-columns: 1fr;
}

.journey-intro > p:last-child {
  grid-column: auto;
}

.journey-scene {
  min-height: auto;
}

.journey-scene__copy {
  position: static;
}

.journey-scene__rail {
  flex-direction: row;
  align-items: center;
}

.journey-scene__rail i {
  width: auto;
  height: 2px;
}

.service-blueprint {
  grid-template-columns: 1fr;
  padding-top: 0;
}

.service-blueprint::before {
  top: 0;
  bottom: 0;
  left: 19px;
  width: 2px;
  height: auto;
}

.blueprint-layer {
  display: grid;
  grid-template-columns: 54px 1fr;
  padding: 32px 0;
}

.blueprint-layer__node {
  grid-row: 1 / 4;
  flex-direction: column;
  align-items: flex-start;
}

.blueprint-layer__heading {
  margin-top: 0;
}

.blueprint-layer__event,
.blueprint-layer dl {
  grid-column: 2;
}

.blueprint-layer__event {
  min-height: 0;
  margin: 20px 0;
}

.blueprint-layer dl {
  grid-template-columns: repeat(3, 1fr);
}

.team-credit {
  grid-template-columns: 90px 1fr;
}

.team-credit p {
  grid-column: 2;
}
```

Inside `@media (max-width: 640px)`, add:

```css
.hero--service-film h1 {
  font-size: clamp(40px, 11vw, 48px);
}

.hero-film__signal {
  position: static;
  margin: 24px 22px 0;
}

.hero-film__copy {
  padding: 58px 22px 64px;
}

.journey-intro,
.journey-scene,
.outcome-section {
  padding-right: 22px;
  padding-left: 22px;
}

.journey-scene h3 {
  font-size: clamp(32px, 9vw, 42px);
}

.blueprint-layer dl,
.outcome-statement {
  grid-template-columns: 1fr;
}

.outcome-statement p {
  border-right: 0;
  border-bottom: 1px solid var(--ink);
}

.team-credit {
  grid-template-columns: 1fr;
  gap: 14px;
}

.team-credit p {
  grid-column: auto;
}
```

- [x] **Step 5: Run targeted tests and static checks**

Run:

```bash
npm test -- app/landing-content.test.tsx
npm run lint
npm run typecheck
git diff --check
```

Expected: every command exits 0. CSS is intentionally verified by the browser QA in Task 4 because unit tests cannot establish typography scale, card-free composition, clipping, or responsive visual hierarchy.

- [x] **Step 6: Commit the visual system**

```bash
git add app/globals.css
git commit -m "style: create OneCare service film layout"
```

### Task 4: Verify, document, and publish the Preview

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-17-onecare-service-film-redesign.md`

**Interfaces:**
- Consumes: the completed homepage and the repository Preview handoff rule.
- Produces: full validation evidence, desktop/mobile visual QA, updated documentation, a Ready Vercel Preview, and a time-limited review URL.

- [x] **Step 1: Update README current implementation copy**

Replace the homepage bullets under `## 当前实现` with:

```markdown
- 面向比赛评审的多页面方案主页，以一条服务信号串联四个角色视角；
- 用户、客服、工程师与后台四个连续服务场景；
- “感知—诊断—编排—服务—学习”五层服务蓝图与冰箱温控异常案例；
- 三位成员能力的编辑式署名占位；
```

Add after the paragraph describing the current homepage boundary:

```markdown
当前主页采用克制的编辑式工业叙事：通过线路、节点、章节色块和场景接力表达系统关系，不使用四列角色卡、五列架构卡或三列成员卡。所有业务结果仍是方案目标，不是生产指标。
```

- [x] **Step 2: Run the complete validation suite**

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run test:runtime
npm audit --omit=dev
git diff --check
```

Expected:

- all Vitest suites pass;
- lint and TypeScript exit 0;
- the Next.js production build succeeds;
- all runtime authentication tests pass;
- audit reports no known production dependency vulnerabilities;
- `git diff --check` prints no output.

- [x] **Step 3: Perform desktop browser QA**

Use the repository browser-testing workflow at `1440 × 900` and verify:

- hero title is no larger than 72px and remains within its column;
- four scenes read as one continuous journey and contain no card containers;
- blueprint contains five readable stages and the learning-to-sense loop statement;
- the outcome section labels all values as goals;
- the team section uses rows/credits without portrait placeholders;
- login CTA remains visible and no `/experience/*` link exists;
- browser console has no application error.

- [x] **Step 4: Perform mobile and reduced-motion QA**

At `390 × 844`, verify:

- hero title is at most 48px and no horizontal overflow exists;
- journey scenes return to normal document flow;
- the blueprint is a readable vertical route;
- outcome items and team credits stack cleanly;
- header navigation remains reachable;
- emulated `prefers-reduced-motion: reduce` leaves all signal lines and content understandable.

- [x] **Step 5: Commit documentation and mark plan steps complete**

Update the checkboxes in this plan to reflect completed work, then run:

```bash
git add README.md docs/superpowers/plans/2026-07-17-onecare-service-film-redesign.md
git commit -m "docs: record OneCare service film homepage"
```

- [x] **Step 6: Create and inspect a non-Production Vercel Preview**

Run from the linked worktree and capture the generated URL without using a placeholder:

```bash
DEPLOY_LOG="$(mktemp)"
npx --yes vercel@latest deploy --yes 2>&1 | tee "$DEPLOY_LOG"
DEPLOYMENT_URL="$(rg -o 'https://[^ ]+\.vercel\.app' "$DEPLOY_LOG" | tail -n 1)"
npx --yes vercel@latest inspect "$DEPLOYMENT_URL"
```

Expected: `DEPLOYMENT_URL` contains the new deployment URL, the deployment target is `preview`, and status becomes `Ready`; do not use `--prod`.

Assign the stable review alias:

```bash
npx --yes vercel@latest alias set "$DEPLOYMENT_URL" onecare-homepage-preview.vercel.app
rm "$DEPLOY_LOG"
```

Expected: the alias points to the new Preview deployment.

- [x] **Step 7: Create a seven-day shareable link and verify unique markers**

Because Preview Deployment Protection is enabled, call the authenticated Vercel REST endpoint with the existing CLI credential. This command reads the credential in memory, prints only the returned share value into a shell variable, and never writes the credential or share value to the repository:

```bash
SHARE_VALUE="$(node --input-type=module -e '
  import { readFile } from "node:fs/promises";
  const path = `${process.env.HOME}/Library/Application Support/com.vercel.cli/auth.json`;
  const { token } = JSON.parse(await readFile(path, "utf8"));
  const response = await fetch(
    "https://api.vercel.com/aliases/onecare-homepage-preview.vercel.app/protection-bypass",
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: 604800 }),
    },
  );
  if (!response.ok) {
    throw new Error(`Vercel share link request failed: ${response.status}`);
  }
  process.stdout.write(JSON.stringify(await response.json()).replace(/^"|"$/g, ""));
')"
SHARE_URL="https://onecare-homepage-preview.vercel.app/?_vercel_share=${SHARE_VALUE}"
```

Expected: `SHARE_VALUE` is non-empty and `SHARE_URL` is the seven-day review URL. Keep the returned value only in the final handoff; never write it to the repository or logs.

Follow the share link with an ephemeral cookie jar and verify without printing the share URL:

```bash
COOKIE_JAR="$(mktemp)"
PREVIEW_HTML="$(mktemp)"
curl --silent --show-error --location --cookie-jar "$COOKIE_JAR" --cookie "$COOKIE_JAR" "$SHARE_URL" --output "$PREVIEW_HTML" --write-out '%{http_code}\n'
rg -n '一次理解，不再重复描述|一次就好|OneCare｜AI 用户服务闭环引擎' "$PREVIEW_HTML"
rm "$COOKIE_JAR" "$PREVIEW_HTML"
```

Expected: curl prints `200` and `rg` finds all three markers.

- [x] **Step 8: Final repository and harness check**

Run:

```bash
git status --short --branch
git diff --check
git log --oneline --decorate -8
```

Expected: clean worktree, branch still based on `origin/main`, no uncommitted files, and no push/PR/merge/Production deployment performed.
