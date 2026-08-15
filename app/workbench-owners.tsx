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
  OWNER_ROLES,
  routingHealth,
  splitScope,
  type OwnerRole,
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
  // 评委通道 sees the roster and the routing health, and changes neither.
  readOnly?: boolean;
}>;

type Draft = Readonly<{
  recordId: string | null;
  role: OwnerRole;
  channel: string;
  category: string;
  openId: string;
  fallback: boolean;
}>;

const EMPTY: Draft = {
  recordId: null,
  role: "客服",
  channel: "",
  category: "",
  openId: "",
  fallback: false,
};

const ROLE_COLOR: Readonly<Record<OwnerRole, string>> = {
  客服: "arcoblue",
  工程师: "green",
  管理员: "orange",
};

const ROLE_HINT: Readonly<Record<OwnerRole, string>> = {
  客服: "按渠道/品类接工单，可设兜底",
  工程师: "派工时可以选到他，收上门任务卡",
  管理员: "不受工单负责人限制，也是唯一能改这张表的人",
};

export function OwnersPane({
  rules,
  members,
  channels,
  categories,
  unavailable,
  readOnly = false,
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
    // A 工程师 or 管理员 row is a person, not a route: the scope and the 兜底 flag are
    // dropped here rather than sent and rejected.
    const route = draft.role === "客服";
    const body = {
      role: draft.role,
      channel: route ? draft.channel : "",
      category: route ? draft.category : "",
      openId: draft.openId,
      fallback: route && draft.fallback,
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
      title: "角色",
      dataIndex: "role",
      width: 100,
      render: (_: unknown, row: OwnerRuleRecord) => (
        <Tag color={ROLE_COLOR[row.role]}>{row.role}</Tag>
      ),
    },
    {
      title: "负责范围",
      dataIndex: "scope",
      render: (_: unknown, row: OwnerRuleRecord) => {
        if (row.role !== "客服") {
          return <Typography.Text type="secondary">{ROLE_HINT[row.role]}</Typography.Text>;
        }
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
      title: "人员",
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
      hidden: readOnly,
      render: (_: unknown, row: OwnerRuleRecord) => (
        <Space size="mini">
          <Button
            size="mini"
            onClick={() => {
              const { channel, category } = splitScope(row.scope);
              setDraft({
                recordId: row.recordId,
                role: row.role,
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
          {/* 派工 picks from this table's 工程师 rows and nowhere else, so an empty list
              is not a cosmetic gap: the button on every ticket would have nobody to
              offer. */}
          {health.engineers === 0 && (
            <Alert type="warning" content="还没有工程师——工单上的「派工」会没有人可选。" />
          )}
        </>
      )}

      <Space>
        {!readOnly && (
          <Button type="primary" icon={<IconPlus />} onClick={() => setDraft(EMPTY)}>
            新增人员
          </Button>
        )}
        <Typography.Text type="secondary">
          客服路由 {health.total} 条 · 工程师 {health.engineers} 人 · 管理员 {health.admins} 人
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
        title={draft?.recordId ? "编辑人员" : "新增人员"}
        visible={draft !== null}
        unmountOnExit
        confirmLoading={saving}
        okButtonProps={{
          disabled: !draft?.openId || (draft?.role === "客服" && !draft?.channel),
        }}
        onCancel={() => setDraft(null)}
        onOk={() => void save()}
      >
        {draft && (
          <Space direction="vertical" size="medium" style={{ width: "100%" }}>
            <div>
              <Typography.Text type="secondary">角色（必填）</Typography.Text>
              <Select
                value={draft.role}
                style={{ width: "100%" }}
                options={OWNER_ROLES.map((role) => ({ label: role, value: role }))}
                onChange={(value) => setDraft({ ...draft, role: value as OwnerRole })}
              />
              <Typography.Text type="secondary">{ROLE_HINT[draft.role]}</Typography.Text>
            </div>
            {draft.role === "客服" && (
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
            )}
            {draft.role === "客服" && (
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
            )}
            <div>
              <Typography.Text type="secondary">人员（必填）</Typography.Text>
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
            {draft.role === "客服" && (
              <Checkbox
                checked={draft.fallback}
                onChange={(checked) => setDraft({ ...draft, fallback: checked })}
              >
                设为兜底负责人（匹配不到任何规则的工单归他，只能有一个）
              </Checkbox>
            )}
          </Space>
        )}
      </Modal>
    </Space>
  );
}
