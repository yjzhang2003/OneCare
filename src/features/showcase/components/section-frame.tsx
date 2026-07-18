import type { ReactNode } from "react";

import { ShowcasePageHeading } from "./showcase-page-heading";

type SectionFrameProps = {
  id: string;
  index: string;
  label: string;
  title: string;
  intro: string;
  tone?: "light" | "dark";
  children: ReactNode;
};

export function SectionFrame({
  id,
  index,
  label,
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
      <ShowcasePageHeading
        index={index}
        intro={intro}
        label={label}
        title={title}
        titleId={titleId}
        tone={tone}
      />
      {children}
    </section>
  );
}
