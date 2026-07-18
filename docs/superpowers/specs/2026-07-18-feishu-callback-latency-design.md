# OneCare 飞书回调低延迟部署设计

## 状态

2026-07-18 已确认问题：生产回调代码可响应请求，但 Vercel 将 Node.js 函数默认部署在美国弗吉尼亚 `iad1`。飞书开发者后台从中国侧验证请求地址时提示三秒超时，且对应请求没有进入 Vercel 函数日志。

## 目标

让 `POST /api/feishu/events` 在飞书要求的三秒窗口内完成 URL Verification，同时不改变网站页面、OAuth 登录或机器人业务逻辑。

## 根因证据

- Vercel 部署产物显示 `api/feishu/events` 位于 `iad1`。
- 本地到生产接口的暖请求首包约为 0.6–0.95 秒。
- 飞书后台验证失败时，Vercel 没有记录对应函数调用，说明超时发生在函数处理前或跨境入口链路上。
- 飞书官方优化指南建议使用位于中国大陆或邻近区域的服务器，减少三秒回调预算中的网络耗时。

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
