"use client";

import { useEffect, useRef, useState } from "react";

import type {
  ArchitectureLayer,
  ClosedLoopStep,
  ConnectedSystem,
  DecisionPath,
  PilotTarget,
  RolloutStage,
  ServiceIdentity,
} from "../content";
import { PilotTargets } from "./pilot-targets";
import {
  ServiceArchitectureOverview,
  ServiceLoopMechanism,
} from "./service-architecture";

type ArchitectureChaptersProps = Readonly<{
  identities: readonly ServiceIdentity[];
  systems: readonly ConnectedSystem[];
  layers: readonly ArchitectureLayer[];
  decisions: readonly DecisionPath[];
  loopSteps: readonly ClosedLoopStep[];
  targets: readonly PilotTarget[];
  stages: readonly RolloutStage[];
}>;

const chapters = [
  { id: "overview", label: "架构全景" },
  { id: "loop", label: "闭环运行" },
  { id: "pilot", label: "试点落地" },
] as const;

export function ArchitectureChapters({
  identities,
  systems,
  layers,
  decisions,
  loopSteps,
  targets,
  stages,
}: ArchitectureChaptersProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const navigation = useRef<HTMLElement | null>(null);
  const chapterSections = useRef<Array<HTMLElement | null>>([]);

  function select(index: number, focus = false) {
    setSelectedIndex(index);
    if (focus) {
      tabs.current[index]?.focus();
    }
    chapterSections.current[index]?.scrollIntoView({
      behavior:
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      block: "start",
    });
  }

  function move(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % chapters.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + chapters.length) % chapters.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = chapters.length - 1;
    }

    if (nextIndex === undefined) {
      return;
    }

    event.preventDefault();
    select(nextIndex, true);
  }

  useEffect(() => {
    const page = navigation.current?.closest<HTMLElement>(".showcase-page");
    if (!page) {
      return;
    }

    function syncActiveChapter() {
      const pageTop = page!.getBoundingClientRect().top;
      const navigationHeight = navigation.current?.offsetHeight ?? 0;
      const activationLine =
        pageTop + navigationHeight + Math.min(page!.clientHeight * 0.32, 260);
      let nextIndex = 0;

      chapterSections.current.forEach((section, index) => {
        if (section && section.getBoundingClientRect().top <= activationLine) {
          nextIndex = index;
        }
      });

      setSelectedIndex(nextIndex);
    }

    page.addEventListener("scroll", syncActiveChapter, { passive: true });
    return () => page.removeEventListener("scroll", syncActiveChapter);
  }, []);

  return (
    <div className="architecture-chapters">
      <nav
        aria-label="闭环架构章节"
        className="architecture-chapter-tabs"
        ref={navigation}
      >
        {chapters.map((chapter, index) => (
          <button
            aria-controls={`architecture-chapter-${chapter.id}`}
            aria-current={index === selectedIndex ? "true" : undefined}
            id={`architecture-chapter-nav-${chapter.id}`}
            key={chapter.id}
            onClick={() => select(index)}
            onKeyDown={(event) => move(event, index)}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            type="button"
          >
            {chapter.label}
          </button>
        ))}
      </nav>

      <section
        aria-labelledby="architecture-chapter-nav-overview"
        className="architecture-chapter-section"
        data-architecture-chapter="overview"
        id="architecture-chapter-overview"
        ref={(node) => {
          chapterSections.current[0] = node;
        }}
      >
          <ServiceArchitectureOverview
            identities={identities}
            layers={layers}
            systems={systems}
          />
      </section>
      <section
        aria-labelledby="architecture-chapter-nav-loop"
        className="architecture-chapter-section"
        data-architecture-chapter="loop"
        id="architecture-chapter-loop"
        ref={(node) => {
          chapterSections.current[1] = node;
        }}
      >
          <ServiceLoopMechanism decisions={decisions} loopSteps={loopSteps} />
      </section>
      <section
        aria-labelledby="architecture-chapter-nav-pilot"
        className="architecture-chapter-section"
        data-architecture-chapter="pilot"
        id="architecture-chapter-pilot"
        ref={(node) => {
          chapterSections.current[2] = node;
        }}
      >
          <PilotTargets stages={stages} targets={targets} />
      </section>
    </div>
  );
}
