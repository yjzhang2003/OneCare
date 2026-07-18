"use client";

import { useEffect, useRef, useState } from "react";

import { customerDemo, serviceCase } from "../perspective-demo-data";
import {
  DemoMetric,
  DemoTimeline,
} from "./perspective-workspace-ui";
import { CustomerChatMessage } from "./customer-chat-message";
import { OneCareLogo } from "./onecare-logo";

type CustomerStage = "invitation" | "diagnosed" | "scheduled";

const customerPrompts = ["饮料不够凉", "刚才开始", "没有异响"] as const;

export function CustomerWorkspace() {
  const [stage, setStage] = useState<CustomerStage>("invitation");
  const chatRef = useRef<HTMLElement>(null);
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

  useEffect(() => {
    const chat = chatRef.current;

    if (!chat) {
      return;
    }

    chat.scrollTo?.({ behavior: "auto", top: chat.scrollHeight });
  }, [stage]);

  return (
    <div className="customer-scene">
      <div className="customer-scene__ambient" aria-hidden="true">
        <span>主动感知</span>
        <strong>问题出现前，服务已经开始。</strong>
        <p>设备信号、用户表达和服务进度始终在同一条上下文中。</p>
      </div>

      <div className="customer-phone">
        <header className="customer-phone__header">
          <OneCareLogo decorative size={32} tone="dark" />
          <div>
            <span className="demo-label">静态交互 Demo</span>
            <strong>爱家服务助手</strong>
          </div>
          <div className="customer-phone__header-status">
            <span>AI 在线</span>
            <small>{serviceCase.id}</small>
          </div>
        </header>

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

          <div className="customer-conversation">
            <section
              aria-label="AI 服务对话"
              aria-live="polite"
              className="customer-chat"
              ref={chatRef}
            >
              <CustomerChatMessage meta="刚刚" sender="assistant">
                {customerDemo.greeting}
              </CustomerChatMessage>

              {stage !== "invitation" ? (
                <>
                  <CustomerChatMessage meta="已送达" sender="customer">
                    {customerDemo.prompt}
                  </CustomerChatMessage>
                  <CustomerChatMessage
                    meta="设备数据已同步"
                    sender="assistant"
                  >
                    <span className="customer-message__reading">
                      {customerDemo.reading}
                    </span>
                    <strong>{customerDemo.diagnosis}</strong>
                  </CustomerChatMessage>
                </>
              ) : null}

              {stage === "scheduled" ? (
                <CustomerChatMessage meta="等待客服确认" sender="assistant">
                  {customerDemo.confirmation}
                </CustomerChatMessage>
              ) : null}

              {stage !== "invitation" ? (
                <section className="customer-service-progress">
                  <DemoTimeline label="本次服务进度" steps={timeline} />
                </section>
              ) : null}
            </section>

            <div
              aria-label="对话快捷操作"
              className="customer-chat-controls"
            >
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
              ) : null}

              {stage === "diagnosed" ? (
                <button
                  className="demo-primary-button customer-chat__action"
                  onClick={() => setStage("scheduled")}
                  type="button"
                >
                  继续安排服务
                </button>
              ) : null}

              {stage === "scheduled" ? (
                <div className="customer-chat__completion">服务已提交</div>
              ) : null}
            </div>
          </div>
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
