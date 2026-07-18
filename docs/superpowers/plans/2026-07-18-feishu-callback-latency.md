# OneCare Feishu Callback Latency Implementation Plan

**Goal:** 将飞书事件 Route 从 Vercel 默认美国区域迁到香港，满足三秒回调窗口。

**Architecture:** 使用 Vercel 每函数区域配置，只改变 `app/api/feishu/events/route.ts` 的计算区域；不改事件解析、认证和机器人业务逻辑。

## Task 1: Lock the regional deployment contract

- [x] 新增失败测试，要求 `vercel.json` 只将事件 Route 配置到 `hkg1`。
- [x] 运行测试确认 RED。
- [x] 新增最小 `vercel.json` 配置。
- [x] 运行目标测试确认 GREEN。

## Task 2: Validate locally and on Vercel

- [x] 运行事件 Route 测试、完整测试、类型检查、Lint 和构建。
- [x] 运行 `git diff --check`。
- [x] 部署 Preview，并检查事件函数实际区域为 `hkg1`。
- [x] 若 Preview 证明配置有效，部署 Production。
- [x] 检查生产事件函数区域为 `hkg1`。
- [ ] 重新观察飞书后台 URL Verification 请求并确认成功。

## Task 3: Document the resolved deployment constraint

- [x] 更新飞书体验规格与技术栈文档，记录香港区域和三秒回调要求。
- [x] 记录验证结果、仍需飞书后台完成的真实验证以及 Harness Reflection。

## Preview Evidence

- Deployment: `dpl_ERqMVXM2PzhyYpw3PmtmNDAxcvtd`
- `api/feishu/events`: Node.js 24, `deployedTo=["hkg1"]`
- `api/auth/feishu/start`: Node.js 24, `deployedTo=["iad1"]`
- Local validation: 24 test files / 105 tests passed; typecheck, lint, and production build passed.
- `git diff --check`: passed.
- Harness Reflection: 现有规格、测试、密钥和部署授权规则足以约束本次修复，没有证据支持修改 `AGENTS.md`；未新增 reflection entry。
- Production deployment: `dpl_36jCYcL9teifexMPVQJomzSKJZX1`, aliased to `https://onecare-loop.vercel.app`.
- Production inspection: `api/feishu/events` is Node.js 24 in `hkg1`; `api/auth/feishu/start` remains in `iad1`.
- Invalid-token production probe: expected HTTP 403 with approximately 0.99-second time to first byte. This proves public reachability and loaded verification configuration without exposing secrets; real Feishu URL Verification remains pending.
