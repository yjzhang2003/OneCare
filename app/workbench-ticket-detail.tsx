"use client";

// Must precede every Arco import. Arco's React 19 adapter installs createRoot
// before any component or toast can fall back to the removed ReactDOM.render.
import "@arco-design/web-react/lib/_util/react-19-adapter";
import "@arco-design/web-react/dist/css/arco.css";

import {
  Avatar,
  Breadcrumb,
  Card,
  Descriptions,
  Layout,
  Space,
  Tag,
  Typography,
} from "@arco-design/web-react";
import Link from "next/link";

import type { AuthUser } from "../src/features/auth/types";
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
} from "../src/features/workbench/query";
import { availableActions } from "../src/features/workbench/write-actions";
import { WorkbenchActions } from "./workbench-actions";

const SECTIONS = [
  { id: "overview", label: "工单概览" },
  { id: "feedback", label: "用户反馈" },
  { id: "analysis", label: "AI 分析" },
  { id: "replies", label: "回复话术" },
  { id: "handling", label: "处理信息" },
] as const;

export type TicketDetailPageViewProps = Readonly<{
  user: AuthUser;
  ticket: WorkbenchTicket;
  now: number;
  backHref: string;
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
}: Readonly<{ user: AuthUser; recordNumber: string | null }>) {
  return (
    <Layout.Header className="oc-console__header oc-ticket-detail__header">
      <Space size="large" className="oc-ticket-detail__header-context">
        <div className="oc-console__brand">万护 OneCare</div>
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
      <DetailHeader user={user} recordNumber={recordNumber} />
      {children}
    </Layout>
  );
}

function ActionPanel({ ticket }: Readonly<{ ticket: WorkbenchTicket }>) {
  const actions = availableActions(ticket);
  const canClaim = !ticket.hasOwner;

  return (
    <Card size="small" title="可执行操作">
      {actions.length === 0 && !canClaim ? (
        <Typography.Text type="secondary">
          {ticket.state === "已闭环" || ticket.state === "无需跟进"
            ? `${ticket.state}是终态，没有后续动作。`
            : `${ticket.state}下没有可由人执行的动作，等打标流水线处理。`}
        </Typography.Text>
      ) : (
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <WorkbenchActions
            recordId={ticket.recordId}
            seenState={ticket.state}
            actions={actions}
            canClaim={canClaim}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            状态流转只有负责人本人能做，其他人点击会被服务端拒绝。改派负责人请在多维表格里操作。
          </Typography.Text>
        </Space>
      )}
    </Card>
  );
}

export function TicketDetailPageView({
  user,
  ticket,
  now,
  backHref,
}: TicketDetailPageViewProps) {
  const dwell = dwellHours(ticket, now);
  const overdue = isOverdue(ticket, now);
  const owner = ticket.ownerNames.length === 0 ? "未分配" : ticket.ownerNames.join("、");
  const channelCategory =
    [ticket.channel, ticket.category].filter(Boolean).join(" / ") || ABSENT;

  return (
    <DetailShell user={user} recordNumber={ticket.recordNumber}>
      <Layout.Content className="oc-ticket-detail__content">
        <div className="oc-ticket-detail__grid">
          <nav className="oc-ticket-detail__nav" aria-label="工单章节">
            <Link className="oc-ticket-detail__back" href={backHref}>
              ← 返回工单列表
            </Link>
            <div className="oc-ticket-detail__anchors">
              {SECTIONS.map((section) => (
                <a key={section.id} href={`#${section.id}`}>
                  {section.label}
                </a>
              ))}
            </div>
          </nav>

          <main className="oc-ticket-detail__main">
            <section id="overview" className="oc-ticket-detail__section">
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
                    <Typography.Title heading={3} className="oc-ticket-detail__title">
                      工单主题 · {ticketTitle(ticket)}
                    </Typography.Title>
                    <Typography.Text code>{ticket.recordNumber}</Typography.Text>
                  </div>
                </Space>
              </Card>
            </section>

            <section id="feedback" className="oc-ticket-detail__section">
              <Card title="用户反馈">
                <Typography.Paragraph className="oc-ticket-detail__prose">
                  {ticket.content || ABSENT}
                </Typography.Paragraph>
                <Descriptions
                  column={2}
                  size="small"
                  data={[
                    { label: "反馈时间", value: formatShanghaiTime(ticket.feedbackAt) ?? ABSENT },
                    { label: "机型", value: ticket.model || ABSENT },
                  ]}
                />
              </Card>
            </section>

            <section id="analysis" className="oc-ticket-detail__section">
              <Card title="AI 分析">
                <Typography.Text type="secondary">AI 摘要</Typography.Text>
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
                      value: ticket.dimensions.length === 0 ? ABSENT : ticket.dimensions.join("、"),
                    },
                    { label: "严重度", value: ticket.severity ?? ABSENT },
                  ]}
                />
              </Card>
            </section>

            <section id="replies" className="oc-ticket-detail__section">
              <Card title="回复话术">
                <Typography.Text type="secondary">AI 回复话术</Typography.Text>
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

            <section id="handling" className="oc-ticket-detail__section">
              <Card title="处理信息">
                <Descriptions
                  column={2}
                  size="small"
                  data={[
                    { label: "建单时间", value: formatShanghaiTime(ticket.ticketOpenedAt) ?? ABSENT },
                    { label: "闭环时间", value: formatShanghaiTime(ticket.closedAt) ?? ABSENT },
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
          </main>

          <aside className="oc-ticket-detail__aside">
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
                <strong>{overdue ? "已超时（按假设 SLA 72 小时）" : "未超时"}</strong>
              </div>
            </Card>

            <ActionPanel ticket={ticket} />

            <Card size="small" title="关键字段">
              <Descriptions
                column={1}
                size="small"
                data={[
                  { label: "记录编号", value: ticket.recordNumber },
                  { label: "渠道", value: ticket.channel || ABSENT },
                  { label: "品类", value: ticket.category || ABSENT },
                  { label: "机型", value: ticket.model || ABSENT },
                  { label: "反馈时间", value: formatShanghaiTime(ticket.feedbackAt) ?? ABSENT },
                  { label: "建单时间", value: formatShanghaiTime(ticket.ticketOpenedAt) ?? ABSENT },
                  { label: "闭环时间", value: formatShanghaiTime(ticket.closedAt) ?? ABSENT },
                ]}
              />
            </Card>
          </aside>
        </div>
      </Layout.Content>
    </DetailShell>
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
