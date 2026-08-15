"use client";

// Must precede every Arco import. Arco reads createRoot off the "react-dom" root export,
// where React 19 no longer puts it, and falls back to the deleted ReactDOM.render.
import "../src/features/workbench/arco-runtime";
import "@arco-design/web-react/dist/css/arco.css";

import { Button, Input, Message, Modal, Select, Space, Typography } from "@arco-design/web-react";
import { IconPlus } from "@arco-design/web-react/icon";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// 新建工单: the demo's starting gun.
//
// Every other way to show the chain spends something — 立即分析 uses up one of the 498
// 待分析 rows, and staging moves existing tickets around. A ticket typed here runs the
// whole loop on a row that did not exist a minute ago, which is also the only way to
// demonstrate it with the audience's own words.
export type NewTicketButtonProps = Readonly<{
  channels: readonly string[];
  categories: readonly string[];
}>;

const EMPTY = {
  channel: "",
  category: "",
  model: "",
  content: "",
  userRef: "",
  deviceRef: "",
};

export function NewTicketButton({ channels, categories }: NewTicketButtonProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<typeof EMPTY | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  async function save() {
    if (!draft || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const response = await fetch("/api/voc/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload: unknown = await response.json().catch(() => null);
      const read = (key: string) =>
        typeof payload === "object" && payload !== null
          ? (payload as Record<string, unknown>)[key]
          : undefined;
      const message =
        typeof read("message") === "string"
          ? (read("message") as string)
          : "新建失败，请稍后重试";

      if (!response.ok) {
        Message.error({ content: message, duration: 6000 });
        return;
      }
      Message.success(message);
      setDraft(null);
      const recordNumber = read("recordNumber");
      // Straight to the ticket that was just made: the next thing anyone wants is
      // 立即分析, and it lives on that page.
      if (typeof recordNumber === "string" && recordNumber.length > 0) {
        router.push(`/workbench/tickets/${encodeURIComponent(recordNumber)}`);
      } else {
        router.refresh();
      }
    } catch {
      Message.error("网络异常，请检查连接后重试");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <Button type="primary" icon={<IconPlus />} onClick={() => setDraft(EMPTY)}>
        新建工单
      </Button>
      <Modal
        title="新建工单"
        visible={draft !== null}
        unmountOnExit
        confirmLoading={saving}
        okButtonProps={{ disabled: !draft?.channel || (draft?.content.length ?? 0) < 5 }}
        onCancel={() => setDraft(null)}
        onOk={() => void save()}
      >
        {draft && (
          <Space direction="vertical" size="medium" style={{ width: "100%" }}>
            <div>
              <Typography.Text type="secondary">渠道（必填）</Typography.Text>
              {/* Chosen from the values the Base's single-select already carries: writing
                  a new one would create an option in the enterprise's own table. */}
              <Select
                placeholder="选择渠道"
                style={{ width: "100%" }}
                value={draft.channel || undefined}
                options={[...channels]}
                onChange={(value) => setDraft({ ...draft, channel: value as string })}
              />
            </div>
            <div>
              <Typography.Text type="secondary">品类</Typography.Text>
              <Select
                allowClear
                placeholder="选择品类"
                style={{ width: "100%" }}
                value={draft.category || undefined}
                options={[...categories]}
                onChange={(value) =>
                  setDraft({ ...draft, category: (value as string) ?? "" })
                }
              />
            </div>
            <div>
              <Typography.Text type="secondary">机型</Typography.Text>
              <Input
                placeholder="例如 海信 65E5Q-PRO"
                value={draft.model}
                onChange={(value) => setDraft({ ...draft, model: value })}
              />
            </div>
            <div>
              <Typography.Text type="secondary">用户原话（必填）</Typography.Text>
              <Input.TextArea
                autoSize={{ minRows: 4, maxRows: 10 }}
                placeholder="把用户说的话原样写进来，AI 分析读的就是这段"
                value={draft.content}
                onChange={(value) => setDraft({ ...draft, content: value })}
              />
            </div>
            <Space size="medium" style={{ width: "100%" }}>
              <div style={{ flex: 1 }}>
                <Typography.Text type="secondary">用户标识</Typography.Text>
                <Input
                  placeholder="U-…"
                  value={draft.userRef}
                  onChange={(value) => setDraft({ ...draft, userRef: value })}
                />
              </div>
              <div style={{ flex: 1 }}>
                <Typography.Text type="secondary">设备标识</Typography.Text>
                <Input
                  placeholder="D-…"
                  value={draft.deviceRef}
                  onChange={(value) => setDraft({ ...draft, deviceRef: value })}
                />
              </div>
            </Space>
          </Space>
        )}
      </Modal>
    </>
  );
}
