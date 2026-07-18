import Link from "next/link";

import type { AuthUser } from "../../src/features/auth/types";

const workspaceModules = [
  {
    index: "A1",
    title: "VOC 洞察",
    description: "识别跨渠道高频问题、情绪变化与产品改善机会。",
    signal: "LISTEN",
  },
  {
    index: "A2",
    title: "智能预诊",
    description: "聚合设备风险信号，为上门诊断与配件准备提供线索。",
    signal: "PREDICT",
  },
  {
    index: "A3",
    title: "协同调度",
    description: "串联客服、工程师、配件与回访角色的服务节点。",
    signal: "DISPATCH",
  },
  {
    index: "A4",
    title: "闭环追踪",
    description: "监控处理进度、回访与满意度，确认问题真正解决。",
    signal: "CLOSE",
  },
] as const;

export function DashboardContent({ user }: { user: AuthUser }) {
  const initial = Array.from(user.name)[0] ?? "A";

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <Link
          aria-label="万护 OneCare 首页"
          className="wordmark compact-wordmark"
          href="/"
        >
          <span className="wordmark-mark" aria-hidden="true">
            1C
          </span>
          <span>万护 ONECARE</span>
        </Link>

        <div className="identity-cluster">
          <div className="avatar" aria-hidden="true">
            {user.avatarUrl ? (
              // Feishu avatar hosts vary; unoptimized display avoids proxying arbitrary URLs.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
              />
            ) : (
              initial
            )}
          </div>
          <div>
            <strong>{user.name}</strong>
            <span>
              <i aria-hidden="true" /> 飞书身份已验证
            </span>
          </div>
          <form action="/api/auth/logout" method="post">
            <button type="submit">退出登录</button>
          </form>
        </div>
      </header>

      <main className="dashboard-main">
        <section className="workspace-intro">
          <div>
            <p className="eyebrow">SERVICE CONTROL / 01</p>
            <h1>服务闭环指挥台</h1>
          </div>
          <div className="prototype-badge">
            <span aria-hidden="true" /> PRODUCT PROTOTYPE
          </div>
        </section>

        <section className="workspace-grid">
          <div className="signal-panel">
            <div className="panel-heading">
              <div>
                  <p>DEVICE RISK PULSE</p>
                  <h2>设备风险信号</h2>
              </div>
              <span>STATIC PREVIEW</span>
            </div>
            <div className="pulse-chart" aria-label="静态设备风险信号示意图">
              {[34, 52, 43, 68, 61, 82, 73, 92, 78, 87, 71, 95].map(
                (height, index) => (
                  <span
                    key={`${height}-${index}`}
                    style={{ "--pulse": `${height}%` } as React.CSSProperties}
                  />
                ),
              )}
            </div>
            <div className="chart-axis">
              <span>感知</span>
              <span>预诊</span>
              <span>响应</span>
            </div>
          </div>

          <aside className="queue-panel">
            <p>SERVICE QUEUE</p>
            <h2>待协同服务</h2>
            <ol>
              <li>
                <span>01</span>
                <div>
                  <strong>冰箱温控异常</strong>
                  <small>静态预览 · 待预诊</small>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>空调制冷波动</strong>
                  <small>静态预览 · 待调度</small>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>电视开机反馈</strong>
                  <small>静态预览 · 待回访</small>
                </div>
              </li>
            </ol>
          </aside>
        </section>

        <section className="module-section" aria-labelledby="module-title">
          <div className="module-heading">
            <p>万护 / ONECARE MODULES</p>
            <h2 id="module-title">服务全链路</h2>
          </div>
          <div className="module-grid">
            {workspaceModules.map((module) => (
              <article key={module.index}>
                <div className="module-index">
                  <span>{module.index}</span>
                  <span>{module.signal}</span>
                </div>
                <h3>{module.title}</h3>
                <p>{module.description}</p>
                <footer>
                  <span>静态预览</span>
                  <span aria-hidden="true">→</span>
                </footer>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
