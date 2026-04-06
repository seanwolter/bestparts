import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { encodeSignedCookiePayload } from "@/lib/auth/cookies";
import {
  ANONYMOUS_VOTER_COOKIE_NAME,
  ANONYMOUS_VOTER_COOKIE_TTL_MS,
  ANONYMOUS_VOTER_COOKIE_VERSION,
  buildAnonymousVoterCookie,
  getOrCreateAnonymousVoter,
  hashAnonymousVoterId,
  tryReadAnonymousVoterCookie,
} from "@/lib/votes/voter-cookie";

describe("anonymous voter cookie helpers", () => {
  const originalSecret = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.SESSION_SECRET = "test-session-secret";
  });

  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
  });

  it("builds a signed long-lived anonymous voter cookie", () => {
    const now = new Date("2026-04-05T20:15:00.000Z");
    const voterId = "3b32a5ef-9059-4acc-bd6e-a8f2e37295ee";
    const cookie = buildAnonymousVoterCookie(
      {
        version: ANONYMOUS_VOTER_COOKIE_VERSION,
        voterId,
      },
      now
    );

    expect(cookie.name).toBe(ANONYMOUS_VOTER_COOKIE_NAME);
    expect(cookie.options.maxAge).toBe(
      Math.floor(ANONYMOUS_VOTER_COOKIE_TTL_MS / 1000)
    );
    expect(cookie.options.expires?.toISOString()).toBe(
      new Date(now.getTime() + ANONYMOUS_VOTER_COOKIE_TTL_MS).toISOString()
    );
    expect(tryReadAnonymousVoterCookie(cookie.value)).toEqual({
      version: ANONYMOUS_VOTER_COOKIE_VERSION,
      voterId,
    });
  });

  it("reuses a valid existing anonymous voter cookie without rotation", () => {
    const voterId = "3b32a5ef-9059-4acc-bd6e-a8f2e37295ee";
    const cookie = buildAnonymousVoterCookie({
      version: ANONYMOUS_VOTER_COOKIE_VERSION,
      voterId,
    });
    const identity = getOrCreateAnonymousVoter(createRequest(cookie.value));

    expect(identity).toEqual({
      voterId,
      voterKeyHash: hashAnonymousVoterId(voterId),
      cookie: null,
    });
  });

  it("creates a new anonymous voter cookie when none exists", () => {
    const identity = getOrCreateAnonymousVoter(
      createRequest(),
      new Date("2026-04-05T20:15:00.000Z")
    );

    expect(identity.cookie).not.toBeNull();
    expect(identity.voterId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(identity.voterKeyHash).toBe(hashAnonymousVoterId(identity.voterId));
    expect(tryReadAnonymousVoterCookie(identity.cookie?.value)).toEqual({
      version: ANONYMOUS_VOTER_COOKIE_VERSION,
      voterId: identity.voterId,
    });
  });

  it("rotates malformed anonymous voter cookies safely", () => {
    const identity = getOrCreateAnonymousVoter(
      createRequest("this-is-not-a-valid-signed-cookie")
    );

    expect(identity.cookie).not.toBeNull();
    expect(tryReadAnonymousVoterCookie(identity.cookie?.value)).toEqual({
      version: ANONYMOUS_VOTER_COOKIE_VERSION,
      voterId: identity.voterId,
    });
  });

  it("rotates tampered anonymous voter cookies safely", () => {
    const originalVoterId = "3b32a5ef-9059-4acc-bd6e-a8f2e37295ee";
    const cookie = buildAnonymousVoterCookie({
      version: ANONYMOUS_VOTER_COOKIE_VERSION,
      voterId: originalVoterId,
    });
    const tamperedValue = `${cookie.value}tampered`;
    const identity = getOrCreateAnonymousVoter(createRequest(tamperedValue));

    expect(identity.cookie).not.toBeNull();
    expect(identity.voterId).not.toBe(originalVoterId);
    expect(tryReadAnonymousVoterCookie(identity.cookie?.value)).toEqual({
      version: ANONYMOUS_VOTER_COOKIE_VERSION,
      voterId: identity.voterId,
    });
  });

  it("rejects unsupported payload versions and invalid voter ids", () => {
    const unsupportedVersion = encodeSignedCookiePayload({
      version: 2,
      voterId: "3b32a5ef-9059-4acc-bd6e-a8f2e37295ee",
    });
    const invalidVoterId = encodeSignedCookiePayload({
      version: ANONYMOUS_VOTER_COOKIE_VERSION,
      voterId: "not-a-uuid",
    });

    expect(tryReadAnonymousVoterCookie(unsupportedVersion)).toBeNull();
    expect(tryReadAnonymousVoterCookie(invalidVoterId)).toBeNull();
  });
});

function createRequest(cookieValue?: string): NextRequest {
  const headers = new Headers();

  if (cookieValue) {
    headers.set("cookie", `${ANONYMOUS_VOTER_COOKIE_NAME}=${cookieValue}`);
  }

  return new NextRequest("http://localhost/api/videos/1/upvote", {
    method: "POST",
    headers,
  });
}
