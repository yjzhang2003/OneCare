"use client";

import { useState } from "react";

import { agentDemo, serviceCase } from "../perspective-demo-data";
import {
  DemoMetric,
  DemoPanel,
  DemoStatusBar,
} from "./perspective-workspace-ui";

export function AgentWorkspace() {
  const [created, setCreated] = useState(false);

  return (
    <div className="agent-workspace">
      <DemoStatusBar
        caseId={serviceCase.id}
        product={serviceCase.product}
        status="上下文已同步"
        title="智能服务坐席"
      />

      <div className="agent-workspace__grid">
        <aside className="agent-queue" aria-label="服务会话队列">
          <div className="workspace-column-heading">
            <span>服务队列</span>
            <strong>8</strong>
          </div>
          <ol>
            <li data-active="true">
              <span>温度异常</span>
              <strong>李女士</strong>
              <small>刚刚 · AI 已预诊</small>
            </li>
            <li>
              <span>预约调整</span>
              <strong>王先生</strong>
              <small>3 分钟前</small>
            </li>
            <li>
              <span>安装咨询</span>
              <strong>赵女士</strong>
              <small>7 分钟前</small>
            </li>
          </ol>
        </aside>

        <DemoPanel className="agent-context">
          <div className="workspace-column-heading">
            <span>当前会话</span>
            <small>不再重复询问</small>
          </div>
          <div className="agent-customer-line">
            <div aria-hidden="true">李</div>
            <div>
              <strong>{serviceCase.customer}</strong>
              <span>{serviceCase.product}</span>
            </div>
          </div>
          <div className="agent-transcript">
            <p>万护：检测到冷藏室温度持续偏高，需要我帮你确认吗？</p>
            <p>用户：饮料不够凉。</p>
            <p>万护：已结合设备数据完成预诊，正在为你衔接服务。</p>
          </div>
          <div className="agent-signal-row">
            <DemoMetric
              detail={`目标 ${serviceCase.targetTemperature}°C`}
              label="当前温度"
              value={`${serviceCase.currentTemperature}°C`}
            />
            <DemoMetric
              label="异常持续"
              value={`${serviceCase.anomalyMinutes} min`}
            />
          </div>
        </DemoPanel>

        <DemoPanel className="agent-assist">
          <div className="workspace-column-heading">
            <span>AI 辅助</span>
            <small>本地模拟结果</small>
          </div>
          <section>
            <span>诉求摘要</span>
            <p>{agentDemo.summary}</p>
          </section>
          <section className="agent-confidence">
            <span>预诊置信度 {agentDemo.confidence}%</span>
            <div aria-hidden="true">
              <i style={{ width: `${agentDemo.confidence}%` }} />
            </div>
          </section>
          <dl>
            <div>
              <dt>建议路由</dt>
              <dd>{agentDemo.route}</dd>
            </div>
            <div>
              <dt>建议配件</dt>
              <dd>{agentDemo.suggestedPart}</dd>
            </div>
          </dl>

          {created ? (
            <div className="agent-assignment">
              <span>{agentDemo.workOrderId}</span>
              <strong>{agentDemo.engineer}</strong>
            </div>
          ) : null}

          <div className="workspace-actions">
            <button
              className="demo-primary-button"
              disabled={created}
              onClick={() => setCreated(true)}
              type="button"
            >
              {created ? "工单已生成" : "生成服务工单"}
            </button>
            <button
              className="demo-reset-button"
              onClick={() => setCreated(false)}
              type="button"
            >
              重新演示
            </button>
          </div>
          <div aria-live="polite" role="status">
            {created ? `已分配给${agentDemo.engineer}` : "等待生成服务工单"}
          </div>
        </DemoPanel>
      </div>
    </div>
  );
}
