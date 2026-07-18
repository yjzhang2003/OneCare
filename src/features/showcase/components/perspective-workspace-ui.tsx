import type { ReactNode } from "react";

type DemoStatusBarProps = Readonly<{
  product: string;
  caseId: string;
  status: string;
  title: string;
}>;

export function DemoStatusBar({
  product,
  caseId,
  status,
  title,
}: DemoStatusBarProps) {
  return (
    <header className="demo-status-bar">
      <div>
        <span className="demo-label">静态交互 Demo</span>
        <strong>{title}</strong>
      </div>
      <div className="demo-status-bar__meta">
        <span>{product}</span>
        <span>{caseId}</span>
        <span className="demo-status-dot">{status}</span>
      </div>
    </header>
  );
}

type DemoMetricProps = Readonly<{
  label: string;
  value: string;
  detail?: string;
}>;

export function DemoMetric({ label, value, detail }: DemoMetricProps) {
  return (
    <div className="demo-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

type TimelineStep = Readonly<{
  label: string;
  state: "complete" | "active" | "pending";
}>;

type DemoTimelineProps = Readonly<{
  label: string;
  steps: readonly TimelineStep[];
}>;

export function DemoTimeline({ label, steps }: DemoTimelineProps) {
  return (
    <ol aria-label={label} className="demo-timeline">
      {steps.map((step) => (
        <li data-state={step.state} key={step.label}>
          <i aria-hidden="true" />
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function DemoPanel({
  children,
  className = "",
}: Readonly<{ children: ReactNode; className?: string }>) {
  return <section className={`demo-panel ${className}`.trim()}>{children}</section>;
}
