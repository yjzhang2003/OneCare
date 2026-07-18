type ShowcasePageHeadingProps = {
  index: string;
  label: string;
  title: string;
  titleId: string;
  intro: string;
  tone?: "light" | "dark";
};

export function ShowcasePageHeading({
  index,
  label,
  title,
  titleId,
  intro,
  tone = "light",
}: ShowcasePageHeadingProps) {
  return (
    <div className={`showcase-page-heading showcase-page-heading--${tone}`}>
      <p className="showcase-page-kicker">{`${index} · ${label}`}</p>
      <h2 data-showcase-title id={titleId} tabIndex={-1}>
        {title}
      </h2>
      <p className="showcase-page-intro">{intro}</p>
    </div>
  );
}
