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
