"use client";

import { useState } from "react";

import { customerDemo, serviceCase } from "../perspective-demo-data";
import {
  DemoMetric,
  DemoStatusBar,
  DemoTimeline,
} from "./perspective-workspace-ui";

type CustomerStage = "invitation" | "diagnosed" | "scheduled";

const customerPrompts = ["饮料不够凉", "刚才开始", "没有异响"] as const;

export function CustomerWorkspace() {
  const [stage, setStage] = useState<CustomerStage>("invitation");
  const stageStatus =
    stage === "scheduled"
      ? "等待客服确认"
      : stage === "diagnosed"
        ? "已生成服务建议"
        : "主动关怀中";

  const timeline = customerDemo.progress.map((label, index) => ({
    label,
    state:
      index === 0 || (stage !== "invitation" && index === 1)
        ? ("complete" as const)
        : stage === "scheduled" && index === 2
          ? ("active" as const)
          : ("pending" as const),
  }));

  return (
    <div className="customer-scene">
      <div className="customer-scene__ambient" aria-hidden="true">
        <span>主动感知</span>
        <strong>问题出现前，服务已经开始。</strong>
        <p>设备信号、用户表达和服务进度始终在同一条上下文中。</p>
      </div>

      <div className="customer-phone">
        <DemoStatusBar
          caseId={serviceCase.id}
          product={serviceCase.product}
          status="设备在线"
          title="爱家服务助手"
        />

        <main className="customer-phone__content">
          <section className="customer-device" aria-label="冰箱设备状态">
            <div>
              <span>冷藏室当前温度</span>
              <strong>{serviceCase.currentTemperature}°C</strong>
            </div>
            <DemoMetric
              detail={`异常持续 ${serviceCase.anomalyMinutes} 分钟`}
              label="目标温度"
              value={`${serviceCase.targetTemperature}°C`}
            />
          </section>

          <section className="customer-chat" aria-label="AI 服务对话">
            <p className="chat-message chat-message--assistant">
              {customerDemo.greeting}
            </p>

            {stage === "invitation" ? (
              <div className="customer-prompts" aria-label="快捷回复">
                {customerPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => setStage("diagnosed")}
                    type="button"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <p className="chat-message chat-message--customer">
                  {customerDemo.prompt}
                </p>
                <p className="chat-message chat-message--assistant">
                  {customerDemo.diagnosis}
                </p>
              </>
            )}
          </section>

          {stage !== "invitation" ? (
            <section className="customer-service-progress">
              <DemoTimeline label="本次服务进度" steps={timeline} />
              {stage === "diagnosed" ? (
                <button
                  className="demo-primary-button"
                  onClick={() => setStage("scheduled")}
                  type="button"
                >
                  继续安排服务
                </button>
              ) : null}
            </section>
          ) : null}
        </main>

        <footer className="customer-phone__footer">
          <div aria-live="polite" role="status">
            {stageStatus}
          </div>
          {stage !== "invitation" ? (
            <button
              className="demo-reset-button"
              onClick={() => setStage("invitation")}
              type="button"
            >
              重新演示
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
