"use client";

import { useReducer, useRef, useState } from "react";

import type { Perspective } from "../content";
import {
  initialServiceJourneyState,
  serviceJourneyReducer,
} from "../service-journey";
import { AgentWorkspace } from "./agent-workspace";
import { CustomerWorkspace } from "./customer-workspace";
import { EngineerWorkspace } from "./engineer-workspace";
import { OperationsWorkspace } from "./operations-workspace";

type PerspectiveTabsProps = {
  perspectives: readonly Perspective[];
};

const workspaceIds = ["customer", "agent", "engineer", "operations"] as const;

export function PerspectiveTabs({ perspectives }: PerspectiveTabsProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [journey, dispatch] = useReducer(
    serviceJourneyReducer,
    initialServiceJourneyState,
  );
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  function select(index: number, focus = false) {
    setSelectedIndex(index);
    if (focus) {
      tabs.current[index]?.focus();
    }
  }

  function move(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % perspectives.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + perspectives.length) % perspectives.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = perspectives.length - 1;
    }

    if (nextIndex === undefined) {
      return;
    }

    event.preventDefault();
    select(nextIndex, true);
  }

  return (
    <section className="perspective-showcase">
      <div
        aria-label="万护 OneCare 服务角色"
        className="perspective-tabs"
        role="tablist"
      >
        {perspectives.map((perspective, index) => (
          <button
            aria-controls={`perspective-panel-${index}`}
            aria-selected={index === selectedIndex}
            id={`perspective-tab-${index}`}
            key={perspective.index}
            onClick={() => select(index)}
            onKeyDown={(event) => move(event, index)}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            role="tab"
            tabIndex={index === selectedIndex ? 0 : -1}
            type="button"
          >
            <span aria-hidden="true">{perspective.index}</span>
            {perspective.title.replace("视角", "")}
          </button>
        ))}
      </div>

      <div className="perspective-workspace-viewport">
        {perspectives.map((perspective, index) => {
          const active = index === selectedIndex;
          const position = active
            ? "active"
            : index < selectedIndex
              ? "before"
              : "after";

          return (
            <section
              aria-hidden={active ? undefined : true}
              aria-labelledby={`perspective-tab-${index}`}
              className="perspective-workspace"
              data-position={position}
              data-testid={`workspace-${workspaceIds[index]}`}
              id={`perspective-panel-${index}`}
              inert={active ? undefined : true}
              key={perspective.index}
              role="tabpanel"
            >
              {index === 0 ? (
                <CustomerWorkspace
                  journey={journey}
                  onAnswerDiagnosis={(reply) =>
                    dispatch({ type: "answerDiagnosis", reply })
                  }
                  onMarkSelfResolved={() =>
                    dispatch({ type: "markSelfResolved" })
                  }
                  onRequestHumanService={() =>
                    dispatch({ type: "requestHumanService" })
                  }
                  onReset={() => dispatch({ type: "resetJourney" })}
                />
              ) : null}
              {index === 1 ? (
                <AgentWorkspace
                  journey={journey}
                  onCreateWorkOrder={() =>
                    dispatch({ type: "createWorkOrder" })
                  }
                  onReset={() => dispatch({ type: "resetJourney" })}
                />
              ) : null}
              {index === 2 ? (
                <EngineerWorkspace
                  journey={journey}
                  onCompleteService={() =>
                    dispatch({ type: "completeService" })
                  }
                  onConfirmParts={() => dispatch({ type: "confirmParts" })}
                  onReset={() => dispatch({ type: "resetJourney" })}
                />
              ) : null}
              {index === 3 ? <OperationsWorkspace /> : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}
