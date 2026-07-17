import type { ReactNode } from "react";

type SectionFrameProps = {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  intro: string;
  tone?: "light" | "dark";
  children: ReactNode;
};

export function SectionFrame({
  id,
  index,
  eyebrow,
  title,
  intro,
  tone = "light",
  children,
}: SectionFrameProps) {
  const titleId = `${id}-title`;

  return (
    <section
      className={`section-frame section-frame--${tone}`}
      id={id}
      aria-labelledby={titleId}
    >
      <div className="section-frame__heading">
        <div className="section-frame__meta">
          <span>{index}</span>
          <p>{eyebrow}</p>
        </div>
        <div>
          <h2 id={titleId}>{title}</h2>
          <p className="section-frame__intro">{intro}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
