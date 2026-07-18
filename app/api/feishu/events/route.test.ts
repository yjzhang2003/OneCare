import { describe, expect, it, vi } from "vitest";

import type { BotEnv } from "../../../../src/lib/env";
import type { FeishuEventOutcome } from "../../../../src/features/feishu-bot/event-handler";
import { createFeishuEventRoute } from "./route";

const env: BotEnv = {
  appId: "cli_onecare",
  appSecret: "server-only-secret",
  verificationToken: "verification-token",
  encryptKey: "12345678901234567890123456789012",
};

function request() {
  return new Request("https://onecare.example/api/feishu/events", {
    method: "POST",
    body: JSON.stringify({ schema: "2.0" }),
    headers: { "content-type": "application/json" },
  });
}

function dependencies(outcome: FeishuEventOutcome) {
  const scheduled: Array<() => Promise<void>> = [];
  return {
    scheduled,
    dependencies: {
      readEnv: vi.fn(() => env),
      parseEvent: vi.fn(async () => outcome),
      createReply: vi.fn((text: string) => ({
        kind: "welcome" as const,
        text: `reply:${text}`,
      })),
      replyMessage: vi.fn(async () => undefined),
      schedule: vi.fn((task: () => Promise<void>) => scheduled.push(task)),
      reportFailure: vi.fn(),
    },
  };
}

describe("POST /api/feishu/events", () => {
  it("returns a URL verification challenge without scheduling work", async () => {
    const setup = dependencies({
      kind: "challenge",
      challenge: "challenge-value",
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      challenge: "challenge-value",
    });
    expect(setup.dependencies.schedule).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callbacks without scheduling work", async () => {
    const setup = dependencies({ kind: "unauthorized" });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(setup.dependencies.schedule).not.toHaveBeenCalled();
  });

  it("acknowledges ignored authentic events", async () => {
    const setup = dependencies({ kind: "ignored" });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
  });

  it("acknowledges a message before the scheduled reply runs", async () => {
    const setup = dependencies({
      kind: "message",
      messageId: "om_message",
      text: "开始体验",
    });

    const response = await createFeishuEventRoute(setup.dependencies)(request());

    expect(response.status).toBe(200);
    expect(setup.dependencies.replyMessage).not.toHaveBeenCalled();
    expect(setup.scheduled).toHaveLength(1);

    await setup.scheduled[0]();

    expect(setup.dependencies.createReply).toHaveBeenCalledWith("开始体验");
    expect(setup.dependencies.replyMessage).toHaveBeenCalledWith({
      env,
      messageId: "om_message",
      text: "reply:开始体验",
    });
  });

  it("reports scheduled reply failures without leaking the exception", async () => {
    const setup = dependencies({
      kind: "message",
      messageId: "om_message",
      text: "开始体验",
    });
    setup.dependencies.replyMessage.mockRejectedValueOnce(
      new Error("private upstream response"),
    );

    await createFeishuEventRoute(setup.dependencies)(request());
    await setup.scheduled[0]();

    expect(setup.dependencies.reportFailure).toHaveBeenCalledWith();
  });
});
