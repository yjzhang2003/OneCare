import { describe, expect, it } from "vitest";

import {
  initialServiceJourneyState,
  serviceJourneyReducer,
} from "./service-journey";

describe("serviceJourneyReducer", () => {
  it("moves one shared case through the complete assisted-service journey", () => {
    let state = serviceJourneyReducer(initialServiceJourneyState, {
      type: "answerDiagnosis",
      reply: "饮料不够凉",
    });

    expect(state).toEqual({
      customerReply: "饮料不够凉",
      stage: "selfHelp",
    });

    for (const action of [
      { type: "requestHumanService" },
      { type: "createWorkOrder" },
      { type: "confirmParts" },
      { type: "completeService" },
      { type: "createImprovementTask" },
    ] as const) {
      state = serviceJourneyReducer(state, action);
    }

    expect(state.stage).toBe("improvementCreated");
    expect(state.customerReply).toBe("饮料不够凉");
  });

  it("ends in selfResolved without opening an assisted-service path", () => {
    const selfHelp = serviceJourneyReducer(initialServiceJourneyState, {
      type: "answerDiagnosis",
      reply: "刚才开始",
    });
    const resolved = serviceJourneyReducer(selfHelp, {
      type: "markSelfResolved",
    });

    expect(resolved.stage).toBe("selfResolved");
    expect(
      serviceJourneyReducer(resolved, { type: "createWorkOrder" }),
    ).toBe(resolved);
  });

  it("rejects actions that skip required stages", () => {
    expect(
      serviceJourneyReducer(initialServiceJourneyState, {
        type: "createWorkOrder",
      }),
    ).toBe(initialServiceJourneyState);
  });

  it("resets every stage and clears the selected reply", () => {
    const selfHelp = serviceJourneyReducer(initialServiceJourneyState, {
      type: "answerDiagnosis",
      reply: "没有异响",
    });

    expect(
      serviceJourneyReducer(selfHelp, { type: "resetJourney" }),
    ).toEqual(initialServiceJourneyState);
  });
});
