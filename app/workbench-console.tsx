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
import { useEffect, useState, useTransition } from "react";

import type { AuthUser } from "../src/features/auth/types";
import type { VocMetrics } from "../src/features/voc/metrics";
import type { WorkbenchTicket } from "../src/features/workbench/data";
import {
  ABSENT,
  formatHours,
  formatShanghaiTime,
  SEVERITY_COLOR,
  shortRecordNumber,
  STATE_COLOR,
} from "../src/features/workbench/presentation";
import {
  filterHref,
  pageHref,
  ticketDetailHref,
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

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

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

  const columns = [
    {
      title: "记录编号",
      dataIndex: "recordNumber",
      width: 96,
      fixed: "left" as const,
      render: (_: unknown, row: WorkbenchTicket) => (
        <Link
          href={ticketDetailHref(query, row.recordNumber)}
          title={row.recordNumber}
        >
          {shortRecordNumber(row.recordNumber)}
        </Link>
      ),
    },
    {
      title: "反馈时间",
      dataIndex: "feedbackAt",
      width: 140,
      render: (_: unknown, row: WorkbenchTicket) =>
        formatShanghaiTime(row.feedbackAt) ?? ABSENT,
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
        <Tooltip content={`超时判据为假设 SLA ${ASSUMED_SLA_HOURS} 小时，非合同约定值`}>
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
            <span>{formatHours(dwell)} 小时</span>
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
        <Menu
          key={query.queue}
          defaultSelectedKeys={[query.queue]}
          style={{ width: "100%" }}
        >
          <Menu.ItemGroup title="工单队列">
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
          </Menu.ItemGroup>
        </Menu>
      </Layout.Sider>

      <Layout>
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
            <Avatar size={30} style={{ backgroundColor: "rgb(var(--primary-6))" }}>
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
                  scroll={{ x: 1200 }}
                  // The whole row opens the full ticket page. The record number
                  // stays a real link so the row remains keyboard-reachable and
                  // its URL remains copyable.
                  onRow={(row) => ({
                    onClick: () => go(ticketDetailHref(query, row.recordNumber)),
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

        {/* Bottom-right, out of the way of the work. It is the one link on this
            page that leaves the workbench, and a pitch page has no business
            sharing the top bar with an operator's own identity. */}
        <Layout.Footer className="oc-console__footer">
          <Link href="/?view=showcase">方案展示厅 →</Link>
        </Layout.Footer>
      </Layout>

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
          value={`${formatHours(metrics.averageClosureHours)} 小时`}
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
          折算节省工时 {formatHours(metrics.effort.savedHours)} 小时 ={" "}
          {metrics.effort.taggedRecords} 条已打标 ×{" "}
          {metrics.effort.manualMinutesPerRecord} 分钟/条。单条分钟数为假设基线，未经实测，因此不换算为金额。
        </Typography.Text>
      )}
    </Space>
  );
}
