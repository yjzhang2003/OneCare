import Image from "next/image";

import {
  ONECARE_LOGO_DARK_SRC,
  ONECARE_LOGO_LIGHT_SRC,
} from "../brand-assets";

type OneCareLogoProps = Readonly<{
  tone: "light" | "dark";
  size?: number;
  decorative?: boolean;
  className?: string;
}>;

export function OneCareLogo({
  tone,
  size = 40,
  decorative = false,
  className = "",
}: OneCareLogoProps) {
  return (
    <Image
      alt={decorative ? "" : "万护 OneCare"}
      aria-hidden={decorative || undefined}
      className={`onecare-logo ${className}`.trim()}
      data-testid="onecare-logo"
      data-tone={tone}
      height={size}
      src={tone === "light" ? ONECARE_LOGO_LIGHT_SRC : ONECARE_LOGO_DARK_SRC}
      unoptimized
      width={size}
    />
  );
}
