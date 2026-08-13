import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

// Global cleanup so every render-based test file unmounts its trees, even
// ones that forget to call cleanup() themselves. Without this, components
// left mounted when a test file finishes can leave React's scheduler with
// pending setImmediate work that fires after Vitest tears down the jsdom
// environment for that file, throwing "window is not defined" as an
// uncaught exception (see app/login/login-content.test.tsx, which renders
// 6 times without ever unmounting). cleanup() is idempotent, so files that
// already call it themselves are unaffected.
afterEach(cleanup);

// jsdom implements no matchMedia, and several Arco components subscribe to one
// on mount to pick a responsive breakpoint (Descriptions, Grid, Layout.Sider).
// Without this they throw "window.matchMedia is not a function" during the
// passive-effect phase — a failure that has nothing to do with what any test is
// asserting.
//
// Always reports "does not match", so components resolve to their widest
// breakpoint. That is the right default here: these tests assert content and
// behaviour, and a component that silently rendered its narrow variant would
// hide columns the assertions are looking for.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
