import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = "test-session-secret";
}

afterEach(() => {
  if (typeof document !== "undefined") {
    cleanup();
  }
});
