import type { ServiceLayer } from "../content";

export function SignalFlow({ layers }: { layers: readonly ServiceLayer[] }) {
  return (
    <ol className="signal-flow">
      {layers.map((layer) => (
        <li className="signal-layer" key={layer.index}>
          <div className="signal-layer__index">
            <span>{layer.index}</span>
            <span>{layer.english}</span>
          </div>
          <h3>{layer.title}</h3>
          <dl>
            <div>
              <dt>输入</dt>
              <dd>{layer.input}</dd>
            </div>
            <div>
              <dt>AI 动作</dt>
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
  );
}
