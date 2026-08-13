"use client";

// Must precede every Arco import: Arco reads createRoot off the "react-dom" root
// export, where React 19 no longer puts it, and silently falls back to the
// deleted ReactDOM.render. src/features/workbench/arco-react19.test.tsx fails if
// this line goes away.
import "@arco-design/web-react/lib/_util/react-19-adapter";
import "@arco-design/web-react/dist/css/arco.css";

import {
  Alert,
  Breadcrumb,
  Card,
  Descriptions,
  Drawer,
  Input,
  Layout,
  Menu,
  Pagination,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from "@arco-design/web-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AuthUser } from "../src/features/auth/types";
import type { VocMetrics } from "../src/features/voc/metrics";
import type { WorkbenchTicket } from "../src/features/workbench/data";
import {
  filterHref,
  pageHref,
  ticketHref,
  toPatch,
  type StringFilterField,
} from "../src/features/workbench/href";
import {
  ASSUMED_SLA_HOURS,
  dwellHours,
  isOverdue,
  PAGE_SIZE,
  QUEUES,
  SORTS,
  type WorkbenchPage,
  type WorkbenchQuery,
} from "../src/features/workbench/query";
import { availableActions } from "../src/features/workbench/write-actions";
import { WorkbenchActions } from "./workbench-actions";

const ABSENT = "—";

// The Base's 记录编号 is a 36-character UUID, so the full value is unreadable in
// a table column and useless as a title. The last six characters are the same
// handle warRoomName builds group names from ("VOC-a3cdc5-冰箱-高"), which is the
// point: an operator looking at a Feishu war room can find its row, and someone
// reading a row knows what its group is called. The full value stays available
// in the drawer.
function shortNumber(recordNumber: string): string {
  return recordNumber.slice(-6);
}

// Fixed +08:00, never the runtime's zone: this renders identically on a Vercel
// box in Washington and on a laptop in Shanghai, and the records it describes
// are Chinese customer feedback timestamped in Beijing time.
function shanghaiTime(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  const shifted = new Date(parsed + 8 * 3_600_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    ` ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  );
}

function hours(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

const SEVERITY_COLOR: Readonly<Record<string, string>> = {
  高: "red",
  中: "orange",
  低: "gray",
};

// Terminal states are grey because a closed ticket is not news. The two states
// that need someone to move are the only coloured ones, so scanning the column
// finds work rather than finding every row equally loud.
const STATE_COLOR: Readonly<Record<string, string>> = {
  待分析: "gray",
  分析失败: "red",
  已分析: "arcoblue",
  无需跟进: "gray",
  待跟进: "orange",
  跟进中: "arcoblue",
  待闭环: "purple",
  已闭环: "green",
};

export type WorkbenchConsoleProps = Readonly<{
  user: AuthUser;
  metrics: VocMetrics | null;
  view: WorkbenchPage;
  query: WorkbenchQuery;
  now: number;
  // Distinct values are computed on the server from every record, not from the
  // current page, so a filter never offers only what happens to be on screen.
  options: Readonly<Record<StringFilterField, readonly string[]>>;
}>;

export function WorkbenchConsole({
  user,
  metrics,
  view,
  query,
  now,
  options,
}: WorkbenchConsoleProps) {
  const router = useRouter();
  const [search, setSearch] = useState(query.search);

  function go(href: string) {
    router.push(href);
  }

  const selected = view.selected;

  const columns = [
    {
      title: "记录编号",
      dataIndex: "recordNumber",
      width: 96,
      fixed: "left" as const,
      render: (_: unknown, row: WorkbenchTicket) => (
        <Link
          href={ticketHref(query, row.recordNumber)}
          title={row.recordNumber}
        >
          {shortNumber(row.recordNumber)}
        </Link>
      ),
    },
    {
      title: "反馈时间",
      dataIndex: "feedbackAt",
      width: 140,
      render: (_: unknown, row: WorkbenchTicket) =>
        shanghaiTime(row.feedbackAt) ?? ABSENT,
    },
    {
      title: "渠道 / 品类",
      dataIndex: "channel",
      width: 150,
      render: (_: unknown, row: WorkbenchTicket) =>
        [row.channel, row.category].filter(Boolean).join(" / ") || ABSENT,
    },
    {
      title: "原始内容",
      dataIndex: "content",
      ellipsis: true,
      width: 280,
    },
    {
      title: "严重度",
      dataIndex: "severity",
      width: 90,
      render: (_: unknown, row: WorkbenchTicket) =>
        row.severity ? (
          <Tag color={SEVERITY_COLOR[row.severity]}>{row.severity}</Tag>
        ) : (
          ABSENT
        ),
    },
    {
      title: "流程状态",
      dataIndex: "state",
      width: 104,
      render: (_: unknown, row: WorkbenchTicket) => (
        <Tag color={STATE_COLOR[row.state]}>{row.state}</Tag>
      ),
    },
    {
      title: "负责人",
      dataIndex: "ownerNames",
      width: 110,
      render: (_: unknown, row: WorkbenchTicket) =>
        row.ownerNames.length === 0 ? (
          <span style={{ color: "var(--color-text-3)" }}>未分配</span>
        ) : (
          row.ownerNames.join("、")
        ),
    },
    {
      title: "停留时长",
      dataIndex: "dwell",
      width: 122,
      render: (_: unknown, row: WorkbenchTicket) => {
        const dwell = dwellHours(row, now);
        if (dwell === null) return ABSENT;
        return (
          <Space size={4}>
            <span>{hours(dwell)} 小时</span>
            {isOverdue(row, now) && (
              <Tag color="red" size="small">
                超时
              </Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: "下一步",
      dataIndex: "next",
      width: 128,
      fixed: "right" as const,
      render: (_: unknown, row: WorkbenchTicket) => {
        // Claiming outranks any transition: nobody may perform a transition on a
        // ticket with no owner, so offering one would be offering a refusal.
        const label = !row.hasOwner ? "我来跟进" : availableActions(row)[0];
        return label ? (
          <Link href={ticketHref(query, row.recordNumber)}>{label} →</Link>
        ) : (
          <span style={{ color: "var(--color-text-3)" }}>{ABSENT}</span>
        );
      },
    },
  ];

  function filterSelect(field: StringFilterField, placeholder: string) {
    return (
      <Select
        key={field}
        allowClear
        placeholder={placeholder}
        value={query[field] ?? undefined}
        style={{ width: 152 }}
        options={[...options[field]]}
        onChange={(value) =>
          go(filterHref(query, toPatch(field, (value as string) ?? null)))
        }
      />
    );
  }

  return (
    <Layout className="oc-console">
      <Layout.Sider width={200} className="oc-console__sider">
        <div className="oc-console__brand">万护 OneCare</div>
        <Menu selectedKeys={[query.queue]} style={{ width: "100%" }}>
          <Menu.ItemGroup title="工单队列">
            {QUEUES.map((queue) => (
              <Menu.Item
                key={queue.key}
                onClick={() => go(filterHref(query, { queue: queue.key }))}
              >
                <Space>
                  <span>{queue.label}</span>
                  <Tag size="small">{view.queueCounts[queue.key]}</Tag>
                </Space>
              </Menu.Item>
            ))}
          </Menu.ItemGroup>
        </Menu>
      </Layout.Sider>

      <Layout>
        <Layout.Header className="oc-console__header">
          <Space size="large">
            <Breadcrumb>
              <Breadcrumb.Item>服务运营</Breadcrumb.Item>
              <Breadcrumb.Item>VOC 工单</Breadcrumb.Item>
              <Breadcrumb.Item>
                {QUEUES.find((q) => q.key === query.queue)?.label}
              </Breadcrumb.Item>
            </Breadcrumb>
          </Space>
          <Space>
            <span className="oc-console__user">{user.name}</span>
            <Link href="/?view=showcase">方案展示厅 →</Link>
          </Space>
        </Layout.Header>

        <Layout.Content className="oc-console__content">
          <Card
            bordered={false}
            title={
              <Space align="center">
                <Typography.Title heading={5} style={{ margin: 0 }}>
                  {QUEUES.find((q) => q.key === query.queue)?.label}
                </Typography.Title>
                <Tag color="arcoblue">{view.matched} 条</Tag>
              </Space>
            }
          >
            <Typography.Paragraph style={{ marginTop: 0 }} type="secondary">
              {QUEUES.find((q) => q.key === query.queue)?.hint}
              　超时判据是**假设 SLA {ASSUMED_SLA_HOURS} 小时**，不是海信给的合同值。
            </Typography.Paragraph>

            {metrics === null && (
              // Raised out of the 数据概览 tab and onto the main view. A failed
              // Bitable read empties `tickets` as well as the aggregates, and an
              // empty table reads as "no work here" — indistinguishable from a
              // genuinely empty queue. The operator has to be told the
              // difference without going looking for it.
              <Alert
                type="warning"
                style={{ marginBottom: 12 }}
                content="读取多维表格失败，指标与工单列表都可能不完整。这里不渲染任何数字，以免把读取失败显示成 0。"
              />
            )}

            <Tabs defaultActiveTab="tickets">
              <Tabs.TabPane key="tickets" title="工单列表">
                <Space wrap style={{ marginBottom: 12 }}>
                  {filterSelect("state", "流程状态")}
                  {filterSelect("severity", "严重度")}
                  {filterSelect("channel", "渠道")}
                  {filterSelect("category", "品类")}
                  {filterSelect("polarity", "情绪极性")}
                  {filterSelect("dimension", "问题维度")}
                  {filterSelect("owner", "负责人")}
                  <Input.Search
                    allowClear
                    placeholder="搜原文 / 编号 / 机型"
                    value={search}
                    style={{ width: 240 }}
                    onChange={setSearch}
                    onSearch={(value) =>
                      go(filterHref(query, { search: value || null }))
                    }
                  />
                  <Select
                    value={query.sort}
                    style={{ width: 176 }}
                    options={SORTS.map((sort) => ({
                      label: sort.label,
                      value: sort.key,
                    }))}
                    onChange={(value) =>
                      go(filterHref(query, { sort: value as string }))
                    }
                  />
                </Space>

                <Table
                  rowKey="recordNumber"
                  columns={columns}
                  data={[...view.rows]}
                  pagination={false}
                  scroll={{ x: 1400 }}
                  border={{ wrapper: true, cell: true }}
                  size="small"
                  noDataElement="这个队列现在是空的"
                />

                <div className="oc-console__pager">
                  <Pagination
                    current={view.page}
                    total={view.matched}
                    pageSize={PAGE_SIZE}
                    showTotal={(total) => `共 ${total} 条`}
                    onChange={(page) => go(pageHref(query, page))}
                  />
                </div>
              </Tabs.TabPane>

              <Tabs.TabPane key="metrics" title="数据概览">
                {metrics ? (
                  <MetricsPane metrics={metrics} />
                ) : (
                  <Typography.Paragraph>
                    指标暂不可用——读取多维表格失败，这里不渲染任何数字，以免把读取失败显示成“0”。
                  </Typography.Paragraph>
                )}
              </Tabs.TabPane>
            </Tabs>
          </Card>
        </Layout.Content>
      </Layout>

      <Drawer
        width={620}
        visible={selected !== null}
        title={selected ? `工单详情 · ${shortNumber(selected.recordNumber)}` : ""}
        footer={null}
        onCancel={() => go(ticketHref(query, null))}
      >
        {selected && (
          <TicketDrawer ticket={selected} query={query} now={now} />
        )}
      </Drawer>
    </Layout>
  );
}

function MetricsPane({ metrics }: Readonly<{ metrics: VocMetrics }>) {
  // Every percentage comes from a ratio aggregateVocMetrics already computed, or
  // from a division whose denominator is spelled out in the label beside it —
  // never from a count divided ad hoc where a reader cannot see what it was
  // divided by.
  const attempted = metrics.taggingSucceeded + metrics.taggingFailed;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Space size={48} wrap>
        <Statistic title="反馈总量" value={metrics.total} groupSeparator />
        <Statistic
          title="负向占比（中评+差评 / 已打标）"
          value={percent(metrics.negativeShare)}
        />
        <Statistic title="已建单" value={metrics.ticketsOpened} groupSeparator />
        <Statistic title="已闭环" value={metrics.ticketsClosed} groupSeparator />
        <Statistic title="闭环率（已闭环 / 已建单）" value={percent(metrics.closureRate)} />
        <Statistic
          title="平均闭环时长"
          value={`${hours(metrics.averageClosureHours)} 小时`}
        />
        <Statistic
          title="打标成功率（成功 / 成功+失败）"
          value={attempted === 0 ? ABSENT : percent(metrics.taggingSucceeded / attempted)}
        />
      </Space>

      <Space size="large" align="start" wrap>
        <Card size="small" title="情绪极性分布" style={{ minWidth: 260 }}>
          <Descriptions
            column={1}
            size="small"
            data={Object.entries(metrics.byPolarity).map(([label, value]) => ({
              label,
              value,
            }))}
          />
        </Card>
        <Card size="small" title="问题维度 Top 6" style={{ minWidth: 260 }}>
          <Descriptions
            column={1}
            size="small"
            data={metrics.dimensionTop.map((row) => ({
              label: row.dimension,
              value: row.count,
            }))}
          />
        </Card>
        <Card size="small" title="渠道分布" style={{ minWidth: 260 }}>
          <Descriptions
            column={1}
            size="small"
            data={metrics.byChannel.map((row) => ({
              label: row.channel,
              value: row.count,
            }))}
          />
        </Card>
      </Space>

      {metrics.effort && (
        <Typography.Text type="secondary">
          折算节省工时 {hours(metrics.effort.savedHours)} 小时 ={" "}
          {metrics.effort.taggedRecords} 条已打标 ×{" "}
          {metrics.effort.manualMinutesPerRecord} 分钟/条。
          **这个单条分钟数是假设值，没有海信的实测工时做基线**，所以不换算成年化金额。
        </Typography.Text>
      )}
    </Space>
  );
}

function TicketDrawer({
  ticket,
  query,
  now,
}: Readonly<{
  ticket: WorkbenchTicket;
  query: WorkbenchQuery;
  now: number;
}>) {
  const dwell = dwellHours(ticket, now);
  // Computed from the row the server already sent — the browser never decides
  // which transitions are legal, and never sees an open_id in order to.
  const actions = availableActions(ticket);
  const canClaim = !ticket.hasOwner;

  return (
    <Space direction="vertical" size="medium" style={{ width: "100%" }}>
      <Card size="small" title="可执行操作">
        {actions.length === 0 && !canClaim ? (
          <Typography.Text type="secondary">
            {ticket.state === "已闭环" || ticket.state === "无需跟进"
              ? `${ticket.state}是终态，没有后续动作。`
              : `${ticket.state}下没有可由人执行的动作，等打标流水线处理。`}
          </Typography.Text>
        ) : (
          <Space direction="vertical" size="small">
            <WorkbenchActions
              recordId={ticket.recordId}
              seenState={ticket.state}
              actions={actions}
              canClaim={canClaim}
            />
            {/* Said plainly rather than implied. This component cannot know
                whether the viewer is the owner — that is per-viewer, and the row
                came from a cache entry every viewer shares — so the buttons are
                offered to everyone and the server decides. */}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              状态流转只有负责人本人能做，其他人点击会被服务端拒绝。改派负责人请在多维表格里操作。
            </Typography.Text>
          </Space>
        )}
      </Card>

      <Descriptions
        column={2}
        size="small"
        border
        title="工单信息"
        data={[
          { label: "记录编号", value: ticket.recordNumber },
          {
            label: "渠道 / 品类",
            value:
              [ticket.channel, ticket.category].filter(Boolean).join(" / ") ||
              ABSENT,
          },
          { label: "机型", value: ticket.model || ABSENT },
          { label: "情绪极性", value: ticket.polarity ?? ABSENT },
          {
            label: "问题维度",
            value:
              ticket.dimensions.length === 0
                ? ABSENT
                : ticket.dimensions.join("、"),
          },
          { label: "严重度", value: ticket.severity ?? ABSENT },
          { label: "流程状态", value: ticket.state },
          {
            label: "负责人",
            value:
              ticket.ownerNames.length === 0
                ? "未分配"
                : ticket.ownerNames.join("、"),
          },
          {
            label: "停留时长",
            value: dwell === null ? ABSENT : `${hours(dwell)} 小时`,
          },
          {
            label: "反馈时间",
            value: shanghaiTime(ticket.feedbackAt) ?? ABSENT,
          },
          {
            label: "建单时间",
            value: shanghaiTime(ticket.ticketOpenedAt) ?? ABSENT,
          },
          { label: "闭环时间", value: shanghaiTime(ticket.closedAt) ?? ABSENT },
          {
            label: "时长",
            value:
              ticket.durationHours === null
                ? ABSENT
                : `${hours(ticket.durationHours)} 小时`,
          },
        ]}
      />

      <Card size="small" title="完整原文">
        <Typography.Paragraph style={{ margin: 0 }}>
          {ticket.content}
        </Typography.Paragraph>
      </Card>

      <Card size="small" title="AI 摘要">
        <Typography.Paragraph style={{ margin: 0 }}>
          {ticket.summary || ABSENT}
        </Typography.Paragraph>
      </Card>

      <Card size="small" title="AI 回复话术">
        {ticket.replies.length === 0 ? (
          <Typography.Text type="secondary">{ABSENT}</Typography.Text>
        ) : (
          <Space direction="vertical" size="small">
            {ticket.replies.map((reply, index) => (
              // Tone plus position, not tone alone: two drafts sharing a tone is
              // a shape parseReplyText really produces.
              <div key={`${reply.tone}-${index}`}>
                <Tag color="arcoblue">{reply.tone}</Tag> {reply.text}
              </div>
            ))}
          </Space>
        )}
      </Card>

      <Link href={ticketHref(query, null)}>收起详情</Link>
    </Space>
  );
}
