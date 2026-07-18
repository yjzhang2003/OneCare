export type AuthEnv = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  sessionSecret: string;
};

export type BotEnv = {
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
};

type ServerEnvironmentName =
  | "FEISHU_APP_ID"
  | "FEISHU_APP_SECRET"
  | "FEISHU_REDIRECT_URI"
  | "SESSION_SECRET"
  | "FEISHU_EVENT_VERIFICATION_TOKEN"
  | "FEISHU_EVENT_ENCRYPT_KEY";

function readRequired(
  source: Readonly<Record<string, string | undefined>>,
  name: ServerEnvironmentName,
): string {
  const value = source[name]?.trim();

  if (!value) {
    throw new Error(`Missing server environment variable: ${name}`);
  }

  return value;
}

export function readAuthEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): AuthEnv {
  const appId = readRequired(source, "FEISHU_APP_ID");
  const appSecret = readRequired(source, "FEISHU_APP_SECRET");
  const redirectUri = readRequired(source, "FEISHU_REDIRECT_URI");
  const sessionSecret = readRequired(source, "SESSION_SECRET");

  if (Buffer.byteLength(sessionSecret, "utf8") < 32) {
    throw new Error("Invalid server environment variable: SESSION_SECRET");
  }

  return { appId, appSecret, redirectUri, sessionSecret };
}

export function readBotEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): BotEnv {
  return {
    appId: readRequired(source, "FEISHU_APP_ID"),
    appSecret: readRequired(source, "FEISHU_APP_SECRET"),
    verificationToken: readRequired(
      source,
      "FEISHU_EVENT_VERIFICATION_TOKEN",
    ),
    encryptKey: readRequired(source, "FEISHU_EVENT_ENCRYPT_KEY"),
  };
}
