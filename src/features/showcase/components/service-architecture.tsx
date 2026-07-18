import Image from "next/image";

import type {
  ArchitectureLayer,
  ClosedLoopStep,
  ConnectedSystem,
  DecisionPath,
  ServiceIdentity,
} from "../content";

type ServiceArchitectureOverviewProps = Readonly<{
  identities: readonly ServiceIdentity[];
  systems: readonly ConnectedSystem[];
  layers: readonly ArchitectureLayer[];
}>;

type ServiceLoopMechanismProps = Readonly<{
  decisions: readonly DecisionPath[];
  loopSteps: readonly ClosedLoopStep[];
}>;

export function ServiceArchitectureOverview({
  identities,
  systems,
  layers,
}: ServiceArchitectureOverviewProps) {
  return (
    <section
      aria-label="万护 OneCare 三层闭环架构"
      className="service-architecture-panel"
    >
      <div className="service-event-rail">
        <div className="service-event-rail__heading">
          <p>方案中的统一关联标识</p>
          <h3>统一服务事件</h3>
          <p>三种标识共同关联一次问题，不代表已经完成跨系统接入。</p>
        </div>

        <dl className="service-identities">
          {identities.map((identity) => (
            <div key={identity.label}>
              <dt>{identity.label}</dt>
              <dd>{identity.description}</dd>
            </div>
          ))}
        </dl>

        <ul aria-label="计划连接端" className="connected-systems">
          {systems.map((system) => (
            <li key={system.id}>
              {system.id === "aijia" ? (
                <Image
                  alt="海信爱家官方应用标识"
                  className="connected-system__mark"
                  height={48}
                  src="/images/hisense/aijia-app-mark.jpg"
                  width={48}
                />
              ) : (
                <span aria-hidden="true" className="connected-system__node" />
              )}
              <span>
                <strong>{system.label}</strong>
                <small>{system.description}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="architecture-stack">
        <h3>三层架构</h3>
        <ol aria-label="万护 OneCare 三层架构" className="architecture-layers">
          {layers.map((layer) => (
            <li key={layer.index}>
              <article>
                <span>{layer.index}</span>
                <h4>{layer.title}</h4>
                <p>{layer.summary}</p>
                <ul>
                  {layer.capabilities.map((capability) => (
                    <li key={capability}>{capability}</li>
                  ))}
                </ul>
              </article>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function ServiceLoopMechanism({
  decisions,
  loopSteps,
}: ServiceLoopMechanismProps) {
  return (
    <section
      aria-label="万护 OneCare 闭环运行机制"
      className="service-architecture-panel service-loop-panel"
    >
      <section aria-labelledby="decision-paths-title" className="decision-section">
        <div className="architecture-section-heading">
          <p>风险分流与治理边界</p>
          <h3 id="decision-paths-title">不同风险，进入不同处理路径</h3>
        </div>
        <div className="decision-paths">
          {decisions.map((decision) => (
            <article data-path={decision.id} key={decision.id}>
              <p>{decision.criteria}</p>
              <h4>{decision.title}</h4>
              <p>{decision.action}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="closed-loop-title" className="closed-loop-section">
        <div className="architecture-section-heading">
          <p>跨三层运行机制</p>
          <h3 id="closed-loop-title">核心闭环</h3>
        </div>
        <ol aria-label="万护 OneCare 服务闭环" className="closed-loop-steps">
          {loopSteps.map((step) => (
            <li key={step.index}>
              <span>{step.index}</span>
              <h4>{step.title}</h4>
              <p>{step.description}</p>
            </li>
          ))}
        </ol>
        <p className="closed-loop-note">
          计划持续追踪派单、备件、上门、维修和回访，并把异常与结果继续带回同一个服务事件。
        </p>
        <span aria-hidden="true" className="architecture-signal" />
      </section>
    </section>
  );
}
