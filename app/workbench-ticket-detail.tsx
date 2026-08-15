"use client";

// Must precede every Arco import. Arco's React 19 adapter installs createRoot
// before any component or toast can fall back to the removed ReactDOM.render.
import "../src/features/workbench/arco-runtime";
import "@arco-design/web-react/dist/css/arco.css";

import {
  Avatar,
  Breadcrumb,
  Card,
  Descriptions,
  Layout,
  Space,
  Spin,
  Tag,
  Typography,
} from "@arco-design/web-react";
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import type { AuthUser } from "../src/features/auth/types";
import type { Member } from "../src/features/directory/members";
import type { WorkbenchTicket } from "../src/features/workbench/data";
import {
  ABSENT,
  formatHours,
  formatShanghaiTime,
  SEVERITY_COLOR,
  shortRecordNumber,
  STATE_COLOR,
  ticketTitle,
} from "../src/features/workbench/presentation";
import {
  dwellHours,
  isOverdue,
  type QueueKey,
  type WorkbenchQuery,
} from "../src/features/workbench/query";
import { availableActions } from "../src/features/workbench/write-actions";
import { AnalyzeButton } from "./workbench-analyze-button";
import { TagEditButton } from "./workbench-tag-edit";
import { DispatchPanel } from "./workbench-dispatch";
import { WarRoomButton } from "./workbench-war-room-button";
import { WorkbenchActions } from "./workbench-actions";
import { ConsoleSider } from "./workbench-sider";

export type TicketDetailPageViewProps = Readonly<{
  // Who may be named as an owner. Empty when the directory read failed, which hides
  // the 改派 control rather than offering a picker with nothing in it.
  members: readonly Member[];
  // The 工程师 rows from 人员管理 — who this ticket can be dispatched to. Empty when the
  // roster could not be read, or when nobody has been made an engineer yet.
  engineers: readonly Readonly<{ openId: string; name: string }>[];
  user: AuthUser;
  ticket: WorkbenchTicket;
  now: number;
  backHref: string;
  // The list query this ticket was opened from. The sider's destinations are built
  // from it, so a filtered list stays filtered when the operator navigates away.
  query: WorkbenchQuery;
  // The sider's counts, read on this page like on any other. Null when the count
  // query failed — which shows no tag rather than a zero.
  queueCounts: Readonly<Record<QueueKey, number>> | null;
  userCount: number | null;
  deviceCount: number | null;
}>;

export type TicketDetailStateProps = Readonly<{
  user: AuthUser;
  kind: "unavailable" | "not-found";
  recordNumber: string;
  backHref: string;
  retryHref: string;
}>;

function UserAvatar({ user }: Readonly<{ user: AuthUser }>) {
  return (
    <Avatar size={30} style={{ backgroundColor: "rgb(var(--primary-6))" }}>
      {user.avatarUrl ? (
        // OAuth controls the avatar host, so next/image cannot declare it at
        // build time. This 30px identity image is intentionally a plain img.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={user.name} src={user.avatarUrl} />
      ) : (
        user.name.slice(0, 1)
      )}
    </Avatar>
  );
}

function DetailHeader({
  user,
  recordNumber,
  brand,
}: Readonly<{
  user: AuthUser;
  recordNumber: string | null;
  // The wordmark belongs to the sider, and the ticket page now has one. The two
  // error states below do not — they are a single centred card with no navigation —
  // so they keep it in the header rather than losing it entirely.
  brand: boolean;
}>) {
  return (
    <Layout.Header className="oc-console__header oc-ticket-detail__header">
      <Space size="large" className="oc-ticket-detail__header-context">
        {brand && <div className="oc-console__brand">万护 OneCare</div>}
        <Breadcrumb>
          <Breadcrumb.Item key="domain">服务运营</Breadcrumb.Item>
          <Breadcrumb.Item key="entity">VOC 工单</Breadcrumb.Item>
          <Breadcrumb.Item key="record">
            {recordNumber ? shortRecordNumber(recordNumber) : "工单详情"}
          </Breadcrumb.Item>
        </Breadcrumb>
      </Space>
      <Space size="small" align="center">
        <span className="oc-console__user">{user.name}</span>
        <UserAvatar user={user} />
      </Space>
    </Layout.Header>
  );
}

// The two error states' shell: no sider, because there is no data to navigate and
// the one useful move is the 返回工单列表 link inside the card.
function DetailShell({
  user,
  recordNumber,
  children,
}: Readonly<{
  user: AuthUser;
  recordNumber: string | null;
  children: React.ReactNode;
}>) {
  return (
    <Layout className="oc-console oc-ticket-detail">
      <DetailHeader user={user} recordNumber={recordNumber} brand />
      {children}
    </Layout>
  );
}

// The label inside the back link, split out only because useLinkStatus has to be
// called from a descendant of the Link it reports on. `pending` is true from the click
// until the list route commits — which is the gap the operator called "反应很慢": the
// old link gave no sign it had been pressed, so the only feedback was the page
// eventually changing.
function BackLabel() {
  const { pending } = useLinkStatus();
  return (
    <>
      ← 返回工单列表
      {pending && <Spin size={12} style={{ marginLeft: 8 }} />}
    </>
  );
}

function ActionPanel({
  ticket,
  members,
}: Readonly<{
  ticket: WorkbenchTicket;
  members: readonly Member[];
}>) {
  const actions = availableActions(ticket);
  const canClaim = !ticket.hasOwner;

  return (
    <Card size="small" title="可执行操作">
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        {actions.length === 0 && !canClaim ? (
          <Typography.Text type="secondary">
            {ticket.state === "已闭环" || ticket.state === "无需跟进"
              ? `${ticket.state}是终态，没有后续动作。`
              : `${ticket.state}下没有可由人执行的动作，等打标流水线处理。`}
          </Typography.Text>
        ) : (
          <WorkbenchActions
            recordId={ticket.recordId}
            members={members}
            ownerNames={ticket.ownerNames}
            seenState={ticket.state}
            actions={actions}
            canClaim={canClaim}
          />
        )}
        {/* Outside the branch above on purpose: 拉群 is not a state transition, so it is
            offered on every ticket — including the terminal ones, where a group is
            sometimes exactly what a post-mortem needs. */}
        <WarRoomButton recordId={ticket.recordId} hasWarRoom={ticket.hasWarRoom} />
      </Space>
    </Card>
  );
}

export function TicketDetailPageView({
  user,
  ticket,
  members,
  engineers,
  now,
  backHref,
  query,
  queueCounts,
  userCount,
  deviceCount,
}: TicketDetailPageViewProps) {
  const router = useRouter();
  // Leaving this page is a server round trip like every other navigation in the
  // console, so it gets the same treatment: the wait is shown over the content the
  // operator is leaving, rather than nothing happening for a second.
  const [leaving, startLeaving] = useTransition();

  // Warm the two ways out of this page: the list it came from, and the queue every
  // sider item resolves to. Leaving a ticket is the most frequent thing done here and
  // needs nothing typed first, so it is worth paying for eagerly.
  useEffect(() => {
    router.prefetch(backHref);
  }, [router, backHref]);

  const dwell = dwellHours(ticket, now);
  const overdue = isOverdue(ticket, now);
  const owner = ticket.ownerNames.length === 0 ? "未分配" : ticket.ownerNames.join("、");
  const channelCategory =
    [ticket.channel, ticket.category].filter(Boolean).join(" / ") || ABSENT;

  return (
    // hasSider because ConsoleSider is a wrapper: Arco looks for Layout.Sider among
    // its direct children and finds a function component, so without this the sider
    // stacks above a zero-height content column. See the same note in the console.
    <Layout className="oc-console oc-ticket-detail" hasSider>
      {/* The same navigation as every other page in the console. It used to be
          replaced here by a column of five same-page anchors, which meant opening a
          ticket dropped the operator out of the workbench and gave them, in
          exchange, links to five headings already visible on screen. */}
      <ConsoleSider
        query={query}
        queueCounts={queueCounts}
        userCount={userCount}
        deviceCount={deviceCount}
        // A ticket is not one of the sider's destinations. Highlighting the queue it
        // came from would say the operator is looking at that list.
        selectedKey={null}
        navigate={(href) => startLeaving(() => router.push(href))}
      />

      <Layout className="oc-console__main">
        <DetailHeader
          user={user}
          recordNumber={ticket.recordNumber}
          brand={false}
        />
        <Layout.Content className="oc-console__content oc-ticket-detail__content">
          <Spin loading={leaving} style={{ display: "block", width: "100%" }}>
        <div className="oc-ticket-detail__grid">
          <main className="oc-ticket-detail__main">
            {/* prefetch, so the list's payload is usually already in the client by
                the time this is clicked — the same trick the console uses for its five
                queues. It does nothing in `next dev`, where prefetching is disabled;
                the wait an operator sees there is compilation, not the query. */}
            <Link className="oc-ticket-detail__back" href={backHref} prefetch>
              <BackLabel />
            </Link>
            <section
              className="oc-ticket-detail__section oc-ticket-detail__overview"
            >
              <Card bordered={false}>
                <Space direction="vertical" size="medium" style={{ width: "100%" }}>
                  <Space wrap>
                    <Tag color={STATE_COLOR[ticket.state]}>{ticket.state}</Tag>
                    <Tag color={ticket.severity ? SEVERITY_COLOR[ticket.severity] : "gray"}>
                      {ticket.severity ?? ABSENT}
                    </Tag>
                    <Typography.Text type="secondary">
                      {channelCategory}
                    </Typography.Text>
                  </Space>
                  <div>
                    <Typography.Text type="secondary">工单概览</Typography.Text>
                    {/* Body text, not a heading. At heading size this ran to three
                        wrapped lines and was cut at 60 characters — so the one line
                        that says what the ticket is about was both the loudest thing
                        on the page and incomplete. */}
                    <p className="oc-ticket-detail__subject">
                      <span className="oc-ticket-detail__subject-label">工单主题</span>
                      {ticketTitle(ticket)}
                    </p>
                    <Typography.Text code>{ticket.recordNumber}</Typography.Text>
                  </div>
                </Space>
              </Card>
            </section>

            <div className="oc-ticket-detail__body">
              <section className="oc-ticket-detail__section">
                <Card title="用户反馈">
                  <Typography.Paragraph className="oc-ticket-detail__prose">
                    {ticket.content || ABSENT}
                  </Typography.Paragraph>
                  <Descriptions
                    column={2}
                    size="small"
                    data={[
                      {
                        label: "反馈时间",
                        value: formatShanghaiTime(ticket.feedbackAt) ?? ABSENT,
                      },
                      { label: "机型", value: ticket.model || ABSENT },
                    ]}
                  />
                </Card>
              </section>

              <section className="oc-ticket-detail__section">
                <Card
                  className="oc-ticket-detail__analysis"
                  // Not "AI 分析": most of these values came from the seeding script,
                  // some from aily, and — since 修正结论 — some from a person. What the
                  // card holds is the conclusion, whoever reached it.
                  title="分析结论"
                  // Both controls sit in the card whose contents they produce, not with
                  // the state transitions in 可执行操作: neither moves the ticket
                  // through the service flow.
                  extra={
                    <Space size="small">
                      <TagEditButton
                        recordId={ticket.recordId}
                        polarity={ticket.polarity}
                        dimensions={ticket.dimensions}
                        severity={ticket.severity}
                        summary={ticket.summary}
                      />
                      <AnalyzeButton
                        recordId={ticket.recordId}
                        state={ticket.state}
                        retryCount={ticket.retryCount}
                      />
                    </Space>
                  }
                >
                  <Typography.Text type="secondary">摘要</Typography.Text>
                  <Typography.Paragraph className="oc-ticket-detail__prose">
                    {ticket.summary || ABSENT}
                  </Typography.Paragraph>
                  <Descriptions
                    column={3}
                    size="small"
                    data={[
                      { label: "情绪极性", value: ticket.polarity ?? ABSENT },
                      {
                        label: "问题维度",
                        value:
                          ticket.dimensions.length === 0
                            ? ABSENT
                            : ticket.dimensions.join("、"),
                      },
                      { label: "严重度", value: ticket.severity ?? ABSENT },
                    ]}
                  />
                </Card>
              </section>

              <section className="oc-ticket-detail__section">
                <Card title="回复话术">
                  <Typography.Text type="secondary">建议话术</Typography.Text>
                  {ticket.replies.length === 0 ? (
                    <Typography.Paragraph>{ABSENT}</Typography.Paragraph>
                  ) : (
                    <div className="oc-ticket-detail__replies">
                      {ticket.replies.map((reply, index) => (
                        <div className="oc-ticket-detail__reply" key={`${reply.tone}-${index}`}>
                          <Tag color="arcoblue">{reply.tone}</Tag>
                          <Typography.Paragraph>{reply.text}</Typography.Paragraph>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </section>

              <section className="oc-ticket-detail__section">
                <Card title="处理信息">
                  <Descriptions
                    column={2}
                    size="small"
                    data={[
                      {
                        label: "建单时间",
                        value: formatShanghaiTime(ticket.ticketOpenedAt) ?? ABSENT,
                      },
                      {
                        label: "闭环时间",
                        value: formatShanghaiTime(ticket.closedAt) ?? ABSENT,
                      },
                      {
                        label: "闭环时长",
                        value:
                          ticket.durationHours === null
                            ? ABSENT
                            : `${formatHours(ticket.durationHours)} 小时`,
                      },
                      { label: "协同群", value: ticket.hasWarRoom ? "已建立" : "未建立" },
                    ]}
                  />
                </Card>
              </section>
            </div>
          </main>

          <aside className="oc-ticket-detail__aside">
            <div className="oc-ticket-detail__actions">
              <Card size="small" title="当前处理">
                <div className="oc-ticket-detail__status-grid">
                  <span>流程状态</span>
                  <Tag color={STATE_COLOR[ticket.state]}>{ticket.state}</Tag>
                  <span>负责人</span>
                  <strong>{owner}</strong>
                  <span>严重度</span>
                  <Tag color={ticket.severity ? SEVERITY_COLOR[ticket.severity] : "gray"}>
                    {ticket.severity ?? ABSENT}
                  </Tag>
                  <span>停留时长</span>
                  <strong>{dwell === null ? ABSENT : `${formatHours(dwell)} 小时`}</strong>
                  <span>超时标记</span>
                  <strong>
                    {dwell === null
                      ? ABSENT
                      : overdue
                        ? "已超时（按假设 SLA 72 小时）"
                        : "未超时"}
                  </strong>
                </div>
              </Card>

              <ActionPanel ticket={ticket} members={members} />

              {/* 上门: its own card rather than a row in 可执行操作, because it is not a
                  state transition — it is handing the ticket to a second person who
                  works it from Feishu and never opens this console. */}
              <Card size="small" title="上门">
                <DispatchPanel
                  recordId={ticket.recordId}
                  engineers={engineers}
                  engineerNames={ticket.engineerNames}
                  dispatchedAt={ticket.dispatchedAt}
                  state={ticket.state}
                />
              </Card>
            </div>

            <div className="oc-ticket-detail__key-fields">
              <Card size="small" title="关键字段">
                <Descriptions
                  column={1}
                  size="small"
                  data={[
                    { label: "记录编号", value: ticket.recordNumber },
                    { label: "渠道", value: ticket.channel || ABSENT },
                    { label: "品类", value: ticket.category || ABSENT },
                    { label: "机型", value: ticket.model || ABSENT },
                    {
                      label: "反馈时间",
                      value: formatShanghaiTime(ticket.feedbackAt) ?? ABSENT,
                    },
                    {
                      label: "建单时间",
                      value: formatShanghaiTime(ticket.ticketOpenedAt) ?? ABSENT,
                    },
                    {
                      label: "闭环时间",
                      value: formatShanghaiTime(ticket.closedAt) ?? ABSENT,
                    },
                  ]}
                />
              </Card>
            </div>
          </aside>
        </div>
          </Spin>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

export function TicketDetailState({
  user,
  kind,
  recordNumber,
  backHref,
  retryHref,
}: TicketDetailStateProps) {
  const unavailable = kind === "unavailable";

  return (
    <DetailShell
      user={user}
      recordNumber={unavailable ? null : recordNumber}
    >
      <Layout.Content className="oc-ticket-detail__content">
        <Card className="oc-ticket-detail__state" bordered={false}>
          <Typography.Title heading={3}>
            {unavailable ? "工单暂时无法加载" : "工单不存在或已被移除"}
          </Typography.Title>
          <Typography.Paragraph type="secondary">
            {unavailable
              ? "当前无法读取工单数据，请稍后重试。"
              : "没有找到对应的工单记录。"}
          </Typography.Paragraph>
          {!unavailable && <Typography.Text code>{recordNumber}</Typography.Text>}
          <Space wrap>
            {unavailable && (
              <Link className="oc-ticket-detail__state-action" href={retryHref}>
                重试
              </Link>
            )}
            <Link className="oc-ticket-detail__state-action" href={backHref}>
              返回工单列表
            </Link>
          </Space>
        </Card>
      </Layout.Content>
    </DetailShell>
  );
}
