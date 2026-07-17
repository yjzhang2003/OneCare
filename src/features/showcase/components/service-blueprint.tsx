import type { ScenarioStep, ServiceLayer } from "../content";

type ServiceBlueprintProps = {
  layers: readonly ServiceLayer[];
  events: readonly ScenarioStep[];
};

export function ServiceBlueprint({ layers, events }: ServiceBlueprintProps) {
  return (
    <div className="blueprint-wrap">
      <ol className="service-blueprint" aria-label="OneCare 五层服务蓝图">
        {layers.map((layer, index) => (
          <li className="blueprint-layer" key={layer.index}>
            <div className="blueprint-layer__node" aria-hidden="true">
              <span>{layer.index}</span>
              <i />
            </div>
            <div className="blueprint-layer__heading">
              <small>{layer.english}</small>
              <h3>{layer.title}</h3>
            </div>
            <p className="blueprint-layer__event">{events[index]?.title}</p>
            <dl>
              <div>
                <dt>输入</dt>
                <dd>{layer.input}</dd>
              </div>
              <div>
                <dt>系统动作</dt>
                <dd>{layer.action}</dd>
              </div>
              <div>
                <dt>输出</dt>
                <dd>{layer.output}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
      <p className="blueprint-loop">
        学习结果回到感知，让下一次服务更早一步。
      </p>
    </div>
  );
}
