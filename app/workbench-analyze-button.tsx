"use client";

// Must precede every Arco import. Arco reads createRoot off the "react-dom" root
// export, where React 19 no longer puts it, and then falls back to the deleted
// ReactDOM.render — so Message.success() dies at runtime with a green build and a
// green typecheck. src/features/workbench/arco-react19.test.tsx fails if this goes.
import "../src/features/workbench/arco-runtime";
import "@arco-design/web-react/dist/css/arco.css";

import { Button, Message, Popconfirm } from "@arco-design/web-react";
import { IconRobot } from "@arco-design/web-react/icon";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { VocState } from "../src/features/voc/service-event";
import { analyzeEligibility } from "../src/features/workbench/analyze-eligibility";

// The wait is roughly 23 seconds against the live aily skill (measured 2026-08-12).
// The button's own spinner carries it — a line of prose next to the control explaining
// what the control does belongs in the docs, not on the screen.

export type AnalyzeButtonProps = Readonly<{
  recordId: string;
  // Both come off the record: which states can be tagged, and whether the retry
  // ceiling has been reached, are decisions analyzeEligibility owns — the same
  // function the route behind this button uses to refuse.
  state: VocState;
  retryCount: number;
}>;

// Runs the tagging pipeline over this one record, now, instead of waiting for the
// daily Cron. Until this existed, a 分析失败 record could only be pushed back to
// 待分析 by 重试 and then sat there until 02:00 the next morning.
export function AnalyzeButton({
  recordId,
  state,
  retryCount,
}: AnalyzeButtonProps) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  // The state above drives the spinner; this ref is what actually prevents a second
  // run. `running` is captured per render, so two clicks dispatched before React
  // re-renders both read it as false — and this is a 20-second wait, which is long
  // enough that clicking again is a reasonable thing for a person to try. Two runs
  // would mean two aily calls, two writes and two cards to the same owner.
  const inFlight = useRef(false);
  const eligibility = analyzeEligibility({ state, retryCount });

  async function run(force: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    try {
      const response = await fetch(
        `/api/voc/tickets/${encodeURIComponent(recordId)}/analyze${force ? "?force=1" : ""}`,
        { method: "POST" },
      );
      const payload: unknown = await response.json().catch(() => null);
      const message =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { message?: unknown }).message === "string"
          ? (payload as { message: string }).message
          : "分析失败，请稍后重试";

      if (!response.ok) {
        Message.error(message);
        return;
      }

      // A run that finished and a run that produced tags are different outcomes.
      // The route says which by returning `tagged`, and a failed analysis gets a
      // warning rather than a green toast over a record that is still untagged.
      const tagged =
        typeof payload === "object" &&
        payload !== null &&
        (payload as { tagged?: unknown }).tagged === true;
      if (tagged) Message.success(message);
      else Message.warning(message);

      // The route has already expired the cached reads; this re-renders the server
      // tree so the AI fields, the state tag and the sider counts all show the
      // result. Runs after a failed analysis too — 失败原因 changed either way.
      router.refresh();
    } catch {
      // The one wording this component owns: the server said nothing at all.
      Message.error("网络异常，请检查连接后重试");
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }

  const button = (
    <Button
      type="primary"
      size="small"
      icon={<IconRobot />}
      loading={running}
      onClick={eligibility.kind === "ready" ? () => void run(false) : undefined}
    >
      {eligibility.kind === "ready" ? "立即分析" : "重新分析"}
    </Button>
  );

  // Always present, in every state. A record that has already been tagged can still be
  // re-analysed — the reason it was hidden (it would overwrite a verdict a person may
  // have corrected) is a reason to confirm, not a reason to have no button. The
  // confirmation carries the state machine's own words for what will be overwritten.
  return eligibility.kind === "ready" ? (
    button
  ) : (
    <Popconfirm
      title="重新分析？"
      content={eligibility.reason}
      onOk={() => void run(true)}
    >
      {button}
    </Popconfirm>
  );
}
