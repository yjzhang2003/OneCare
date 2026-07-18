import Image from "next/image";
import Link from "next/link";

import type { AuthUser } from "../../src/features/auth/types";
import { OneCareLogo } from "../../src/features/showcase/components/onecare-logo";

export type LoginSourceRole = "agent" | "engineer" | "operations";

const sourceMessages: Record<LoginSourceRole, string> = {
  agent: "从客服视角继续：在飞书接收转人工会话与 AI 预诊摘要。",
  engineer: "从工程师视角继续：在飞书接收工单、配件与上门提醒。",
  operations: "从后台视角继续：在飞书接收 VOC 异常与闭环任务。",
};

type LoginContentProps = Readonly<{
  user: AuthUser | null;
  authError?: string;
  sourceRole?: LoginSourceRole;
}>;

const steps = [
  {
    index: "01",
    title: "加入体验组织",
    description: "尚未加入 OneCare 时，先扫描右侧二维码完成加入。",
  },
  {
    index: "02",
    title: "验证飞书身份",
    description: "使用组织内的飞书账号完成身份验证。",
  },
  {
    index: "03",
    title: "在飞书开始体验",
    description: "打开飞书，在顶部搜索 OneCare 与服务助手对话。",
  },
] as const;

export function LoginContent({
  user,
  authError,
  sourceRole,
}: LoginContentProps) {
  const initial = user ? (Array.from(user.name)[0] ?? "万") : "万";

  return (
    <div className="feishu-login-shell">
      <header className="feishu-login-header">
        <Link aria-label="万护 OneCare 首页" href="/">
          <OneCareLogo decorative size={34} tone="light" />
          <span>
            万护 ONECARE
            <small>飞书体验入口</small>
          </span>
        </Link>
        <Link className="feishu-login-header__back" href="/">
          返回首页
        </Link>
      </header>

      <main className="feishu-login-main">
        <section className="feishu-login-guide" aria-labelledby="login-title">
          <p className="feishu-login-kicker">FEISHU EXPERIENCE</p>
          <h1 id="login-title">在飞书里体验万护</h1>
          <p className="feishu-login-intro">
            网站负责说明方案，飞书承接真实体验。加入 OneCare 组织、验证身份，
            然后在熟悉的协作入口里开始服务对话。
          </p>

          {sourceRole ? (
            <p className="feishu-source-note">{sourceMessages[sourceRole]}</p>
          ) : null}

          <ol className="feishu-step-list">
            {steps.map((step) => (
              <li key={step.index}>
                <span>{step.index}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>

          {authError ? (
            <div className="feishu-auth-notice" role="alert">
              <span>登录提示</span>
              {authError}
            </div>
          ) : null}

          {user ? (
            <div className="feishu-verified-panel">
              <div className="feishu-verified-identity">
                <div className="feishu-verified-avatar" aria-hidden="true">
                  {user.avatarUrl ? (
                    // Feishu avatar hosts vary; render directly without proxying.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    initial
                  )}
                </div>
                <div>
                  <strong>{user.name}</strong>
                  <span>飞书身份已验证</span>
                </div>
              </div>
              <div className="feishu-bot-status">
                <span>机器人配置中</span>
                <strong>打开飞书，在顶部搜索「OneCare」开始体验</strong>
                <p>机器人完成发布后即可在组织内搜索；当前页面不会进入另一套网站后台。</p>
              </div>
              <form action="/api/auth/logout" method="post">
                <button className="feishu-auth-secondary" type="submit">
                  退出登录
                </button>
              </form>
            </div>
          ) : (
            <a className="feishu-auth-action" href="/api/auth/feishu/start">
              使用飞书验证身份
            </a>
          )}
        </section>

        <aside className="feishu-invite-card" aria-label="OneCare 体验组织邀请">
          <div className="feishu-invite-card__heading">
            <div>
              <span>比赛体验组织</span>
              <h2>扫码加入 OneCare</h2>
            </div>
            <span className="feishu-invite-card__limit">仅支持 +86 手机号</span>
          </div>
          <Image
            alt="加入 OneCare 体验组织的飞书二维码"
            className="feishu-invite-image"
            height={1334}
            priority
            src="/images/feishu/onecare-enterprise-invite-2026-08-29.png"
            width={750}
          />
          <div className="feishu-invite-card__meta">
            <strong>二维码有效期至 2026 年 8 月 29 日</strong>
            <span>加入申请可能需要管理员审核</span>
          </div>
        </aside>
      </main>

      <footer className="feishu-login-footer">
        <span>万护 OneCare</span>
        <p>AI 用户服务全链路闭环引擎 · 比赛体验原型</p>
      </footer>
    </div>
  );
}
