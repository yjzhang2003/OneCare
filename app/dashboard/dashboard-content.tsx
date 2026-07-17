import Link from "next/link";

import type { AuthUser } from "../../src/features/auth/types";

const workspaceModules = [
  {
    index: "A1",
    title: "人群地图",
    description: "按人生阶段、城市线级与车型偏好交叉下钻。",
    signal: "SEGMENT",
  },
  {
    index: "A2",
    title: "用户原声",
    description: "回到可定位的评论与访谈片段，理解结论从何而来。",
    signal: "EVIDENCE",
  },
  {
    index: "A3",
    title: "车型对比",
    description: "持续观察竞品人群、卖点和市场反馈之间的变化。",
    signal: "COMPARE",
  },
] as const;

export function DashboardContent({ user }: { user: AuthUser }) {
  const initial = Array.from(user.name)[0] ?? "A";

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <Link className="wordmark compact-wordmark" href="/">
          <span className="wordmark-mark" aria-hidden="true">
            AI
          </span>
          <span>AUTO INSIGHT</span>
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
            <p className="eyebrow">RESEARCH DESK / 01</p>
            <h1>今天，从哪一群用户开始？</h1>
          </div>
          <div className="prototype-badge">
            <span aria-hidden="true" /> PRODUCT PROTOTYPE
          </div>
        </section>

        <section className="workspace-grid">
          <div className="signal-panel">
            <div className="panel-heading">
              <div>
                <p>VOICE PULSE</p>
                <h2>用户信号脉冲</h2>
              </div>
              <span>STATIC PREVIEW</span>
            </div>
            <div className="pulse-chart" aria-label="静态用户信号示意图">
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
              <span>观察</span>
              <span>验证</span>
              <span>决策</span>
            </div>
          </div>

          <aside className="queue-panel">
            <p>RESEARCH QUEUE</p>
            <h2>研究队列</h2>
            <ol>
              <li>
                <span>01</span>
                <div>
                  <strong>核心家庭用户</strong>
                  <small>等待数据接入</small>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>年轻首购人群</strong>
                  <small>等待数据接入</small>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>新能源增换购</strong>
                  <small>等待数据接入</small>
                </div>
              </li>
            </ol>
          </aside>
        </section>

        <section className="module-section" aria-labelledby="module-title">
          <div className="module-heading">
            <p>WORKSPACE MODULES</p>
            <h2 id="module-title">洞察工作台</h2>
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
                  <span>演示框架</span>
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
