"use client";

// Must precede every Arco import. Arco reads createRoot off the "react-dom" root export,
// where React 19 no longer puts it, and falls back to the deleted ReactDOM.render.
import "../src/features/workbench/arco-runtime";
import "@arco-design/web-react/dist/css/arco.css";

import { Button, Input, Message, Modal, Select, Space, Typography } from "@arco-design/web-react";
import { IconEdit } from "@arco-design/web-react/icon";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  VOC_DIMENSIONS,
  VOC_POLARITIES,
  VOC_SEVERITIES,
  type VocDimension,
  type VocPolarity,
  type VocSeverity,
} from "../src/features/voc/triage";

// 修正结论: the operator's correction of what the tagging produced.
//
// Most rows in this dataset were labelled by the seeding script, and a rule engine's
// 严重度 is only as good as the polarity and dimension count handed to it. Somebody
// reading the original complaint can see when that is wrong; before this, fixing it
// meant leaving the console for the Bitable.
export type TagEditButtonProps = Readonly<{
  recordId: string;
  polarity: VocPolarity | null;
  dimensions: readonly VocDimension[];
  severity: VocSeverity | null;
  summary: string;
}>;

export function TagEditButton({
  recordId,
  polarity,
  dimensions,
  severity,
  summary,
}: TagEditButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    polarity: polarity ?? "",
    dimensions: [...dimensions] as string[],
    severity: severity ?? "",
    summary,
  });
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  function start() {
    // Re-seeded from the props on every open, so a save elsewhere (or a re-analysis)
    // is what the form starts from rather than a stale first render.
    setDraft({
      polarity: polarity ?? "",
      dimensions: [...dimensions],
      severity: severity ?? "",
      summary,
    });
    setOpen(true);
  }

  async function save() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const response = await fetch(
        `/api/voc/tickets/${encodeURIComponent(recordId)}/tags`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      const message =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { message?: unknown }).message === "string"
          ? (payload as { message: string }).message
          : "保存失败，请稍后重试";

      if (!response.ok) {
        Message.error({ content: message, duration: 6000 });
        return;
      }
      Message.success(message);
      setOpen(false);
      router.refresh();
    } catch {
      Message.error("网络异常，请检查连接后重试");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="small" icon={<IconEdit />} onClick={start}>
        修正结论
      </Button>
      <Modal
        title="修正结论"
        visible={open}
        unmountOnExit
        confirmLoading={saving}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
      >
        <Space direction="vertical" size="medium" style={{ width: "100%" }}>
          <div>
            <Typography.Text type="secondary">情绪极性</Typography.Text>
            <Select
              allowClear
              placeholder="未判定"
              style={{ width: "100%" }}
              value={draft.polarity || undefined}
              options={[...VOC_POLARITIES]}
              onChange={(value) =>
                setDraft({ ...draft, polarity: (value as string) ?? "" })
              }
            />
          </div>
          <div>
            <Typography.Text type="secondary">问题维度</Typography.Text>
            <Select
              mode="multiple"
              allowClear
              placeholder="未命中"
              style={{ width: "100%" }}
              value={draft.dimensions}
              options={[...VOC_DIMENSIONS]}
              onChange={(value) =>
                setDraft({ ...draft, dimensions: (value as string[]) ?? [] })
              }
            />
          </div>
          <div>
            <Typography.Text type="secondary">严重度</Typography.Text>
            <Select
              allowClear
              placeholder="未判定"
              style={{ width: "100%" }}
              value={draft.severity || undefined}
              options={[...VOC_SEVERITIES]}
              onChange={(value) =>
                setDraft({ ...draft, severity: (value as string) ?? "" })
              }
            />
          </div>
          <div>
            <Typography.Text type="secondary">摘要</Typography.Text>
            <Input.TextArea
              autoSize={{ minRows: 3, maxRows: 8 }}
              value={draft.summary}
              onChange={(value) => setDraft({ ...draft, summary: value })}
            />
          </div>
        </Space>
      </Modal>
    </>
  );
}
