"use client";

// Must precede every Arco import. Arco reads createRoot off the "react-dom" root export,
// where React 19 no longer puts it, and falls back to the deleted ReactDOM.render.
import "../src/features/workbench/arco-runtime";
import "@arco-design/web-react/dist/css/arco.css";

import {
  Alert,
  Button,
  Checkbox,
  Message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "@arco-design/web-react";
import { IconPlus } from "@arco-design/web-react/icon";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { Member } from "../src/features/directory/members";
import {
  routingHealth,
  splitScope,
  type OwnerRuleRecord,
} from "../src/features/voc/owner-rules";

// 人员管理: the routing table that decides who a ticket goes to.
//
// It used to live only in the Bitable, which meant an operator asking "why did this go to
// him" had to leave the console and open a second table. Everything here writes back to
// that same table — this is a different front door to one source of truth, not a copy.
//
// The scope is **built** from the channel and category values the data actually contains,
// never typed: resolveOwner matches by exact string, so "400客服" without the space is a
// rule that never fires and never says so.
export type OwnersPaneProps = Readonly<{
  rules: readonly OwnerRuleRecord[];
  members: readonly Member[];
  channels: readonly string[];
  categories: readonly string[];
  // Null when the routing table could not be read at all, which is different from it
  // being empty and is shown as such.
  unavailable: boolean;
}>;

type Draft = Readonly<{
  recordId: string | null;
  channel: string;
  category: string;
  openId: string;
  fallback: boolean;
}>;

const EMPTY: Draft = {
  recordId: null,
  channel: "",
  category: "",
  openId: "",
  fallback: false,
};

export function OwnersPane({
  rules,
  members,
  channels,
  categories,
  unavailable,
}: OwnersPaneProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  // A ref, not the saving state: two clicks dispatched before React re-renders would both
  // read it as false and write the rule twice.
  const inFlight = useRef(false);

  const health = routingHealth(rules, channels);

  async function send(
    url: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown,
  ): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    try {
      const response = await fetch(url, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const message =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { message?: unknown }).message === "string"
          ? (payload as { message: string }).message
          : "操作失败，请稍后重试";

      if (!response.ok) {
        // 422 carries the reason the rule was refused — it is the useful part, so it is
        // shown for long enough to read.
        Message.error({ content: message, duration: 6000 });
        return false;
      }
      Message.success(message);
      router.refresh();
      return true;
    } catch {
      Message.error("网络异常，请检查连接后重试");
      return false;
    } finally {
      inFlight.current = false;
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    const body = {
      channel: draft.channel,
      category: draft.category,
      openId: draft.openId,
      fallback: draft.fallback,
    };
    const done = draft.recordId
      ? await send(`/api/voc/owners/${encodeURIComponent(draft.recordId)}`, "PATCH", body)
      : await send("/api/voc/owners", "POST", body);
    setSaving(false);
    if (done) setDraft(null);
  }

  async function remove(recordId: string) {
    setRemoving(recordId);
    await send(`/api/voc/owners/${encodeURIComponent(recordId)}`, "DELETE");
    setRemoving(null);
  }

  const columns = [
    {
      title: "负责范围",
      dataIndex: "scope",
      render: (_: unknown, row: OwnerRuleRecord) => {
        const { channel, category } = splitScope(row.scope);
        return (
          <Space size={4}>
            <Tag>{channel || "—"}</Tag>
            {category ? <Tag color="arcoblue">{category}</Tag> : (
              <Typography.Text type="secondary">全部品类</Typography.Text>
            )}
          </Space>
        );
      },
    },
    {
      title: "负责人",
      dataIndex: "ownerName",
      width: 160,
      render: (_: unknown, row: OwnerRuleRecord) =>
        row.ownerName ? (
          row.ownerName
        ) : (
          // An unreadable person is shown as a gap rather than as a raw open_id, which
          // is not a colleague's name.
          <Typography.Text type="secondary">未解析到姓名</Typography.Text>
        ),
    },
    {
      title: "兜底",
      dataIndex: "fallback",
      width: 90,
      render: (_: unknown, row: OwnerRuleRecord) =>
        row.fallback ? <Tag color="orange">兜底</Tag> : "—",
    },
    {
      title: "操作",
      dataIndex: "recordId",
      width: 150,
      render: (_: unknown, row: OwnerRuleRecord) => (
        <Space size="mini">
          <Button
            size="mini"
            onClick={() => {
              const { channel, category } = splitScope(row.scope);
              setDraft({
                recordId: row.recordId,
                channel,
                category,
                openId: row.openId,
                fallback: row.fallback,
              });
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="删除这条路由规则？"
            content="删除后，匹配这个范围的工单将改由兜底负责人接收。"
            onOk={() => void remove(row.recordId)}
          >
            <Button size="mini" status="danger" loading={removing === row.recordId}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="medium" style={{ width: "100%" }}>
      {unavailable ? (
        <Alert type="warning" content="负责人表读不出来，请稍后重试。" />
      ) : (
        <>
          {/* The state of the routing, above the table: whether a ticket that matches
              nothing has anywhere to go, and which channels rely on that. */}
          {!health.hasFallback && (
            <Alert
              type="error"
              content="没有兜底负责人——匹配不到规则的工单将无人接收。"
            />
          )}
          {health.uncovered.length > 0 && health.hasFallback && (
            <Alert
              type="info"
              content={`${health.uncovered.join("、")} 没有专属规则，会走兜底。`}
            />
          )}
          {health.shadowed.length > 0 && (
            <Alert
              type="warning"
              content={`重复范围：${health.shadowed.join("、")}——匹配只取第一条，后面的不会生效。`}
            />
          )}
        </>
      )}

      <Space>
        <Button type="primary" icon={<IconPlus />} onClick={() => setDraft(EMPTY)}>
          新增规则
        </Button>
        <Typography.Text type="secondary">
          共 {health.total} 条；工单按「渠道/品类」优先匹配，其次「渠道」，都不中则走兜底
        </Typography.Text>
      </Space>

      <Table
        rowKey="recordId"
        columns={columns}
        data={[...rules]}
        pagination={false}
        border={{ wrapper: true, cell: true }}
        size="small"
        noDataElement="还没有路由规则"
      />

      <Modal
        title={draft?.recordId ? "编辑路由规则" : "新增路由规则"}
        visible={draft !== null}
        unmountOnExit
        confirmLoading={saving}
        okButtonProps={{ disabled: !draft?.channel || !draft?.openId }}
        onCancel={() => setDraft(null)}
        onOk={() => void save()}
      >
        {draft && (
          <Space direction="vertical" size="medium" style={{ width: "100%" }}>
            <div>
              <Typography.Text type="secondary">渠道（必填）</Typography.Text>
              {/* Chosen from the values the data contains, never typed: an exact-match
                  rule on a value no ticket carries is dead and says nothing. */}
              <Select
                placeholder="选择渠道"
                value={draft.channel || undefined}
                style={{ width: "100%" }}
                options={[...channels]}
                onChange={(value) => setDraft({ ...draft, channel: value as string })}
              />
            </div>
            <div>
              <Typography.Text type="secondary">品类（留空表示该渠道全部品类）</Typography.Text>
              <Select
                allowClear
                placeholder="全部品类"
                value={draft.category || undefined}
                style={{ width: "100%" }}
                options={[...categories]}
                onChange={(value) =>
                  setDraft({ ...draft, category: (value as string) ?? "" })
                }
              />
            </div>
            <div>
              <Typography.Text type="secondary">负责人（必填）</Typography.Text>
              <Select
                showSearch
                placeholder={
                  members.length === 0 ? "通讯录读不出来，暂时无法选择" : "选择负责人"
                }
                disabled={members.length === 0}
                value={draft.openId || undefined}
                style={{ width: "100%" }}
                options={members.map((member) => ({
                  label: member.name,
                  value: member.openId,
                }))}
                onChange={(value) => setDraft({ ...draft, openId: value as string })}
              />
            </div>
            <Checkbox
              checked={draft.fallback}
              onChange={(checked) => setDraft({ ...draft, fallback: checked })}
            >
              设为兜底负责人（匹配不到任何规则的工单归他，只能有一个）
            </Checkbox>
          </Space>
        )}
      </Modal>
    </Space>
  );
}
