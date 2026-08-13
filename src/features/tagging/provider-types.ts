import type { TagOutcome } from "./contracts";

export type TaggingRequestRecord = Readonly<{
  recordId: string;
  content: string;
  channel: string;
  category: string;
  rating?: number;
}>;

export type TaggingProvider = Readonly<{
  name: "aily" | "field-shortcut";
  tag(records: readonly TaggingRequestRecord[]): Promise<readonly TagOutcome[]>;
}>;
