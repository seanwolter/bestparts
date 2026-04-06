import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCeremonyCookie,
  buildExpiredCeremonyCookie,
  buildExpiredSessionCookie,
  buildSessionCookie,
  decodeSignedCookiePayload,
  getCeremonyCookieName,
  getDefaultCookieOptions,
  SESSION_COOKIE_NAME,
  type SignedCeremonyCookiePayload,
} from "@/lib/auth/cookies";

describe("auth cookies", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SESSION_SECRET", "test-session-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses hardened default cookie options outside production", () => {
    expect(getDefaultCookieOptions()).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });
  });

  it("uses secure default cookie options in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(getDefaultCookieOptions()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  });

  it("builds a session cookie with hardened defaults and a caller-supplied expiry", () => {
    const expiresAt = new Date("2026-04-06T00:00:00.000Z");
    const cookie = buildSessionCookie("session-token", expiresAt);

    expect(cookie).toEqual({
      name: SESSION_COOKIE_NAME,
      value: "session-token",
      options: {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
        expires: expiresAt,
      },
    });
  });

  it("builds an expired session cookie that preserves hardening flags", () => {
    const cookie = buildExpiredSessionCookie();

    expect(cookie.name).toBe(SESSION_COOKIE_NAME);
    expect(cookie.value).toBe("");
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.secure).toBe(false);
    expect(cookie.options.sameSite).toBe("lax");
    expect(cookie.options.path).toBe("/");
    expect(cookie.options.maxAge).toBe(0);
    expect(cookie.options.expires).toEqual(new Date(0));
  });

  it("builds a signed ceremony cookie with hardened defaults and the expected name", () => {
    const expiresAt = "2026-04-06T00:00:00.000Z";
    const cookie = buildCeremonyCookie({
      flow: "login",
      challenge: "challenge-value",
      expiresAt,
      nonce: "nonce-value",
      username: "mark",
    });
    const payload = decodeSignedCookiePayload<SignedCeremonyCookiePayload>(cookie.value);

    expect(cookie.name).toBe(getCeremonyCookieName("login"));
    expect(cookie.options).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      expires: new Date(expiresAt),
    });
    expect(payload).toEqual({
      flow: "login",
      challenge: "challenge-value",
      expiresAt,
      nonce: "nonce-value",
      username: "mark",
    });
  });

  it("builds an expired ceremony cookie that preserves hardening flags", () => {
    const cookie = buildExpiredCeremonyCookie("setup");

    expect(cookie.name).toBe(getCeremonyCookieName("setup"));
    expect(cookie.value).toBe("");
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.secure).toBe(false);
    expect(cookie.options.sameSite).toBe("lax");
    expect(cookie.options.path).toBe("/");
    expect(cookie.options.maxAge).toBe(0);
    expect(cookie.options.expires).toEqual(new Date(0));
  });
});
