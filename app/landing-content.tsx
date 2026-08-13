import type { AuthUser } from "../src/features/auth/types";
import type { VocMetricsResult } from "../src/features/voc/metrics";
import {
  architectureLayers,
  closedLoopSteps,
  connectedSystems,
  decisionPaths,
  pilotTargets,
  perspectives,
  rolloutStages,
  serviceIdentities,
  teamMembers,
} from "../src/features/showcase/content";
import { HeroMedia } from "../src/features/showcase/components/hero-media";
import { ArchitectureChapters } from "../src/features/showcase/components/architecture-chapters";
import { PerspectiveTabs } from "../src/features/showcase/components/perspective-tabs";
import { SectionFrame } from "../src/features/showcase/components/section-frame";
import { SiteFooter } from "../src/features/showcase/components/site-footer";
import { ShowcaseNavigator } from "../src/features/showcase/components/showcase-navigator";
import { ShowcasePageHeading } from "../src/features/showcase/components/showcase-page-heading";

const errorMessages: Record<string, string> = {
  configuration_error: "登录服务尚未完成配置，请稍后再试。",
  access_denied: "你已取消飞书授权，可以随时重新登录。",
  invalid_state: "登录请求已失效，请重新发起。",
  token_exchange_failed: "飞书登录暂时未完成，请重新尝试。",
  user_info_failed: "暂时无法读取飞书身份，请重新尝试。",
  // Set by app/page.tsx when the /enter loop guard (shouldStartAuthorization)
  // reports a prior attempt that did not produce a session, with no more
  // specific auth_error code attached. Deliberately generic — this must never
  // surface the underlying reason to the client.
  tried: "工作台授权未成功，你可以点击下方「进入工作台」重新尝试，或继续浏览方案展示厅。",
};

type LandingContentProps = {
  user: AuthUser | null;
  authError?: string;
  // Fetched by app/page.tsx (a sibling server component already awaiting
  // getCurrentSession() there) and threaded through this component and
  // PerspectiveTabs down to OperationsWorkspace, so the VOC showcase panel
  // reflects the same real, cached aggregation the public dashboard shows
  // rather than a second, independently-fabricated demo number set. Fetched
  // one layer up instead of inside this component so LandingContent stays a
  // plain synchronous component — landing-content.test.tsx renders it
  // directly with @testing-library/react, which cannot render an async
  // component. A `VocMetricsResult` (not a bare `VocMetrics`) because
  // getVocDashboardMetrics() never throws — a failed read must not fail
  // this page's render, so the "did it work" branch is a value every
  // consumer down the chain has to handle explicitly.
  metrics: VocMetricsResult;
};

export function LandingContent({ user, authError, metrics }: LandingContentProps) {
  const errorMessage = authError ? errorMessages[authError] : undefined;

  return (
    <div className="landing-shell" id="top">
      <ShowcaseNavigator
        authError={errorMessage}
        pages={{
          home: (
            <section
              aria-labelledby="home-title"
              className="showroom-hero"
            >
          <HeroMedia />
          <div className="showroom-hero__copy">
                <p className="showcase-page-kicker">00 · 首页</p>
                <h1 data-showcase-title id="home-title" tabIndex={-1}>
              <span>让每一次服务，</span>
              <span>都比问题更早一步</span>
            </h1>
            <p className="hero-intro">
              万护 OneCare 面向海信智能家庭场景，把用户声音、设备信号与服务协同
              串成一条有感知、有判断、有行动、会学习的服务闭环。
            </p>

            <div className="hero-actions">
              <a className="primary-action" href="#perspectives">
                查看四个视角
              </a>
              <a className="secondary-action" href="/login">
                使用飞书体验
              </a>
              {user ? null : (
                // Anonymous visitors (including a tenant member who opened
                // this page from a shared link rather than the Feishu app
                // icon) need a manual way to reach the workbench: opening the
                // app icon lands on /enter without this link, but a shared
                // /-link degrades to one click here instead.
                <a className="secondary-action" href="/enter">
                  进入工作台
                </a>
              )}
            </div>
          </div>
            </section>
          ),
          perspectives: (
            <div className="perspectives-section">
              <ShowcasePageHeading
                index="01"
                intro="从 AI 自助、客服建单到工程师服务和后台改善，点击查看同一个问题如何一步步闭环。"
                label="四个视角"
                title="一次问题，四种角色，一条完整服务链"
                titleId="perspectives-title"
              />
          <PerspectiveTabs metrics={metrics} perspectives={perspectives} />
            </div>
          ),
          architecture: (
            <div className="architecture-page">
              <SectionFrame
          id="architecture-content"
          index="02"
                label="闭环架构"
          title="统一服务事件，驱动三层协同闭环"
          intro="万护拟通过统一的用户、设备与服务事件标识，轻量连接海信爱家、400 客服、IoT、工程师和备件系统，让一次问题在数据、决策和执行之间连续流转。"
        >
          <ArchitectureChapters
            decisions={decisionPaths}
            identities={serviceIdentities}
            layers={architectureLayers}
            loopSteps={closedLoopSteps}
            stages={rolloutStages}
            systems={connectedSystems}
            targets={pilotTargets}
          />
        </SectionFrame>
            </div>
          ),
          team: (
            <div className="team-page">
              <SectionFrame
                id="team-content"
                index="03"
                label="团队"
          title="三种能力，共同完成服务创新"
          intro="从 AI 工程、安全仿真到业务产品化，三种能力共同把服务创新变成可验证的方案。"
        >
          <div className="team-credits">
            {teamMembers.map((member) => (
              <article
                className="team-card surface-card"
                key={member.index}
              >
                <div className="team-card__heading">
                  <span>成员 {member.index}</span>
                  <p>{member.role}</p>
                </div>
                <h3>{member.name}</h3>
                <section
                  aria-label={`${member.name}学历`}
                  className="team-card__section"
                >
                  <h4>学历</h4>
                  <ul>
                    {member.education.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
                <section
                  aria-label={`${member.name}代表经历`}
                  className="team-card__section"
                >
                  <h4>代表经历</h4>
                  <ul>
                    {member.highlights.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
                <p className="team-card__capabilities">
                  {member.capabilities.join(" / ")}
                </p>
              </article>
            ))}
          </div>
        </SectionFrame>
              <SiteFooter />
            </div>
          ),
        }}
        user={user}
      />
    </div>
  );
}
