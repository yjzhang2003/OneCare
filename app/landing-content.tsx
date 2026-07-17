import Link from "next/link";

import type { AuthUser } from "../src/features/auth/types";

const capabilities = [
  {
    index: "01",
    title: "VOC 智能分析",
    description: "汇聚客服、服务与用户反馈中的声音，识别高频问题和改善机会。",
    marker: "LISTEN / LEARN",
  },
  {
    index: "02",
    title: "智能预诊",
    description: "结合 IoT 设备运行信号预判故障，让工程师上门前更接近正确答案。",
    marker: "PREDICT / PREPARE",
  },
  {
    index: "03",
    title: "协同调度",
    description: "把客服、工程师、配件与回访角色放进同一条可追踪的服务链路。",
    marker: "DISPATCH / ALIGN",
  },
  {
    index: "04",
    title: "闭环追踪",
    description: "持续监控服务进度，自动触发回访与评价，让每个问题都有结果。",
    marker: "CLOSE / IMPROVE",
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
        <Link className="wordmark" href="/" aria-label="OneCare 首页">
          <span className="wordmark-mark" aria-hidden="true">
            1C
          </span>
          <span>
            ONECARE
            <small>AI 用户服务闭环引擎</small>
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
            <p className="eyebrow">AI SERVICE LOOP ENGINE</p>
            <h1>让每一次服务，都比问题更早一步</h1>
            <p className="hero-intro">
              OneCare 面向海信智能家庭场景，把用户声音、设备信号与服务协同
              串成一条有感知、有响应、有结果的服务闭环。
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
              <span>ONE</span>
              <strong>CARE</strong>
              <span>LOOP</span>
            </div>
            <div className="stage-caption">
              <span>LISTEN</span>
              <span>PREDICT</span>
              <span>DISPATCH</span>
              <span>CLOSE</span>
            </div>
          </div>
        </section>

        <section className="metric-rail" aria-label="产品目标">
          <div>
            <strong>更短</strong>
            <span>服务周期目标</span>
          </div>
          <div>
            <strong>更低</strong>
            <span>重复上门目标</span>
          </div>
          <div>
            <strong>更高</strong>
            <span>用户满意目标</span>
          </div>
          <p>从“用户报修”走向“服务先行”</p>
        </section>

        <section className="capability-section" aria-labelledby="capability-title">
          <div className="section-heading">
            <p>SERVICE LOOP / 01—04</p>
            <h2 id="capability-title">从发现问题，到确认问题真正解决</h2>
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
          <span>PROTOTYPE BOUNDARY</span>
          <p>
            当前为 OneCare 方案原型，仅开放给应用所属企业成员。页面展示服务闭环构想，
            尚未接入真实业务数据或 AI 服务。
          </p>
        </aside>
      </main>

      <footer className="site-footer">
        <span>ONECARE / 2026</span>
        <span>AI × SERVICE × HUMAN WARMTH</span>
      </footer>
    </div>
  );
}
