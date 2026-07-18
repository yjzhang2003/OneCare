"use client";

import { useState } from "react";

import {
  serviceCase,
  vocTopics,
  type VocTopicId,
} from "../perspective-demo-data";
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
  onCreateImprovementTask: () => void;
  onReset: () => void;
}>;

export function OperationsWorkspace({
  journey,
  onCreateImprovementTask,
  onReset,
}: OperationsWorkspaceProps) {
  const [selectedTopic, setSelectedTopic] =
    useState<VocTopicId>("temperature");
  const topic = vocTopics.find((item) => item.id === selectedTopic) ?? vocTopics[0];
  const serviceCompleted = journeyHasCompletedService(journey);
  const taskCreated = journeyHasImprovementTask(journey);

  function reset() {
    setSelectedTopic("temperature");
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
            <span>高频问题聚类</span>
            <small>AI 语义聚类 · 模拟</small>
          </div>
          <div className="voc-topic-list">
            {vocTopics.map((item, index) => (
              <button
                aria-label={item.label}
                aria-pressed={item.id === selectedTopic}
                key={item.id}
                onClick={() => setSelectedTopic(item.id)}
                type="button"
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.label}</strong>
                <small>{item.voices} 条</small>
              </button>
            ))}
          </div>
        </DemoPanel>

        <DemoPanel className="voc-detail">
          <div className="workspace-column-heading">
            <span>主题洞察</span>
            <small>{topic.change} 环比变化</small>
          </div>
          <div className="voc-detail__headline">
            <div>
              <span>当前主题</span>
              <h3>{topic.label}</h3>
            </div>
            <strong>{topic.voices} 条相关声音</strong>
          </div>
          <div className="voc-detail__signals">
            <DemoMetric label="关联型号" value={`${topic.models} 个`} />
            <DemoMetric label="趋势变化" value={topic.change} />
            <DemoMetric label="关联服务案例" value={serviceCase.id} />
          </div>
          <div className="voc-trend" aria-label={`${topic.label}七日趋势`}>
            {[32, 44, 40, 58, 66, 74, 88].map((height, index) => (
              <i key={`${topic.id}-${index}`} style={{ height: `${height}%` }} />
            ))}
          </div>
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
              ? `${topic.label}已进入闭环`
              : serviceCompleted
                ? "等待创建改善任务"
                : "等待服务结果"}
          </div>
        </DemoPanel>
      </div>
    </div>
  );
}
