import type { VocMetricsResult } from "../../../src/features/voc/metrics";
import { getVocDashboardMetrics } from "../../api/voc/dashboard/route";

// Percentage formatting only ever touches ratios already computed by
// aggregateVocMetrics (0..1) — never a raw count divided ad hoc here, so
// every number on this page traces back to one arithmetic source.
function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function hours(value: number): string {
  return value.toFixed(1);
}

const dashboardStyles = `
  .voc-dashboard {
    max-width: 960px;
    margin: 0 auto;
    padding: 48px 24px 96px;
    color: #1a1d1f;
    line-height: 1.6;
  }
  .voc-dashboard h1 {
    font-size: 28px;
    margin-bottom: 4px;
  }
  .voc-dashboard__lede {
    color: #55595e;
    max-width: 640px;
    margin-bottom: 32px;
  }
  .voc-dashboard section {
    border: 1px solid #e2e5e8;
    border-radius: 12px;
    padding: 20px 24px;
    margin-bottom: 20px;
  }
  .voc-dashboard h2 {
    font-size: 16px;
    margin: 0 0 12px;
  }
  .voc-dashboard__stats {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
  }
  .voc-dashboard__stat {
    min-width: 140px;
  }
  .voc-dashboard__stat span {
    display: block;
    font-size: 13px;
    color: #767b80;
  }
  .voc-dashboard__stat strong {
    font-size: 24px;
  }
  .voc-dashboard table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  .voc-dashboard th,
  .voc-dashboard td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid #eef0f1;
  }
  .voc-dashboard__assumption {
    font-size: 13px;
    color: #8a6d1a;
    background: #fdf6e3;
    border: 1px solid #f0dfa4;
    border-radius: 8px;
    padding: 10px 14px;
    margin-top: 12px;
  }
  .voc-dashboard__note {
    font-size: 12px;
    color: #8a8f94;
    margin-top: 24px;
  }
  .voc-dashboard__unavailable {
    border-color: #f0dfa4;
    background: #fdf6e3;
    color: #6b5610;
  }
`;

// The shared shell every state (ok or unavailable) renders inside, so the
// "this page never leaks raw content" framing sentence and the page title
// are never duplicated or allowed to drift between the two branches.
function DashboardShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="voc-dashboard">
      <style>{dashboardStyles}</style>
      <h1>VOC 闭环看板</h1>
      <p className="voc-dashboard__lede">
        本页只读、无需登录，直接对飞书多维表格现有记录做数字聚合，不展示任何用户原文、姓名、电话、地址或工单
        record_id。所有数字均可与多维表格中的记录数逐一核对。
      </p>
      {children}
    </main>
  );
}

// Pulled out of the page's default export so it is testable without a real
// (or faked) network layer: feed it a VocMetricsResult directly and assert
// on the rendered output. A failed read must never render 0s or any other
// number that could pass for real data — it renders no numeric sections at
// all, only an explicit "unavailable" notice.
export function renderVocDashboard(result: VocMetricsResult) {
  if (result.status === "unavailable") {
    return (
      <DashboardShell>
        <section
          aria-labelledby="voc-dashboard-unavailable"
          className="voc-dashboard__unavailable"
          role="status"
        >
          <h2 id="voc-dashboard-unavailable">指标暂不可用</h2>
          <p>
            本次未能从飞书多维表格读取到最新数据，因此暂不展示任何统计数字——这不代表
            Base 中没有记录，只代表这一次读取失败。请稍后刷新本页重试。
          </p>
        </section>
      </DashboardShell>
    );
  }

  const metrics = result.metrics;
  const negativeCount = metrics.byPolarity.差评 + metrics.byPolarity.中评;
  const taggingProcessed = metrics.taggingSucceeded + metrics.taggingFailed;
  const taggingCoverage =
    metrics.taggingAttempted === 0
      ? 0
      : taggingProcessed / metrics.taggingAttempted;
  const taggingSuccessRate =
    taggingProcessed === 0 ? 0 : metrics.taggingSucceeded / taggingProcessed;

  return (
    <DashboardShell>
      <section aria-labelledby="voc-dashboard-total">
        <h2 id="voc-dashboard-total">总量与情绪极性</h2>
        <div className="voc-dashboard__stats">
          <div className="voc-dashboard__stat">
            <span>反馈总量</span>
            <strong>{metrics.total}</strong>
          </div>
          <div className="voc-dashboard__stat">
            <span>好评</span>
            <strong>{metrics.byPolarity.好评}</strong>
          </div>
          <div className="voc-dashboard__stat">
            <span>中评</span>
            <strong>{metrics.byPolarity.中评}</strong>
          </div>
          <div className="voc-dashboard__stat">
            <span>差评</span>
            <strong>{metrics.byPolarity.差评}</strong>
          </div>
          <div className="voc-dashboard__stat">
            <span>负向占比（中评+差评 / 已打标）</span>
            <strong>{percent(metrics.negativeShare)}</strong>
          </div>
        </div>
        <p className="voc-dashboard__note">
          负向占比分母为已打标记录（好评+中评+差评={" "}
          {metrics.byPolarity.好评 + metrics.byPolarity.中评 + metrics.byPolarity.差评}
          ），分子为中评+差评={negativeCount}。
        </p>
      </section>

      <section aria-labelledby="voc-dashboard-dimensions">
        <h2 id="voc-dashboard-dimensions">问题维度 Top {metrics.dimensionTop.length}</h2>
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

      <section aria-labelledby="voc-dashboard-channel">
        <h2 id="voc-dashboard-channel">渠道分布</h2>
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

      <section aria-labelledby="voc-dashboard-closure">
        <h2 id="voc-dashboard-closure">工单闭环</h2>
        <div className="voc-dashboard__stats">
          <div className="voc-dashboard__stat">
            <span>已建单</span>
            <strong>{metrics.ticketsOpened}</strong>
          </div>
          <div className="voc-dashboard__stat">
            <span>已闭环</span>
            <strong>{metrics.ticketsClosed}</strong>
          </div>
          <div className="voc-dashboard__stat">
            <span>闭环率（已闭环 / 已建单）</span>
            <strong>{percent(metrics.closureRate)}</strong>
          </div>
          <div className="voc-dashboard__stat">
            <span>平均闭环时长</span>
            <strong>{hours(metrics.averageClosureHours)} 小时</strong>
          </div>
        </div>
      </section>

      <section aria-labelledby="voc-dashboard-tagging">
        <h2 id="voc-dashboard-tagging">AI 打标覆盖与成功率</h2>
        <div className="voc-dashboard__stats">
          <div className="voc-dashboard__stat">
            <span>总记录数</span>
            <strong>{metrics.taggingAttempted}</strong>
          </div>
          <div className="voc-dashboard__stat">
            <span>打标成功</span>
            <strong>{metrics.taggingSucceeded}</strong>
          </div>
          <div className="voc-dashboard__stat">
            <span>打标失败</span>
            <strong>{metrics.taggingFailed}</strong>
          </div>
          <div className="voc-dashboard__stat">
            <span>待打标</span>
            <strong>{metrics.taggingPending}</strong>
          </div>
          <div className="voc-dashboard__stat">
            <span>覆盖率（成功+失败 / 总记录数）</span>
            <strong>{percent(taggingCoverage)}</strong>
          </div>
          <div className="voc-dashboard__stat">
            <span>成功率（成功 / 成功+失败）</span>
            <strong>{percent(taggingSuccessRate)}</strong>
          </div>
        </div>
      </section>

      <section aria-labelledby="voc-dashboard-effort">
        <h2 id="voc-dashboard-effort">人效估算</h2>
        {metrics.effort ? (
          <>
            <div className="voc-dashboard__stats">
              <div className="voc-dashboard__stat">
                <span>已完成打标记录数</span>
                <strong>{metrics.effort.taggedRecords}</strong>
              </div>
              <div className="voc-dashboard__stat">
                <span>假设人工处理耗时 / 条</span>
                <strong>{metrics.effort.manualMinutesPerRecord} 分钟</strong>
              </div>
              <div className="voc-dashboard__stat">
                <span>折算节省工时</span>
                <strong>{hours(metrics.effort.savedHours)} 小时</strong>
              </div>
            </div>
            <p className="voc-dashboard__assumption">
              假设值：以上工时按「每条记录人工需要{" "}
              {metrics.effort.manualMinutesPerRecord} 分钟」这一未经实测的假设基线折算，
              仅用于估算 AI 打标相对人工处理可能节省的时间数量级，不代表实际测量值，也不折算为年化金额。
            </p>
          </>
        ) : (
          <p>未配置人工处理基线，不计算人效数字。</p>
        )}
      </section>
    </DashboardShell>
  );
}

export default async function VocDashboardPage() {
  const result = await getVocDashboardMetrics();
  return renderVocDashboard(result);
}
