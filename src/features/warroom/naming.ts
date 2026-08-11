export const DECLINED_MARKER = "declined";

export function warRoomName(
  input: Readonly<{ recordNumber: string; category: string; severity: string | null }>,
): string {
  const tail = input.recordNumber.slice(-6);
  const segments = ["VOC", tail, input.category, input.severity ?? ""].filter(
    (segment) => segment.trim().length > 0,
  );
  return segments.join("-");
}

export function warRoomDecision(chatId: string): "create" | "exists" | "declined" {
  const value = chatId.trim();
  if (value.length === 0) return "create";
  if (value === DECLINED_MARKER) return "declined";
  return "exists";
}
