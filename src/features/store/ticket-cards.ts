// 卡片登记簿：一条工单发出去过哪些卡片，各自的 message_id 是什么。
//
// A Feishu card can only be redrawn by whoever holds its message id, and a card
// callback can redraw exactly one card — the one that was clicked. Without this
// table the other two surfaces are unreachable: the 客服 closes a ticket from the
// console and the engineer's 上门任务卡 keeps showing 上门中 forever, with a live
// button on it. Keyed by message id because that is what the update call takes;
// indexed by record so a transition can find every card it has to catch up.
//
// `payload` carries whatever a card needs beyond the record itself — the engineer
// card's dispatcher name and device history, which are not columns on the ticket
// and would otherwise have to be re-derived (or re-fetched) on every redraw.

import { getSql } from "./records";

export const CARD_AUDIENCES = ["owner", "engineer", "war_room"] as const;
export type CardAudience = (typeof CARD_AUDIENCES)[number];

export type TicketCard = Readonly<{
  messageId: string;
  recordId: string;
  audience: CardAudience;
  payload: Readonly<Record<string, unknown>>;
}>;

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS ticket_cards (
  message_id TEXT PRIMARY KEY,
  record_id  TEXT NOT NULL,
  audience   TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const CREATE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_ticket_cards_record ON ticket_cards (record_id, created_at DESC);`,
];

let ensured: Promise<void> | null = null;

export function ensureTicketCardsTable(): Promise<void> {
  ensured ??= (async () => {
    const sql = getSql();
    await sql.query(CREATE_TABLE);
    for (const statement of CREATE_INDEXES) {
      await sql.query(statement);
    }
  })().catch((error: unknown) => {
    ensured = null;
    throw error;
  });
  return ensured;
}

// Never throws: a card that was delivered but not written down is a card that
// will not update later, which is strictly better than a delivery that reports
// failure because bookkeeping failed after the message was already sent.
export async function rememberTicketCard(
  input: Readonly<{
    messageId: string | null;
    recordId: string;
    audience: CardAudience;
    payload?: Readonly<Record<string, unknown>>;
  }>,
): Promise<void> {
  if (!input.messageId) return;
  try {
    await ensureTicketCardsTable();
    await getSql().query(
      `INSERT INTO ticket_cards (message_id, record_id, audience, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (message_id) DO NOTHING`,
      [
        input.messageId,
        input.recordId,
        input.audience,
        JSON.stringify(input.payload ?? {}),
      ],
    );
  } catch {
    // Deliberately silent — see the comment above.
  }
}

function audienceOf(value: unknown): CardAudience {
  return CARD_AUDIENCES.includes(value as CardAudience)
    ? (value as CardAudience)
    : "owner";
}

export async function listTicketCards(
  recordId: string,
): Promise<readonly TicketCard[]> {
  try {
    await ensureTicketCardsTable();
    const rows = await getSql().query(
      `SELECT message_id, record_id, audience, payload
         FROM ticket_cards WHERE record_id = $1 ORDER BY created_at ASC`,
      [recordId],
    );
    return (rows as unknown as ReadonlyArray<Record<string, unknown>>).map((row) => ({
      messageId: String(row.message_id ?? ""),
      recordId: String(row.record_id ?? ""),
      audience: audienceOf(row.audience),
      payload:
        typeof row.payload === "object" && row.payload !== null
          ? (row.payload as Record<string, unknown>)
          : {},
    }));
  } catch {
    return [];
  }
}

// Called when Feishu says the message is gone (recalled, or older than the
// update window). Keeping a dead id would mean retrying it on every transition
// for the life of the ticket.
export async function forgetTicketCard(messageId: string): Promise<void> {
  try {
    await ensureTicketCardsTable();
    await getSql().query(`DELETE FROM ticket_cards WHERE message_id = $1`, [
      messageId,
    ]);
  } catch {
    // Same reasoning as rememberTicketCard.
  }
}
