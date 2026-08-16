// The production wiring for syncTicketCards, in one place so every transition
// path catches the other surfaces up identically.
//
// Separate from card-sync.ts because that module is pure — it renders cards from
// a record and hands them to a patcher — while this one reaches for the mirror,
// the card registry and the bot credentials. readBotEnv() is called per patch
// rather than hoisted, the same discipline every other bot call site follows: a
// missing credential must surface as one stale card, never as a failed import.

import { patchFeishuCard } from "./client";
import { syncTicketCards, type CardSyncDependencies, type CardSyncResult } from "./card-sync";
import { readRecordById } from "../store/records";
import { listTicketCards } from "../store/ticket-cards";
import { readBotEnv } from "../../lib/env";

export function defaultCardSyncDependencies(): CardSyncDependencies {
  return {
    listCards: listTicketCards,
    // The mirror, not the Bitable: this runs immediately after a write that
    // landed in the mirror first, so it is the copy that already reflects the
    // transition being broadcast.
    getRecord: readRecordById,
    patch: (messageId, card) =>
      patchFeishuCard({ env: readBotEnv(), messageId, card }),
  };
}

// Fire-and-forget by design: the caller has already written the transition and
// already answered the operator. Awaiting this would add a Feishu round trip per
// card to a response that is otherwise done, and failing it would report an
// error for work that succeeded.
export function syncTicketCardsInBackground(
  recordId: string,
  skipMessageId?: string,
): Promise<CardSyncResult> {
  return syncTicketCards(
    recordId,
    defaultCardSyncDependencies(),
    skipMessageId,
  );
}
