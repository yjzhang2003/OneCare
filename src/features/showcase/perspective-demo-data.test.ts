import { describe, expect, it } from "vitest";

import {
  agentDemo,
  customerDemo,
  engineerDemo,
  serviceCase,
  vocTopics,
} from "./perspective-demo-data";

describe("perspective demo data", () => {
  it("keeps every role on one deterministic service case", () => {
    expect(serviceCase.id).toBe("OC-240718-037");
    expect(serviceCase.currentTemperature).toBe(9);
    expect(serviceCase.targetTemperature).toBe(4);
    expect(customerDemo.caseId).toBe(serviceCase.id);
    expect(agentDemo.caseId).toBe(serviceCase.id);
    expect(engineerDemo.caseId).toBe(serviceCase.id);
    expect(vocTopics[0].relatedCaseId).toBe(serviceCase.id);
  });
});
