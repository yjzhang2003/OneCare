import type { AuthUser } from "../src/features/auth/types";
import {
  perspectives,
  scenarioSteps,
  serviceLayers,
  teamMembers,
} from "../src/features/showcase/content";
import { RoleCard } from "../src/features/showcase/components/role-card";
import { SectionFrame } from "../src/features/showcase/components/section-frame";
import { SignalFlow } from "../src/features/showcase/components/signal-flow";
import { SiteFooter } from "../src/features/showcase/components/site-footer";
import { SiteHeader } from "../src/features/showcase/components/site-header";
import { StatusTag } from "../src/features/showcase/components/status-tag";

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
  const workspaceHref = user ? "/dashboard" : "/api/auth/feishu/start";

  return (
    <div className="landing-shell">
      <SiteHeader user={user} />

      {errorMessage ? (
        <div className="auth-notice" role="alert">
          <span>AUTH / NOTICE</span>
          {errorMessage}
        </div>
      ) : null}

      <main>
        <section className="hero">
          <div className="hero-copy">
            <StatusTag>PRODUCT PROTOTYPE · 01</StatusTag>
            <p className="eyebrow">AI SERVICE LOOP ENGINE</p>
            <h1>
              <span>让每一次服务，</span>
              <span>都比问题更早一步</span>
            </h1>
            <p className="hero-intro">
              OneCare 面向海信智能家庭场景，把用户声音、设备信号与服务协同
              串成一条有感知、有判断、有行动、会学习的服务闭环。
            </p>

            <div className="hero-actions">
              <a className="primary-action" href="#perspectives">
                <span>查看角色视角</span>
                <span className="action-arrow" aria-hidden="true">
                  ↓
                </span>
              </a>
              <a className="secondary-action" href={workspaceHref}>
                {user ? "进入工作台" : "使用飞书登录"}
                <span aria-hidden="true">↗</span>
              </a>
            </div>
            <p className="session-copy">
              {user ? `${user.name}，欢迎回来` : "FEISHU VERIFIED ACCESS"}
            </p>
          </div>

          <div className="signal-stage" aria-hidden="true">
            <div className="stage-index">00—05</div>
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="signal-core">
              <span>ONE</span>
              <strong>CARE</strong>
              <span>LOOP</span>
            </div>
            <div className="stage-caption">
              <span>SENSE</span>
              <span>DIAGNOSE</span>
              <span>ORCHESTRATE</span>
              <span>SERVE</span>
              <span>LEARN</span>
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
          <p>从被动报修，走向主动关怀</p>
        </section>

        <SectionFrame
          id="perspectives"
          index="01"
          eyebrow="FOUR PERSPECTIVES"
          title="同一个问题，四个视角，一条连续服务链"
          intro="每个角色拥有自己的工作界面，但共享同一份服务上下文。角色页面将逐步开放，主页先呈现它们如何协同。"
        >
          <div className="role-grid">
            {perspectives.map((role) => (
              <RoleCard key={role.index} role={role} />
            ))}
          </div>
        </SectionFrame>

        <SectionFrame
          id="architecture"
          index="02"
          eyebrow="FIVE-LAYER ARCHITECTURE"
          title="感知—诊断—编排—服务—学习"
          intro="五层不是五个孤立模块，而是一条持续流动的服务信号链：每一次解决，都成为下一次提前发现的依据。"
          tone="dark"
        >
          <SignalFlow layers={serviceLayers} />
        </SectionFrame>

        <SectionFrame
          id="scenario"
          index="03"
          eyebrow="SOLUTION PATH"
          title="让架构落到一次真实可感的服务旅程"
          intro="以下案例用于说明方案如何流动，不代表已经接入生产设备、工单或 AI 服务。"
        >
          <div className="scenario-layout">
            <div className="scenario-lead">
              <StatusTag>方案演示</StatusTag>
              <p className="scenario-kicker">SMART REFRIGERATOR / CASE 01</p>
              <h3>冰箱温控异常</h3>
              <p>
                从一条微弱的温度波动开始，OneCare 把设备、用户与服务团队连接起来，
                让问题少一次转述，也少一次等待。
              </p>
              <div className="scenario-device" aria-hidden="true">
                <span>−18°</span>
                <i />
                <span>04°</span>
              </div>
            </div>
            <ol className="scenario-list">
              {scenarioSteps.map((step, index) => (
                <li key={step.layer}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <small>{step.layer}</small>
                    <h4>{step.title}</h4>
                    <p>{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </SectionFrame>

        <SectionFrame
          id="team"
          index="04"
          eyebrow="TEAM CAPABILITY"
          title="三种能力，组成一支完整的服务创新团队"
          intro="成员资料将在确认后替换；当前只展示参赛团队所需的能力互补关系，不虚构个人履历。"
        >
          <div className="team-grid">
            {teamMembers.map((member) => (
              <article className="team-card" key={member.index}>
                <div className="team-card__index">
                  <span>成员 {member.index}</span>
                  <StatusTag>成员信息待补充</StatusTag>
                </div>
                <div className="team-card__portrait" aria-hidden="true">
                  <span>{member.index}</span>
                </div>
                <h3>{member.title}</h3>
                <ul>
                  {member.capabilities.map((capability) => (
                    <li key={capability}>{capability}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </SectionFrame>
      </main>

      <SiteFooter />
    </div>
  );
}
