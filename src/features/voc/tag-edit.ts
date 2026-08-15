// 人工修正打标结论：极性、维度、严重度、摘要。
//
// Why this exists at all: most rows in the demo dataset were tagged by the seeding
// script, and a rule engine's 严重度 is only as good as the polarity and dimension count
// it was handed. An operator reading the original complaint can see when a verdict is
// wrong, and until now the only place to fix it was the Bitable — which is the detour
// the workbench exists to remove.
//
// A manual edit is not a smaller version of a tagging run:
//
//   - It never touches 流程状态 or 负责人. Re-running the pipeline is what re-decides
//     those; correcting a label is not a reason to move a ticket someone is working.
//   - It stamps 打标来源 with who did it. A row that reads 差评/高 should say whether a
//     model, the seed script, or a person put it there — that provenance is the whole
//     reason the column exists.

import { VOC_FIELD_NAMES, type BitableFields } from "../bitable/field-map";
import {
  VOC_DIMENSIONS,
  VOC_POLARITIES,
  VOC_SEVERITIES,
  type VocDimension,
  type VocPolarity,
  type VocSeverity,
} from "./triage";

export type TagEdit = Readonly<{
  // Null clears the column: an operator who thinks nothing was ever decided here should
  // be able to say so, rather than being forced to pick one of three.
  polarity: VocPolarity | null;
  dimensions: readonly VocDimension[];
  severity: VocSeverity | null;
  summary: string;
}>;

// The wire shape, validated rather than trusted. Anything outside the three enums is
// rejected outright — a 严重度 of "很高" would sail through the Bitable's single-select
// as a brand new option and every downstream count would quietly disagree with itself.
export function parseTagEdit(body: unknown): TagEdit | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;

  const polarity =
    raw.polarity === null || raw.polarity === undefined || raw.polarity === ""
      ? null
      : typeof raw.polarity === "string" &&
          (VOC_POLARITIES as readonly string[]).includes(raw.polarity)
        ? (raw.polarity as VocPolarity)
        : undefined;
  if (polarity === undefined) return null;

  const severity =
    raw.severity === null || raw.severity === undefined || raw.severity === ""
      ? null
      : typeof raw.severity === "string" &&
          (VOC_SEVERITIES as readonly string[]).includes(raw.severity)
        ? (raw.severity as VocSeverity)
        : undefined;
  if (severity === undefined) return null;

  if (!Array.isArray(raw.dimensions)) return null;
  const dimensions: VocDimension[] = [];
  for (const value of raw.dimensions) {
    if (
      typeof value !== "string" ||
      !(VOC_DIMENSIONS as readonly string[]).includes(value)
    ) {
      return null;
    }
    // De-duplicated here rather than in the UI: a multi-select writes what it is given,
    // and "售后服务、售后服务" would count twice in the dimension aggregate.
    if (!dimensions.includes(value as VocDimension)) {
      dimensions.push(value as VocDimension);
    }
  }

  if (typeof raw.summary !== "string") return null;

  return { polarity, dimensions, severity, summary: raw.summary.trim() };
}

// The Bitable write. A cleared enum goes out as "" — the same empty the mapping reads
// back as null — so clearing is expressible rather than being silently ignored.
export function toTagEditFields(edit: TagEdit, editorName: string): BitableFields {
  return {
    [VOC_FIELD_NAMES.polarity]: edit.polarity ?? "",
    [VOC_FIELD_NAMES.dimensions]: [...edit.dimensions],
    [VOC_FIELD_NAMES.severity]: edit.severity ?? "",
    [VOC_FIELD_NAMES.summary]: edit.summary,
    [VOC_FIELD_NAMES.tagSource]: `manual:${editorName}`,
  };
}
