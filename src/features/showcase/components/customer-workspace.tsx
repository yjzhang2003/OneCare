"use client";

import { useEffect, useRef } from "react";

import { customerDemo, serviceCase } from "../perspective-demo-data";
import {
  journeyHasCompletedService,
  journeyHasWorkOrder,
  type ServiceJourneyState,
} from "../service-journey";
import { CustomerChatMessage } from "./customer-chat-message";
import { OneCareLogo } from "./onecare-logo";
import { DemoMetric, DemoTimeline } from "./perspective-workspace-ui";

type CustomerWorkspaceProps = Readonly<{
  journey: ServiceJourneyState;
  onAnswerDiagnosis: (reply: string) => void;
  onMarkSelfResolved: () => void;
  onRequestHumanService: () => void;
  onReset: () => void;
}>;

const customerPrompts = ["饮料不够凉", "刚才开始", "没有异响"] as const;

export function CustomerWorkspace({
  journey,
  onAnswerDiagnosis,
  onMarkSelfResolved,
  onRequestHumanService,
  onReset,
}: CustomerWorkspaceProps) {
  const chatRef = useRef<HTMLElement>(null);
  const { stage } = journey;
  const hasDiagnosis = stage !== "detected";
  const hasWorkOrder = journeyHasWorkOrder(journey);
  const serviceCompleted = journeyHasCompletedService(journey);
  const stageStatus = serviceCompleted
    ? "服务已完成"
    : hasWorkOrder
      ? "客服已建单"
      : stage === "serviceRequested"
        ? "等待客服建单"
        : stage === "selfResolved"
          ? "问题已解决"
          : stage === "selfHelp"
            ? "AI 自助排查中"
            : "主动关怀中";

  const timeline = customerDemo.progress.map((label, index) => {
    if (index === 0) {
      return { label, state: "complete" as const };
    }

    if (index === 1) {
      return {
        label,
        state:
          stage === "selfHelp"
            ? ("active" as const)
            : hasDiagnosis
              ? ("complete" as const)
              : ("pending" as const),
      };
    }

    if (index === 2) {
      return {
        label,
        state: hasWorkOrder
          ? ("complete" as const)
          : stage === "serviceRequested"
            ? ("active" as const)
            : ("pending" as const),
      };
    }

    return {
      label,
      state: serviceCompleted
        ? ("complete" as const)
        : hasWorkOrder
          ? ("active" as const)
          : ("pending" as const),
    };
  });

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

              {hasDiagnosis ? (
                <>
                  <CustomerChatMessage meta="已送达" sender="customer">
                    {journey.customerReply}
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
                  <section
                    aria-label="知识库建议"
                    className="customer-knowledge"
                  >
                    <span>知识库建议</span>
                    <p>{customerDemo.knowledgeIntro}</p>
                    <ol>
                      {customerDemo.knowledgeSteps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </section>
                </>
              ) : null}

              {stage === "selfResolved" ? (
                <CustomerChatMessage meta="已解决" sender="assistant">
                  {customerDemo.selfResolved}
                </CustomerChatMessage>
              ) : null}

              {stage === "serviceRequested" ? (
                <CustomerChatMessage meta="等待客服建单" sender="assistant">
                  {customerDemo.serviceRequested}
                </CustomerChatMessage>
              ) : null}

              {hasWorkOrder ? (
                <CustomerChatMessage meta="客服已建单" sender="assistant">
                  {customerDemo.workOrderConfirmation}
                </CustomerChatMessage>
              ) : null}

              {serviceCompleted ? (
                <CustomerChatMessage meta="服务已完成" sender="assistant">
                  {customerDemo.serviceCompleted}
                </CustomerChatMessage>
              ) : null}

              {hasDiagnosis ? (
                <section className="customer-service-progress">
                  <DemoTimeline label="本次服务进度" steps={timeline} />
                </section>
              ) : null}
            </section>

            <div
              aria-label="对话快捷操作"
              className="customer-chat-controls"
            >
              {stage === "detected" ? (
                <div className="customer-prompts" aria-label="快捷回复">
                  {customerPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => onAnswerDiagnosis(prompt)}
                      type="button"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              ) : null}

              {stage === "selfHelp" ? (
                <div className="customer-resolution-actions">
                  <button
                    className="demo-secondary-button"
                    onClick={onMarkSelfResolved}
                    type="button"
                  >
                    问题已解决
                  </button>
                  <button
                    className="demo-primary-button"
                    onClick={onRequestHumanService}
                    type="button"
                  >
                    仍需人工服务
                  </button>
                </div>
              ) : null}

              {stage !== "detected" && stage !== "selfHelp" ? (
                <div className="customer-chat__completion">{stageStatus}</div>
              ) : null}
            </div>
          </div>
        </main>

        <footer className="customer-phone__footer">
          <div aria-live="polite" role="status">
            {stageStatus}
          </div>
          {stage !== "detected" ? (
            <button
              className="demo-reset-button"
              onClick={onReset}
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
