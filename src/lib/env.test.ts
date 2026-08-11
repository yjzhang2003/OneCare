import { describe, expect, it } from "vitest";

import { readAuthEnv, readBitableEnv, readBotEnv, readTaggingEnv } from "./env";

const validEnvironment = {
  FEISHU_APP_ID: "cli_test",
  FEISHU_APP_SECRET: "test-app-secret",
  FEISHU_REDIRECT_URI: "https://auto-insight.example/api/auth/feishu/callback",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
};

const validBotEnvironment = {
  FEISHU_APP_ID: "cli_test",
  FEISHU_APP_SECRET: "test-app-secret",
  FEISHU_EVENT_VERIFICATION_TOKEN: "verification-token",
  FEISHU_EVENT_ENCRYPT_KEY: "12345678901234567890123456789012",
};

describe("readAuthEnv", () => {
  it("maps complete server environment variables", () => {
    expect(readAuthEnv(validEnvironment)).toEqual({
      appId: "cli_test",
      appSecret: "test-app-secret",
      redirectUri: "https://auto-insight.example/api/auth/feishu/callback",
      sessionSecret: "0123456789abcdef0123456789abcdef",
    });
  });

  it("reports a missing variable by name without exposing values", () => {
    expect(() =>
      readAuthEnv({
        FEISHU_APP_ID: "cli_test",
      }),
    ).toThrow("Missing server environment variable: FEISHU_APP_SECRET");
  });

  it("rejects a session secret shorter than 32 bytes", () => {
    expect(() =>
      readAuthEnv({
        ...validEnvironment,
        SESSION_SECRET: "too-short",
      }),
    ).toThrow("Invalid server environment variable: SESSION_SECRET");
  });
});

describe("readBotEnv", () => {
  it("maps the server-only bot environment independently from OAuth", () => {
    expect(readBotEnv(validBotEnvironment)).toEqual({
      appId: "cli_test",
      appSecret: "test-app-secret",
      verificationToken: "verification-token",
      encryptKey: "12345678901234567890123456789012",
    });
  });

  it("reports missing verification settings without exposing values", () => {
    expect(() =>
      readBotEnv({
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "private-value",
      }),
    ).toThrow(
      "Missing server environment variable: FEISHU_EVENT_VERIFICATION_TOKEN",
    );
  });
});

const bitable = {
  FEISHU_BITABLE_APP_TOKEN: "bascn_demo",
  FEISHU_BITABLE_TABLE_VOC: "tblvoc",
  FEISHU_BITABLE_TABLE_OWNER: "tblowner",
};

describe("readBitableEnv", () => {
  it("reads all three identifiers", () => {
    expect(readBitableEnv(bitable)).toEqual({
      appToken: "bascn_demo",
      vocTableId: "tblvoc",
      ownerTableId: "tblowner",
    });
  });

  it.each(Object.keys(bitable))("throws when %s is missing", (key) => {
    const source = { ...bitable, [key]: "" };
    expect(() => readBitableEnv(source)).toThrow(new RegExp(key));
  });
});

describe("readTaggingEnv", () => {
  it("reads the field shortcut track without aily identifiers", () => {
    expect(readTaggingEnv({ TAGGING_PROVIDER: "field-shortcut" })).toEqual({
      provider: "field-shortcut",
    });
  });

  it("requires aily identifiers on the aily track", () => {
    expect(() => readTaggingEnv({ TAGGING_PROVIDER: "aily" })).toThrow(
      /FEISHU_AILY_APP_ID/,
    );
  });

  it("reads the aily track when fully configured", () => {
    expect(
      readTaggingEnv({
        TAGGING_PROVIDER: "aily",
        FEISHU_AILY_APP_ID: "spring_demo__c",
        FEISHU_AILY_SKILL_TAGGING: "skill_demo",
      }),
    ).toEqual({
      provider: "aily",
      ailyAppId: "spring_demo__c",
      taggingSkillId: "skill_demo",
      // Null means "sign the aily call with the main app", which is right for a
      // tenant whose aily application lives under that app.
      credential: null,
    });
  });

  it("reads a dedicated aily credential when the aily app is published under its own", () => {
    // The skill-start API resolves the aily application from the calling
    // credential, not from the app id in the path — verified against the live
    // API, where this project's main app gets 2320008 for a real, published
    // aily app id. So the aily call may have to be signed by the app aily
    // created for it, while Bitable and messaging keep the main app.
    expect(
      readTaggingEnv({
        TAGGING_PROVIDER: "aily",
        FEISHU_AILY_APP_ID: "spring_demo__c",
        FEISHU_AILY_SKILL_TAGGING: "skill_demo",
        FEISHU_AILY_BOT_APP_ID: "cli_demo",
        FEISHU_AILY_BOT_APP_SECRET: "secret_demo",
      }),
    ).toMatchObject({
      credential: { appId: "cli_demo", appSecret: "secret_demo" },
    });
  });

  it("rejects half a credential pair rather than silently using the main app", () => {
    // Falling back on a half-configured override would resurface as 2320008
    // from a caller who had every reason to think the override was in place.
    for (const half of [
      { FEISHU_AILY_BOT_APP_ID: "cli_demo" },
      { FEISHU_AILY_BOT_APP_SECRET: "secret_demo" },
    ]) {
      expect(() =>
        readTaggingEnv({
          TAGGING_PROVIDER: "aily",
          FEISHU_AILY_APP_ID: "spring_demo__c",
          FEISHU_AILY_SKILL_TAGGING: "skill_demo",
          ...half,
        }),
      ).toThrow(/must be set together/);
    }
  });

  it("rejects an unknown provider name", () => {
    expect(() => readTaggingEnv({ TAGGING_PROVIDER: "magic" })).toThrow(
      /TAGGING_PROVIDER/,
    );
  });
});
