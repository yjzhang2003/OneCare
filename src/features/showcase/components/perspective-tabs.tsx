"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import type { Perspective } from "../content";

type PerspectiveTabsProps = {
  perspectives: readonly Perspective[];
};

export function PerspectiveTabs({ perspectives }: PerspectiveTabsProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = perspectives[selectedIndex];

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
        className="perspective-tabs"
        role="tablist"
        aria-label="OneCare 服务角色"
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

      <article
        aria-labelledby={`perspective-tab-${selectedIndex}`}
        className="perspective-panel surface-card"
        id={`perspective-panel-${selectedIndex}`}
        key={active.index}
        role="tabpanel"
      >
        <div className="perspective-panel__media">
          <Image
            alt="海信智能冰箱产品示意"
            fill
            sizes="(max-width: 768px) 100vw, 42vw"
            src="/images/hisense/smart-refrigerator.webp"
          />
          <span>{active.handoff}</span>
        </div>
        <div className="perspective-panel__copy">
          <p className="perspective-panel__role">{active.title}</p>
          <h3>{active.sceneLine}</h3>
          <p className="perspective-panel__value">{active.value}</p>
          <ul aria-label={`${active.title}关键能力`}>
            {active.capabilities.map((capability, index) => (
              <li key={capability}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {capability}
              </li>
            ))}
          </ul>
        </div>
      </article>
    </section>
  );
}
