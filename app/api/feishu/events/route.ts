import { after } from "next/server";

import { createBotReply, type BotReply } from "../../../../src/features/feishu-bot/bot-script";
import { replyToFeishuMessage } from "../../../../src/features/feishu-bot/client";
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
  replyMessage: (input: {
    env: BotEnv;
    messageId: string;
    text: string;
  }) => Promise<void>;
  schedule: Scheduler;
  reportFailure: () => void;
};

const defaultDependencies: FeishuEventRouteDependencies = {
  readEnv: () => readBotEnv(),
  parseEvent: parseFeishuEvent,
  createReply: createBotReply,
  replyMessage: replyToFeishuMessage,
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

      const reply = dependencies.createReply(outcome.text);
      dependencies.schedule(async () => {
        try {
          await dependencies.replyMessage({
            env,
            messageId: outcome.messageId,
            text: reply.text,
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
