import Link from "next/link";

import type { AuthUser } from "../src/features/auth/types";
import { VOC_STATE_SEQUENCE, VOC_STATES } from "../src/features/voc/service-event";
import type { VocState } from "../src/features/voc/service-event";
import type { VocMetrics } from "../src/features/voc/metrics";
import {
  VOC_DIMENSIONS,
  VOC_POLARITIES,
  VOC_SEVERITIES,
} from "../src/features/voc/triage";
import type {
  WorkbenchData,
  WorkbenchTicket,
} from "../src/features/workbench/data";
import {
  applyWorkbenchQuery,
  ASSUMED_SLA_HOURS,
  dwellHours,
  isOverdue,
  parseWorkbenchQuery,
  QUEUES,
  SORTS,
  type QueueKey,
  type WorkbenchPage,
  type WorkbenchQuery,
} from "../src/features/workbench/query";

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

function text(value: string | null): string {
  return value ?? ABSENT;
}

// Counted from the full data set rather than from whatever the current queue
// or filters happen to match: this line answers "how is the whole backlog
// distributed across states", and that answer must not change just because
// an operator narrowed the view above it. VocMetrics carries no per-state
// breakdown, and deriving one from a different pass over the records is how
// two numbers on one page start disagreeing, so this counts the same
// `data.tickets` the queue tabs and filters are built from.
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

// Matches parseWorkbenchQuery's own (unexported) RawParams shape structurally
// rather than importing a type query.ts does not expose — Next's searchParams
// promise resolves to exactly this record, and parseWorkbenchQuery only cares
// about the shape, not which module declared it. Declaring an equivalent type
// here means query.ts's public surface stays exactly what it was when it
// shipped fully tested; this file adapts to it instead of the other way
// round.
type RawSearchParams = Readonly<Record<string, string | string[] | undefined>>;

function distinctValues(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((a, b) =>
    a.localeCompare(b, "zh"),
  );
}

// Every link on this page is assembled by one of the three functions below
// rather than a hand-built query string at each call site, so "what does
// clicking this do to the URL" has exactly one place to audit. All three
// round-trip through the WorkbenchQuery the page already parsed — never
// through the current document location — because this is a server
// component with no client-side state to read a location from; the URL
// arriving on the next request *is* the state.
function baseParams(query: WorkbenchQuery): Record<string, string | null> {
  return {
    queue: query.queue,
    channel: query.channel,
    category: query.category,
    polarity: query.polarity,
    dimension: query.dimension,
    severity: query.severity,
    state: query.state,
    owner: query.owner,
    search: query.search.length > 0 ? query.search : null,
    sort: query.sort,
    page: query.page > 1 ? String(query.page) : null,
    ticket: query.ticket,
  };
}

function toHref(params: Readonly<Record<string, string | null>>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value.length > 0) usp.set(key, value);
  }
  const qs = usp.toString();
  return qs.length > 0 ? `/?${qs}` : "/";
}

type QueryPatch = Readonly<
  Partial<
    Record<
      | "queue"
      | "channel"
      | "category"
      | "polarity"
      | "dimension"
      | "severity"
      | "state"
      | "owner"
      | "sort"
      | "page"
      | "ticket",
      string | null
    >
  >
>;

// Changing the queue, a filter or the sort order always lands back on page
// one: the matched set just changed, so whatever "page 3" meant a moment ago
// no longer describes it.
function filterHref(query: WorkbenchQuery, patch: QueryPatch): string {
  return toHref({ ...baseParams(query), page: null, ...patch });
}

function pageHref(query: WorkbenchQuery, page: number): string {
  return toHref({ ...baseParams(query), page: page > 1 ? String(page) : null });
}

// Opening or closing the detail panel never touches the queue, the filters,
// the search term, the sort or which page they were browsing — it is
// orthogonal state, which is also why applyWorkbenchQuery resolves `selected`
// against every record rather than only the current page's rows.
function ticketHref(query: WorkbenchQuery, ticket: string | null): string {
  return toHref({ ...baseParams(query), ticket });
}

type StringFilterField =
  | "channel"
  | "category"
  | "polarity"
  | "dimension"
  | "severity"
  | "state"
  | "owner";

// A computed property key needs an assertion because TypeScript cannot see
// that `field`'s type is exactly the subset of QueryPatch's keys it indexes —
// StringFilterField is that subset by construction (every member also names a
// string-or-null field on WorkbenchQuery), so this is a type-level fact about
// the shape above rather than an unchecked escape hatch around an unverified
// value.
function toPatch(field: StringFilterField, value: string | null): QueryPatch {
  return { [field]: value } as QueryPatch;
}

// Colours come from the palette in globals.css rather than literals. The first
// version of this file hardcoded a dark text colour copied from the retired
// aggregate page and set no background at all, so it rendered dark-on-dark
// against the site's near-black body — invisible, and invisible in a way no
// assertion in this repo can see, since jsdom computes no contrast. Tokens make
// the surface and the text agree by construction. The outer element also reuses
// the existing `.dashboard-shell` paper surface instead of inventing a second
// one. Every element added for the triage surface (queues, pills, the search
// box, the overdue badge) follows the same rule: no literal colour, only
// tokens.
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
  .workbench h3 {
    font-size: 13px;
    color: var(--muted);
    margin: 0 0 8px;
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
  .workbench__queues {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 20px;
  }
  .workbench__queue-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 6px 14px;
    font-size: 13px;
  }
  .workbench__queue-tab--active {
    color: var(--paper);
    background: var(--ink);
    border-color: var(--ink);
  }
  .workbench__queue-count {
    display: inline-block;
    min-width: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--paper-deep);
    color: var(--ink);
    font-size: 12px;
    text-align: center;
  }
  .workbench__queue-tab--active .workbench__queue-count {
    background: var(--paper);
    color: var(--ink);
  }
  .workbench__filters {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 16px;
  }
  .workbench__filter-group,
  .workbench__sort {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .workbench__filter-label {
    min-width: 76px;
    font-size: 13px;
    color: var(--muted);
  }
  .workbench__filter-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .workbench__pill {
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 12px;
  }
  .workbench__pill--active {
    color: var(--paper);
    background: var(--ink);
    border-color: var(--ink);
  }
  .workbench__search-form {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 20px;
  }
  .workbench__search-form label {
    font-size: 13px;
    color: var(--muted);
  }
  .workbench__search-form input[type="search"] {
    flex: 1;
    min-width: 220px;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 13px;
  }
  .workbench__row--overdue td:first-child {
    border-left: 3px solid var(--orange);
  }
  .workbench__overdue-badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--orange);
    color: var(--paper);
    font-size: 11px;
    font-weight: 700;
  }
  .workbench__pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 12px;
    font-size: 13px;
    color: var(--ink);
  }
  .workbench__pagination-disabled {
    color: var(--muted);
  }
  .workbench__detail-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .workbench__detail-grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 16px;
    font-size: 13px;
    margin: 0 0 16px;
  }
  .workbench__detail-grid dt {
    color: var(--muted);
  }
  .workbench__detail-grid dd {
    margin: 0;
  }
  .workbench__replies {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .workbench__replies li {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 12px;
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

function QueueTabs({
  query,
  queueCounts,
}: Readonly<{
  query: WorkbenchQuery;
  queueCounts: Readonly<Record<QueueKey, number>>;
}>) {
  return (
    <nav className="workbench__queues" aria-label="工单队列">
      {QUEUES.map((item) => {
        const active = query.queue === item.key;
        return (
          <Link
            key={item.key}
            href={filterHref(query, { queue: item.key })}
            title={item.hint}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "workbench__queue-tab workbench__queue-tab--active"
                : "workbench__queue-tab"
            }
          >
            {item.label}
            <span className="workbench__queue-count">
              {queueCounts[item.key]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function SortLinks({ query }: Readonly<{ query: WorkbenchQuery }>) {
  return (
    <div className="workbench__sort" aria-label="排序方式">
      <span className="workbench__filter-label">排序</span>
      <div className="workbench__filter-pills">
        {SORTS.map((item) => (
          <Link
            key={item.key}
            href={filterHref(query, { sort: item.key })}
            aria-current={query.sort === item.key ? "true" : undefined}
            className={
              query.sort === item.key
                ? "workbench__pill workbench__pill--active"
                : "workbench__pill"
            }
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

// One `<form method="get">` with a single visible field is the only form on
// this page, and deliberately carries no submit button: a form with exactly
// one text-type field submits on Enter without any script, and this project's
// own regression test (below, "renders no button at all") pins the read-only
// surface's stronger property — zero interactive controls of that kind, not
// merely none with a state-changing label. A visible button here would have
// meant either breaking that test or reintroducing exactly the ambiguity it
// was written to rule out.
function SearchForm({ query }: Readonly<{ query: WorkbenchQuery }>) {
  return (
    <form method="get" className="workbench__search-form">
      <label htmlFor="workbench-search-input">
        搜索原始内容 / 机型 / 记录编号（按回车提交）
      </label>
      <input
        id="workbench-search-input"
        type="search"
        name="search"
        defaultValue={query.search}
      />
      {/* Hidden fields carry the queue and every active filter forward, so
          submitting a search only ever adds `search=` — it never silently
          resets the view an operator already narrowed down. Page and the
          open ticket are deliberately left out: a new search is a new look
          at the list, not a request to stay on the same page or keep
          whatever record happened to be open. */}
      <input type="hidden" name="queue" value={query.queue} />
      {query.channel !== null && (
        <input type="hidden" name="channel" value={query.channel} />
      )}
      {query.category !== null && (
        <input type="hidden" name="category" value={query.category} />
      )}
      {query.polarity !== null && (
        <input type="hidden" name="polarity" value={query.polarity} />
      )}
      {query.dimension !== null && (
        <input type="hidden" name="dimension" value={query.dimension} />
      )}
      {query.severity !== null && (
        <input type="hidden" name="severity" value={query.severity} />
      )}
      {query.state !== null && (
        <input type="hidden" name="state" value={query.state} />
      )}
      {query.owner !== null && (
        <input type="hidden" name="owner" value={query.owner} />
      )}
      {query.sort !== "feedback_desc" && (
        <input type="hidden" name="sort" value={query.sort} />
      )}
    </form>
  );
}

function FilterGroup({
  label,
  field,
  options,
  query,
}: Readonly<{
  label: string;
  field: StringFilterField;
  options: readonly string[];
  query: WorkbenchQuery;
}>) {
  const current = query[field];
  return (
    <div className="workbench__filter-group">
      <span className="workbench__filter-label">{label}</span>
      <div className="workbench__filter-pills">
        <Link
          href={filterHref(query, toPatch(field, null))}
          className={
            current === null
              ? "workbench__pill workbench__pill--active"
              : "workbench__pill"
          }
        >
          全部
        </Link>
        {options.map((option) => (
          <Link
            key={option}
            href={filterHref(
              query,
              toPatch(field, current === option ? null : option),
            )}
            className={
              current === option
                ? "workbench__pill workbench__pill--active"
                : "workbench__pill"
            }
          >
            {option}
          </Link>
        ))}
      </div>
    </div>
  );
}

function DwellCell({
  ticket,
  now,
}: Readonly<{ ticket: WorkbenchTicket; now: number }>) {
  const dwell = dwellHours(ticket, now);
  if (dwell === null) return <>{ABSENT}</>;
  const overdue = isOverdue(ticket, now);
  return (
    <>
      {hours(dwell)} 小时
      {overdue && (
        <span
          className="workbench__overdue-badge"
          title={`停留超过 ${ASSUMED_SLA_HOURS} 小时（假设 SLA，暂无企业方给出的合同值）`}
        >
          超时
        </span>
      )}
    </>
  );
}

function TicketTable({
  tickets,
  query,
  now,
}: Readonly<{
  tickets: readonly WorkbenchTicket[];
  query: WorkbenchQuery;
  now: number;
}>) {
  return (
    <div className="workbench__tickets">
      <table>
        <thead>
          <tr>
            <th>记录编号</th>
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
            <th>停留时长</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr
              key={ticket.recordNumber}
              className={
                isOverdue(ticket, now)
                  ? "workbench__row workbench__row--overdue"
                  : "workbench__row"
              }
            >
              <td>
                <Link href={ticketHref(query, ticket.recordNumber)}>
                  {ticket.recordNumber}
                </Link>
              </td>
              <td>{text(shanghaiTime(ticket.feedbackAt))}</td>
              {/* The separator only appears when both sides do. The source file
                  mixes product lines and org units in one column, so a record
                  from 集团 or 中国区 legitimately has no product category, and
                  "电商评价 / " with nothing after it reads as a rendering bug. */}
              <td>
                {[ticket.channel, ticket.category].filter(Boolean).join(" / ") ||
                  ABSENT}
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
              <td>
                <DwellCell ticket={ticket} now={now} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({
  query,
  view,
}: Readonly<{ query: WorkbenchQuery; view: WorkbenchPage }>) {
  return (
    <div className="workbench__pagination" aria-label="分页">
      {view.page > 1 ? (
        <Link href={pageHref(query, view.page - 1)}>上一页</Link>
      ) : (
        <span className="workbench__pagination-disabled">上一页</span>
      )}
      <span>
        第 {view.page} / {view.pageCount} 页，共 {view.matched} 条
      </span>
      {view.page < view.pageCount ? (
        <Link href={pageHref(query, view.page + 1)}>下一页</Link>
      ) : (
        <span className="workbench__pagination-disabled">下一页</span>
      )}
    </div>
  );
}

// Rendered above the queue/filter/search controls (and therefore above the
// list, which is also "near the top of the page" — the brief allows either
// reading) precisely because applyWorkbenchQuery resolves `selected` against
// every record, not just the current page: a link someone was sent must open
// even when the recipient's saved queue or filters would otherwise exclude
// it, so the panel cannot live inside — or depend on — the filtered table
// below it.
function TicketDetail({
  ticket,
  query,
  now,
}: Readonly<{ ticket: WorkbenchTicket; query: WorkbenchQuery; now: number }>) {
  const dwell = dwellHours(ticket, now);
  const overdue = isOverdue(ticket, now);
  return (
    <section aria-labelledby="workbench-detail">
      <div className="workbench__detail-header">
        <h2 id="workbench-detail">工单详情 · {ticket.recordNumber}</h2>
        <Link href={ticketHref(query, null)}>收起详情 ×</Link>
      </div>
      <dl className="workbench__detail-grid">
        <dt>渠道 / 品类</dt>
        <dd>
          {[ticket.channel, ticket.category].filter(Boolean).join(" / ") ||
            ABSENT}
        </dd>
        <dt>机型</dt>
        <dd>{ticket.model.length === 0 ? ABSENT : ticket.model}</dd>
        <dt>情绪极性</dt>
        <dd>{text(ticket.polarity)}</dd>
        <dt>问题维度</dt>
        <dd>
          {ticket.dimensions.length === 0
            ? ABSENT
            : ticket.dimensions.join("、")}
        </dd>
        <dt>严重度</dt>
        <dd>{text(ticket.severity)}</dd>
        <dt>流程状态</dt>
        <dd>{ticket.state}</dd>
        <dt>负责人</dt>
        <dd>
          {ticket.ownerNames.length === 0 ? ABSENT : ticket.ownerNames.join("、")}
        </dd>
        <dt>反馈时间</dt>
        <dd>{text(shanghaiTime(ticket.feedbackAt))}</dd>
        <dt>建单时间</dt>
        <dd>{text(shanghaiTime(ticket.ticketOpenedAt))}</dd>
        <dt>闭环时间</dt>
        <dd>{text(shanghaiTime(ticket.closedAt))}</dd>
        <dt>停留时长</dt>
        <dd>
          {dwell === null ? (
            ABSENT
          ) : (
            <>
              {hours(dwell)} 小时
              {overdue && (
                <span
                  className="workbench__overdue-badge"
                  title={`停留超过 ${ASSUMED_SLA_HOURS} 小时（假设 SLA，暂无企业方给出的合同值）`}
                >
                  超时
                </span>
              )}
            </>
          )}
        </dd>
      </dl>
      <h3>完整原文</h3>
      <p className="workbench__content-cell">{ticket.content}</p>
      <h3>AI 摘要</h3>
      <p>{ticket.summary.length === 0 ? ABSENT : ticket.summary}</p>
      <h3>AI 回复话术</h3>
      {ticket.replies.length === 0 ? (
        <p>{ABSENT}</p>
      ) : (
        <ul className="workbench__replies">
          {ticket.replies.map((reply, index) => (
            // Tone plus position, not just tone: two drafts sharing a tone
            // ("安抚") are a real shape parseReplyText can produce, and index
            // alone would silently collide with a re-ordered array from a
            // future edit.
            <li key={`${reply.tone}-${index}`}>
              <strong>【{reply.tone}】</strong> <span>{reply.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type WorkbenchContentProps = Readonly<{
  data: WorkbenchData;
  user: AuthUser;
  // Passed in rather than read from Date.now() inside this component: the
  // component must stay a pure function of its props to be testable without
  // a fake timer, and this project runs under Next's Cache Components model,
  // where a component that reaches for the wall clock itself makes its own
  // caching behaviour much harder to reason about. The page decides "now"
  // once and hands it down.
  now: number;
  searchParams: RawSearchParams;
}>;

// A server component with no client-boundary directive at the top of the
// file: every control here is a link, a GET form, or plain markup. That is
// the point rather than an omission —
// state changes belong to the Feishu card path, whose identity comes from a
// signed event while this page's comes from a session cookie. Two write
// paths with two different identity sources feeding one state machine is a
// concurrency and an authorization risk at once, and Bitable offers no
// compare-and-set to arbitrate between them. Queues, filters, search,
// pagination and the ticket detail drill-down are all navigation — they
// change which records this read-only view shows, never a record itself —
// so all of it fits the same no-JavaScript, URL-is-the-only-state design the
// original page shipped with.
export function WorkbenchContent({
  data,
  user,
  now,
  searchParams,
}: WorkbenchContentProps) {
  const stateCounts = countByState(data.tickets);
  const query = parseWorkbenchQuery(searchParams);
  const view = applyWorkbenchQuery(data.tickets, query, now);

  // Facet options are drawn from the whole Base, not from the currently
  // matched rows: a faceted filter panel whose own options kept shrinking as
  // filters were applied would make combining two filters ("400 客服" then
  // "冰箱") impossible the moment the first one narrowed the list past the
  // second option's only appearance.
  const channelOptions = distinctValues(data.tickets.map((t) => t.channel));
  const categoryOptions = distinctValues(data.tickets.map((t) => t.category));
  const ownerOptions = distinctValues(data.tickets.flatMap((t) => t.ownerNames));

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

      {view.selected && (
        <TicketDetail ticket={view.selected} query={query} now={now} />
      )}

      <section aria-labelledby="workbench-tickets">
        <h2 id="workbench-tickets">工单列表（只读）</h2>
        {data.tickets.length === 0 ? (
          <p>暂无工单记录。</p>
        ) : (
          <>
            <h3>队列</h3>
            <QueueTabs query={query} queueCounts={view.queueCounts} />

            <h3>搜索</h3>
            <SearchForm query={query} />

            <h3>筛选</h3>
            <div className="workbench__filters">
              <FilterGroup
                label="渠道"
                field="channel"
                options={channelOptions}
                query={query}
              />
              <FilterGroup
                label="产品品类"
                field="category"
                options={categoryOptions}
                query={query}
              />
              <FilterGroup
                label="情绪极性"
                field="polarity"
                options={VOC_POLARITIES}
                query={query}
              />
              <FilterGroup
                label="问题维度"
                field="dimension"
                options={VOC_DIMENSIONS}
                query={query}
              />
              <FilterGroup
                label="严重度"
                field="severity"
                options={VOC_SEVERITIES}
                query={query}
              />
              <FilterGroup
                label="流程状态"
                field="state"
                options={VOC_STATES}
                query={query}
              />
              <FilterGroup
                label="负责人"
                field="owner"
                options={ownerOptions}
                query={query}
              />
              <SortLinks query={query} />
            </div>

            {/* Base's true size and the current match count are both stated
                here, deliberately never just one of the two — a reader who
                sees only "47 条" after applying a filter has no way to tell
                that from "the Base only has 47 records to begin with". */}
            <p className="workbench__note">
              Base 全量 {data.tickets.length} 条；当前筛选匹配 {view.matched}{" "}
              条。无反馈时间的记录排在末尾而不被丢弃。
              {stateCounts.length === 0
                ? null
                : ` 流程状态分布（全量 ${data.tickets.length} 条）：${stateCounts
                    .map((row) => `${row.state} ${row.count}`)
                    .join("、")}。`}
            </p>

            {view.rows.length === 0 ? (
              <p>当前队列 / 筛选条件下没有匹配的工单。</p>
            ) : (
              <TicketTable tickets={view.rows} query={query} now={now} />
            )}

            <Pagination query={query} view={view} />
          </>
        )}
      </section>
      </div>
    </main>
  );
}
