import Link from "next/link";

import type { AuthUser } from "../src/features/auth/types";
import { VOC_STATE_SEQUENCE } from "../src/features/voc/service-event";
import type { VocState } from "../src/features/voc/service-event";
import type { VocMetrics } from "../src/features/voc/metrics";
import { VOC_POLARITIES } from "../src/features/voc/triage";
import type {
  WorkbenchData,
  WorkbenchTicket,
} from "../src/features/workbench/data";

// Percentages only ever come from ratios aggregateVocMetrics already computed,
// never from a count divided ad hoc in the view, so every number here traces
// back to one arithmetic source — the same rule the retired public aggregate
// page followed, and the reason this page and a direct curl of
// /api/voc/dashboard cannot disagree.
function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function hours(value: number): string {
  return value.toFixed(1);
}

// Fixed +08:00 rather than toLocaleString or Intl: the audience is a China
// service-operations team, China observes no daylight saving, and a formatter
// that reads the host time zone would render one thing in a test runner,
// another on the build machine, and a third in the serverless region. Bitable
// hands these back as epoch milliseconds, so there is no original offset to
// preserve.
function shanghaiTime(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  const shifted = new Date(parsed + 8 * 3_600_000);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-` +
    `${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:` +
    `${pad(shifted.getUTCMinutes())}`
  );
}

const ABSENT = "未填写";

// The real dataset is one enterprise weekly report: 3628 records. Rendering all
// of them puts several megabytes of HTML on the wire for a page nobody scrolls
// to the bottom of. The cap lives here rather than in buildWorkbench because the
// data layer guarantees its row count equals the record count — an operator who
// cannot see a record cannot fix it, and a silently shorter list stops
// reconciling against the Base. So the aggregates and the state tally below
// still cover every record; only the table is windowed, and it says so.
const LIST_LIMIT = 200;

function text(value: string | null): string {
  return value ?? ABSENT;
}

// Counted from the very rows rendered below rather than pulled from a second
// aggregation. VocMetrics carries no per-state breakdown, and deriving one
// from a different pass over the records is how two numbers on one page start
// disagreeing. Counting the visible rows means the state tallies and the list
// can never contradict each other.
function countByState(
  tickets: readonly WorkbenchTicket[],
): ReadonlyArray<{ state: VocState; count: number }> {
  const counts = new Map<VocState, number>();
  for (const ticket of tickets) {
    counts.set(ticket.state, (counts.get(ticket.state) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => VOC_STATE_SEQUENCE[a.state] - VOC_STATE_SEQUENCE[b.state]);
}

// Colours come from the palette in globals.css rather than literals. The first
// version of this file hardcoded a dark text colour copied from the retired
// aggregate page and set no background at all, so it rendered dark-on-dark
// against the site's near-black body — invisible, and invisible in a way no
// assertion in this repo can see, since jsdom computes no contrast. Tokens make
// the surface and the text agree by construction. The outer element also reuses
// the existing `.dashboard-shell` paper surface instead of inventing a second
// one.
const workbenchStyles = `
  .workbench {
    color: var(--ink);
    line-height: 1.6;
    background: var(--paper);
  }
  .workbench__inner {
    max-width: 1180px;
    margin: 0 auto;
    padding: 40px 24px 96px;
  }
  .workbench__masthead {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid var(--line);
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  .workbench__masthead h1 {
    font-size: 24px;
    margin: 0;
  }
  .workbench__identity {
    font-size: 13px;
    color: var(--muted);
    margin: 4px 0 0;
  }
  .workbench__showcase-link {
    font-size: 13px;
    color: var(--ink);
  }
  .workbench section {
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 20px 24px;
    margin-bottom: 20px;
  }
  .workbench h2 {
    font-size: 16px;
    margin: 0 0 12px;
  }
  .workbench__stats {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
  }
  .workbench__stat {
    min-width: 132px;
  }
  .workbench__stat span {
    display: block;
    font-size: 13px;
    color: var(--muted);
  }
  .workbench__stat strong {
    font-size: 22px;
  }
  .workbench__panels {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 20px;
  }
  .workbench table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .workbench th,
  .workbench td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  .workbench th {
    color: var(--muted);
    font-weight: 600;
  }
  .workbench__content-cell {
    min-width: 240px;
    white-space: pre-wrap;
  }
  .workbench__tickets {
    overflow-x: auto;
  }
  .workbench__assumption {
    font-size: 13px;
    color: #8a6d1a;
    background: #fdf6e3;
    border: 1px solid #f0dfa4;
    border-radius: 8px;
    padding: 10px 14px;
    margin-top: 12px;
  }
  .workbench__note {
    font-size: 12px;
    color: var(--muted);
    margin-top: 8px;
  }
  .workbench__unavailable {
    border-color: #f0dfa4;
    background: #fdf6e3;
    color: #6b5610;
  }
`;

function MetricsSections({ metrics }: Readonly<{ metrics: VocMetrics }>) {
  const taggingProcessed = metrics.taggingSucceeded + metrics.taggingFailed;
  const taggingSuccessRate =
    taggingProcessed === 0 ? 0 : metrics.taggingSucceeded / taggingProcessed;

  return (
    <>
      <section aria-labelledby="workbench-headline">
        <h2 id="workbench-headline">总量与闭环</h2>
        <div className="workbench__stats">
          <div className="workbench__stat">
            <span>反馈总量</span>
            <strong>{metrics.total}</strong>
          </div>
          <div className="workbench__stat">
            <span>负向占比（中评+差评 / 已打标）</span>
            <strong>{percent(metrics.negativeShare)}</strong>
          </div>
          <div className="workbench__stat">
            <span>已建单</span>
            <strong>{metrics.ticketsOpened}</strong>
          </div>
          <div className="workbench__stat">
            <span>已闭环</span>
            <strong>{metrics.ticketsClosed}</strong>
          </div>
          <div className="workbench__stat">
            <span>闭环率（已闭环 / 已建单）</span>
            <strong>{percent(metrics.closureRate)}</strong>
          </div>
          <div className="workbench__stat">
            <span>平均闭环时长</span>
            <strong>{hours(metrics.averageClosureHours)} 小时</strong>
          </div>
          <div className="workbench__stat">
            <span>打标成功率（成功 / 成功+失败）</span>
            <strong>{percent(taggingSuccessRate)}</strong>
          </div>
        </div>
      </section>

      <div className="workbench__panels">
        <section aria-labelledby="workbench-polarity">
          <h2 id="workbench-polarity">情绪极性分布</h2>
          <table>
            <thead>
              <tr>
                <th>极性</th>
                <th>反馈数</th>
              </tr>
            </thead>
            <tbody>
              {VOC_POLARITIES.map((polarity) => (
                <tr key={polarity}>
                  <td>{polarity}</td>
                  <td>{metrics.byPolarity[polarity]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="workbench-dimensions">
          <h2 id="workbench-dimensions">
            问题维度 Top {metrics.dimensionTop.length}
          </h2>
          {metrics.dimensionTop.length === 0 ? (
            <p>暂无维度数据。</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>维度</th>
                  <th>出现次数</th>
                </tr>
              </thead>
              <tbody>
                {metrics.dimensionTop.map((row) => (
                  <tr key={row.dimension}>
                    <td>{row.dimension}</td>
                    <td>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section aria-labelledby="workbench-channels">
          <h2 id="workbench-channels">渠道分布</h2>
          {metrics.byChannel.length === 0 ? (
            <p>暂无渠道数据。</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>渠道</th>
                  <th>反馈数</th>
                </tr>
              </thead>
              <tbody>
                {metrics.byChannel.map((row) => (
                  <tr key={row.channel}>
                    <td>{row.channel}</td>
                    <td>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section aria-labelledby="workbench-effort">
        <h2 id="workbench-effort">人效估算</h2>
        {metrics.effort ? (
          <>
            <div className="workbench__stats">
              <div className="workbench__stat">
                <span>已完成打标记录数</span>
                <strong>{metrics.effort.taggedRecords}</strong>
              </div>
              <div className="workbench__stat">
                <span>假设人工处理耗时 / 条</span>
                <strong>{metrics.effort.manualMinutesPerRecord} 分钟</strong>
              </div>
              <div className="workbench__stat">
                <span>折算节省工时</span>
                <strong>{hours(metrics.effort.savedHours)} 小时</strong>
              </div>
            </div>
            <p className="workbench__assumption">
              假设值：以上工时按「每条记录人工需要{" "}
              {metrics.effort.manualMinutesPerRecord} 分钟」这一未经实测的假设基线折算，
              仅用于估算 AI 打标相对人工处理可能节省的时间数量级，不代表实际测量值，也不折算为年化金额。
            </p>
          </>
        ) : (
          <p>未配置人工处理基线，不计算人效数字。</p>
        )}
      </section>
    </>
  );
}

function TicketTable({ tickets }: Readonly<{ tickets: readonly WorkbenchTicket[] }>) {
  return (
    <div className="workbench__tickets">
      <table>
        <thead>
          <tr>
            <th>反馈时间</th>
            <th>渠道 / 品类</th>
            <th>原始内容</th>
            <th>极性</th>
            <th>问题维度</th>
            <th>严重度</th>
            <th>流程状态</th>
            <th>负责人</th>
            <th>建单时间</th>
            <th>闭环时间</th>
            <th>时长</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr key={ticket.recordNumber}>
              <td>{text(shanghaiTime(ticket.feedbackAt))}</td>
              <td>
                {ticket.channel} / {ticket.category}
              </td>
              <td className="workbench__content-cell">{ticket.content}</td>
              <td>{text(ticket.polarity)}</td>
              <td>
                {ticket.dimensions.length === 0
                  ? ABSENT
                  : ticket.dimensions.join("、")}
              </td>
              <td>{text(ticket.severity)}</td>
              <td>{ticket.state}</td>
              <td>
                {ticket.ownerNames.length === 0
                  ? ABSENT
                  : ticket.ownerNames.join("、")}
              </td>
              <td>{text(shanghaiTime(ticket.ticketOpenedAt))}</td>
              <td>{text(shanghaiTime(ticket.closedAt))}</td>
              <td>
                {ticket.durationHours === null
                  ? ABSENT
                  : `${hours(ticket.durationHours)} 小时`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type WorkbenchContentProps = Readonly<{
  data: WorkbenchData;
  user: AuthUser;
}>;

// A server component with no "use client": every control here is a link or
// plain markup. That is the point rather than an omission — state changes
// belong to the Feishu card path, whose identity comes from a signed event
// while this page's comes from a session cookie. Two write paths with two
// different identity sources feeding one state machine is a concurrency and
// an authorization risk at once, and Bitable offers no compare-and-set to
// arbitrate between them.
export function WorkbenchContent({ data, user }: WorkbenchContentProps) {
  const stateCounts = countByState(data.tickets);

  return (
    <main className="dashboard-shell workbench">
      <style>{workbenchStyles}</style>
      <div className="workbench__inner">
      <div className="workbench__masthead">
        <div>
          <h1>万护 OneCare 服务运营工作台</h1>
          {/* The operator's own name sits inside this sentence rather than in
              an element of its own, so a name that also appears as a ticket
              owner below stays unambiguous to anyone (or any test) looking
              for that owner. */}
          <p className="workbench__identity">
            当前登录 {user.name} · 数据直连飞书多维表格，含真实用户原文与真实负责人姓名 ·
            本页只读，改状态在飞书卡片里完成
          </p>
        </div>
        <Link className="workbench__showcase-link" href="/?view=showcase">
          方案展示厅 →
        </Link>
      </div>

      {data.metrics.status === "unavailable" ? (
        <section
          aria-labelledby="workbench-unavailable"
          className="workbench__unavailable"
          role="status"
        >
          <h2 id="workbench-unavailable">指标暂不可用</h2>
          <p>
            本次未能从飞书多维表格读取到最新数据，因此不展示任何统计数字——一个 0
            会被当成真实结果，而这里的真相是「这一次没读到」，不是「Base 里没有记录」。
            请稍后刷新本页重试。
          </p>
        </section>
      ) : (
        <MetricsSections metrics={data.metrics.metrics} />
      )}

      <section aria-labelledby="workbench-tickets">
        <h2 id="workbench-tickets">工单列表（只读）</h2>
        {data.tickets.length === 0 ? (
          <p>暂无工单记录。</p>
        ) : (
          <>
            <p className="workbench__note">
              共 {data.tickets.length} 条
              {data.tickets.length > LIST_LIMIT
                ? `，下表显示按反馈时间最新的 ${LIST_LIMIT} 条`
                : "，按反馈时间从新到旧排列"}
              ；无反馈时间的记录排在末尾而不被丢弃。
              {stateCounts.length === 0
                ? null
                : ` 流程状态分布（全部 ${data.tickets.length} 条）：${stateCounts
                    .map((row) => `${row.state} ${row.count}`)
                    .join("、")}。`}
            </p>
            <TicketTable tickets={data.tickets.slice(0, LIST_LIMIT)} />
          </>
        )}
      </section>
      </div>
    </main>
  );
}
