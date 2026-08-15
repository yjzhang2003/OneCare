import type { VocRecord } from "../bitable/field-map";

// Feishu renders an @-mention inside a group message's text as literal
// placeholder text — "@_user_1" for a real member, "@OneCare" for the bot
// itself — immediately followed by whatever the sender actually typed. A
// question handed to the skill verbatim would start with that placeholder
// instead of the question, and a message that is nothing but a mention (no
// question at all) has to come back as "" rather than as whitespace: the
// caller uses exactly that emptiness to decide not to call the model at all,
// instead of sending it a blank question and getting a hallucinated reply.
//
// Loops rather than a single regex because Feishu can chain more than one
// mention ("@user1 @user2 问题") ahead of the real text.
export function stripMention(text: string): string {
  let remainder = text;
  while (/^@\S+/.test(remainder)) {
    remainder = remainder.replace(/^@\S+\s*/, "");
  }
  return remainder.trim();
}

export type FactsAggregates = Readonly<{
  sameDimension: Readonly<{ total: number; closed: number }>;
  sameModel: number;
  // 这台机器修过几次 is the first question anyone asks in a war room, and until this
  // was in the facts the honest answer the skill gave was "我不知道". Zero when the
  // record carries no 设备标识 — there is no machine to count.
  sameDevice?: Readonly<{ total: number; open: number }>;
}>;

export type BuildAnswerFactsInput = Readonly<{
  ticket: VocRecord;
  sameDimension: Readonly<{ total: number; closed: number }>;
  sameModel: number;
  sameDevice?: Readonly<{ total: number; open: number }>;
}>;

// The only two things the answering skill is ever shown: the ticket itself
// and two aggregate counts. `recordId` and `warRoomChatId` are deliberately
// dropped from the ticket before it travels — the answer lands back in the
// very group `warRoomChatId` names, and a Bitable record id has no business
// appearing in a human conversation; at best it's noise, at worst it's an
// internal identifier leaking into a chat transcript.
//
// Returned as a JSON string, not handed over as an object: aily's custom
// skill parameters are scalars only (String / Boolean / Float / Integer — no
// array, no object, confirmed against the live skill editor on 2026-08-11),
// so `facts` has to already be text by the time createAnswerProvider sends
// it.
export function buildAnswerFacts(input: BuildAnswerFactsInput): string {
  const { recordId: _recordId, warRoomChatId: _warRoomChatId, ...ticketFacts } =
    input.ticket;

  return JSON.stringify({
    ticket: ticketFacts,
    aggregates: {
      sameDimensionLast7Days: input.sameDimension.total,
      sameDimensionClosed: input.sameDimension.closed,
      sameModelTotal: input.sameModel,
      // Named for what it is: every feedback ever recorded against this same machine,
      // and how many of those are still open.
      sameDeviceTotal: input.sameDevice?.total ?? 0,
      sameDeviceOpen: input.sameDevice?.open ?? 0,
    },
  });
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Turns the full VOC table into the two numbers the answering skill is
// allowed to cite (spec §6.1 step 3): how many other feedbacks share a 问题
// 维度 with this ticket in the last seven days — and how many of those are
// already 已闭环 — plus how many rows in the whole table share this ticket's
// 机型. A ticket with no dimension tags or a blank model has nothing to
// compare against, so both come back zero instead of matching every other
// blank-dimension or blank-model row in the table.
export function computeFactsAggregates(
  ticket: VocRecord,
  records: readonly VocRecord[],
  now: Date = new Date(),
): FactsAggregates {
  const cutoff = now.getTime() - SEVEN_DAYS_MS;
  const dimensions = new Set(ticket.dimensions);

  const recentSameDimension =
    dimensions.size === 0
      ? []
      : records.filter((record) => {
          if (record.feedbackAt === null) return false;
          const feedbackTime = Date.parse(record.feedbackAt);
          return (
            Number.isFinite(feedbackTime) &&
            feedbackTime >= cutoff &&
            record.dimensions.some((dimension) => dimensions.has(dimension))
          );
        });

  const model = ticket.model.trim();
  const sameModel =
    model.length === 0
      ? 0
      : records.filter((record) => record.model.trim() === model).length;

  return {
    sameDimension: {
      total: recentSameDimension.length,
      closed: recentSameDimension.filter((record) => record.state === "已闭环")
        .length,
    },
    sameModel,
  };
}
