import { describe, expect, it } from "vitest";

import { redactVocContent } from "./redact";

describe("redactVocContent", () => {
  it("masks mobile numbers", () => {
    expect(redactVocContent("请回电 13800138000 谢谢")).toBe(
      "请回电 [手机号] 谢谢",
    );
  });

  it("masks email addresses", () => {
    expect(redactVocContent("联系 zhang.san+voc@example.com.cn")).toBe(
      "联系 [邮箱]",
    );
  });

  it("masks id card numbers without also matching them as mobiles", () => {
    expect(redactVocContent("证件 11010519491231002X 已核")).toBe(
      "证件 [身份证] 已核",
    );
  });

  it("masks long order numbers", () => {
    expect(redactVocContent("订单 202601231234567 未处理")).toBe(
      "订单 [订单号] 未处理",
    );
  });

  it("leaves ordinary numbers alone", () => {
    expect(redactVocContent("等了 3 天，报修 2 次")).toBe("等了 3 天，报修 2 次");
  });

  it("masks several kinds in one sentence", () => {
    expect(
      redactVocContent("13800138000 和 a@b.cn 都联系不上，订单 202601231234567"),
    ).toBe("[手机号] 和 [邮箱] 都联系不上，订单 [订单号]");
  });

  it("returns empty string unchanged", () => {
    expect(redactVocContent("")).toBe("");
  });
});
