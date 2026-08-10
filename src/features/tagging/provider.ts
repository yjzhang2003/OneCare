import type { TaggingProvider } from "./provider-types";

export type TaggingProviderName = TaggingProvider["name"];

export type TaggingProviderFactories = Readonly<{
  createAily: () => TaggingProvider;
  createFieldShortcut: () => TaggingProvider;
}>;

export function selectTaggingProvider(
  name: TaggingProviderName,
  factories: TaggingProviderFactories,
): TaggingProvider {
  switch (name) {
    case "aily":
      return factories.createAily();
    case "field-shortcut":
      return factories.createFieldShortcut();
    default: {
      const unreachable: never = name;
      throw new Error(
        `Unsupported TAGGING_PROVIDER: ${String(unreachable)}`,
      );
    }
  }
}
