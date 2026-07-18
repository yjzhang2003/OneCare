# 万护 OneCare 团队成员与品牌收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用三位成员的真实学历与代表经历替换团队占位内容，复用现有万护 Logo 替换旧 favicon，并把团队页 Footer 重组为清晰的双层收尾区。

**Architecture:** `teamMembers` 继续作为成员内容唯一来源，扩展只读类型后由 `LandingContent` 语义化渲染。`SiteFooter` 保持无状态服务端组件，只重组现有品牌、导航与原型边界内容；浏览器图标从 `brand-assets.ts` 的现有深色 Logo 机械派生为静态 `app/icon.png`，不新建品牌图形。

**Tech Stack:** TypeScript 5.9、Next.js 16 App Router、React 19、CSS、Vitest、React Testing Library、Node.js 24、Vercel Preview。

## Global Constraints

- 只使用 TypeScript 项目工具链，不添加 Python 代码或 Python 工具。
- 三位成员均展示硕士研究生与本科背景，每人只保留两条代表经历和三个能力关键词。
- 团队卡片不显示照片、头像占位、电话、邮箱、社交账号、政治面貌或民族。
- favicon 必须复用 `src/features/showcase/brand-assets.ts` 的现有万护 Logo，不重新绘制、生成或引入新的品牌图形。
- Footer 保留黑色背景、原型边界说明和四页导航，删除 `Typeface: MiSans`，并使用药丸形“返回首页”。
- 保留 `#home`、`#perspectives`、`#architecture`、`#team` 四页模型，不新增路由或客户端状态。
- 不修改飞书认证、机器人、Production 配置、环境变量、Dashboard 或真实业务集成。
- 行为和展示契约按 RED → GREEN → REFACTOR 实施。
- 完成本地验证后只发布非 Production Vercel Preview；不推送、不创建 PR、不合并。

---

## File Structure

- `src/features/showcase/content.ts`：定义扩展后的 `TeamMember` 只读类型与三位成员的唯一内容数据。
- `app/landing-content.tsx`：渲染成员姓名、角色、学历、代表经历与能力关键词，不硬编码履历。
- `app/landing-content.test.tsx`：锁定三位成员、六条学历、角色、隐私边界与旧占位移除。
- `src/features/showcase/components/site-footer.tsx`：输出双层 Footer、完整四页导航与原型边界说明。
- `src/features/showcase/components/site-footer.test.tsx`：锁定 Footer 分组、链接、文案和删除项。
- `app/icon.test.ts`：验证静态 favicon 与现有深色品牌 Logo 字节一致，且旧 SVG 已删除。
- `app/icon.png`：从 `ONECARE_LOGO_DARK_SRC` 机械派生的 Next.js App Router 图标文件。
- `app/globals.css`：实现成员卡信息层级、双层 Footer 与桌面/移动响应式布局。
- `README.md`：把三位成员占位与旧页尾描述更新为真实成员简介、品牌 favicon 与整理后的 Footer。
- `docs/superpowers/specs/2026-07-18-onecare-team-members-design.md`：保持批准范围与最终实现一致。
- `docs/superpowers/plans/2026-07-18-onecare-team-members-and-brand-polish.md`：记录步骤完成状态与验证证据。

---

### Task 1: 三位成员内容与语义卡片

**Files:**
- Modify: `app/landing-content.test.tsx`
- Modify: `src/features/showcase/content.ts`
- Modify: `app/landing-content.tsx`

**Interfaces:**
- Produces: `TeamMember` 的 `name`、`role`、`education`、`highlights`、`capabilities` 字段与三位成员只读数据。
- Consumes: 现有 `teamMembers.map()` 与 `SectionFrame` 团队页组合。

- [x] **Step 1: 写成员内容失败测试**

把 `app/landing-content.test.tsx` 中团队占位断言替换为以下契约：

```tsx
fireEvent.click(screen.getByRole("link", { name: "团队" }));

expect(screen.getByText("03 · 团队")).toBeInTheDocument();

const expectedMembers = [
  ["张禹健", "AI 工程与系统架构"],
  ["张睿哲", "安全仿真与算法研究"],
  ["黄齐", "AI 产品与业务洞察"],
] as const;

expectedMembers.forEach(([name, role]) => {
  expect(screen.getByRole("heading", { name })).toBeInTheDocument();
  expect(screen.getByText(role)).toBeInTheDocument();
});

[
  "南京大学软件工程硕士研究生",
  "南京邮电大学计算机科学与技术本科",
  "西安电子科技大学网络与信息安全硕士研究生",
  "南京邮电大学信息安全本科",
  "卡内基梅隆大学人工智能系统管理硕士研究生",
  "苏州大学物流管理本科",
].forEach((education) => {
  expect(screen.getByText(education)).toBeInTheDocument();
});

expect(screen.queryByText(/成员信息待补充/)).not.toBeInTheDocument();

container.querySelectorAll(".team-card").forEach((card) => {
  expect(card.querySelector("img")).toBeNull();
});
```

同时断言团队导语为：

```tsx
expect(
  screen.getByText(
    "从 AI 工程、安全仿真到业务产品化，三种能力共同把服务创新变成可验证的方案。",
  ),
).toBeInTheDocument();
```

- [x] **Step 2: 运行目标测试并确认 RED**

Run:

```bash
npx vitest run app/landing-content.test.tsx
```

Expected: FAIL，因为页面仍显示“成员信息待补充”和三张通用能力占位卡，三位姓名与学历尚不存在。

- [x] **Step 3: 扩展成员类型与真实内容数据**

把 `src/features/showcase/content.ts` 中的 `TeamMember` 改为：

```ts
export type TeamMember = Readonly<{
  index: string;
  name: string;
  role: string;
  education: readonly string[];
  highlights: readonly string[];
  capabilities: readonly string[];
}>;
```

把 `teamMembers` 改为：

```ts
export const teamMembers: readonly TeamMember[] = [
  {
    index: "01",
    name: "张禹健",
    role: "AI 工程与系统架构",
    education: [
      "南京大学软件工程硕士研究生",
      "南京邮电大学计算机科学与技术本科",
    ],
    highlights: [
      "参与飞书智能伙伴 Aily 后端研发，负责用户上下文模块与 Aily CLI。",
      "搭建企业级 AI 自动修复工作流，形成扫描、定位、修复、构建验证与提交闭环。",
    ],
    capabilities: ["Agent 工程", "系统架构", "工程闭环"],
  },
  {
    index: "02",
    name: "张睿哲",
    role: "安全仿真与算法研究",
    education: [
      "西安电子科技大学网络与信息安全硕士研究生",
      "南京邮电大学信息安全本科",
    ],
    highlights: [
      "基于 CARLA-Air 搭建无人机与地面车辆协同仿真及多模态数据采集场景。",
      "开展三维车辆多视角仿真与可微渲染研究，并参与 Fuzzer 自动化安全测试。",
    ],
    capabilities: ["安全研究", "仿真建模", "算法验证"],
  },
  {
    index: "03",
    name: "黄齐",
    role: "AI 产品与业务洞察",
    education: [
      "卡内基梅隆大学人工智能系统管理硕士研究生",
      "苏州大学物流管理本科",
    ],
    highlights: [
      "参与政务数据场景的自然语言到 SQL/DSL 智能查询系统，负责多 Agent 拆解与 RAG 检索模块。",
      "构建多模态 RAG、事实核查 Agent 与多 Agent 调试系统，并具有供应链建模和质量分析经验。",
    ],
    capabilities: ["AI 产品化", "数据洞察", "业务建模"],
  },
] as const;
```

- [x] **Step 4: 更新团队页语义结构**

把 `app/landing-content.tsx` 中团队 `SectionFrame` 的导语改为批准文案，并把卡片内容改为：

```tsx
<article className="team-card surface-card" key={member.index}>
  <div className="team-card__heading">
    <span>成员 {member.index}</span>
    <p>{member.role}</p>
  </div>
  <h3>{member.name}</h3>
  <section className="team-card__section" aria-label={`${member.name}学历`}>
    <h4>学历</h4>
    <ul>
      {member.education.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  </section>
  <section className="team-card__section" aria-label={`${member.name}代表经历`}>
    <h4>代表经历</h4>
    <ul>
      {member.highlights.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  </section>
  <p className="team-card__capabilities">
    {member.capabilities.join(" / ")}
  </p>
</article>
```

- [x] **Step 5: 运行目标测试并确认 GREEN**

Run:

```bash
npx vitest run app/landing-content.test.tsx
```

Expected: `app/landing-content.test.tsx` 全部 PASS，三位成员与六条学历可通过语义查询访问，旧占位文案不存在。

- [x] **Step 6: 提交成员内容**

```bash
git add app/landing-content.test.tsx app/landing-content.tsx src/features/showcase/content.ts
git commit -m "feat: add OneCare team member profiles"
```

---

### Task 2: 现有品牌 Logo favicon

**Files:**
- Create: `app/icon.test.ts`
- Create: `app/icon.png`
- Delete: `app/icon.svg`

**Interfaces:**
- Consumes: `ONECARE_LOGO_DARK_SRC` 的 `data:image/png;base64,...` 字节。
- Produces: Next.js App Router 自动发现的静态 `app/icon.png`。

- [x] **Step 1: 写 favicon 来源失败测试**

创建 `app/icon.test.ts`：

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("browser tab icon", () => {
  it("reuses the existing dark OneCare brand asset", () => {
    const repositoryRoot = process.cwd();
    const iconPath = join(repositoryRoot, "app/icon.png");
    const legacyIconPath = join(repositoryRoot, "app/icon.svg");
    const brandAssets = readFileSync(
      join(repositoryRoot, "src/features/showcase/brand-assets.ts"),
      "utf8",
    );
    const darkLogo = brandAssets.match(
      /ONECARE_LOGO_DARK_SRC\s*=\s*\n\s*"data:image\/png;base64,([^"]+)"/,
    );

    expect(darkLogo).not.toBeNull();
    expect(existsSync(legacyIconPath)).toBe(false);
    expect(existsSync(iconPath)).toBe(true);

    if (!darkLogo || !existsSync(iconPath)) {
      return;
    }

    expect(readFileSync(iconPath)).toEqual(Buffer.from(darkLogo[1], "base64"));
  });
});
```

- [x] **Step 2: 运行 favicon 测试并确认 RED**

Run:

```bash
npx vitest run app/icon.test.ts
```

Expected: FAIL，因为 `app/icon.svg` 仍存在且 `app/icon.png` 尚不存在。

- [x] **Step 3: 从现有品牌源机械派生静态图标**

运行以下一次性 Node 命令。它只读取已跟踪的 TypeScript 品牌常量并写出完全相同的 PNG 字节，不新增 JavaScript 文件或运行时依赖：

```bash
node -e 'const fs=require("node:fs");const source=fs.readFileSync("src/features/showcase/brand-assets.ts","utf8");const match=source.match(/ONECARE_LOGO_DARK_SRC\s*=\s*\n\s*"data:image\/png;base64,([^"]+)"/);if(!match)throw new Error("Missing ONECARE_LOGO_DARK_SRC");fs.writeFileSync("app/icon.png",Buffer.from(match[1],"base64"));'
```

删除旧图标：

```diff
*** Delete File: app/icon.svg
```

- [x] **Step 4: 运行 favicon 测试并确认 GREEN**

Run:

```bash
npx vitest run app/icon.test.ts
```

Expected: `1` 个测试 PASS，`app/icon.png` 与 `ONECARE_LOGO_DARK_SRC` 字节一致，旧 SVG 不存在。

- [x] **Step 5: 提交 favicon**

```bash
git add app/icon.test.ts app/icon.png app/icon.svg
git commit -m "fix: align favicon with OneCare brand"
```

---

### Task 3: 双层 Footer 结构

**Files:**
- Create: `src/features/showcase/components/site-footer.test.tsx`
- Modify: `src/features/showcase/components/site-footer.tsx`

**Interfaces:**
- Produces: `.footer-top`、`.footer-bottom`、四页 `nav` 与 `.back-to-top`。
- Consumes: 现有 `OneCareLogo` 浅色版本和四个稳定 Hash。

- [x] **Step 1: 写 Footer 结构失败测试**

创建 `src/features/showcase/components/site-footer.test.tsx`：

```tsx
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SiteFooter } from "./site-footer";

afterEach(cleanup);

describe("SiteFooter", () => {
  it("groups brand navigation and prototype boundary into two clear rows", () => {
    const { container } = render(<SiteFooter />);
    const navigation = screen.getByRole("navigation", { name: "页尾导航" });

    expect(container.querySelector(".footer-top")).not.toBeNull();
    expect(container.querySelector(".footer-bottom")).not.toBeNull();
    expect(screen.getByText("万护 OneCare")).toBeInTheDocument();
    expect(screen.getByText("AI 用户服务全链路闭环引擎")).toBeInTheDocument();

    [
      ["首页", "#home"],
      ["四个视角", "#perspectives"],
      ["五层引擎", "#architecture"],
      ["团队", "#team"],
    ].forEach(([label, href]) => {
      expect(within(navigation).getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
    });

    expect(
      screen.getByText(/当前为万护 OneCare 方案原型/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回首页" })).toHaveAttribute(
      "href",
      "#home",
    );
    expect(screen.queryByText("Typeface: MiSans")).not.toBeInTheDocument();
  });
});
```

- [x] **Step 2: 运行 Footer 测试并确认 RED**

Run:

```bash
npx vitest run src/features/showcase/components/site-footer.test.tsx
```

Expected: FAIL，因为现有 Footer 没有 `.footer-top`、`.footer-bottom` 和“首页”页尾导航，且仍显示 `Typeface: MiSans`。

- [x] **Step 3: 实现双层 Footer**

把 `SiteFooter` 改为：

```tsx
import { OneCareLogo } from "./onecare-logo";

export function SiteFooter() {
  return (
    <footer className="site-footer public-footer">
      <div className="footer-top">
        <div className="footer-brand">
          <OneCareLogo decorative size={52} tone="light" />
          <div>
            <strong>万护 OneCare</strong>
            <span>AI 用户服务全链路闭环引擎</span>
          </div>
        </div>
        <nav aria-label="页尾导航">
          <a href="#home">首页</a>
          <a href="#perspectives">四个视角</a>
          <a href="#architecture">五层引擎</a>
          <a href="#team">团队</a>
        </nav>
      </div>
      <div className="footer-bottom">
        <p>
          当前为万护 OneCare 方案原型，尚未接入真实业务数据或 AI 服务。
        </p>
        <a className="back-to-top" href="#home">
          返回首页
        </a>
      </div>
    </footer>
  );
}
```

- [x] **Step 4: 运行 Footer 与首页测试并确认 GREEN**

Run:

```bash
npx vitest run src/features/showcase/components/site-footer.test.tsx app/landing-content.test.tsx
```

Expected: 两个测试文件全部 PASS，Footer 四页导航与首页集成契约均保持有效。

- [x] **Step 5: 提交 Footer 结构**

```bash
git add src/features/showcase/components/site-footer.tsx src/features/showcase/components/site-footer.test.tsx
git commit -m "refactor: organize OneCare footer content"
```

---

### Task 4: 成员卡与 Footer 响应式视觉

**Files:**
- Modify: `app/globals.css`
- Modify: `app/fullscreen-showcase-styles.test.ts`

**Interfaces:**
- Consumes: `.team-card__heading`、`.team-card__section`、`.team-card__capabilities`、`.footer-top`、`.footer-bottom`。
- Produces: 三列成员卡、双层桌面 Footer 与单列移动 Footer。

- [x] **Step 1: 增加视觉结构失败契约**

在 `app/fullscreen-showcase-styles.test.ts` 中读取 `app/globals.css` 的既有测试里加入：

```ts
expect(css).toMatch(/\.team-card__section\s+ul\s*\{/);
expect(css).toMatch(
  /\.landing-shell \.footer-top,\s*\.landing-shell \.footer-bottom\s*\{[\s\S]*?grid-template-columns:/,
);
expect(css).toMatch(/\.footer-bottom\s*\{[\s\S]*?border-top:/);
expect(css).toMatch(
  /@media \(max-width: 640px\)[\s\S]*?\.landing-shell \.footer-top[\s\S]*?grid-template-columns:\s*1fr/,
);
```

- [x] **Step 2: 运行样式测试并确认 RED**

Run:

```bash
npx vitest run app/fullscreen-showcase-styles.test.ts
```

Expected: FAIL，因为新增成员分组和 Footer 双层类名尚未有最终 CSS。

- [x] **Step 3: 实现成员卡信息层级**

替换 `app/globals.css` 中现有 `.landing-shell .team-card` 规则，使卡片不再依赖 `h3 { margin: auto 0 0; }`，并加入：

```css
.landing-shell .team-card {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 22px;
  padding: 30px;
  border-radius: 20px;
  box-shadow: 0 18px 52px rgba(17, 19, 18, 0.05);
}

.landing-shell .team-card__heading {
  display: flex;
  min-height: 52px;
  flex-direction: column;
  gap: 6px;
}

.landing-shell .team-card__heading > span {
  color: var(--onecare-teal-dark);
  font-size: 13px;
  font-weight: 600;
}

.landing-shell .team-card__heading > p {
  color: var(--onecare-muted);
  font-size: 15px;
  font-weight: 600;
}

.landing-shell .team-card h3 {
  max-width: none;
  margin: 0;
  color: var(--onecare-ink);
  font-size: clamp(30px, 2.5vw, 38px);
  font-weight: 600;
  line-height: 1.15;
}

.landing-shell .team-card__section {
  display: grid;
  gap: 10px;
}

.landing-shell .team-card__section h4 {
  margin: 0;
  color: var(--onecare-ink);
  font-size: 14px;
  font-weight: 600;
}

.landing-shell .team-card__section ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0 0 0 1.1em;
  color: var(--onecare-muted);
  font-size: 14px;
  line-height: 1.6;
}

.landing-shell .team-card__capabilities {
  margin-top: auto;
  padding-top: 18px;
  border-top: 1px solid var(--onecare-line);
  color: var(--onecare-teal-dark);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.6;
}
```

- [x] **Step 4: 实现双层 Footer 布局**

把 `.landing-shell .public-footer` 及其子规则重写为：

```css
.landing-shell .public-footer {
  display: flex;
  min-height: 300px;
  flex-direction: column;
  gap: 44px;
  padding: 64px clamp(24px, 5vw, 76px) 40px;
  color: rgba(255, 255, 255, 0.72);
  background: var(--onecare-black);
  border: 0;
}

.landing-shell .footer-top,
.landing-shell .footer-bottom {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto;
  gap: clamp(32px, 6vw, 96px);
  align-items: center;
}

.landing-shell .footer-top nav {
  display: flex;
  flex-direction: row;
  gap: clamp(18px, 2.5vw, 36px);
  align-items: center;
}

.landing-shell .footer-bottom {
  padding-top: 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.16);
}

.landing-shell .back-to-top {
  display: inline-flex;
  width: auto;
  min-height: 48px;
  padding: 0 24px;
  align-items: center;
  justify-content: center;
  color: var(--onecare-black);
  background: var(--onecare-teal);
  border-radius: 999px;
  font-size: 15px;
  font-weight: 600;
}
```

保留并适配现有 `.footer-brand`、文字颜色、链接 hover 与 focus-visible 规则，移除旧四列 Footer 选择器和圆形 `.back-to-top` 尺寸。

- [x] **Step 5: 实现移动端堆叠**

在 `@media (max-width: 640px)` 中用以下规则替换旧 Footer 移动规则：

```css
.landing-shell .public-footer {
  gap: 34px;
  min-height: 0;
  padding: 48px 20px 32px;
}

.landing-shell .footer-top,
.landing-shell .footer-bottom {
  grid-template-columns: 1fr;
  gap: 26px;
  align-items: start;
}

.landing-shell .footer-top nav {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 20px;
}

.landing-shell .back-to-top {
  justify-self: start;
}
```

移动端 `.team-card` 保持单列，使用 `padding: 24px` 与 `border-radius: 16px`，不设置固定最小高度。

- [x] **Step 6: 运行样式与组件测试并确认 GREEN**

Run:

```bash
npx vitest run app/fullscreen-showcase-styles.test.ts app/landing-content.test.tsx src/features/showcase/components/site-footer.test.tsx
```

Expected: 三个测试文件全部 PASS。

- [x] **Step 7: 提交响应式视觉**

```bash
git add app/globals.css app/fullscreen-showcase-styles.test.ts
git commit -m "style: refine team cards and footer"
```

---

### Task 5: 文档、完整验证与 Preview

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-18-onecare-team-members-design.md`
- Modify: `docs/superpowers/plans/2026-07-18-onecare-team-members-and-brand-polish.md`

**Interfaces:**
- Consumes: 完成的成员卡、favicon 与 Footer。
- Produces: 可复核文档、完整本地验证证据和非 Production Preview URL。

- [x] **Step 1: 更新 README 当前实现**

把“当前实现”中的“三位成员能力的圆角卡片占位”改为：

```markdown
- 三位成员的真实姓名、学历、代表经历与互补能力简介，不展示照片或联系方式；
```

在视觉描述中补充浏览器 Tab 使用现有万护品牌图形、团队页采用整理后的双层黑色 Footer。不得改变 IoT、VOC、AI、持久化与飞书集成的未实现边界。

- [x] **Step 2: 运行完整自动化验证**

Run:

```bash
npm test
npm run test:runtime
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
git diff --check
```

Expected: 所有命令退出码为 `0`；所有 Vitest 测试 PASS；Lint 与 TypeScript 无错误；两个生产构建成功；Audit 为 `0 vulnerabilities`；Diff 无空白错误。

- [x] **Step 3: 运行真实浏览器验收**

在本地生产构建或 Preview 上检查 `1440 × 900` 和 `390 × 844`：

- 团队页显示张禹健、张睿哲、黄齐的姓名、角色、硕士研究生与本科学历；
- 每张卡只显示两条代表经历和三个能力关键词，不出现照片或联系方式；
- 三列桌面卡片与单列移动卡片没有裁切、横向溢出或重叠；
- Footer 桌面端为上下两层，移动端按品牌、导航、原型说明、返回首页自然堆叠；
- Footer 显示四页导航，不显示 `Typeface: MiSans`，返回首页为药丸按钮；
- 浏览器 Tab 显示现有黑色万护图形，不显示旧橙色 `A`；
- 页面无控制台错误、hydration 警告或水平滚动条。

- [x] **Step 4: 更新规格与计划验证记录**

在规格末尾增加“实现记录”，写明实际成员排序、favicon 来源、Footer 布局和浏览器检查结果。把本计划已完成步骤逐项勾选，并记录测试数量、构建结果、Audit 与 Preview 验证标记。

- [x] **Step 5: 提交文档与验证记录**

```bash
git add README.md docs/superpowers/specs/2026-07-18-onecare-team-members-design.md docs/superpowers/plans/2026-07-18-onecare-team-members-and-brand-polish.md
git commit -m "docs: record team and brand polish"
```

- [ ] **Step 6: 发布并验证非 Production Preview**

从当前分支运行：

```bash
vercel deploy --yes
```

等待状态为 `Ready`。如果 Deployment Protection 开启，创建限时分享链接。验证 Preview 返回 HTTP `200`，并确认页面包含 `张禹健`、`张睿哲`、`黄齐` 和 `AI 用户服务全链路闭环引擎`。不得使用 `--prod`，不得修改环境变量或飞书回调。

- [ ] **Step 7: 最终状态检查**

Run:

```bash
git status --short --branch
git log -8 --oneline
```

Expected: 工作树干净，当前分支为 `codex/member-page-team`，提交只包含规格、计划、成员页、favicon、Footer、样式、测试与 README 变更。

## Validation Record

- `npm test`: 26 个测试文件、108 个测试全部通过；
- `npm run test:runtime`: 4 个生产运行时测试全部通过；
- `npm run lint`: 通过；
- `npm run typecheck`: 通过；
- `npm run build`: 通过，并输出静态 `/icon.png` 路由；
- `npm audit --omit=dev`: `0 vulnerabilities`；
- `git diff --check`: 通过；
- Playwright `1440 × 900`: 三列成员卡无裁切，Footer 双层整行对齐；
- Playwright `390 × 844`: 单列成员卡与 Footer 自然堆叠，`scrollWidth` 与 `clientWidth` 均为 `390`；
- 浏览器控制台：`0` errors、`0` warnings；
- favicon：页面实际加载 `/icon.png`，测试确认其字节与 `ONECARE_LOGO_DARK_SRC` 一致；
- Preview：待发布与验证。
