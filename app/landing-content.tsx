import Link from "next/link";

import type { AuthUser } from "../src/features/auth/types";

const capabilities = [
  {
    index: "01",
    title: "千万级数据洞察",
    description: "把分散的用户原声、访谈与行为信号，收束成可追溯的产品判断。",
    marker: "SIGNAL / SCALE",
  },
  {
    index: "02",
    title: "动态人群地图",
    description: "沿人生阶段、城市线级与车型偏好切入，找到人群之间真正的分界线。",
    marker: "SEGMENT / MAP",
  },
  {
    index: "03",
    title: "飞书协同",
    description: "用企业身份进入同一洞察现场，让研究结论自然流向产品定义过程。",
    marker: "TEAM / FLOW",
  },
] as const;

const errorMessages: Record<string, string> = {
  configuration_error: "登录服务尚未完成配置，请稍后再试。",
  access_denied: "你已取消飞书授权，可以随时重新登录。",
  invalid_state: "登录请求已失效，请重新发起。",
  token_exchange_failed: "飞书登录暂时未完成，请重新尝试。",
  user_info_failed: "暂时无法读取飞书身份，请重新尝试。",
};

type LandingContentProps = {
  user: AuthUser | null;
  authError?: string;
};

export function LandingContent({ user, authError }: LandingContentProps) {
  const errorMessage = authError ? errorMessages[authError] : undefined;

  return (
    <div className="landing-shell">
      <header className="site-header">
        <Link className="wordmark" href="/" aria-label="Auto Insight 首页">
          <span className="wordmark-mark" aria-hidden="true">
            AI
          </span>
          <span>
            AUTO INSIGHT
            <small>汽车用户洞察引擎</small>
          </span>
        </Link>
        <div className="header-status">
          <span className="status-light" aria-hidden="true" />
          ENTERPRISE DEMO · 01
        </div>
      </header>

      {errorMessage ? (
        <div className="auth-notice" role="alert">
          <span>AUTH / NOTICE</span>
          {errorMessage}
        </div>
      ) : null}

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">USER SIGNAL OPERATING SYSTEM</p>
            <h1>让每一次产品定义，都听见真实用户</h1>
            <p className="hero-intro">
              Auto Insight 把海量用户声音变成可交互、可追溯的研究现场，
              让车型立项从经验判断走向持续验证。
            </p>

            <div className="hero-actions">
              <a
                className="primary-action"
                href={user ? "/dashboard" : "/api/auth/feishu/start"}
              >
                <span>{user ? "进入工作台" : "使用飞书登录"}</span>
                <span className="action-arrow" aria-hidden="true">
                  ↗
                </span>
              </a>
              <p className="session-copy">
                {user ? `${user.name}，欢迎回来` : "FEISHU VERIFIED ACCESS"}
              </p>
            </div>
          </div>

          <div className="signal-stage" aria-hidden="true">
            <div className="stage-index">00—01</div>
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="signal-core">
              <span>USER</span>
              <strong>VOICE</strong>
              <span>MODEL</span>
            </div>
            <div className="stage-caption">
              <span>INPUT</span>
              <span>TRACE</span>
              <span>DECIDE</span>
            </div>
          </div>
        </section>

        <section className="metric-rail" aria-label="产品目标">
          <div>
            <strong>分钟级</strong>
            <span>洞察响应</span>
          </div>
          <div>
            <strong>10+</strong>
            <span>竞品持续追踪</span>
          </div>
          <div>
            <strong>全链路</strong>
            <span>结论可追溯</span>
          </div>
          <p>从“等报告”到“即时查”</p>
        </section>

        <section className="capability-section" aria-labelledby="capability-title">
          <div className="section-heading">
            <p>CAPABILITY INDEX</p>
            <h2 id="capability-title">一套更接近真实用户的研究界面</h2>
          </div>
          <div className="capability-grid">
            {capabilities.map((capability) => (
              <article className="capability-card" key={capability.index}>
                <div className="card-topline">
                  <span>{capability.index}</span>
                  <span>{capability.marker}</span>
                </div>
                <h3>{capability.title}</h3>
                <p>{capability.description}</p>
                <div className="card-scanline" aria-hidden="true" />
              </article>
            ))}
          </div>
        </section>

        <aside className="trust-boundary">
          <span>ACCESS BOUNDARY</span>
          <p>
            当前为企业内部应用演示，仅开放给应用所属企业成员。页面展示产品框架，
            尚未接入真实汽车数据或 AI 分析结果。
          </p>
        </aside>
      </main>

      <footer className="site-footer">
        <span>AUTO INSIGHT / 2026</span>
        <span>PRODUCT DEFINITION × USER TRUTH</span>
      </footer>
    </div>
  );
}
