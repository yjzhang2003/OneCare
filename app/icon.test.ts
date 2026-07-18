import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("browser tab icon", () => {
  it("reuses the existing dark OneCare brand asset", () => {
    const repositoryRoot = process.cwd();
    const iconPath = join(repositoryRoot, "app/icon.png");
    const legacyIconPath = join(repositoryRoot, "app/icon.svg");
    const brandAssets = readFileSync(
      join(repositoryRoot, "src/features/showcase/brand-assets.ts"),
      "utf8",
    );
    const darkLogo = brandAssets.match(
      /ONECARE_LOGO_DARK_SRC\s*=\s*\n\s*"data:image\/png;base64,([^"]+)"/,
    );

    expect(darkLogo).not.toBeNull();
    expect(existsSync(legacyIconPath)).toBe(false);
    expect(existsSync(iconPath)).toBe(true);

    if (!darkLogo || !existsSync(iconPath)) {
      return;
    }

    expect(readFileSync(iconPath)).toEqual(Buffer.from(darkLogo[1], "base64"));
  });
});
