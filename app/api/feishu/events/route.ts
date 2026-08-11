import { after } from "next/server";

import {
  createBitableClient,
  createTenantTokenProvider,
  type BitableClient,
} from "../../../../src/features/bitable/client";
import {
  createBotReply,
  type BotReply,
} from "../../../../src/features/feishu-bot/bot-script";
import {
  resolveCardAction,
  resolveVocCardAction,
  type CardActionResult,
  type VocActionBitable,
} from "../../../../src/features/feishu-bot/card-actions";
import {
  VOC_CARD_ACTIONS,
  type FeishuOutboundMessage,
  type OneCareCardAction,
  type VocCardAction,
} from "../../../../src/features/feishu-bot/card-types";
import { createWelcomeMessage } from "../../../../src/features/feishu-bot/cards";
import {
  replyToFeishuMessage,
  sendFeishuMessage,
} from "../../../../src/features/feishu-bot/client";
import {
  parseFeishuEvent,
  type FeishuEventOutcome,
} from "../../../../src/features/feishu-bot/event-handler";
import {
  readBitableEnv,
  readBotEnv,
  type BotEnv,
} from "../../../../src/lib/env";

// `runtime = "nodejs"` was dropped: it is the App Router default anyway, and
// task 14 enables `cacheComponents` in next.config.ts (for the VOC
// dashboard's `use cache`), which rejects this route segment config outright.
export const maxDuration = 10;

type Scheduler = (task: () => Promise<void>) => void;

type FeishuEventRouteDependencies = {
  readEnv: () => BotEnv;
  parseEvent: (input: {
    rawBody: string;
    headers: Headers;
    env: BotEnv;
  }) => Promise<FeishuEventOutcome>;
  createReply: (text: string) => BotReply;
  createWelcome: () => FeishuOutboundMessage;
  replyMessage: (input: {
    env: BotEnv;
    messageId: string;
    message: FeishuOutboundMessage;
  }) => Promise<void>;
  sendMessage: (input: {
    env: BotEnv;
    chatId: string;
    message: FeishuOutboundMessage;
  }) => Promise<void>;
  resolveAction: (input: CardActionRequest) => Promise<CardActionResult>;
  schedule: Scheduler;
  reportFailure: () => void;
};

// Every field the dispatcher needs, all required. `note` is not optional here
// on purpose: the previous shape omitted it entirely, so this route called
// resolveVocCardAction without 跟进记录/闭环结论, TypeScript was satisfied
// because they were optional parameters, and both actions were rejected by
// their own guards in production while every test on both sides passed.
type CardActionRequest = Readonly<{
  action: OneCareCardAction | VocCardAction;
  recordId: string;
  operatorOpenId: string;
  note: string;
}>;

function isVocCardAction(
  action: OneCareCardAction | VocCardAction,
): action is VocCardAction {
  return (VOC_CARD_ACTIONS as readonly string[]).includes(action);
}

// Built once per server instance and reused across requests, exactly like
// createTenantTokenProvider's own internal cache: a card callback has a
// three second budget and cannot afford to re-read env vars or re-exchange a
// token on every click. Constructed lazily (only when a VOC action actually
// arrives) so a missing Bitable env var never breaks the nine demo actions,
// which never touch it.
let bitableClient: BitableClient | null = null;
function getBitableClient(): BitableClient {
  if (!bitableClient) {
    const botEnv = readBotEnv();
    const bitableEnv = readBitableEnv();
    const tokenProvider = createTenantTokenProvider(
      botEnv.appId,
      botEnv.appSecret,
    );
    bitableClient = createBitableClient(bitableEnv, tokenProvider);
  }
  return bitableClient;
}

// The single dispatch point for every card click, demo or real: a VOC action
// carries a real record id and operator identity and goes through the triple
// check (Task 12); the nine demo actions keep using the untouched, synchronous
// demo resolver.
//
// The Bitable client arrives as a parameter so this dispatcher — the exact
// code production runs — can be driven end to end over a fake Bitable
// boundary. Replacing this function with a stub in tests is what let the
// missing note reach production: the route's own tests never saw the call it
// actually makes.
export function createResolveAction(
  bitable: () => VocActionBitable,
): (input: CardActionRequest) => Promise<CardActionResult> {
  return async function resolveAction(input) {
    if (isVocCardAction(input.action)) {
      return resolveVocCardAction({
        action: input.action,
        recordId: input.recordId,
        operatorOpenId: input.operatorOpenId,
        note: input.note,
        bitable: bitable(),
      });
    }
    return resolveCardAction(input.action);
  };
}

const defaultDependencies: FeishuEventRouteDependencies = {
  readEnv: () => readBotEnv(),
  parseEvent: parseFeishuEvent,
  createReply: createBotReply,
  createWelcome: createWelcomeMessage,
  replyMessage: replyToFeishuMessage,
  sendMessage: sendFeishuMessage,
  resolveAction: createResolveAction(getBitableClient),
  schedule: (task) => after(task),
  reportFailure: () => console.error("[onecare-bot] reply_failed"),
};

function json(data: object, status = 200): Response {
  return Response.json(data, { status });
}

export function createFeishuEventRoute(
  dependencies: FeishuEventRouteDependencies = defaultDependencies,
) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const env = dependencies.readEnv();
      const rawBody = await request.text();
      const outcome = await dependencies.parseEvent({
        rawBody,
        headers: request.headers,
        env,
      });

      if (outcome.kind === "challenge") {
        return json({ challenge: outcome.challenge });
      }
      if (outcome.kind === "unauthorized") {
        return json({ error: "unauthorized" }, 403);
      }
      if (outcome.kind === "ignored") {
        return json({});
      }
      if (outcome.kind === "invalid_card_action") {
        return json({
          toast: { type: "info", content: "暂不支持该操作" },
        });
      }

      if (outcome.kind === "entered") {
        dependencies.schedule(async () => {
          try {
            await dependencies.sendMessage({
              env,
              chatId: outcome.chatId,
              message: dependencies.createWelcome(),
            });
          } catch {
            dependencies.reportFailure();
          }
        });
        return json({});
      }

      if (outcome.kind === "card_action") {
        let result: CardActionResult;
        try {
          result = await dependencies.resolveAction({
            action: outcome.action,
            recordId: outcome.recordId,
            operatorOpenId: outcome.operatorOpenId,
            note: outcome.note,
          });
        } catch {
          return json({
            toast: { type: "error", content: "操作未完成，请稍后重试" },
          });
        }
        if (result.kind === "update") {
          return json(result.response);
        }

        dependencies.schedule(async () => {
          try {
            await dependencies.sendMessage({
              env,
              chatId: outcome.chatId,
              message: result.message,
            });
          } catch {
            dependencies.reportFailure();
          }
        });
        return json({ toast: { type: "info", content: result.toast } });
      }

      const reply = dependencies.createReply(outcome.text);
      dependencies.schedule(async () => {
        try {
          await dependencies.replyMessage({
            env,
            messageId: outcome.messageId,
            message: reply.message,
          });
        } catch {
          dependencies.reportFailure();
        }
      });
      return json({});
    } catch {
      return json({ error: "configuration_unavailable" }, 503);
    }
  };
}

export const POST = createFeishuEventRoute();
