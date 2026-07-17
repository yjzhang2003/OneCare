import type { Perspective } from "../content";

export function JourneyScene({ perspective }: { perspective: Perspective }) {
  return (
    <article className={`journey-scene journey-scene--${perspective.index}`}>
      <div className="journey-scene__rail" aria-hidden="true">
        <span>{perspective.index}</span>
        <i />
      </div>
      <div className="journey-scene__copy">
        <p>{perspective.title}</p>
        <h3>{perspective.sceneLine}</h3>
        <p className="journey-scene__value">{perspective.value}</p>
      </div>
      <div className="journey-scene__evidence">
        <p>{perspective.handoff}</p>
        <ul aria-label={`${perspective.title}关键能力`}>
          {perspective.capabilities.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}
