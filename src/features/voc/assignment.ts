export type OwnerRule = Readonly<{
  scope: string;
  openId: string;
  fallback: boolean;
}>;

export type OwnerAssignment = Readonly<{
  openId: string;
  viaFallback: boolean;
}>;

export function resolveOwner(
  rules: readonly OwnerRule[],
  input: Readonly<{ channel: string; category: string }>,
): OwnerAssignment | null {
  const usable = rules.filter((rule) => rule.openId.trim().length > 0);

  const candidates = [`${input.channel}/${input.category}`, input.channel];
  for (const scope of candidates) {
    const match = usable.find((rule) => rule.scope === scope);
    if (match) return { openId: match.openId, viaFallback: false };
  }

  // Dropping an unmatched ticket would make it vanish and quietly inflate the
  // closure rate, so an explicit backstop is part of the contract.
  const backstop = usable.find((rule) => rule.fallback);
  return backstop ? { openId: backstop.openId, viaFallback: true } : null;
}
