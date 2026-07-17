import type { Outcome } from "../content";

export function OutcomeStatement({
  outcomes,
}: {
  outcomes: readonly Outcome[];
}) {
  return (
    <div className="outcome-statement">
      {outcomes.map((outcome) => (
        <p key={outcome.label}>
          <strong>{outcome.emphasis}</strong>
          <span>{outcome.label}</span>
          <span className="sr-only">{`${outcome.emphasis}${outcome.label}`}</span>
        </p>
      ))}
    </div>
  );
}
