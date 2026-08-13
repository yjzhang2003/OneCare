"use client";

// Must precede every Arco import: Arco reads createRoot off the "react-dom" root
// export, where React 19 no longer puts it, and silently falls back to the
// deleted ReactDOM.render. src/features/workbench/arco-react19.test.tsx fails if
// this line goes away.
import "@arco-design/web-react/lib/_util/react-19-adapter";
import "@arco-design/web-react/dist/css/arco.css";

import {
  Alert,
  Avatar,
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
  Tooltip,
  Typography,
} from "@arco-design/web-react";
import {
  IconApps,
  IconBug,
  IconClockCircle,
  IconList,
  IconUserAdd,
} from "@arco-design/web-react/icon";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

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

// The table wrapper's own 1px top and bottom border, which the geometry below
// cannot see: measured as a constant 2px of residual overflow at 1440×800,
// 1680×1050, 1100×760 and 1280×900.
//
// A constant, deliberately, after a self-correcting version of this went wrong:
// folding the observed overflow back into the height on every measurement pass is
// a feedback loop — changing the height retriggers the observer, the overflow is
// re-added, and the table collapses to its floor. A wrong constant costs at most a
// two-pixel scrollbar; a wrong feedback loop cost the whole table.
const TABLE_WRAPPER_BORDERS = 2;

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

// One icon per queue, so the sider is scannable by shape before it is read.
// Keyed by QueueKey rather than by position: a reordered QUEUES array must not
// silently reassign every icon.
const QUEUE_ICON: Readonly<Record<string, React.ReactNode>> = {
  open: <IconList />,
  overdue: <IconClockCircle />,
  unassigned: <IconUserAdd />,
  failed: <IconBug />,
  all: <IconApps />,
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
  // Every navigation here is a server round trip: filtering and paging 3628
  // records stays on the server so only 50 rows cross the wire. That is the right
  // trade, but it means a click has latency, and without a pending state the UI
  // looks dead while it waits — which is what "左侧按钮反应特别慢" actually
  // described. startTransition surfaces the wait; the prefetch below removes most
  // of it.
  const [pending, startTransition] = useTransition();

  // The table body's height is measured rather than computed from a constant.
  // A constant has to encode how tall the chrome above the table is, and that
  // changes with the window: the filter row wraps to two lines or three depending
  // on width. Measuring the wrapper's actual position makes the table fill
  // whatever is left, so there is exactly one scrollbar — the table's — at any
  // viewport.
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const [tableHeight, setTableHeight] = useState<number | null>(null);

  useEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap) return;
    const content = wrap.closest(".oc-console__content");
    if (!content) return;

    function measure() {
      if (!wrap || !content) return;
      const pager = wrap.querySelector<HTMLElement>(".oc-console__pager");
      const head = wrap.querySelector<HTMLElement>(".arco-table-header");

      // getBoundingClientRect().bottom sits at the outer edge of the padding, so
      // using it hands the table the space the padding needs and produces a
      // second scrollbar of exactly that many pixels. Both paddings are read
      // rather than assumed, so changing them in CSS cannot silently reintroduce
      // the overflow.
      const padBottom =
        parseFloat(getComputedStyle(content).paddingBottom) || 0;
      const cardBody = wrap.closest(".arco-card-body");
      const cardPadBottom = cardBody
        ? parseFloat(getComputedStyle(cardBody).paddingBottom) || 0
        : 0;

      const available =
        content.getBoundingClientRect().top +
        content.clientHeight -
        padBottom -
        cardPadBottom -
        wrap.getBoundingClientRect().top -
        (pager?.offsetHeight ?? 0) -
        (head?.offsetHeight ?? 0);
      // A floor rather than an unbounded shrink: below this the table stops being
      // usable and the content area should scroll instead, which is the honest
      // degradation on a short window.
      setTableHeight(
        Math.max(180, Math.floor(available) - TABLE_WRAPPER_BORDERS),
      );
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [view.rows.length, query.queue]);

  function go(href: string) {
    startTransition(() => router.push(href));
  }

  // Warm all five queue routes up front. Switching queues is the most frequent
  // action in this console and the one with nothing to type first, so it is worth
  // paying for eagerly; by the time a queue is clicked its payload is usually
  // already there.
  useEffect(() => {
    for (const queue of QUEUES) {
      router.prefetch(filterHref(query, { queue: queue.key }));
    }
  }, [router, query]);

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
      title: (
        <Tooltip
          content={`超时判据为假设 SLA ${ASSUMED_SLA_HOURS} 小时，非合同约定值`}
        >
          <span>停留时长</span>
        </Tooltip>
      ),
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
        {/* No ItemGroup: there is one group and never will be a second, so its
            title was a label for nothing — and it made every item indented, which
            is what pushed the queue names out of line with the wordmark above. */}
        <Menu selectedKeys={[query.queue]} style={{ width: "100%" }}>
          {QUEUES.map((queue) => (
            <Menu.Item
              key={queue.key}
              onClick={() => go(filterHref(query, { queue: queue.key }))}
            >
              {QUEUE_ICON[queue.key]}
              <span className="oc-console__queue-label">{queue.label}</span>
              <Tag size="small">{view.queueCounts[queue.key]}</Tag>
            </Menu.Item>
          ))}
        </Menu>

        {/* Pinned to the bottom of the sider by the flex rule on
            .arco-layout-sider-children: it is navigation, so it belongs in the
            navigation column, and it is the one destination that leaves the
            workbench, so it belongs at the far end of it. */}
        <div className="oc-console__sider-footer">
          <Link href="/?view=showcase">方案展示厅 →</Link>
        </div>
      </Layout.Sider>

      <Layout className="oc-console__main">
        <Layout.Header className="oc-console__header">
          <Space size="large">
            <Breadcrumb>
              <Breadcrumb.Item key="domain">服务运营</Breadcrumb.Item>
              <Breadcrumb.Item key="entity">VOC 工单</Breadcrumb.Item>
              <Breadcrumb.Item key="queue">
                {QUEUES.find((q) => q.key === query.queue)?.label}
              </Breadcrumb.Item>
            </Breadcrumb>
          </Space>
          <Space size="small" align="center">
            <span className="oc-console__user">{user.name}</span>
            {/* avatarUrl is optional on AuthUser — Feishu does not always return
                one — so the fallback is the name's first character rather than a
                broken image. */}
            <Avatar
              size={30}
              style={{ backgroundColor: "rgb(var(--primary-6))" }}
            >
              {user.avatarUrl ? (
                // A plain <img>, not next/image: the avatar host is whatever
                // Feishu's OAuth user-info returned, so it cannot be declared in
                // images.remotePatterns at build time, and guessing a CDN
                // hostname is exactly the kind of unverified external assumption
                // this project has been burned by. At 30px the rule's LCP and
                // bandwidth concerns do not apply.
                // eslint-disable-next-line @next/next/no-img-element
                <img alt={user.name} src={user.avatarUrl} />
              ) : (
                user.name.slice(0, 1)
              )}
            </Avatar>
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
            </Typography.Paragraph>

            {query.sourceTicketNo !== null && (
              <Alert
                type="info"
                style={{ marginBottom: 12 }}
                content={`只显示来源单号 ${query.sourceTicketNo} 的记录`}
                action={
                  <Link href={filterHref(query, { ticketNo: null })}>清除</Link>
                }
              />
            )}

            {metrics === null && (
              // Raised out of the 数据概览 tab and onto the main view. A failed
              // Bitable read empties `tickets` as well as the aggregates, and an
              // empty table reads as "no work here" — indistinguishable from a
              // genuinely empty queue. The operator has to be told the
              // difference without going looking for it.
              <Alert
                type="warning"
                style={{ marginBottom: 12 }}
                content="读取多维表格失败，当前页面的数字和列表都不完整，请稍后重试。"
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
                  {filterSelect("unit", "事业部")}
                  {filterSelect("level1", "问题分类")}
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

                <div ref={tableWrapRef}>
                  <Table
                    rowKey="recordNumber"
                    columns={columns}
                    data={[...view.rows]}
                    pagination={false}
                    // Measured above, so the tbody is what scrolls and the column
                    // headers stay put while an operator works down 50 rows.
                    scroll={{
                      x: 1200,
                      ...(tableHeight ? { y: tableHeight } : {}),
                    }}
                    // The whole row opens the drawer. A dedicated action column read
                    // as bolted on, and every console this one is modelled on makes
                    // the row itself the target — the record number stays a real
                    // link so the row is still keyboard-reachable and its URL still
                    // copyable.
                    onRow={(row) => ({
                      onClick: () => go(ticketHref(query, row.recordNumber)),
                      style: { cursor: "pointer" },
                    })}
                    border={{ wrapper: true, cell: true }}
                    size="small"
                    loading={pending}
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
                </div>
              </Tabs.TabPane>

              <Tabs.TabPane key="metrics" title="数据概览">
                {metrics ? (
                  <MetricsPane metrics={metrics} />
                ) : (
                  <Typography.Paragraph>
                    指标暂不可用，读取多维表格失败，请稍后重试。
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
        title={
          selected ? `工单详情 · ${shortNumber(selected.recordNumber)}` : ""
        }
        footer={null}
        onCancel={() => go(ticketHref(query, null))}
      >
        {selected && (
          <TicketDrawer
            ticket={selected}
            query={query}
            now={now}
            related={view.selectedRelated}
          />
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
        <Statistic
          title="已建单"
          value={metrics.ticketsOpened}
          groupSeparator
        />
        <Statistic
          title="已闭环"
          value={metrics.ticketsClosed}
          groupSeparator
        />
        <Statistic
          title="闭环率（已闭环 / 已建单）"
          value={percent(metrics.closureRate)}
        />
        <Statistic
          title="平均闭环时长"
          value={`${hours(metrics.averageClosureHours)} 小时`}
        />
        <Statistic
          title="打标成功率（成功 / 成功+失败）"
          value={
            attempted === 0
              ? ABSENT
              : percent(metrics.taggingSucceeded / attempted)
          }
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
          {metrics.effort.manualMinutesPerRecord}{" "}
          分钟/条。单条分钟数为假设基线，未经实测，因此不换算为金额。
        </Typography.Text>
      )}
    </Space>
  );
}

function TicketDrawer({
  ticket,
  query,
  now,
  related,
}: Readonly<{
  ticket: WorkbenchTicket;
  query: WorkbenchQuery;
  now: number;
  related: number;
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
            label: "来源单号",
            value:
              ticket.sourceTicketNo.length === 0 ? (
                ABSENT
              ) : related > 0 ? (
                // The number itself is the link: following it lists every record
                // logged under the same 400 case or the same review, which is the
                // capability the recovered column bought.
                <Link
                  href={filterHref(query, {
                    ticketNo: ticket.sourceTicketNo,
                    ticket: null,
                  })}
                >
                  {ticket.sourceTicketNo}（另有 {related} 条同单号）
                </Link>
              ) : (
                ticket.sourceTicketNo
              ),
          },
          {
            label: "来源",
            value:
              ticket.sourceDetail.length === 0 ? ABSENT : ticket.sourceDetail,
          },
          { label: "事业部", value: ticket.businessUnit || ABSENT },
          { label: "问题分类", value: ticket.categoryLevel1 || ABSENT },
          {
            label: "原始出处",
            value:
              ticket.sourceUrl.length === 0 ? (
                ABSENT
              ) : (
                <a href={ticket.sourceUrl} target="_blank" rel="noreferrer">
                  打开原始页面
                </a>
              ),
          },
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
