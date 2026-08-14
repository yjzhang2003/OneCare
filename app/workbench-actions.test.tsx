import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbenchActions } from "./workbench-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

// The parameters are declared even though the body ignores them: without them
// vi.fn infers a zero-argument mock, mock.calls[0] is typed [], and every
// assertion about what was POSTed has to cast — which typechecks only because
// `vitest run` does not typecheck at all.
function respond(status: number, body: Record<string, unknown>) {
  return vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  refresh.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function panel(
  props: Partial<React.ComponentProps<typeof WorkbenchActions>> = {},
) {
  return render(
    <WorkbenchActions
      recordId="rec1"
      members={[{ openId: "ou_huang", name: "黄齐" }]}
      ownerNames={["张禹健"]}
      seenState="待闭环"
      actions={["确认闭环"]}
      canClaim={false}
      {...props}
    />,
  );
}

async function openNoteModal(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "确认闭环" }));
  const textarea = await screen.findByRole("textbox");
  fireEvent.change(textarea, { target: { value: text } });
  return textarea;
}

// The clickable "确认闭环" inside the dialog, as opposed to the panel button that
// opened it. Arco's modal footer renders 确定/取消 rather than repeating the title.
function confirmButton() {
  return screen.getByRole("button", { name: "确定" });
}

describe("WorkbenchActions", () => {
  it("sends the action and the state the server rendered", async () => {
    const fetchMock = respond(200, { ok: true, message: "已流转到「已闭环」" });
    vi.stubGlobal("fetch", fetchMock);
    panel();

    await openNoteModal("已换新并致歉");
    fireEvent.click(confirmButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/voc/tickets/rec1/action");
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "transition",
      action: "确认闭环",
      seenState: "待闭环",
      note: "已换新并致歉",
    });
  });

  it("refreshes the page once a write lands", async () => {
    vi.stubGlobal("fetch", respond(200, { ok: true, message: "已流转到「已闭环」" }));
    panel();

    await openNoteModal("已换新并致歉");
    fireEvent.click(confirmButton());

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  // The defect this test exists for: the note used to be cleared in a `finally`,
  // so a transient Bitable timeout silently discarded whatever the operator had
  // written. Losing several sentences of 闭环结论 that way teaches someone not to
  // trust the field.
  it("keeps the typed note when the write fails", async () => {
    vi.stubGlobal(
      "fetch",
      respond(502, { error: "write_failed", message: "写回多维表格失败，请稍后重试" }),
    );
    panel();

    const textarea = await openNoteModal("已联系用户，同意换新，等待仓库发货");
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(screen.getByText("写回多维表格失败，请稍后重试")).toBeInTheDocument(),
    );
    expect(textarea).toHaveValue("已联系用户，同意换新，等待仓库发货");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps the typed note when the server refuses", async () => {
    vi.stubGlobal(
      "fetch",
      respond(403, { error: "forbidden", message: "只有该记录的负责人可以操作" }),
    );
    panel();

    const textarea = await openNoteModal("已换新并致歉");
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(screen.getByText("只有该记录的负责人可以操作")).toBeInTheDocument(),
    );
    expect(textarea).toHaveValue("已换新并致歉");
  });

  it("keeps the typed note when the network fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    panel();

    const textarea = await openNoteModal("已换新并致歉");
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(screen.getByText("网络异常，请检查连接后重试")).toBeInTheDocument(),
    );
    expect(textarea).toHaveValue("已换新并致歉");
  });

  // A 409 is the one refusal retrying cannot fix, so the intent is let go rather
  // than kept alive for a retry that would be refused identically.
  it("lets the intent go on a stale-view conflict, and refreshes", async () => {
    vi.stubGlobal(
      "fetch",
      respond(409, { error: "conflict", actual: "已闭环", message: "这条工单已被改成「已闭环」，请刷新后再操作" }),
    );
    panel();

    await openNoteModal("已换新并致歉");
    fireEvent.click(confirmButton());

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // Asserts the note was released rather than that the dialog unmounted:
    // Arco unmounts a closed modal only after its exit transition completes, and
    // jsdom runs no transitions, so the node lingers here in a way it does not
    // in a browser. An empty value is the property that actually distinguishes
    // "intent let go" from "intent kept for a retry" — which is what the three
    // tests above assert the other way round.
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
  });

  it("claims without asking for a note", async () => {
    const fetchMock = respond(200, { ok: true, message: "已认领" });
    vi.stubGlobal("fetch", fetchMock);
    panel({ actions: [], canClaim: true, seenState: "待跟进" });

    fireEvent.click(screen.getByRole("button", { name: "我来跟进" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "claim",
      seenState: "待跟进",
    });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("submits an action that carries no note directly", async () => {
    const fetchMock = respond(200, { ok: true, message: "已流转到「跟进中」" });
    vi.stubGlobal("fetch", fetchMock);
    panel({ actions: ["开始跟进"], seenState: "待跟进" });

    fireEvent.click(screen.getByRole("button", { name: "开始跟进" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
