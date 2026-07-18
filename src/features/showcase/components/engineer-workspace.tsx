"use client";

import { engineerDemo, serviceCase } from "../perspective-demo-data";
import {
  journeyHasCompletedService,
  journeyHasConfirmedParts,
  journeyHasWorkOrder,
  type ServiceJourneyState,
} from "../service-journey";
import {
  DemoMetric,
  DemoPanel,
  DemoStatusBar,
  DemoTimeline,
} from "./perspective-workspace-ui";
import { FeishuExperienceBanner } from "./feishu-experience-banner";

type EngineerWorkspaceProps = Readonly<{
  journey: ServiceJourneyState;
  onConfirmParts: () => void;
  onCompleteService: () => void;
  onReset: () => void;
}>;

export function EngineerWorkspace({
  journey,
  onConfirmParts,
  onCompleteService,
  onReset,
}: EngineerWorkspaceProps) {
  const assigned = journeyHasWorkOrder(journey);
  const ready = journeyHasConfirmedParts(journey);
  const complete = journeyHasCompletedService(journey);

  return (
    <div className="engineer-workspace">
      <DemoStatusBar
        caseId={serviceCase.id}
        product={serviceCase.product}
        status={
          complete
            ? "服务已闭环"
            : ready
              ? "准备出发"
              : assigned
                ? "待核验"
                : "等待客服建单"
        }
        title="一次上门工作台"
      />

      <FeishuExperienceBanner role="engineer">
        在飞书接收工单、配件与上门提醒
      </FeishuExperienceBanner>

      <div className="engineer-task-strip">
        <div>
          <span>今日上门</span>
          <strong>{assigned ? serviceCase.visitWindow : "等待分配"}</strong>
        </div>
        <div>
          <span>用户</span>
          <strong>{serviceCase.customer}</strong>
        </div>
        <div>
          <span>地址</span>
          <strong>{serviceCase.address}</strong>
        </div>
        <div>
          <span>联系偏好</span>
          <strong>{engineerDemo.contactPreference}</strong>
        </div>
      </div>

      <div className="engineer-workspace__grid">
        <DemoPanel className="engineer-diagnosis">
          <div className="workspace-column-heading">
            <span>设备预诊</span>
            <small>IoT 信号 · 本地模拟</small>
          </div>
          <div className="temperature-chart" aria-label="冷藏室温度趋势">
            {[4, 4, 5, 6, 8, 9, 9].map((value, index) => (
              <i
                aria-label={`${index * 5} 分钟 ${value} 摄氏度`}
                key={`${value}-${index}`}
                style={{ height: `${value * 8}%` }}
              />
            ))}
          </div>
          <div className="engineer-metrics">
            <DemoMetric
              label="当前温度"
              value={`${serviceCase.currentTemperature}°C`}
            />
            <DemoMetric
              label="预诊置信度"
              value={`${engineerDemo.confidence}%`}
            />
            <DemoMetric
              label="异常持续"
              value={`${serviceCase.anomalyMinutes} min`}
            />
          </div>
          <section className="engineer-causes">
            <span>可能原因</span>
            <ol>
              {engineerDemo.possibleCauses.map((cause, index) => (
                <li key={cause}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {cause}
                </li>
              ))}
            </ol>
          </section>
        </DemoPanel>

        <aside className="engineer-side">
          <DemoPanel className="engineer-parts">
            <div className="workspace-column-heading">
              <span>建议携件</span>
              <small>{ready ? "已核验" : assigned ? "待确认" : "等待工单"}</small>
            </div>
            <ul>
              {engineerDemo.parts.map((part) => (
                <li data-checked={ready ? "true" : "false"} key={part}>
                  <i aria-hidden="true" />
                  <span>{part}</span>
                </li>
              ))}
            </ul>
          </DemoPanel>

          <DemoPanel className="engineer-progress">
            <DemoTimeline
              label="上门任务进度"
              steps={[
                {
                  label: "接收任务",
                  state: assigned ? "complete" : "pending",
                },
                {
                  label: "核验配件",
                  state: ready ? "complete" : assigned ? "active" : "pending",
                },
                {
                  label: "现场解决",
                  state: complete ? "complete" : ready ? "active" : "pending",
                },
              ]}
            />
            <div className="workspace-actions">
              <button
                className="demo-secondary-button"
                disabled={!assigned || ready}
                onClick={onConfirmParts}
                type="button"
              >
                {ready ? "携件已确认" : "确认携件"}
              </button>
              <button
                className="demo-primary-button"
                disabled={!ready || complete}
                onClick={onCompleteService}
                type="button"
              >
                {complete ? "服务已完成" : "完成本次服务"}
              </button>
              <button
                className="demo-reset-button"
                onClick={onReset}
                type="button"
              >
                重新演示
              </button>
            </div>
            <div aria-live="polite" role="status">
              {complete
                ? "首次上门完成"
                : ready
                  ? "准备出发"
                  : assigned
                    ? "等待确认携件"
                    : "等待客服建单"}
            </div>
          </DemoPanel>
        </aside>
      </div>
    </div>
  );
}
