// Whether a record can be handed to the tagging pipeline right now, and if not, why.
//
// One module because two places need the same answer and must not disagree about it:
// the AI 分析 card, which decides whether to offer 立即分析 or explain its absence,
// and the route behind that button, which must refuse a request the UI would not have
// sent. A browser can post whatever it likes; the route is where the refusal counts,
// and the card is where it is legible.
//
// The tagging pipeline only ever knew how to start from 待分析 — buildTaggedWrite
// computes 待分析 -> 已分析 -> {待跟进|无需跟进} through transition(), and a record
// arriving in any other state falls through every one of those transitions and gets
// its AI fields written while its 流程状态 stays put. That is why 分析失败 is routed
// through the real 重试 transition here rather than simply being allowed: 重试 is what
// makes it 待分析, and it is also what enforces the retry ceiling.

import {
  transition,
  type VocState,
} from "../voc/service-event";

export type AnalyzeSubject = Readonly<{
  state: VocState;
  retryCount: number;
}>;

export type AnalyzeEligibility =
  // `state` is the state the shard must see, which is not always the record's own:
  // a 分析失败 record is presented to the pipeline as 待分析, exactly as
  // buildPendingShard does for the Cron path.
  | Readonly<{ kind: "ready"; state: VocState }>
  | Readonly<{ kind: "refused"; reason: string }>;

export function analyzeEligibility(subject: AnalyzeSubject): AnalyzeEligibility {
  if (subject.state === "待分析") return { kind: "ready", state: "待分析" };

  if (subject.state === "分析失败") {
    // The same call buildPendingShard makes, for the same reason: the retry ceiling
    // is the state machine's rule, not this feature's, and a record that has burned
    // its attempts must not be retaken by hand either.
    const retry = transition(subject.state, "重试", {
      retryCount: subject.retryCount,
      hasOwner: false,
    });
    if (retry.kind === "ok") return { kind: "ready", state: retry.next };
    // "noop" is the idempotent-replay answer for a record already back at 待分析,
    // which the branch above has already handled — it cannot be reached from 分析失败.
    // Reported rather than silently treated as ready: a state machine that starts
    // answering differently should surface here, not tag a record from a state the
    // pipeline cannot start from.
    return {
      kind: "refused",
      reason: retry.kind === "rejected" ? retry.reason : "该工单当前不能重新分析",
    };
  }

  // Everything from 已分析 onward has been tagged once and may since have been
  // claimed, followed up and closed by a person. Re-running the pipeline over it
  // would overwrite that AI verdict and re-resolve its owner from the routing rules,
  // discarding a human's work — so this refuses rather than offering a button whose
  // effect nobody asked for.
  return {
    kind: "refused",
    reason: `${subject.state}的工单已经打过标，重新分析会覆盖现有结论`,
  };
}
