// One event, two channels. Everything that hands work to a person goes through here.
//
// The console's inbox and the bot's message are written from the same copy (messages.ts)
// in the same call, so they cannot disagree about what happened — and a failure in either
// one is contained: a Feishu outage must not stop the ticket being handed over, and a
// database that will not take the row must not stop the person being told.

import { insertNotification } from "../store/notifications";
import { sendFeishuMessage } from "../feishu-bot/client";
import { createTextMessage } from "../feishu-bot/cards";
import { readBotEnv } from "../../lib/env";
import {
  notificationCopy,
  notificationText,
  type NotificationKind,
  type NotificationSubject,
} from "./messages";

export type NotifyInput = Readonly<{
  kind: NotificationKind;
  // Empty is a real case: 建单 with no resolvable owner has nobody to tell, and this is
  // the last place that can notice rather than sending a message into the void.
  openId: string;
  recordId: string;
  subject: NotificationSubject;
  // False when a richer card for this very event is already on its way — 建单 pushes the
  // ticket card, 派工 pushes the task card. A plain text repeat would give the recipient
  // two messages and two places to click, one of which does less.
  sendFeishuText: boolean;
}>;

export type NotifyDependencies = Readonly<{
  insert: (input: {
    openId: string;
    kind: NotificationKind;
    recordId: string;
    recordNumber: string;
    title: string;
    body: string;
    href: string;
  }) => Promise<void>;
  send: (openId: string, text: string) => Promise<void>;
  // The console link the notification points at. Injected because the origin differs
  // between local and production and this module has no business reading env.
  ticketHref: (recordNumber: string) => string;
}>;

// Never throws. A notification is a side effect of work that already happened — the
// ticket has been assigned, the engineer has been dispatched — so a failure here is
// logged and dropped rather than turned into a failed request that invites the operator
// to click again and hand the ticket over twice.
export async function notify(
  input: NotifyInput,
  dependencies: NotifyDependencies,
): Promise<void> {
  if (input.openId.trim().length === 0) return;

  const copy = notificationCopy(input.kind, input.subject);
  const href = dependencies.ticketHref(input.subject.recordNumber);

  await Promise.all([
    dependencies
      .insert({
        openId: input.openId,
        kind: input.kind,
        recordId: input.recordId,
        recordNumber: input.subject.recordNumber,
        title: copy.title,
        body: copy.body,
        href,
      })
      .catch((error: unknown) => {
        console.error(
          "Notification insert failed:",
          error instanceof Error ? error.message : String(error),
        );
      }),
    input.sendFeishuText
      ? dependencies
          .send(input.openId, notificationText(input.kind, input.subject, href))
          .catch((error: unknown) => {
            console.error(
              "Notification send failed:",
              error instanceof Error ? error.message : String(error),
            );
          })
      : Promise.resolve(),
  ]);
}

// ---------------------------------------------------------------------------

// The production wiring, in one place so every call site notifies identically.
export function defaultNotifyDependencies(): NotifyDependencies {
  return {
    insert: insertNotification,
    send: (openId, text) =>
      sendFeishuMessage({
        env: readBotEnv(),
        openId,
        message: createTextMessage(text),
      }),
    ticketHref: (recordNumber) => {
      const origin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? "https://onecare.ohmyfeishu.top";
      return `${origin}/workbench/tickets/${encodeURIComponent(recordNumber)}`;
    },
  };
}
