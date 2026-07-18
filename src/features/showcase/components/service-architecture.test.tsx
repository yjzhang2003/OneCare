import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  architectureLayers,
  closedLoopSteps,
  connectedSystems,
  decisionPaths,
  pilotTargets,
  rolloutStages,
  serviceIdentities,
} from "../content";
import { PilotTargets } from "./pilot-targets";
import {
  ServiceArchitectureOverview,
  ServiceLoopMechanism,
} from "./service-architecture";

afterEach(cleanup);

describe("ServiceArchitecture", () => {
  it("renders the unified event and three architecture layers", () => {
    render(
      <ServiceArchitectureOverview
        identities={serviceIdentities}
        layers={architectureLayers}
        systems={connectedSystems}
      />,
    );

    expect(
      screen.getByRole("region", { name: "万护 OneCare 三层闭环架构" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "统一服务事件" })).toBeInTheDocument();
    expect(screen.getByText("用户 ID")).toBeInTheDocument();
    expect(screen.queryByText(/USER ID|DEVICE ID|SERVICE EVENT ID/)).not.toBeInTheDocument();
    expect(screen.getByAltText("海信爱家官方应用标识")).toBeInTheDocument();

    const layers = screen.getByRole("list", { name: "万护 OneCare 三层架构" });
    expect(within(layers).getAllByRole("heading", { level: 4 })).toHaveLength(3);
  });

  it("renders governed decision paths and the five-step loop", () => {
    render(
      <ServiceLoopMechanism
        decisions={decisionPaths}
        loopSteps={closedLoopSteps}
      />,
    );

    expect(screen.getByText("复杂、低置信度或高风险")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "人工审核后执行" })).toBeInTheDocument();

    const loop = screen.getByRole("list", { name: "万护 OneCare 服务闭环" });
    expect(within(loop).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText(/计划持续追踪派单、备件、上门、维修和回访/)).toBeInTheDocument();
  });
});

describe("PilotTargets", () => {
  it("labels every metric as an unmeasured pilot target", () => {
    render(<PilotTargets stages={rolloutStages} targets={pilotTargets} />);

    expect(screen.getByRole("heading", { name: "6 个月试点目标" })).toBeInTheDocument();
    expect(
      screen.getByText(/不代表已经取得的生产结果/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/实际基线和测量口径待试点启动前确认/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("试点目标")).toHaveLength(4);
    expect(screen.getByText("降低 30%–50%")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "轻量开始，验证后逐步推广" }),
    ).toBeInTheDocument();
  });
});
