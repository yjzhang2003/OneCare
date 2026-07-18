import type { ReactNode } from "react";

import { OneCareLogo } from "./onecare-logo";

type CustomerChatMessageProps = Readonly<{
  sender: "assistant" | "customer";
  meta: string;
  children: ReactNode;
}>;

export function CustomerChatMessage({
  sender,
  meta,
  children,
}: CustomerChatMessageProps) {
  const assistant = sender === "assistant";

  return (
    <article className="customer-message" data-sender={sender}>
      <div className="customer-message__identity">
        {assistant ? (
          <span className="customer-message__avatar" aria-hidden="true">
            <OneCareLogo decorative size={24} tone="light" />
          </span>
        ) : null}
        <span>{assistant ? "万护助手" : "我"}</span>
      </div>
      <div className="customer-message__bubble">{children}</div>
      <small className="customer-message__meta">{meta}</small>
    </article>
  );
}
