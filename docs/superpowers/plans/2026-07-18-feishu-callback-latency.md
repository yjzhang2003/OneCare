# OneCare Feishu Callback Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让飞书事件 Route 通过香港函数和自定义域名 `onecare.ohmyfeishu.top` 满足三秒回调窗口。

**Architecture:** 使用 Vercel 每函数区域配置，只改变 `app/api/feishu/events/route.ts` 的计算区域；再把独立子域名直接绑定到同一个 Vercel Production 项目，绕开中国大陆对 `*.vercel.app` 的潜在阻断。不改事件解析、认证、OAuth 或机器人业务逻辑。

**Tech Stack:** Vercel CLI 56、Vercel Domains、阿里云云解析 DNS、Node.js 24、Next.js 16、飞书 HTTP 事件订阅。

## Global Constraints

- 只使用 `onecare.ohmyfeishu.top`；不迁移或覆盖 `ohmyfeishu.top` 与 `www.ohmyfeishu.top`。
- 现有生产网站 `https://onecare-loop.vercel.app` 和 OAuth Redirect URI 保持不变。
- CNAME 记录值必须使用 Vercel 实际返回值，不凭记忆填写。
- DNS 与 HTTPS 未就绪前不在飞书后台反复验证。
- 不输出 App Secret、Verification Token、Encrypt Key 或任何访问令牌。
- 飞书 URL Verification 成功前不宣称回调已经打通。

---

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

### Task 4: Bind and verify the custom callback domain

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-feishu-callback-latency.md`
- No application code changes.

**Interfaces:**
- Consumes: Vercel project `onecare`, domain `ohmyfeishu.top`, existing Production Route `POST /api/feishu/events`.
- Produces: HTTPS endpoint `https://onecare.ohmyfeishu.top/api/feishu/events`.

- [x] **Step 1: Register the subdomain with the OneCare Vercel project**

Run:

```bash
npx vercel@latest domains add onecare.ohmyfeishu.top onecare
npx vercel@latest domains inspect onecare.ohmyfeishu.top
```

Expected: Vercel assigns `onecare.ohmyfeishu.top` only to project `onecare` and prints the exact required CNAME record. Do not use `--force`.

- [x] **Step 2: Hand off the exact Aliyun DNS record**

Report these fields without changing DNS on the user's behalf:

```text
Record type: CNAME
Host record: onecare
Record value: copy the exact CNAME target printed by `vercel domains add`
TTL: default / 600 seconds
```

Expected: user adds the record in the Alibaba Cloud DNS zone for `ohmyfeishu.top` and confirms completion.

- [x] **Step 3: Verify authoritative DNS and Vercel TLS readiness**

Run after user confirmation:

```bash
dig +short onecare.ohmyfeishu.top CNAME @dns23.hichina.com
dig +short onecare.ohmyfeishu.top CNAME @dns24.hichina.com
npx vercel@latest domains inspect onecare.ohmyfeishu.top
curl -sS -o /dev/null -w 'status=%{http_code} redirect=%{redirect_url} total=%{time_total}s\n' \
  -X POST 'https://onecare.ohmyfeishu.top/api/feishu/events' \
  -H 'content-type: application/json' \
  --data '{"challenge":"probe","token":"invalid","type":"url_verification"}'
```

Expected: both authoritative nameservers return exactly the CNAME target printed in Step 1; Vercel reports valid configuration; HTTPS probe returns 403 without redirect and within three seconds.

- [ ] **Step 4: Validate the real Feishu challenge**

Configure this exact request URL in Feishu:

```text
https://onecare.ohmyfeishu.top/api/feishu/events
```

Then run:

```bash
npx vercel@latest logs --environment production --since 10m --limit 100 --json
```

Expected: Feishu reports URL Verification success and Vercel logs contain the corresponding `POST /api/feishu/events` with HTTP 200.

- [ ] **Step 5: Record the external validation result**

Update this plan with DNS target, Vercel domain state, HTTPS probe timing, Feishu result, and any remaining gap. Run:

```bash
git diff --check
git status --short --branch
```

Expected: documentation contains no secret values; `git diff --check` passes.

### Custom Domain Execution Evidence

- Vercel attached `onecare.ohmyfeishu.top` to project `onecare` without `--force` and confirmed domain ownership in the current account scope.
- Current authoritative nameservers remain `dns23.hichina.com` and `dns24.hichina.com`; the root domain and `www` assignment were not changed.
- Vercel's highest-ranked required record is `CNAME onecare 58f23ec1de303fe0.vercel-dns-017.com.`
- The user added the CNAME. Both Alibaba Cloud authoritative nameservers, Alibaba Public DNS, and Cloudflare DNS return the same target.
- Vercel reports `configured-correctly` and confirmed the domain is attached only to project `onecare`.
- Automatic TLS was not yet present immediately after DNS verification, so Vercel certificate issuance was triggered explicitly. The resulting Let's Encrypt certificate covers `onecare.ohmyfeishu.top` and is valid through 2026-10-16.
- HTTPS probe returns the expected 403 without redirect in approximately 1.71 seconds; `x-vercel-id` confirms execution in `hkg1`.

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
