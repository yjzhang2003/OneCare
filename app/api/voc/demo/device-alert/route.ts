import { getCurrentSession } from "../../../../../src/features/auth/current-session";
import { isGuest, refuseGuestWrite } from "../../../../../src/features/auth/guest";
import type { AuthUser } from "../../../../../src/features/auth/types";
import { createProfileInsightCard } from "../../../../../src/features/feishu-bot/cards";
import type { FeishuCard } from "../../../../../src/features/feishu-bot/card-types";
import { sendFeishuMessage } from "../../../../../src/features/feishu-bot/client";
import {
  defaultNotifyDependencies,
  notify,
  type NotifyInput,
} from "../../../../../src/features/notify/deliver";
import {
  ruleBasedProvider,
  type ProfileInsight,
  type ProfileInsightProvider,
} from "../../../../../src/features/profiles/insight";
import {
  readIdentityResponderOpenIds,
  readIdentityRecords,
  readProfile,
  readProfiles,
} from "../../../../../src/features/store/workbench-query";
import type { WorkbenchTicket } from "../../../../../src/features/workbench/data";
import type { IdentityProfile } from "../../../../../src/features/workbench/profiles";
import { parseWorkbenchQuery } from "../../../../../src/features/workbench/query";
import { readBotEnv } from "../../../../../src/lib/env";

// 设备异常预警的触发口。
//
// The recurrence analysis has always existed on 设备追踪, but somebody had to go looking
// for it — which is the wrong way round for an alert. This pushes it: the device with the
// worst recurrence right now is analysed and sent to whoever is already working its open
// tickets, as a card in Feishu and a row in 消息, from which the ordinary chain continues
// (open the device → 拉群 or 派工).
//
// There is no IoT telemetry behind it and the response says so: the signal is this
// device's own VOC history — how many times it came back, how close together, and on
// which dimension.
export const maxDuration = 60;

export type DeviceAlertDependencies = Readonly<{
  session: () => Promise<AuthUser | null>;
  // The repeat-device list, ordered the way 设备追踪 orders it, so "the worst one right
  // now" is the same device an operator would see at the top.
  candidates: () => Promise<readonly IdentityProfile[]>;
  getProfile: (id: string) => Promise<IdentityProfile | null>;
  getRecords: (id: string) => Promise<readonly WorkbenchTicket[]>;
  getOwnerOpenIds: (id: string) => Promise<readonly string[]>;
  provider: ProfileInsightProvider;
  sendCard: (openId: string, card: FeishuCard) => Promise<void>;
  notify: (input: NotifyInput) => Promise<void>;
  now: () => number;
}>;

const TERMINAL = new Set(["已闭环", "无需跟进"]);

export function createDeviceAlertRoute(dependencies: DeviceAlertDependencies) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const user = await dependencies.session();
      if (!user) {
        return Response.json(
          { error: "unauthorized", message: "登录已过期，请重新进入工作台" },
          { status: 401 },
        );
      }
      if (isGuest(user)) return refuseGuestWrite();

      const asked = new URL(request.url).searchParams.get("device")?.trim() ?? "";
      const deviceRef =
        asked.length > 0 ? asked : ((await dependencies.candidates())[0]?.id ?? "");
      if (deviceRef.length === 0) {
        return Response.json(
          { error: "not_found", message: "没有找到重复报修的设备" },
          { status: 404 },
        );
      }

      const [profile, records, owners] = await Promise.all([
        dependencies.getProfile(deviceRef),
        dependencies.getRecords(deviceRef),
        dependencies.getOwnerOpenIds(deviceRef),
      ]);
      if (!profile) {
        return Response.json(
          { error: "not_found", message: "找不到这个设备标识" },
          { status: 404 },
        );
      }

      const insight: ProfileInsight = await dependencies.provider.analyze({
        kind: "device",
        profile,
        records,
        now: dependencies.now(),
      });

      const open = records.filter(
        (record) => record.ticketOpenedAt !== null && !TERMINAL.has(record.state),
      );
      // Whoever is already working this device's open tickets, plus the person who
      // triggered it — an alert nobody receives is not an alert.
      const recipients = [...new Set([...owners, user.openId])].filter(
        (openId) => openId.trim().length > 0,
      );

      const card = createProfileInsightCard({
        kind: "device",
        id: deviceRef,
        level: insight.level,
        headline: insight.headline,
        labels: insight.labels,
        signals: insight.signals,
        actions: insight.actions,
        producedBy: insight.producedBy,
        openTicketNumbers: open.map((record) => record.recordNumber),
      });

      let delivered = 0;
      for (const openId of recipients) {
        try {
          await dependencies.sendCard(openId, card);
          delivered += 1;
        } catch {
          // One unreachable recipient must not stop the others.
        }
        await dependencies.notify({
          kind: "device_alert",
          openId,
          recordId: open[0]?.recordId ?? "",
          sendFeishuText: false,
          subject: {
            recordNumber: deviceRef,
            channel: "设备追踪",
            category: profile.categories[0] ?? "",
            summary: insight.headline,
            content: insight.signals.join("；"),
            severity: insight.level,
            state: `${records.length} 条反馈 / ${open.length} 条未闭环`,
            actorName: "",
          },
        });
      }

      return Response.json({
        ok: true,
        deviceRef,
        level: insight.level,
        headline: insight.headline,
        delivered,
        href: `/?section=devices&device=${encodeURIComponent(deviceRef)}&queue=all`,
        message: `已推送 ${deviceRef} 的设备预警（${insight.level}），${delivered} 人收到`,
      });
    } catch {
      return Response.json(
        { error: "internal", message: "服务暂时不可用，请稍后重试" },
        { status: 500 },
      );
    }
  };
}

export const POST = createDeviceAlertRoute({
  session: getCurrentSession,
  candidates: async () => (await readProfiles("device", parseWorkbenchQuery({}))).profiles,
  getProfile: (id) => readProfile("device", id),
  getRecords: (id) => readIdentityRecords("device", id),
  getOwnerOpenIds: (id) => readIdentityResponderOpenIds("device", id),
  provider: ruleBasedProvider,
  sendCard: (openId, card) =>
    sendFeishuMessage({
      env: readBotEnv(),
      openId,
      message: { msgType: "interactive", content: JSON.stringify(card) },
    }),
  notify: (input) => notify(input, defaultNotifyDependencies()),
  now: () => Date.now(),
});
