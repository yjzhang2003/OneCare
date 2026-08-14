import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyzeButton } from "./workbench-analyze-button";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const { success, warning, error } = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

// Only the toast surface is faked; the button, its states and its fetch are real.
vi.mock("@arco-design/web-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@arco-design/web-react")>();
  return { ...actual, Message: { success, warning, error } };
});

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function answer(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function click() {
  screen.getByRole("button", { name: /立即分析/ }).click();
}

describe("AnalyzeButton", () => {
  it("posts to the record's analyze route and refreshes on a tagged result", async () => {
    fetchMock.mockResolvedValue(
      answer({ ok: true, tagged: true, message: "AI 分析完成，打标结果已回写" }),
    );

    render(<AnalyzeButton recordId="rec 1" state="待分析" retryCount={0} />);
    click();

    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    // The id is encoded: a Bitable record id is opaque and this is a path segment.
    expect(fetchMock).toHaveBeenCalledWith("/api/voc/tickets/rec%201/analyze", {
      method: "POST",
    });
    expect(success).toHaveBeenCalledWith("AI 分析完成，打标结果已回写");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // A run that finished and a run that produced tags are different outcomes. A green
  // toast over a record that is still untagged would read as "done".
  it("warns rather than congratulates when the analysis produced nothing", async () => {
    fetchMock.mockResolvedValue(
      answer({ ok: true, tagged: false, message: "AI 分析失败，失败原因已记录在工单上" }),
    );

    render(<AnalyzeButton recordId="rec1" state="分析失败" retryCount={1} />);
    click();

    await waitFor(() => expect(warning).toHaveBeenCalledTimes(1));
    expect(success).not.toHaveBeenCalled();
    // 失败原因 changed, so the page still has to be re-read.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // Every refusal from that route carries a message written for a person, so this
  // component invents no wording of its own for one.
  it("shows the server's refusal verbatim and does not refresh", async () => {
    fetchMock.mockResolvedValue(
      answer({ error: "rejected", message: "重试次数已达上限 3" }, 422),
    );

    render(<AnalyzeButton recordId="rec1" state="待分析" retryCount={0} />);
    click();

    await waitFor(() => expect(error).toHaveBeenCalledWith("重试次数已达上限 3"));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("owns exactly one message: the one the server never sent", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    render(<AnalyzeButton recordId="rec1" state="待分析" retryCount={0} />);
    click();

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("网络异常，请检查连接后重试"),
    );
  });

  // The button is not offered at all for a record the route would refuse — and the
  // reason takes its place, because "why not" is the useful part.
  it("states the reason instead of a control when the record cannot be analysed", () => {
    render(<AnalyzeButton recordId="rec1" state="已闭环" retryCount={0} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/已闭环的工单已经打过标/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 23 seconds is long enough that a second click is a reasonable thing for a person to
  // try. Arco's loading state swallows it, and this pins that: two runs would mean two
  // aily calls and two writes for one intent.
  it("cannot be fired twice while a run is in flight", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );

    render(<AnalyzeButton recordId="rec1" state="待分析" retryCount={0} />);
    click();
    click();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(answer({ ok: true, tagged: true, message: "完成" }));
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
  });
});
