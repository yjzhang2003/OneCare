# OneCare Brand Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有展示站、项目文档和远程项目名称从汽车用户洞察转向 OneCare 海信用户服务闭环方案，同时保持技术栈和认证行为不变。

**Architecture:** 只修改展示组件、样式中的四列能力布局、元数据和产品文档；认证模块及 Route Handlers 保持不变。GitHub 与 Vercel 重命名作为独立平台步骤执行，并以保留现有 OAuth 回调可用性为边界。

**Tech Stack:** Node.js 24 LTS、Next.js 16 App Router、React 19、TypeScript、Vitest、React Testing Library、Vercel。

## Global Constraints

- 产品、仓库和网页品牌统一使用 `OneCare`，仓库名和网页标题不得出现 `Hisense`。
- 网站正文可以明确说明方案服务于海信集团。
- 保持现有飞书 OAuth、签名会话、认证路由、Next.js 脚手架与依赖不变。
- 不新增真实 AI、IoT、VOC、工单、配件、回访或数据库集成。
- 所有业务状态和指标必须标记为静态预览、方案原型或目标值。
- 不追溯改写历史规格与历史计划。

---

## File Map

- `app/landing-content.test.tsx`、`app/landing-content.tsx`：OneCare 首页展示契约与实现。
- `app/dashboard/dashboard-content.test.tsx`、`app/dashboard/dashboard-content.tsx`：服务闭环工作台展示契约与实现。
- `app/globals.css`：将能力与模块网格扩展为四列并保持响应式。
- `app/layout.tsx`：OneCare 页面元数据。
- `package.json`、`package-lock.json`：npm 包名。
- `README.md`：当前实现、运行方式与新题目全文。
- `AGENTS.md`、`docs/TECH_STACK.md`：当前产品基线和技术实现边界。
- `.gitignore`：忽略 Vercel CLI 重新链接生成的本地 `.vercel` 元数据。
- GitHub repository、Vercel project：远程产品名称与生产地址。

### Task 1: OneCare 展示契约

**Files:**
- Modify: `app/landing-content.test.tsx`
- Modify: `app/dashboard/dashboard-content.test.tsx`

**Interfaces:**
- Consumes: `LandingContent({ user, authError })` 与 `DashboardContent({ user })`。
- Produces: OneCare 品牌、四项服务闭环能力、静态演示边界与未泄露 `openId` 的展示契约。

- [x] **Step 1: 将首页测试改为断言 OneCare 与四项能力**

断言标题“让每一次服务，都比问题更早一步”，正文中的 OneCare、`VOC 智能分析`、`智能预诊`、`协同调度`、`闭环追踪`，以及未接入真实业务数据或 AI 服务的边界说明；保留飞书登录链接和已登录返回工作台断言。

- [x] **Step 2: 将工作台测试改为断言服务闭环模块**

断言 `服务闭环指挥台`、`VOC 洞察`、`智能预诊`、`协同调度`、`闭环追踪` 和静态预览标记；保留飞书身份、退出表单与 `openId` 不渲染断言。

- [x] **Step 3: 运行测试并确认预期失败**

Run: `npm test -- app/landing-content.test.tsx app/dashboard/dashboard-content.test.tsx`

Expected: FAIL，失败信息指出新的 OneCare 标题与服务模块尚未渲染。

### Task 2: 首页与工作台转向

**Files:**
- Modify: `app/landing-content.tsx`
- Modify: `app/dashboard/dashboard-content.tsx`
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: Task 1 的展示契约和现有 `AuthUser`。
- Produces: 保持原组件签名不变的 OneCare 静态展示站。

- [x] **Step 1: 实现 OneCare 首页最小文案与四项能力**

保留错误提示、会话感知 CTA 与飞书登录 URL，只替换品牌、题目、能力、目标指标、服务循环标签和演示边界文案。

- [x] **Step 2: 实现服务闭环工作台最小文案与四项模块**

保留用户头像、身份状态、退出表单和静态图形结构，替换工作台问题、信号、服务队列与模块内容。

- [x] **Step 3: 将桌面网格调整为四列**

把 `.capability-grid` 与 `.module-grid` 的桌面列数改为四列，保留现有移动端断点行为，不增加依赖或新视觉系统。

- [x] **Step 4: 更新页面元数据**

设置标题 `OneCare｜AI 用户服务闭环引擎`，描述 `面向海信智能家庭场景的 AI 用户服务全链路闭环方案。`。

- [x] **Step 5: 运行展示测试并确认通过**

Run: `npm test -- app/landing-content.test.tsx app/dashboard/dashboard-content.test.tsx`

Expected: PASS，两个测试文件全部通过。

### Task 3: 产品与仓库文档转向

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/TECH_STACK.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: 已批准的 OneCare 题目与当前实现事实。
- Produces: 不夸大能力、与页面一致的仓库入口和技术现状。

- [x] **Step 1: 更新包名与锁文件包名**

将根包名从 `auto-insight` 改为 `onecare`，不修改依赖、版本、脚本或 Node 引擎。

- [x] **Step 2: 重写 README 的产品背景与当前实现**

完整替换旧汽车题目，记录用户提供的海信背景、四项真实挑战、四个 AI 机会点、系统性方案目标，以及当前版本仅为静态展示和飞书登录框架的边界。

- [x] **Step 3: 更新当前项目基线文档**

在 `AGENTS.md` 和 `docs/TECH_STACK.md` 中把当前产品名改为 OneCare，并把未实现领域从汽车数据/洞察改为 IoT、VOC、服务业务系统与 AI；保留认证、安全、租户和技术栈事实。

- [x] **Step 4: 检查当前产品文件中的旧叙事**

Run: `! rg -n "汽车用户洞察|车型对比|人群地图|AUTO INSIGHT" README.md AGENTS.md docs/TECH_STACK.md app package.json`

Expected: exit 0。历史规格与认证测试夹具不在此检查范围内。

### Task 4: 本地完整验证

**Files:**
- Modify if needed: Task 1–3 listed files only.

**Interfaces:**
- Consumes: OneCare 展示与文档变更。
- Produces: 可构建且认证行为无回归的本地版本。

- [x] **Step 1: 运行测试、静态检查和构建**

Run: `npm test && npm run lint && npm run typecheck && npm run build`

Expected: 所有命令 exit 0，测试无失败，Next.js 构建成功。

- [x] **Step 2: 运行格式与差异检查**

Run: `git diff --check && git status --short --branch`

Expected: `git diff --check` exit 0，状态仅包含计划内文件。

### Task 5: GitHub 与 Vercel 重命名

**Files:**
- Modify if actual URL changes: `README.md`
- Modify if actual URL changes: `docs/TECH_STACK.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: GitHub CLI 与当前已链接的 Vercel 项目。
- Produces: 名为 OneCare 的 GitHub 仓库，以及不含 Hisense 的 Vercel 项目名称和经核验的生产地址。

- [x] **Step 1: 核验当前 GitHub 与 Vercel 登录和链接**

Run: `gh repo view --json name,nameWithOwner,url && vercel project inspect auto-insight`

Expected: 只输出项目元数据，不输出任何密钥。

- [x] **Step 2: 将 GitHub 仓库改名为 OneCare**

Run: `gh repo rename OneCare --yes`

Expected: exit 0；`gh repo view --json name,nameWithOwner,url` 返回名称 `OneCare`。

- [x] **Step 3: 将 Vercel 项目改为 OneCare 名称**

优先使用 Vercel 官方项目重命名能力将项目 slug 改为 `onecare`。若名称冲突，使用最短的不含 Hisense 的 OneCare 变体。不得删除现有稳定生产别名。

- [x] **Step 4: 核验生产域名与 OAuth 回调边界**

核验新默认域名和 `https://auto-insight-omega.vercel.app/api/auth/feishu/callback` 的可达性，并确认 Vercel Production 的 `FEISHU_REDIRECT_URI` 是否仍指向已登记的稳定回调。不得打印变量值；若需要飞书后台改地址，只报告待办。

- [x] **Step 5: 记录实际远程地址并重新验证文档**

把 GitHub URL、Vercel 生产 URL 与兼容说明写入 README/TECH_STACK，然后运行 `git diff --check`。

Expected: 文档地址与远程平台实际状态一致。
