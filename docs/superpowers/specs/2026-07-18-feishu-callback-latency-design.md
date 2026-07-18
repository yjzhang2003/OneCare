# OneCare 飞书回调低延迟部署设计

## 状态

2026-07-18 已确认两层问题：生产回调代码可响应请求，但 Vercel 最初将 Node.js 函数默认部署在美国弗吉尼亚 `iad1`；迁移到香港 `hkg1` 后，飞书后台的验证请求仍未进入 Vercel 日志。Vercel 官方说明中国大陆可能阻断或限速 `*.vercel.app`，因此用户确认使用已有域名 `ohmyfeishu.top` 的独立子域名作为回调入口。

## 目标

让 `POST /api/feishu/events` 通过中国侧更可达的自定义域名，在飞书要求的三秒窗口内完成 URL Verification，同时不改变网站页面、OAuth 登录或机器人业务逻辑。

## 根因证据

- Vercel 部署产物显示 `api/feishu/events` 位于 `iad1`。
- 本地到生产接口的暖请求首包约为 0.6–0.95 秒。
- 飞书后台验证失败时，Vercel 没有记录对应函数调用，说明超时发生在函数处理前或跨境入口链路上。
- 飞书官方优化指南建议使用位于中国大陆或邻近区域的服务器，减少三秒回调预算中的网络耗时。
- 迁移到 `hkg1` 后，飞书后台再次验证仍提示三秒超时，且同一时间段 Vercel Production 日志没有任何 `/api/feishu/events` 请求。
- Vercel 官方说明 `*.vercel.app` 在中国大陆可能受到 DNS、SNI 或跨境链路影响，并建议使用自定义域名。

## 方案

在 `vercel.json` 中只为 `app/api/feishu/events/route.ts` 指定香港 `hkg1`：

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "app/api/feishu/events/route.ts": {
      "regions": ["hkg1"]
    }
  }
}
```

保留 Node.js runtime，因为现有事件验证依赖 Node `crypto` 与飞书官方 Node SDK。首页、OAuth 和其他函数继续使用现有部署区域。

## 验证

1. 配置契约测试确认只配置事件 Route 且目标为 `hkg1`。
2. 运行事件 Route 单元测试、类型检查、Lint、构建和 `git diff --check`。
3. 部署 Vercel Preview，检查部署产物中 `api/feishu/events` 的 `deployedTo` 为 `hkg1`，其他函数未被全局迁移。
4. 部署 Production 后检查生产产物区域，并让飞书开发者后台重新验证请求地址。

## 安全与边界

- 不修改或输出 App Secret、Verification Token、Encrypt Key。
- 不放宽签名、Token 或加密校验。
- 不把三秒预算用于消息回复；现有 `after()` 异步回复策略保持不变。
- 若当前 Vercel 账户不支持 `hkg1`，停止部署并改用新加坡 `sin1` 或中国大陆托管服务，不伪称已打通。

## Preview 验证记录

Preview `dpl_ERqMVXM2PzhyYpw3PmtmNDAxcvtd` 已验证 Vercel 接受该配置：`api/feishu/events` 使用 Node.js 24 并部署到 `hkg1`，`api/auth/feishu/start` 仍部署到 `iad1`。这证明配置只影响飞书事件函数。Production 部署和飞书后台 URL Verification 仍需分别验证，完成前不宣称回调已完全打通。

## Production 验证记录

Production `dpl_36jCYcL9teifexMPVQJomzSKJZX1` 已绑定 `https://onecare-loop.vercel.app`。部署产物确认事件函数位于 `hkg1`，OAuth 函数仍位于 `iad1`；使用错误 token 的安全探测按预期返回 HTTP 403，首包约 0.99 秒。这证明公网地址、香港函数和服务端验证配置均已加载。飞书后台使用真实 challenge 的 URL Verification 仍是最终验收门槛，成功前不宣称事件订阅完全打通。

## 自定义域名设计

### 域名与影响范围

- 新增子域名：`onecare.ohmyfeishu.top`。
- 子域名只绑定 Vercel `onecare` 项目，不迁移 `ohmyfeishu.top` 或 `www.ohmyfeishu.top`；两者继续属于现有 `oh-my-feishu` 项目。
- 新的飞书事件请求地址为 `https://onecare.ohmyfeishu.top/api/feishu/events`。
- `https://onecare-loop.vercel.app` 继续作为现有生产网站地址，不强制重定向，也不修改 OAuth Redirect URI。

### DNS 配置流程

1. 在 Vercel `onecare` 项目登记 `onecare.ohmyfeishu.top`。
2. 读取 Vercel 返回的精确 DNS 要求，不预先假设 CNAME 目标。
3. 由于 `ohmyfeishu.top` 当前使用阿里云 DNS，用户在阿里云云解析添加：记录类型 `CNAME`、主机记录 `onecare`、记录值为 Vercel 返回值、TTL 使用默认值。
4. 等待 Vercel 显示域名配置有效并完成 HTTPS 证书签发。
5. 使用新域名直接 POST 到事件 Route，确认无跳转、证书有效、预期错误 token 返回 403，并在 Vercel 日志看到请求命中 `hkg1`。
6. 飞书后台改填新事件请求地址并重新执行 URL Verification。

### 失败处理

- DNS 未生效或证书未签发时，不在飞书后台反复验证。
- 若自定义域名请求进入 Vercel但返回 403，检查飞书后台与 Production 的 Verification Token/Encrypt Key 是否一致，不泄露具体值。
- 若自定义域名从飞书侧仍完全不进入 Vercel 日志，则停止继续调整 Vercel Route，改用飞书官方长连接；长连接需要独立规格，因为它引入持续运行的 Node 进程并改变事件传输方式。

### 验收标准

- Vercel 显示 `onecare.ohmyfeishu.top` 配置有效且 HTTPS 正常。
- 新域名无 30x 跳转地访问 `/api/feishu/events`。
- 飞书后台 URL Verification 成功，Vercel 日志能看到对应 POST。
- 完成前不宣称机器人事件订阅已打通。

## 参考

- [Vercel：中国大陆访问 Vercel 托管网站](https://vercel.com/kb/guide/accessing-vercel-hosted-sites-from-mainland-china)
- [飞书：使用长连接接收事件](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case)
