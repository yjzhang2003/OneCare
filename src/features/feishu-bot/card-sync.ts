// 三边同步：一次状态推进之后，把这条工单发出去的每一张卡片都重画一遍。
//
// The problem this solves is visible in any two-person demo: the 客服 confirms
// closure in the console, and the engineer's 上门任务卡 still says 上门中 with a
// live 回填处理结果 button on it, while the war room shows a third version. A card
// callback can only redraw the card that was clicked; every other surface is a
// separate message that keeps whatever it was rendered with.
//
// So each surface is redrawn from the record as it is now, for the audience that
// holds it: the owner and the war room get the ticket card (the war room's is
// untruncated, the way it was posted), the engineer gets the task card with the
// dispatch context that was stored beside its message id. Nothing here decides
// permissions — the card builders already omit buttons a given audience must not
// have, and every button is re-checked server-side when it is pressed.

import {
  createEngineerTaskCard,
  createVocTicketCard,
  type VocTicketCardRecord,
} from "./cards";
import type { FeishuCard } from "./card-types";
import type { VocRecord } from "../bitable/field-map";
import type { CardAudience, TicketCard } from "../store/ticket-cards";

export type CardSyncDependencies = Readonly<{
  listCards: (recordId: string) => Promise<readonly TicketCard[]>;
  getRecord: (recordId: string) => Promise<VocRecord | null>;
  patch: (messageId: string, card: FeishuCard) => Promise<void>;
  // 人员管理's 工程师 rows, so a redrawn 客服 card keeps its 派单 buttons. Optional:
  // without it the card is still correct, just missing the shortcut.
  listEngineers?: () => Promise<readonly Readonly<{ openId: string; name: string }>[]>;
}>;

export type CardSyncResult = Readonly<{
  patched: number;
  failed: number;
}>;

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function recurrenceOf(value: unknown): Readonly<{
  level: string;
  headline: string;
  actions: readonly string[];
  producedBy: string;
}> | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const actions = Array.isArray(raw.actions)
    ? raw.actions.filter((item): item is string => typeof item === "string")
    : [];
  return {
    level: str(raw.level, "—"),
    headline: str(raw.headline),
    actions,
    producedBy: str(raw.producedBy),
  };
}

// The ticket card and the engineer card take the same tag block; both read it off
// the record rather than re-running any analysis.
function tagOf(record: VocRecord) {
  return {
    summary: record.summary,
    polarity: record.polarity ?? "—",
    dimensions: record.dimensions,
    replies: record.replies,
  };
}

function cardRecord(record: VocRecord): VocTicketCardRecord {
  return {
    recordId: record.recordId,
    recordNumber: record.recordNumber,
    channel: record.channel,
    category: record.category,
    content: record.content,
    feedbackAt: record.feedbackAt,
    state: record.state,
    severity: record.severity,
  };
}

export function renderForAudience(
  audience: CardAudience,
  record: VocRecord,
  payload: Readonly<Record<string, unknown>>,
  engineers: readonly Readonly<{ openId: string; name: string }>[] = [],
): FeishuCard {
  if (audience === "engineer") {
    return createEngineerTaskCard({
      record: cardRecord(record),
      tag: tagOf(record),
      dispatcherName: str(payload.dispatcherName, "—"),
      model: str(payload.model, record.model),
      userRef: str(payload.userRef, record.userRef),
      deviceRef: str(payload.deviceRef, record.deviceRef),
      deviceTotal: num(payload.deviceTotal),
      deviceOpen: num(payload.deviceOpen),
      recurrence: recurrenceOf(payload.recurrence),
    });
  }

  // The war room's copy was posted untruncated on purpose — everyone in that
  // group was added to work this one ticket — so its redraw keeps that.
  return createVocTicketCard(cardRecord(record), tagOf(record), {
    fullContent: audience === "war_room",
    engineers,
  });
}

// Never throws. This runs after a transition that has already been written and
// already been answered; a card that fails to redraw is a stale card, not a
// failed transition, and it must not turn a successful click into an error.
export async function syncTicketCards(
  recordId: string,
  dependencies: CardSyncDependencies,
  // The card that was just redrawn by the callback itself, if any. Patching it a
  // second time would spend one of the two updates that callback token allows.
  skipMessageId?: string,
): Promise<CardSyncResult> {
  let patched = 0;
  let failed = 0;

  try {
    const cards = await dependencies.listCards(recordId);
    if (cards.length === 0) return { patched, failed };

    const record = await dependencies.getRecord(recordId);
    if (!record) return { patched, failed };

    // One roster read for the whole sync, and only when a card on this ticket could
    // carry 派单 buttons at all.
    const engineers = await (dependencies.listEngineers?.().catch(() => []) ?? []);

    for (const card of cards) {
      if (card.messageId.length === 0 || card.messageId === skipMessageId) {
        continue;
      }
      try {
        await dependencies.patch(
          card.messageId,
          renderForAudience(card.audience, record, card.payload, engineers),
        );
        patched += 1;
      } catch {
        // Counted, not deleted. A network blip and a message that can no longer
        // be edited look identical from here, and discarding a live card's id on
        // the first failure would silently stop syncing a card that was fine.
        // The cost of keeping a dead id is one failed call per transition.
        failed += 1;
      }
    }
  } catch {
    // listCards/getRecord already swallow their own failures; this is the last
    // net so a sync can never surface as a failed user action.
  }

  return { patched, failed };
}
