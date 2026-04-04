import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  consumeCeremonyState,
  issueCeremonyState,
  readCeremonyState,
  CeremonyStateError,
} from "@/lib/auth/challenge";

describe("challenge helpers", () => {
  const originalSecret = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.SESSION_SECRET = "test-session-secret";
  });

  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
  });

  it("issues and reads signed ceremony state", () => {
    const now = new Date("2026-04-04T18:30:00.000Z");
    const { state, cookie } = issueCeremonyState({
      flow: "login",
      username: "mark",
      now,
    });

    const loaded = readCeremonyState(cookie.value, "login", { username: "mark" }, now);

    expect(loaded.challenge).toBe(state.challenge);
    expect(cookie.name).toContain("login");
  });

  it("clears ceremony cookies on consume", () => {
    const { cookie } = issueCeremonyState({
      flow: "setup",
      userId: "user_123",
    });

    const consumed = consumeCeremonyState(cookie.value, "setup", {
      userId: "user_123",
    });

    expect(consumed.clearedCookie.value).toBe("");
    expect(consumed.clearedCookie.options.maxAge).toBe(0);
  });

  it("rejects expired ceremony state", () => {
    const issuedAt = new Date("2026-04-04T18:30:00.000Z");
    const { cookie } = issueCeremonyState({
      flow: "login",
      now: issuedAt,
      ttlMs: 1_000,
    });

    expect(() =>
      readCeremonyState(
        cookie.value,
        "login",
        undefined,
        new Date("2026-04-04T18:30:02.000Z")
      )
    ).toThrowError(CeremonyStateError);
  });

  it("rejects mismatched principal bindings", () => {
    const { cookie } = issueCeremonyState({
      flow: "setup",
      userId: "user_123",
    });

    expect(() =>
      readCeremonyState(cookie.value, "setup", { userId: "user_999" })
    ).toThrowError(CeremonyStateError);
  });
});
