# 万护 OneCare 闭环架构页 Implementation Plan

**Goal:** 将当前“02 · 五层引擎”页面重构为“02 · 闭环架构”，用统一服务事件、三层架构、风险分流、五步闭环、六个月试点目标和渐进推广路径准确呈现已审核的新方案。

**Architecture:** 保留 `#architecture`、一级页面顺序和 `ShowcaseNavigator`。`content.ts` 提供新的只读架构数据；展示组件分别负责架构全景、闭环运行与试点落地；`ArchitectureChapters` 将三个章节放入同一全局滚动流，只维护滚动联动的当前章节状态。页面不增加网络请求、真实集成或依赖。

**Tech Stack:** TypeScript、Next.js 16、React 19、CSS、Vitest、React Testing Library。

## Global Constraints

- 只在 `codex/onecare-service-architecture-spec` 分支和 `.worktrees/onecare-service-architecture-spec` 工作树修改文件。
- 一级页面仍为 `#home`、`#perspectives`、`#architecture`、`#team`，索引仍为 `00–03`。
- 三种 ID 只显示中文名称，不显示英文辅助标签。
- 海信爱家使用官方 App 标识与中文名称；素材来自可核验的官方页面并记录来源，不改变比例、不自行重绘。
- 四项数值只标注为“6 个月试点目标”，明确“尚无正式测量口径、待试点启动前确认”。
- 不实现真实 AI、IoT、数据库、API 或外部系统连接。
- 不修改登录、飞书认证、Dashboard、路由、环境变量、部署配置或无关页面。
- 不新增依赖，不执行 Vercel 或 Production 操作。
- 行为和呈现变化遵循 RED → GREEN → REFACTOR。

## File Map

- `docs/superpowers/specs/2026-07-18-onecare-closed-loop-architecture-design.md`：记录已审核规格与实施验证结果。
- `docs/superpowers/plans/2026-07-18-onecare-closed-loop-architecture.md`：跟踪本计划状态与验证证据。
- `src/features/showcase/navigation.ts`：把可见导航名称改为“闭环架构”，保留 `architecture` ID 与索引。
- `src/features/showcase/content.ts`：用统一标识、连接端、三层、决策路径、闭环步骤、试点目标和推广阶段替换旧五层数据。
- `src/features/showcase/content.test.ts`：锁定新数据顺序、目标数值、规划状态与中文 ID 标签。
- `src/features/showcase/components/service-architecture.tsx`：渲染统一服务事件、三层系统面板、风险分流和五步闭环。
- `src/features/showcase/components/pilot-targets.tsx`：渲染四项试点目标、口径说明和推广阶段。
- `src/features/showcase/components/service-architecture.test.tsx`：锁定语义结构、可访问名称、官方爱家标识和规划措辞。
- `src/features/showcase/components/site-footer.tsx`：同步页尾入口名称。
- `app/landing-content.tsx`：组合新的闭环架构页。
- `app/landing-content.test.tsx`：锁定一级导航、页面归属、旧五层移除和红线措辞。
- `app/fullscreen-showcase-styles.test.ts`：锁定架构页桌面/移动响应式和减少动效。
- `app/globals.css`：在现有视觉令牌内实现新架构局部样式。
- `public/images/hisense/aijia-app-mark.*`：从官方应用页面取得的海信爱家 App 标识，最终扩展名以官方资源为准。
- `public/images/hisense/SOURCES.md`：记录海信爱家标识来源、获取日期、用途和未修改说明。
- `README.md`：更新当前四个整屏章节和新闭环架构的静态方案边界。
- 删除不再使用的 `service-blueprint.tsx` 与 `outcome-statement.tsx`，前提是引用检查确认无其他消费者。

---

### Task 1: 锁定新内容合同并确认 RED

**Files:**
- Create: `src/features/showcase/content.test.ts`
- Create: `src/features/showcase/components/service-architecture.test.tsx`
- Modify: `app/landing-content.test.tsx`
- Modify: `app/fullscreen-showcase-styles.test.ts`

- [x] 在 `content.test.ts` 断言三种中文 ID、五个连接端、三层顺序、两条决策路径、五步闭环、四项试点目标和三阶段推广路径。
- [x] 在组件测试中断言语义有序列表、人工审核后执行、目标免责声明、口径待确认和海信爱家官方标识的替代文本。
- [x] 在首页测试中把“五层引擎”断言改为“闭环架构”，保留 `#architecture` 与编号 `02`，并断言旧五层和三个泛化目标不再出现。
- [x] 在 CSS 合同中锁定三层连续面板、决策双路径、五步闭环、四列/两列/单列目标与减少动效规则。
- [x] 运行目标测试并确认因新数据、组件和样式尚不存在而按预期失败。

验证命令：

```bash
npx vitest run src/features/showcase/content.test.ts src/features/showcase/components/service-architecture.test.tsx app/landing-content.test.tsx app/fullscreen-showcase-styles.test.ts
```

---

### Task 2: 建立只读架构数据与官方爱家标识

**Files:**
- Modify: `src/features/showcase/content.ts`
- Add: `public/images/hisense/aijia-app-mark.*`
- Modify: `public/images/hisense/SOURCES.md`

- [x] 从 Apple App Store 的海信爱家官方开发者页面或海信官方页面取得当前 App 标识；检查实际图像后保留原始比例，不重绘、不合成英文标签。
- [x] 在 `SOURCES.md` 记录官方应用页面、直接素材 URL、获取日期、用途与处理方式。
- [x] 用职责清晰的只读类型和常量替换 `ServiceLayer`、`ScenarioStep`、`Outcome`，不触碰四视角演示数据。
- [x] 所有连接、AI、IoT、库存和追踪能力使用“计划”“拟”等状态文案。
- [x] 运行数据测试并确认 GREEN。

验证命令：

```bash
npx vitest run src/features/showcase/content.test.ts
```

---

### Task 3: 实现闭环架构语义组件

**Files:**
- Create: `src/features/showcase/components/service-architecture.tsx`
- Create: `src/features/showcase/components/pilot-targets.tsx`
- Modify: `src/features/showcase/components/site-footer.tsx`
- Modify: `src/features/showcase/navigation.ts`
- Modify: `app/landing-content.tsx`
- Delete: `src/features/showcase/components/service-blueprint.tsx`
- Delete: `src/features/showcase/components/outcome-statement.tsx`

- [x] `ServiceArchitecture` 使用一条统一事件身份带、三层有序列表、静态双路径决策区和五步有序闭环；装饰节点隐藏于可访问性树。
- [x] 海信爱家连接端显示官方标识和中文名称；其他连接端使用中文文本。
- [x] `PilotTargets` 显示四项指标、非成果声明、口径待确认和三阶段试点路径。
- [x] `LandingContent` 使用“统一服务事件，驱动三层协同闭环”标题和规划措辞导语。
- [x] 顶部与页尾改为“闭环架构”，保留 `#architecture`、`02` 和页面顺序。
- [x] 引用检查确认旧组件无消费者后删除；不扩展共享导航或四视角状态机。
- [x] 运行组件和首页测试并确认 GREEN。

验证命令：

```bash
npx vitest run src/features/showcase/content.test.ts src/features/showcase/components/service-architecture.test.tsx app/landing-content.test.tsx src/features/showcase/components/showcase-navigator.test.tsx
```

---

### Task 4: 延续视觉并完成响应式实现

**Files:**
- Modify: `app/globals.css`
- Modify: `app/fullscreen-showcase-styles.test.ts`

- [x] 复用白色画布、MiSans、青绿色路径、浅灰分隔线和 `28px` 圆角大型系统面板。
- [x] 桌面三层为连续层带；统一事件主线、分流路径和五步闭环关系不依赖颜色。
- [x] 四项目标在宽屏四列、平板两列、手机单列；三层和闭环在窄屏转为纵向且 DOM 顺序不变。
- [x] 不增加页面级横向溢出；正文、辅助说明和导航保持既有最小字阶。
- [x] `prefers-reduced-motion: reduce` 关闭路径信号动效，不隐藏内容。
- [x] 运行 CSS 合同、目标测试、Lint 和类型检查。

验证命令：

```bash
npx vitest run app/fullscreen-showcase-styles.test.ts app/landing-content.test.tsx src/features/showcase/components/service-architecture.test.tsx
npm run lint
npm run typecheck
```

---

### Task 5: 文档、完整验证与本地浏览器验收

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-18-onecare-closed-loop-architecture-design.md`
- Modify: `docs/superpowers/plans/2026-07-18-onecare-closed-loop-architecture.md`

- [x] README 把“五层引擎”改为“闭环架构”，说明新页面内容和所有能力仍是静态规划展示。
- [x] 运行完整测试、运行时测试、Lint、类型检查、生产构建、依赖审计和 `git diff --check`。
- [ ] 本地生产构建在 `1440 × 900`、`1024 × 768`、`390 × 844` 验收导航、内部滚动、无横向溢出、标题层级、爱家标识、规划措辞、目标口径说明、键盘焦点和减少动效。
- [x] 记录验证结果，评估 harness 是否造成可避免的歧义或风险；无充分证据时不修改 `AGENTS.md`。
- [x] 不执行 Vercel 操作。

完整验证命令：

```bash
npm test
npm run test:runtime
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
git diff --check
```

---

### Task 6: Git 与 Pull Request 交付

- [x] 复核只包含本规格范围的文件，报告所有已知失败和未验证假设。
- [x] 创建聚焦提交，不带入原工作树的 `next-env.d.ts`。
- [x] 推送 `codex/onecare-service-architecture-spec`。
- [x] 创建以 `main` 为基线的 Pull Request，摘要明确“静态方案展示、无真实集成、无 Vercel 操作”。
- [x] 返回提交、PR URL、验证结果和剩余人工确认项；不合并 PR。

## 实施验证记录

2026-07-18 已按 RED → GREEN 完成数据、组件、首页和 CSS 合同：首次目标运行中，新组件导入、导航名称、新数据常量和新样式均按预期失败；实现后目标测试为 4 个文件、18 项通过。

完整自动化验证：

- `npm test`：19 个测试文件、73 项测试通过；
- `npm run test:runtime`：生产构建通过，1 个运行时文件、3 项认证测试通过；
- `npm run lint`、`npm run typecheck`、独立 `npm run build` 均通过；
- `npm audit --omit=dev`：0 vulnerabilities；
- `git diff --check`：通过。

本地开发服务返回 HTTP 200，服务端 HTML 包含“统一服务事件，驱动三层协同闭环”、海信爱家标识路径和试点口径声明，且不包含“五层引擎”。应用内浏览器运行环境因本机 `AppData` 读取权限失败，未能完成 `1440 × 900`、`1024 × 768` 和 `390 × 844` 的交互式视觉验收；该项保持未勾选，并作为 PR 已知验证缺口报告。未使用其他浏览器控制方式绕过技能约束。

Harness 规则清楚区分了规格、计划、测试、远端和 Vercel 权限，没有发现需要修改 `AGENTS.md` 的 durable repository-specific 问题。依赖安装仅在独立工作树生成被忽略的 `node_modules`，没有修改 `package.json` 或锁文件。未执行任何 Vercel 操作。

Git 交付：功能提交为 `01912e9 feat: add OneCare closed-loop architecture`，分支 `codex/onecare-service-architecture-spec` 已推送；Pull Request 为 <https://github.com/yjzhang2003/OneCare/pull/7>，状态 `open`，基线为 `main`。PR 未合并。

## 后续视觉迭代

用户在首轮交付后明确要求 PR 不作为界面完成节点，需继续在同一独立工作树中迭代，直至界面达到评审目标。现有 PR 仅保留为未合并的临时评审分支；后续迭代未经用户确认不提交、不推送、不合并、不部署。

2026-07-18 第一轮视觉反馈聚焦以下两项：

- [x] 减少统一标识、三层架构、风险分流、试点指标和推广路径中的连续外框与单元格边框，改用留白、细分隔线和少量柔和底色，延续其他展示页面的开放式编辑布局；
- [x] 核心闭环复用原“五层引擎”的贯穿轨道模式，使横线在 `01` 之前和 `05` 之后均保留延伸，并在窄屏下转换为贯穿首尾的纵向轨道；
- [x] 通过新增 CSS 合约先确认旧实现失败，再完成样式与冗余装饰元素调整；
- [x] 定向验证 3 个测试文件、15 项测试通过，`npm run typecheck` 与 `git diff --check` 通过；
- [x] 用户继续进行了后续界面评审，本轮结果由第三轮全局滚动方案取代。

2026-07-18 第二轮视觉反馈确认将 02 从长页面调整为三个内部章节：

- [x] 新增“架构全景 / 闭环运行 / 试点落地”章节导航，默认显示架构全景；
- [x] 复用 01 的 Tab 语义、左右方向键、Home、End、焦点管理和药丸控件语言，不增加二级路由或英文标签；
- [x] 将原 `ServiceArchitecture` 局部拆分为 `ServiceArchitectureOverview` 与 `ServiceLoopMechanism`，试点页继续复用 `PilotTargets`，数据来源保持不变；
- [x] 02 改为固定展示页，标题与章节导航位于上方，当前章节内容在独立区域滚动；移动端保持单列内容和 44px 触控高度；
- [x] RED 阶段确认章节组件与 Tab 语义缺失；实现后定向验证 4 个文件、18 项通过，类型检查和 `git diff --check` 通过；
- [x] 应用内浏览器可读取本地服务端结构，但开发页未完成客户端水合，无法把浏览器点击结果作为可靠验收证据；组件测试已覆盖点击与键盘切换，生产构建通过，且未为本地验证修改 Next.js 配置；
- [x] 用户继续进行了视觉评审，本轮隐藏面板方案由第三轮全局滚动方案取代。

2026-07-18 第三轮视觉反馈将隐藏 Tab 面板改为全局页面滚动：

- [x] 三个章节全部进入 `#architecture` 的连续文档流，不再使用当前章节内部滚动条；
- [x] 顶部导航改为无椭圆外框的吸顶文字导航，点击后平滑滚动至对应章节；
- [x] 监听页面滚动位置，越过章节边界后自动更新当前高亮；左右方向键、Home、End 和减少动效行为继续保留；
- [x] 章节导航使用 `nav`、`button`、`aria-current` 与 `aria-controls`，不再把同时可见的文档章节误标为 Tab；
- [x] RED 阶段确认旧组件只渲染一个 `tabpanel` 且 CSS 使用嵌套滚动和椭圆容器；实现后定向验证 3 个文件、16 项通过，类型检查和 `git diff --check` 通过；
- [x] 用户确认全局滚动版本达到当前目标，并授权提交、推送及更新现有 Pull Request。

最终 PR 前验证：`npm test` 为 20 个测试文件、78 项通过；`npm run lint`、`npm run typecheck`、`npm run build`、`npm run test:runtime` 和 `git diff --check` 均通过；`npm audit --omit=dev` 为 0 vulnerabilities。审计首次在沙箱内因网络权限失败，使用获批的 npm 官方审计连接重跑后通过。未执行 Vercel 操作。
