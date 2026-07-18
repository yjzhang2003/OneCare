import { after } from "next/server";

import {
  createBotReply,
  type BotReply,
} from "../../../../src/features/feishu-bot/bot-script";
import {
  resolveCardAction,
  type CardActionResult,
} from "../../../../src/features/feishu-bot/card-actions";
import type {
  FeishuOutboundMessage,
  OneCareCardAction,
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
import { readBotEnv, type BotEnv } from "../../../../src/lib/env";

export const runtime = "nodejs";
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
  resolveAction: (action: OneCareCardAction) => CardActionResult;
  schedule: Scheduler;
  reportFailure: () => void;
};

const defaultDependencies: FeishuEventRouteDependencies = {
  readEnv: () => readBotEnv(),
  parseEvent: parseFeishuEvent,
  createReply: createBotReply,
  createWelcome: createWelcomeMessage,
  replyMessage: replyToFeishuMessage,
  sendMessage: sendFeishuMessage,
  resolveAction: resolveCardAction,
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
        const result = dependencies.resolveAction(outcome.action);
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
