// Compatibility guard for Arco on React 19 — not a test of Arco's own
// correctness, which is its maintainers' problem, but of the one line below it
// that we own and can lose.
//
// Arco declares `react: >=16`, which proves nothing. It reads createRoot off
// the "react-dom" root export, where React 19 no longer puts it, and then
// silently falls back to the deleted ReactDOM.render — so `Message.success()`
// dies with "CopyReactDOM.render is not a function" at runtime, in production,
// with a green build and a green type-check. arco-runtime is what prevents
// that, and nothing else in the codebase would notice its removal. Hence this
// file.
//
// Every component here is one the workbench write actions use, chosen because
// it drives a transition, a portal, or an imperative mount — the three paths
// that break without the adapter.
import "./arco-runtime";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Button, Message, Modal, Select, Table } from "@arco-design/web-react";
import { render as esRender } from "@arco-design/web-react/es/_util/react-dom";
import { render as libRender } from "@arco-design/web-react/lib/_util/react-dom";

afterEach(cleanup);

test("Table renders rows", () => {
  render(
    <Table
      columns={[
        { title: "工单", dataIndex: "num" },
        { title: "状态", dataIndex: "state" },
      ]}
      data={[{ key: "1", num: "VOC-a3cdc5", state: "待跟进" }]}
      pagination={false}
    />,
  );
  expect(screen.getByText("VOC-a3cdc5")).toBeInTheDocument();
});

test("Select opens its dropdown on click (Trigger + CSSTransition path)", () => {
  const { container } = render(
    <Select defaultValue="待跟进" options={["待跟进", "已闭环"]} />,
  );
  const control = container.querySelector(".arco-select-view");
  expect(control).not.toBeNull();
  fireEvent.click(control as Element);
  expect(screen.getAllByText("已闭环").length).toBeGreaterThan(0);
});

test("Modal renders through a portal", () => {
  render(
    <Modal visible title="确认认领" onOk={() => {}} onCancel={() => {}}>
      这条工单将指派给你
    </Modal>,
  );
  expect(screen.getByText("这条工单将指派给你")).toBeInTheDocument();
});

test("Message mounts imperatively", () => {
  Message.success("已更新");
  expect(true).toBe(true);
});

// The test above passes with only half the fix, which is how the product shipped a
// console whose toasts all threw. Arco has two builds — lib (what Node resolves, so what
// this file's `Message` is) and es (what the bundler resolves, so what the browser's
// `Message` is) — each holding its own createRoot. Registering the adapter on one leaves
// the other falling back to the deleted ReactDOM.render, and only the browser finds out.
// So both imperative mounts are driven here, by the same paths Message.success takes.
test.each([
  ["es", esRender],
  ["lib", libRender],
])("%s build mounts imperatively, not through the deleted ReactDOM.render", (_name, mount) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  expect(() => mount(<span>已更新</span>, container)).not.toThrow();
  document.body.removeChild(container);
});

test("Button renders", () => {
  render(<Button type="primary">我来跟进</Button>);
  expect(screen.getByText("我来跟进")).toBeInTheDocument();
});
