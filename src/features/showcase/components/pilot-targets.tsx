import type { PilotTarget, RolloutStage } from "../content";

type PilotTargetsProps = Readonly<{
  targets: readonly PilotTarget[];
  stages: readonly RolloutStage[];
}>;

export function PilotTargets({ targets, stages }: PilotTargetsProps) {
  return (
    <section aria-labelledby="pilot-targets-title" className="pilot-targets">
      <div className="pilot-targets__heading">
        <p>方案验证</p>
        <h3 id="pilot-targets-title">6 个月试点目标</h3>
        <p>
          以下为试点目标区间，不代表已经取得的生产结果；实际基线和测量口径待试点启动前确认。
        </p>
      </div>

      <p className="pilot-targets__grid-label">试点目标</p>
      <div className="pilot-targets__grid">
        {targets.map((target) => (
          <p
            aria-label={`${target.label}${target.value}${
              target.stretchValue ? `，${target.stretchValue}` : ""
            }，${target.status}`}
            key={target.label}
          >
            <span className="pilot-targets__label">{target.label}</span>
            <strong>{target.value}</strong>
            {target.stretchValue ? (
              <span className="pilot-targets__stretch">{target.stretchValue}</span>
            ) : null}
          </p>
        ))}
      </div>

      <div className="rollout-path">
        <div>
          <p>试点路径</p>
          <h3>轻量开始，验证后逐步推广</h3>
        </div>
        <ol aria-label="万护 OneCare 试点路径">
          {stages.map((stage) => (
            <li key={stage.index}>
              <span>{stage.index}</span>
              <strong>{stage.title}</strong>
              <p>{stage.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
