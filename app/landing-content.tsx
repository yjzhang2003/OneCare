import type { AuthUser } from "../src/features/auth/types";
import {
  outcomes,
  perspectives,
  scenarioSteps,
  serviceLayers,
  teamMembers,
} from "../src/features/showcase/content";
import { JourneyScene } from "../src/features/showcase/components/journey-scene";
import { OutcomeStatement } from "../src/features/showcase/components/outcome-statement";
import { SectionFrame } from "../src/features/showcase/components/section-frame";
import { ServiceBlueprint } from "../src/features/showcase/components/service-blueprint";
import { SiteFooter } from "../src/features/showcase/components/site-footer";
import { SiteHeader } from "../src/features/showcase/components/site-header";

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
        <section className="hero hero--service-film">
          <div className="hero-film__signal" aria-hidden="true">
            <span>−18°</span>
            <i />
            <span>04°</span>
          </div>
          <div className="hero-film__copy">
            <p className="eyebrow">ONECARE / SERVICE SIGNAL 001</p>
            <h1>
              <span>让每一次服务，</span>
              <span>都比问题更早一步</span>
            </h1>
            <p className="hero-intro">
              OneCare 面向海信智能家庭场景，把用户声音、设备信号与服务协同
              串成一条有感知、有判断、有行动、会学习的服务闭环。
            </p>

            <div className="hero-actions">
              <a className="primary-action" href="#journey">
                <span>跟随服务信号</span>
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
              {user
                ? `${user.name}，欢迎回来`
                : "方案原型 · 未接入真实业务数据"}
            </p>
          </div>
          <div className="hero-film__case" aria-hidden="true">
            <span>异常信号</span>
            <strong>冰箱温控异常</strong>
            <i />
          </div>
        </section>

        <section
          className="service-journey"
          id="journey"
          aria-labelledby="journey-title"
        >
          <div className="journey-intro">
            <p>01 / FOUR PERSPECTIVES</p>
            <h2 id="journey-title">同一个问题，在四个角色之间连续流动</h2>
            <p>用户不必重复描述，服务上下文沿同一条信号链持续传递。</p>
          </div>
          <div className="journey-scenes">
            {perspectives.map((perspective) => (
              <JourneyScene
                key={perspective.index}
                perspective={perspective}
              />
            ))}
          </div>
        </section>

        <SectionFrame
          id="architecture"
          index="02"
          eyebrow="FIVE-LAYER ENGINE"
          title="感知—诊断—编排—服务—学习"
          intro="一次服务不是五个孤立模块，而是一条从问题信号到持续改善的闭环蓝图。"
          tone="dark"
        >
          <ServiceBlueprint layers={serviceLayers} events={scenarioSteps} />
        </SectionFrame>

        <section
          className="outcome-section"
          aria-labelledby="outcome-title"
        >
          <div>
            <p>03 / OUTCOME</p>
            <h2 id="outcome-title">一次就好</h2>
            <p>以下是 OneCare 的方案目标，不代表已经实现的生产指标。</p>
          </div>
          <OutcomeStatement outcomes={outcomes} />
          <p className="outcome-loop">
            本次解决 → 知识沉淀 → 下一次更早发现
          </p>
        </section>

        <SectionFrame
          id="team"
          index="04"
          eyebrow="TEAM CREDITS"
          title="三种能力，共同完成服务创新"
          intro="成员信息待补充；当前只展示参赛团队的能力互补关系。"
        >
          <div className="team-credits">
            {teamMembers.map((member) => (
              <article className="team-credit" key={member.index}>
                <span>成员 {member.index}</span>
                <h3>{member.title}</h3>
                <p>{member.capabilities.join(" / ")}</p>
              </article>
            ))}
          </div>
        </SectionFrame>
      </main>

      <SiteFooter />
    </div>
  );
}
