import { VOC_FIELD_NAMES } from "./field-map";

export type SchemaSource = Readonly<{
  listFieldNames(): Promise<readonly string[]>;
}>;

export async function assertVocSchema(source: SchemaSource): Promise<void> {
  const present = new Set(await source.listFieldNames());
  const missing = Object.values(VOC_FIELD_NAMES).filter(
    (name) => !present.has(name),
  );

  if (missing.length > 0) {
    // A renamed column otherwise fails silently by writing into nothing, which
    // is far worse than refusing to start.
    throw new Error(`多维表格缺少字段：${missing.join("、")}`);
  }
}
