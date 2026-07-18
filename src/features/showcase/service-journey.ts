export type ServiceJourneyStage =
  | "detected"
  | "selfHelp"
  | "selfResolved"
  | "serviceRequested"
  | "workOrderCreated"
  | "partsConfirmed"
  | "serviceCompleted"
  | "improvementCreated";

export type ServiceJourneyState = Readonly<{
  stage: ServiceJourneyStage;
  customerReply: string | null;
}>;

export type ServiceJourneyAction =
  | Readonly<{ type: "answerDiagnosis"; reply: string }>
  | Readonly<{ type: "markSelfResolved" }>
  | Readonly<{ type: "requestHumanService" }>
  | Readonly<{ type: "createWorkOrder" }>
  | Readonly<{ type: "confirmParts" }>
  | Readonly<{ type: "completeService" }>
  | Readonly<{ type: "createImprovementTask" }>
  | Readonly<{ type: "resetJourney" }>;

export const initialServiceJourneyState: ServiceJourneyState = {
  stage: "detected",
  customerReply: null,
};

const workOrderStages = new Set<ServiceJourneyStage>([
  "workOrderCreated",
  "partsConfirmed",
  "serviceCompleted",
  "improvementCreated",
]);

const confirmedPartStages = new Set<ServiceJourneyStage>([
  "partsConfirmed",
  "serviceCompleted",
  "improvementCreated",
]);

const completedServiceStages = new Set<ServiceJourneyStage>([
  "serviceCompleted",
  "improvementCreated",
]);

export function serviceJourneyReducer(
  state: ServiceJourneyState,
  action: ServiceJourneyAction,
): ServiceJourneyState {
  if (action.type === "resetJourney") {
    return initialServiceJourneyState;
  }

  if (action.type === "answerDiagnosis" && state.stage === "detected") {
    return { stage: "selfHelp", customerReply: action.reply };
  }

  if (action.type === "markSelfResolved" && state.stage === "selfHelp") {
    return { ...state, stage: "selfResolved" };
  }

  if (action.type === "requestHumanService" && state.stage === "selfHelp") {
    return { ...state, stage: "serviceRequested" };
  }

  if (action.type === "createWorkOrder" && state.stage === "serviceRequested") {
    return { ...state, stage: "workOrderCreated" };
  }

  if (action.type === "confirmParts" && state.stage === "workOrderCreated") {
    return { ...state, stage: "partsConfirmed" };
  }

  if (action.type === "completeService" && state.stage === "partsConfirmed") {
    return { ...state, stage: "serviceCompleted" };
  }

  if (
    action.type === "createImprovementTask" &&
    state.stage === "serviceCompleted"
  ) {
    return { ...state, stage: "improvementCreated" };
  }

  return state;
}

export const journeyHasWorkOrder = (state: ServiceJourneyState) =>
  workOrderStages.has(state.stage);

export const journeyHasConfirmedParts = (state: ServiceJourneyState) =>
  confirmedPartStages.has(state.stage);

export const journeyHasCompletedService = (state: ServiceJourneyState) =>
  completedServiceStages.has(state.stage);

export const journeyHasImprovementTask = (state: ServiceJourneyState) =>
  state.stage === "improvementCreated";
