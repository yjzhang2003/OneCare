type RedactionRule = Readonly<{ pattern: RegExp; mask: string }>;

// Order matters: the longest, most specific patterns run first so a shorter
// rule cannot consume part of a longer identifier.
const RULES: readonly RedactionRule[] = [
  { pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, mask: "[邮箱]" },
  { pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g, mask: "[身份证]" },
  { pattern: /(?<!\d)\d{12,}(?!\d)/g, mask: "[订单号]" },
  { pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g, mask: "[手机号]" },
];

export function redactVocContent(text: string): string {
  return RULES.reduce(
    (current, rule) => current.replace(rule.pattern, rule.mask),
    text,
  );
}
