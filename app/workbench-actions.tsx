"use client";

// Must come before any Arco component import. Arco reads createRoot off the
// "react-dom" root export, where React 19 no longer puts it, and then falls back
// to the deleted ReactDOM.render — so Message.success() dies at runtime with a
// green build and a green typecheck. src/features/workbench/arco-react19.test.tsx
// exists to fail if this line is ever removed.
import "@arco-design/web-react/lib/_util/react-19-adapter";
import "@arco-design/web-react/dist/css/arco.css";

import { Button, Input, Message, Modal, Space } from "@arco-design/web-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { VocState } from "../src/features/voc/service-event";
import {
  NOTE_LABELS,
  type WorkbenchAction,
} from "../src/features/workbench/write-actions";

// The only client component in this app. Everything else — queues, filters,
// search, sorting, pagination, the detail panel — is server-rendered and driven
// by URL parameters, which is why a shared link reproduces a colleague's exact
// view. This island exists because the three things it does (collect a note
// before submitting, report an outcome, refresh the page underneath) cannot be
// expressed as navigation.
export type WorkbenchActionsProps = Readonly<{
  recordId: string;
  // The state the server rendered. Sent back with every request so the handler
  // can refuse an action decided against a view that has since gone stale.
  seenState: VocState;
  actions: readonly WorkbenchAction[];
  canClaim: boolean;
}>;

type Pending = Readonly<{ action: WorkbenchAction; label: string }> | null;

export function WorkbenchActions({
  recordId,
  seenState,
  actions,
  canClaim,
}: WorkbenchActionsProps) {
  const router = useRouter();
  // Which intent is in flight, not merely whether one is: a single boolean put a
  // spinner on every button at once, which reads as "all of these are happening".
  // Everything is still disabled while one runs — that part guards against a
  // double submit — but only the button actually waiting spins.
  const [inFlight, setInFlight] = useState<WorkbenchAction | "claim" | null>(
    null,
  );
  const [pending, setPending] = useState<Pending>(null);
  const [note, setNote] = useState("");
  const busy = inFlight !== null;

  // Resolves true when this intent is finished with — either it landed, or it
  // became moot — and false when the operator should be left where they were to
  // try again. That distinction is the whole reason this returns anything: the
  // note modal must not discard a paragraph of typed 闭环结论 because the Base
  // write timed out.
  async function submit(
    intent: WorkbenchAction | "claim",
    body: unknown,
  ): Promise<boolean> {
    setInFlight(intent);
    try {
      const response = await fetch(
        `/api/voc/tickets/${encodeURIComponent(recordId)}/action`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      // Every response from that handler carries a `message` written for a
      // person, so there is no branch here that invents its own wording. The
      // status decides the severity, the server decides the words.
      const payload: unknown = await response.json().catch(() => null);
      const message =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { message?: unknown }).message === "string"
          ? (payload as { message: string }).message
          : "操作失败，请稍后重试";

      if (response.ok) {
        Message.success(message);
        // The handler has already invalidated the cached reads; this re-renders
        // the server component tree so the row, the queue counts and the panel
        // all show the new state. Without it the operator is looking at data
        // they just changed.
        router.refresh();
        return true;
      }

      if (response.status === 409) {
        // A stale view is the one failure retrying cannot fix — the action was
        // decided against a state that no longer holds — so this refreshes for
        // them and lets the intent go, rather than inviting a retry that would
        // be refused for the same reason.
        Message.warning(message);
        router.refresh();
        return true;
      }

      // 403 / 422 / 502: refused or failed, but the intent still stands and the
      // typed note is still wanted.
      Message.error(message);
      return false;
    } catch {
      // A network failure is the one case where the server said nothing, so
      // this is the only wording this component owns.
      Message.error("网络异常，请检查连接后重试");
      return false;
    } finally {
      setInFlight(null);
    }
  }

  function start(action: WorkbenchAction) {
    const label = NOTE_LABELS[action];
    if (label) {
      setPending({ action, label });
      return;
    }
    void submit(action, { kind: "transition", action, seenState });
  }

  return (
    <>
      <Space wrap>
        {canClaim && (
          <Button
            type="primary"
            loading={inFlight === "claim"}
            disabled={busy && inFlight !== "claim"}
            onClick={() => void submit("claim", { kind: "claim", seenState })}
          >
            我来跟进
          </Button>
        )}
        {actions.map((action) => (
          <Button
            key={action}
            loading={inFlight === action}
            disabled={busy && inFlight !== action}
            onClick={() => start(action)}
          >
            {action}
          </Button>
        ))}
      </Space>

      <Modal
        title={pending?.label}
        visible={pending !== null}
        // Arco keeps a closed modal's DOM mounted by default, which would leave
        // the operator's typed note sitting in a hidden textarea after the
        // dialog is gone. Unmounting it means the text exists only while the
        // dialog that collected it does.
        unmountOnExit
        confirmLoading={busy}
        okButtonProps={{ disabled: note.trim().length === 0 }}
        // Closing mid-request would leave the operator with no idea whether the
        // write landed, so neither the cancel button nor the mask nor Esc is a
        // way out while one is in flight.
        cancelButtonProps={{ disabled: busy }}
        maskClosable={!busy}
        escToExit={!busy}
        onCancel={() => {
          setPending(null);
          setNote("");
        }}
        onOk={() => {
          if (!pending) return;
          void submit(pending.action, {
            kind: "transition",
            action: pending.action,
            seenState,
            note,
          }).then((done) => {
            // Closed and cleared only once the intent is finished with. A
            // refusal or a failed write leaves the modal open with the text
            // intact — the operator may have written several sentences of
            // 闭环结论, and losing that to a transient Bitable timeout would
            // teach them not to trust the field.
            if (done) {
              setPending(null);
              setNote("");
            }
          });
        }}
      >
        <Input.TextArea
          autoFocus
          rows={4}
          value={note}
          onChange={setNote}
          placeholder={`请填写${pending?.label ?? ""}，这段文字会写进多维表格`}
        />
      </Modal>
    </>
  );
}
