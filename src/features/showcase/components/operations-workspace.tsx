"use client";

import { useState } from "react";

import type { VocMetricsResult } from "../../voc/metrics";
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
  metrics: VocMetricsResult;
  onCreateImprovementTask: () => void;
  onReset: () => void;
}>;

export function OperationsWorkspace({
  journey,
  metrics,
  onCreateImprovementTask,
  onReset,
}: OperationsWorkspaceProps) {
  // Every real number below comes from `metrics.metrics` when the read
  // succeeded. `dimensions` is `[]` in the unavailable case purely so the
  // hooks below stay unconditional (same calls, same order, every render) —
  // the unavailable *message* itself is a separate, explicit branch in the
  // JSX, never inferred from an empty list, so "0 dimensions because the
  // read failed" can never be confused with "0 dimensions because a real,
  // successful read had none to report".
  const dimensions = metrics.status === "ok" ? metrics.metrics.dimensionTop : [];
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

      {metrics.status === "unavailable" ? (
        <div className="operations-metrics operations-metrics--unavailable" role="status">
          <p>
            VOC 指标暂不可用（本次未能读取到飞书多维表格数据），以下汇总与问题维度聚类暂不展示；请稍后刷新重试。
          </p>
        </div>
      ) : (
        <div className="operations-metrics">
          <DemoMetric
            detail="已建单未闭环"
            label="待闭环"
            value={`${metrics.metrics.ticketsOpened - metrics.metrics.ticketsClosed}`}
          />
          <DemoMetric
            detail="需人工复核"
            label="打标失败"
            value={`${metrics.metrics.taggingFailed}`}
          />
          <DemoMetric
            detail="AI 语义聚合，非环比"
            label="高频问题维度数"
            value={`${metrics.metrics.dimensionTop.length}`}
          />
          <DemoMetric
            detail="基于当前 Base 快照"
            label="闭环达成率"
            value={`${Math.round(metrics.metrics.closureRate * 100)}%`}
          />
        </div>
      )}

      <div className="operations-workspace__grid">
        {metrics.status === "unavailable" ? (
          <DemoPanel className="voc-clusters voc-clusters--unavailable">
            <div className="workspace-column-heading">
              <span>高频问题维度</span>
              <small>指标暂不可用</small>
            </div>
            <p>指标暂不可用，无法展示问题维度聚类与洞察，请稍后重试。</p>
          </DemoPanel>
        ) : (
          <>
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
                    <DemoMetric label="反馈总量" value={`${metrics.metrics.total} 条`} />
                    <DemoMetric
                      label="负向占比"
                      value={`${Math.round(metrics.metrics.negativeShare * 100)}%`}
                    />
                    <DemoMetric label="关联服务案例" value={serviceCase.id} />
                  </div>
                </>
              ) : (
                <p>暂无维度数据，等待更多 VOC 记录完成打标。</p>
              )}
            </DemoPanel>
          </>
        )}

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
