"use client";

import { useState } from "react";

import type { VocMetrics } from "../../voc/metrics";
import { serviceCase } from "../perspective-demo-data";
import {
  journeyHasCompletedService,
  journeyHasImprovementTask,
  type ServiceJourneyState,
} from "../service-journey";
import {
  DemoMetric,
  DemoPanel,
  DemoStatusBar,
  DemoTimeline,
} from "./perspective-workspace-ui";
import { FeishuExperienceBanner } from "./feishu-experience-banner";

type OperationsWorkspaceProps = Readonly<{
  journey: ServiceJourneyState;
  metrics: VocMetrics;
  onCreateImprovementTask: () => void;
  onReset: () => void;
}>;

export function OperationsWorkspace({
  journey,
  metrics,
  onCreateImprovementTask,
  onReset,
}: OperationsWorkspaceProps) {
  const dimensions = metrics.dimensionTop;
  const [selectedDimension, setSelectedDimension] = useState<string | null>(
    dimensions[0]?.dimension ?? null,
  );
  const activeDimension =
    dimensions.find((item) => item.dimension === selectedDimension) ??
    dimensions[0] ??
    null;
  const serviceCompleted = journeyHasCompletedService(journey);
  const taskCreated = journeyHasImprovementTask(journey);

  function reset() {
    setSelectedDimension(dimensions[0]?.dimension ?? null);
    onReset();
  }

  return (
    <div className="operations-workspace">
      <DemoStatusBar
        caseId={serviceCase.id}
        product="全渠道用户声音"
        status="数据更新于 10:24"
        title="VOC 闭环驾驶舱"
      />

      <FeishuExperienceBanner role="operations">
        在飞书接收 VOC 异常与闭环任务
      </FeishuExperienceBanner>

      <div className="operations-metrics">
        <DemoMetric detail="需跨角色协同" label="待闭环" value="12" />
        <DemoMetric detail="需要主动干预" label="重复上门风险" value="3" />
        <DemoMetric detail="较上周新增 2 个" label="本周高频问题" value="6" />
        <DemoMetric detail="静态方案目标" label="闭环达成率" value="86%" />
      </div>

      <div className="operations-workspace__grid">
        <DemoPanel className="voc-clusters">
          <div className="workspace-column-heading">
            <span>高频问题维度</span>
            <small>来自当前 Base 快照 · AI 打标聚合</small>
          </div>
          <div className="voc-topic-list">
            {dimensions.length === 0 ? (
              <p>暂无已打标的问题维度。</p>
            ) : (
              dimensions.map((item, index) => (
                <button
                  aria-label={item.dimension}
                  aria-pressed={item.dimension === activeDimension?.dimension}
                  key={item.dimension}
                  onClick={() => setSelectedDimension(item.dimension)}
                  type="button"
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{item.dimension}</strong>
                  <small>{item.count} 条</small>
                </button>
              ))
            )}
          </div>
        </DemoPanel>

        <DemoPanel className="voc-detail">
          <div className="workspace-column-heading">
            <span>维度洞察</span>
            <small>单一快照，暂无环比</small>
          </div>
          {activeDimension ? (
            <>
              <div className="voc-detail__headline">
                <div>
                  <span>当前维度</span>
                  <h3>{activeDimension.dimension}</h3>
                </div>
                <strong>{activeDimension.count} 条相关反馈</strong>
              </div>
              <div className="voc-detail__signals">
                <DemoMetric label="反馈总量" value={`${metrics.total} 条`} />
                <DemoMetric
                  label="负向占比"
                  value={`${Math.round(metrics.negativeShare * 100)}%`}
                />
                <DemoMetric label="关联服务案例" value={serviceCase.id} />
              </div>
            </>
          ) : (
            <p>暂无维度数据，等待更多 VOC 记录完成打标。</p>
          )}
        </DemoPanel>

        <DemoPanel className="closure-panel">
          <div className="workspace-column-heading">
            <span>闭环追踪</span>
            <small>
              {taskCreated
                ? "任务已建立"
                : serviceCompleted
                  ? "等待行动"
                  : "等待服务结果"}
            </small>
          </div>
          <DemoTimeline
            label="VOC 改善闭环"
            steps={[
              { label: "VOC 聚类", state: "complete" },
              { label: "原因验证", state: "complete" },
              {
                label: "服务策略",
                state: taskCreated
                  ? "complete"
                  : serviceCompleted
                    ? "active"
                    : "pending",
              },
              {
                label: "产品改进",
                state: taskCreated ? "active" : "pending",
              },
            ]}
          />
          {taskCreated ? (
            <div className="closure-owner">
              <span>任务归属</span>
              <strong>产品质量 × 服务运营</strong>
            </div>
          ) : null}
          <div className="workspace-actions">
            <button
              className="demo-primary-button"
              disabled={!serviceCompleted || taskCreated}
              onClick={onCreateImprovementTask}
              type="button"
            >
              {taskCreated ? "改善任务已创建" : "创建改善任务"}
            </button>
            <button
              className="demo-reset-button"
              onClick={reset}
              type="button"
            >
              重新演示
            </button>
          </div>
          <div aria-live="polite" role="status">
            {taskCreated
              ? `${activeDimension ? activeDimension.dimension : "该问题"}已进入闭环`
              : serviceCompleted
                ? "等待创建改善任务"
                : "等待服务结果"}
          </div>
        </DemoPanel>
      </div>
    </div>
  );
}
