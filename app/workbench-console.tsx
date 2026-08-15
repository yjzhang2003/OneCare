"use client";

// Must precede every Arco import: Arco reads createRoot off the "react-dom" root
// export, where React 19 no longer puts it, and silently falls back to the
// deleted ReactDOM.render. src/features/workbench/arco-react19.test.tsx fails if
// this line goes away.
import "../src/features/workbench/arco-runtime";
import "@arco-design/web-react/dist/css/arco.css";

import {
  Alert,
  Avatar,
  Breadcrumb,
  Card,
  Descriptions,
  Input,
  Layout,
  Pagination,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "@arco-design/web-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type { AuthUser } from "../src/features/auth/types";
import type { Member } from "../src/features/directory/members";
import type { OwnerRuleRecord } from "../src/features/voc/owner-rules";
import type { VocMetrics } from "../src/features/voc/metrics";
import type { WorkbenchTicket } from "../src/features/workbench/data";
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
import type {
  IdentityProfile,
  ProfilePage,
} from "../src/features/workbench/profiles";
import { OwnersPane } from "./workbench-owners";
import { ProfileInsightPanel } from "./workbench-profile-insight";
import { ConsoleSider } from "./workbench-sider";

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

// The queue's own label stands in for the ticket section, since which queue you are
// looking at is the more specific fact.
const SECTION_TITLE: Readonly<Record<string, string | undefined>> = {
  users: "用户画像",
  devices: "设备追踪",
  metrics: "数据概览",
  owners: "人员管理",
  tickets: undefined,
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
  // One page of repeat profiles each, narrowed by the same filters and search the
  // ticket list uses. `total` is every identity the filters admit, single-record ones
  // included, so the list can state what it leaves out instead of implying
  // completeness.
  users: ProfilePage;
  devices: ProfilePage;
  // The sider's own two counts, read on every section rather than taken from the
  // lists above — those are empty unless their section is the one being shown, so
  // deriving the counts from them made the sider report 0 users everywhere else.
  userCount: number;
  deviceCount: number;
  selectedProfile: IdentityProfile | null;
  // 人员管理's data. Read only on its own section; `unavailable` distinguishes "the
  // routing table could not be read" from "there are no rules", which are very
  // different things to show an operator.
  owners: Readonly<{
    rules: readonly OwnerRuleRecord[];
    members: readonly Member[];
    unavailable: boolean;
  }>;
}>;

export function WorkbenchConsole({
  user,
  metrics,
  view,
  query,
  now,
  options,
  users,
  devices,
  userCount,
  deviceCount,
  selectedProfile,
  owners,
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
    // Re-measured whenever the mounted table changes: the ticket list and the two
    // profile lists share this ref (only one is ever mounted), and each has its own
    // row count and its own chrome above it.
  }, [
    view.rows.length,
    query.queue,
    query.section,
    users.profiles.length,
    devices.profiles.length,
  ]);

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
      // 客服 and 工程师 in one column rather than two: they answer the same question
      // ("who has this"), and a ticket only ever has an engineer once someone put one
      // on it, so the second line is absent far more often than it is present.
      title: "负责人",
      dataIndex: "ownerNames",
      width: 132,
      render: (_: unknown, row: WorkbenchTicket) => (
        <div className="oc-console__owners">
          {row.ownerNames.length === 0 ? (
            <span style={{ color: "var(--color-text-3)" }}>未分配</span>
          ) : (
            <span>客服 {row.ownerNames.join("、")}</span>
          )}
          {row.engineerNames.length > 0 && (
            <span style={{ color: "var(--color-text-3)" }}>
              工程师 {row.engineerNames.join("、")}
            </span>
          )}
        </div>
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

  // The nine selects plus the search box, shared by the ticket list and both profile
  // lists. One definition because they are the same controls over the same records:
  // a profile is an aggregation of records, so filtering profiles means filtering the
  // records first and grouping what is left. The ticket list adds its sort control
  // through `extra`; the profile lists have a fixed order (heaviest first).
  function filterRow(
    searchPlaceholder: string,
    extra?: React.ReactNode,
  ): React.ReactNode {
    const filterSelect = (field: StringFilterField, placeholder: string) => (
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

    return (
      <Space wrap style={{ marginBottom: 12 }}>
        {filterSelect("state", "流程状态")}
        {filterSelect("severity", "严重度")}
        {filterSelect("channel", "渠道")}
        {filterSelect("category", "品类")}
        {filterSelect("polarity", "情绪极性")}
        {filterSelect("dimension", "问题维度")}
        {filterSelect("owner", "客服负责人")}
        {filterSelect("unit", "事业部")}
        {filterSelect("level1", "问题分类")}
        <Input.Search
          allowClear
          placeholder={searchPlaceholder}
          value={search}
          style={{ width: 240 }}
          onChange={setSearch}
          onSearch={(value) => go(filterHref(query, { search: value || null }))}
        />
        {extra}
      </Space>
    );
  }

  return (
    // hasSider is not optional here even though Arco calls it "generally unnecessary":
    // it detects a sider by looking for Layout.Sider among its *direct* children, and
    // ours arrives inside ConsoleSider. Without it the class that makes this a row is
    // never applied, so the sider stacks on top of a zero-height main column — which
    // is exactly what happened the moment the sider moved into its own component.
    <Layout className="oc-console" hasSider>
      <ConsoleSider
        query={query}
        queueCounts={view.queueCounts}
        userCount={userCount}
        deviceCount={deviceCount}
        selectedKey={query.section === "tickets" ? query.queue : query.section}
        navigate={go}
      />

      <Layout className="oc-console__main">
        <Layout.Header className="oc-console__header">
          <Space size="large">
            <Breadcrumb>
              <Breadcrumb.Item key="domain">服务运营</Breadcrumb.Item>
              {/* The queues, the two profile lists and the overview are all views of
                  the same VOC tickets. 人员管理 is not one of them — it is the routing
                  configuration those tickets are matched against, and filing it under
                  工单 said it held tickets. */}
              {query.section !== "owners" && (
                <Breadcrumb.Item key="entity">VOC 工单</Breadcrumb.Item>
              )}
              {/* Where you actually are, which is the section unless the section is
                  the ticket list — there the queue is the more specific fact. It read
                  the queue label unconditionally before, so 用户画像 announced itself
                  as 待处理 in the breadcrumb while the card title said otherwise. */}
              <Breadcrumb.Item key="section">
                {SECTION_TITLE[query.section] ??
                  QUEUES.find((q) => q.key === query.queue)?.label}
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
                  {SECTION_TITLE[query.section] ??
                    QUEUES.find((q) => q.key === query.queue)?.label}
                </Typography.Title>
                {query.section === "tickets" && (
                  <Tag color="arcoblue">{view.matched} 条</Tag>
                )}
                {query.section === "users" && query.userRef === null && (
                  <Tag color="arcoblue">{users.matched} 个</Tag>
                )}
                {query.section === "devices" && query.deviceRef === null && (
                  <Tag color="arcoblue">{devices.matched} 个</Tag>
                )}
              </Space>
            }
          >
            <Spin loading={pending} style={{ display: "block", width: "100%" }}>
              {query.sourceTicketNo !== null && (
                <Alert
                  type="info"
                  style={{ marginBottom: 12 }}
                  content={`只显示来源单号 ${query.sourceTicketNo} 的记录`}
                  action={
                    <Link href={filterHref(query, { ticketNo: null })}>
                      清除
                    </Link>
                  }
                />
              )}

              {query.section === "tickets" && (
                <>
                  {filterRow(
                    "搜原文 / 编号 / 机型 / 来源单号",
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
                    />,
                  )}

                  <div ref={tableWrapRef}>
                    <Table
                      rowKey="recordNumber"
                      columns={columns}
                      data={[...view.rows]}
                      pagination={false}
                      scroll={{
                        x: 1200,
                        ...(tableHeight ? { y: tableHeight } : {}),
                      }}
                      border={{ wrapper: true, cell: true }}
                      size="small"
                      loading={pending}
                      noDataElement="这个队列现在是空的"
                      onRow={(row) => ({
                        onClick: () => go(ticketDetailHref(query, row.recordNumber)),
                        style: { cursor: "pointer" },
                      })}
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
                </>
              )}

              {query.section === "users" &&
                (query.userRef === null ? (
                  <ProfilePane
                    kind="user"
                    page={users}
                    query={query}
                    go={go}
                    filterRow={filterRow}
                    tableWrapRef={tableWrapRef}
                    tableHeight={tableHeight}
                  />
                ) : (
                  <ProfileDetail
                    kind="user"
                    id={query.userRef}
                    profile={selectedProfile}
                    records={view.rows}
                    query={query}
                    now={now}
                    go={go}
                  />
                ))}

              {query.section === "devices" &&
                (query.deviceRef === null ? (
                  <ProfilePane
                    kind="device"
                    page={devices}
                    query={query}
                    go={go}
                    filterRow={filterRow}
                    tableWrapRef={tableWrapRef}
                    tableHeight={tableHeight}
                  />
                ) : (
                  <ProfileDetail
                    kind="device"
                    id={query.deviceRef}
                    profile={selectedProfile}
                    records={view.rows}
                    query={query}
                    now={now}
                    go={go}
                  />
                ))}

              {query.section === "owners" && (
                <OwnersPane
                  rules={owners.rules}
                  members={owners.members}
                  channels={options.channel}
                  categories={options.category}
                  unavailable={owners.unavailable}
                />
              )}

              {query.section === "metrics" &&
                (metrics ? (
                  <MetricsPane metrics={metrics} />
                ) : (
                  <Alert type="warning" content="指标暂时读不出来，请稍后重试。" />
                ))}
            </Spin>
          </Card>
        </Layout.Content>
      </Layout>

    </Layout>
  );
}

// Both profile tabs are the same table over the same shape, differing only in what
// an id means and which filter drilling into one applies. Two near-identical
// components would drift.
function ProfilePane({
  kind,
  page,
  query,
  go,
  filterRow,
  tableWrapRef,
  tableHeight,
}: Readonly<{
  kind: "user" | "device";
  page: ProfilePage;
  query: WorkbenchQuery;
  go: (href: string) => void;
  // The console's own filter controls, passed in rather than rebuilt: these are the
  // same nine selects over the same records, and a second copy would drift.
  filterRow: (searchPlaceholder: string, extra?: React.ReactNode) => React.ReactNode;
  // The measured table height, shared with the ticket list. Only one of the two
  // tables is ever mounted, so they can share the one ref and the one measurement.
  tableWrapRef: React.RefObject<HTMLDivElement | null>;
  tableHeight: number | null;
}>) {
  const isUser = kind === "user";
  const { profiles, matched, total } = page;

  const columns = [
    {
      title: isUser ? "用户标识" : "设备标识",
      dataIndex: "id",
      width: 130,
      render: (_: unknown, row: IdentityProfile) => (
        <Typography.Text style={{ fontFamily: "ui-monospace, monospace" }}>
          {row.id}
        </Typography.Text>
      ),
    },
    { title: "反馈条数", dataIndex: "records", width: 96 },
    {
      title: "未闭环",
      dataIndex: "open",
      width: 90,
      render: (_: unknown, row: IdentityProfile) =>
        row.open === 0 ? (
          <Typography.Text type="secondary">0</Typography.Text>
        ) : (
          <Tag color="orange">{row.open}</Tag>
        ),
    },
    {
      title: "高严重度",
      dataIndex: "severityHigh",
      width: 100,
      render: (_: unknown, row: IdentityProfile) =>
        row.severityHigh === 0 ? (
          <Typography.Text type="secondary">0</Typography.Text>
        ) : (
          <Tag color="red">{row.severityHigh}</Tag>
        ),
    },
    {
      title: isUser ? "品类" : "机型",
      dataIndex: "categories",
      ellipsis: true,
      width: 200,
      render: (_: unknown, row: IdentityProfile) =>
        (isUser ? row.categories : row.models).join("、") || ABSENT,
    },
    {
      title: "问题维度",
      dataIndex: "dimensions",
      ellipsis: true,
      width: 220,
      render: (_: unknown, row: IdentityProfile) =>
        row.dimensions.join("、") || ABSENT,
    },
    {
      title: "首次反馈",
      dataIndex: "firstFeedbackAt",
      width: 140,
      render: (_: unknown, row: IdentityProfile) =>
        shanghaiTime(row.firstFeedbackAt) ?? ABSENT,
    },
    {
      title: "最近反馈",
      dataIndex: "lastFeedbackAt",
      width: 140,
      render: (_: unknown, row: IdentityProfile) =>
        shanghaiTime(row.lastFeedbackAt) ?? ABSENT,
    },
  ];

  return (
    <>
      {filterRow(
        isUser ? "搜用户标识 / 原文 / 机型" : "搜设备标识 / 原文 / 机型",
      )}

      <Space style={{ marginBottom: 12 }}>
        <Tag color="arcoblue">
          {`${matched} 个${isUser ? "多条反馈" : "重复报修"}`}
        </Tag>
        <Tag>{`共 ${total} 个${isUser ? "用户" : "设备"}标识`}</Tag>
      </Space>

      <div ref={tableWrapRef}>
        <Table
          rowKey="id"
          columns={columns}
          data={[...profiles]}
          // Paged on the server like the ticket list, so a filter narrows the whole
          // set rather than the page. Arco's own pagination would have paged
          // whatever 50 rows the server sent and called it the total.
          pagination={false}
          scroll={{ x: 1200, ...(tableHeight ? { y: tableHeight } : {}) }}
          border={{ wrapper: true, cell: true }}
          size="small"
          // "Nothing here" and "everything here has exactly one record" are different
          // answers, and the second one is what a search for a specific id usually
          // gets: the identity exists, it just isn't a repeat. Saying so beats an
          // empty table that reads as "no such user".
          noDataElement={
            matched === 0 && total > 0
              ? `命中 ${total} 个标识，但都只有 1 条反馈`
              : "没有多条记录的对象"
          }
          onRow={(row) => ({
            // Drilling in goes to the ticket list filtered to this identity, rather
            // than opening yet another drawer: the records are the substance, and the
            // list already knows how to show them.
            onClick: () =>
              go(
                filterHref(query, {
                  ...(isUser ? { user: row.id } : { device: row.id }),
                  // queue=all so the detail page shows every record for this
                  // identity rather than only those the current queue admits.
                  queue: "all",
                }),
              ),
            style: { cursor: "pointer" },
          })}
        />

        <div className="oc-console__pager">
          <Pagination
            current={page.page}
            total={matched}
            pageSize={PAGE_SIZE}
            showTotal={(count) => `共 ${count} 个`}
            onChange={(next) => go(pageHref(query, next))}
          />
        </div>
      </div>
    </>
  );
}

// One identity's page: what we know about it, then every record behind it.
function ProfileDetail({
  kind,
  id,
  profile,
  records,
  query,
  now,
  go,
}: Readonly<{
  kind: "user" | "device";
  id: string;
  profile: IdentityProfile | null;
  records: readonly WorkbenchTicket[];
  query: WorkbenchQuery;
  now: number;
  go: (href: string) => void;
}>) {
  const isUser = kind === "user";
  const back = filterHref(query, { user: null, device: null });

  if (!profile) {
    return (
      <Space direction="vertical" size="medium">
        <Alert type="warning" content={`找不到 ${id}`} />
        <Link href={back}>返回列表</Link>
      </Space>
    );
  }

  const span =
    profile.firstFeedbackAt === null
      ? ABSENT
      : `${shanghaiTime(profile.firstFeedbackAt)} → ${shanghaiTime(profile.lastFeedbackAt)}`;

  return (
    <Space direction="vertical" size="medium" style={{ width: "100%" }}>
      <Space align="center">
        <Link href={back}>← 返回列表</Link>
        <Typography.Text style={{ fontFamily: "ui-monospace, monospace" }}>
          {id}
        </Typography.Text>
        <Tag color="arcoblue">{profile.records} 条反馈</Tag>
        {profile.open > 0 && <Tag color="orange">{profile.open} 条未闭环</Tag>}
        {profile.severityHigh > 0 && (
          <Tag color="red">{profile.severityHigh} 条高严重度</Tag>
        )}
      </Space>

      <Descriptions
        column={3}
        size="small"
        border
        data={[
          {
            label: isUser ? "涉及品类" : "机型",
            value:
              (isUser ? profile.categories : profile.models).join("、") ||
              ABSENT,
          },
          { label: "反馈渠道", value: profile.channels.join("、") || ABSENT },
          { label: "问题维度", value: profile.dimensions.join("、") || ABSENT },
          { label: "反馈区间", value: span },
          { label: "已闭环", value: profile.closed },
          { label: "未闭环", value: profile.open },
        ]}
      />

      {/* The analysis and the 拉群 it leads to. Its own client component because both
          buttons are actions with in-flight state, and this pane is otherwise a
          read-only rendering of what the server already resolved. */}
      <ProfileInsightPanel kind={kind} id={id} open={profile.open} />

      <Table
        rowKey="recordNumber"
        columns={[
          {
            title: "记录编号",
            dataIndex: "recordNumber",
            width: 96,
            render: (_: unknown, row: WorkbenchTicket) => (
              <Link
                href={ticketDetailHref(query, row.recordNumber)}
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
            title: "原始内容",
            dataIndex: "content",
            ellipsis: true,
            width: 320,
          },
          {
            title: "严重度",
            dataIndex: "severity",
            width: 88,
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
        ]}
        data={[...records]}
        pagination={false}
        scroll={{ x: 900, y: 380 }}
        border={{ wrapper: true, cell: true }}
        size="small"
        noDataElement="没有记录"
        onRow={(row) => ({
          onClick: () => go(ticketDetailHref(query, row.recordNumber)),
          style: { cursor: "pointer" },
        })}
      />
    </Space>
  );
}

// Horizontal bars rather than columns of numbers. A distribution is a comparison —
// "which dimension dominates" — and a table of counts makes the reader do that
// comparison in their head.
//
// Drawn with divs, not a charting library. The five charts here are one shape, the
// data is already aggregated in SQL, and G2Plot or Recharts would add hundreds of
// kilobytes to a page whose entire client bundle exists to render one console.
function BarChart({
  title,
  rows,
  note,
}: Readonly<{
  title: string;
  rows: ReadonlyArray<{ label: string; count: number }>;
  note?: string;
}>) {
  // Scaled against the largest bar, not the total: with 3600 records in one bucket and
  // 3 in another, a total-based scale renders every minority bar as an invisible sliver.
  const peak = rows.reduce((max, row) => Math.max(max, row.count), 0);
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <Card size="small" title={title} className="oc-chart-card">
      {rows.length === 0 ? (
        <Typography.Text type="secondary">暂无数据</Typography.Text>
      ) : (
        <div className="oc-chart">
          {rows.map((row) => (
            <div key={row.label} className="oc-chart__row">
              <span className="oc-chart__label" title={row.label}>
                {row.label}
              </span>
              <span className="oc-chart__track">
                <span
                  className="oc-chart__bar"
                  style={{
                    width: peak === 0 ? "0%" : `${(row.count / peak) * 100}%`,
                  }}
                />
              </span>
              <span className="oc-chart__value">
                {row.count}
                {total > 0 && (
                  <em className="oc-chart__share">
                    {Math.round((row.count / total) * 100)}%
                  </em>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {note && (
        <div className="oc-chart__note">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {note}
          </Typography.Text>
        </div>
      )}
    </Card>
  );
}

function MetricsPane({ metrics }: Readonly<{ metrics: VocMetrics }>) {
  // Every percentage comes from a ratio the aggregate already computed, or from a
  // division whose denominator is spelled out in the label beside it — never from a
  // count divided ad hoc where a reader cannot see what it was divided by.
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

      <div className="oc-charts">
        {/* Three stages rather than a ratio: "14%" does not say whether the
            denominator is 7 or 7000. */}
        <BarChart
          title="闭环漏斗"
          rows={[
            { label: "全部反馈", count: metrics.total },
            { label: "已建单", count: metrics.ticketsOpened },
            { label: "已闭环", count: metrics.ticketsClosed },
          ]}
        />
        <BarChart
          title="打标进度"
          rows={[
            { label: "已打标", count: metrics.taggingSucceeded },
            { label: "打标失败", count: metrics.taggingFailed },
            { label: "待打标", count: metrics.taggingPending },
          ]}
        />
        <BarChart
          title="情绪极性分布"
          rows={Object.entries(metrics.byPolarity).map(([label, count]) => ({
            label,
            count,
          }))}
          // The old note here read "源数据全部是负向 VOC，这里的极性来自 AI 打标". Both
          // halves stopped being true: the corpus is mostly e-commerce reviews and plenty
          // of them are praise, and since the demo dataset was re-seeded most of these
          // tags are synthesized rather than model output. A label on a chart has to hold.
          note="极性来自打标结果；演示数据集中多数打标为合成（打标来源 demo-seed）"
        />
        <BarChart
          title="问题维度分布"
          rows={metrics.dimensionTop.map((row) => ({
            label: row.dimension,
            count: row.count,
          }))}
        />
        <BarChart
          title="渠道分布"
          rows={metrics.byChannel.map((row) => ({
            label: row.channel,
            count: row.count,
          }))}
        />
      </div>
    </Space>
  );
}


