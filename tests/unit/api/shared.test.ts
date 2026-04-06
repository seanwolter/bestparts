import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  assertSameOriginMutationRequest,
  getTrustedClientIpAddress,
  jsonForbidden,
  jsonRateLimitError,
  jsonVoteCooldownError,
  MutationOriginError,
  TRUST_PROXY_HEADERS_ENV,
} from "@/app/api/_shared";

describe("api shared helpers", () => {
  const originalTrustProxyHeaders = process.env[TRUST_PROXY_HEADERS_ENV];

  afterEach(() => {
    process.env[TRUST_PROXY_HEADERS_ENV] = originalTrustProxyHeaders;
  });

  it("ignores forwarding headers unless trusted proxy mode is enabled", () => {
    process.env[TRUST_PROXY_HEADERS_ENV] = "false";

    const request = createRequest("http://localhost/api/auth/login/options", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 198.51.100.2",
        "x-real-ip": "198.51.100.10",
      },
    });

    expect(getTrustedClientIpAddress(request)).toBeUndefined();
  });

  it("prefers the first forwarded-for address when trusted proxy mode is enabled", () => {
    process.env[TRUST_PROXY_HEADERS_ENV] = "true";

    const request = createRequest("http://localhost/api/auth/login/options", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 198.51.100.2",
        "x-real-ip": "198.51.100.10",
      },
    });

    expect(getTrustedClientIpAddress(request)).toBe("203.0.113.10");
  });

  it("falls back to x-real-ip when forwarded-for is absent", () => {
    process.env[TRUST_PROXY_HEADERS_ENV] = "true";

    const request = createRequest("http://localhost/api/auth/login/options", {
      headers: {
        "x-real-ip": "198.51.100.10",
      },
    });

    expect(getTrustedClientIpAddress(request)).toBe("198.51.100.10");
  });

  it("allows matching origin headers for unsafe same-origin requests", () => {
    const request = createRequest("http://localhost/api/videos/1/upvote", {
      method: "POST",
      headers: {
        origin: "http://localhost",
      },
    });

    expect(() => assertSameOriginMutationRequest(request)).not.toThrow();
  });

  it("falls back to referer when origin is absent", () => {
    const request = createRequest("http://localhost/api/videos/1/upvote", {
      method: "POST",
      headers: {
        referer: "http://localhost/some-page?sort=top",
      },
    });

    expect(() => assertSameOriginMutationRequest(request)).not.toThrow();
  });

  it("rejects sec-fetch-site cross-site mutation requests", () => {
    const request = createRequest("http://localhost/api/videos/1/upvote", {
      method: "POST",
      headers: {
        "sec-fetch-site": "cross-site",
      },
    });

    expect(() => assertSameOriginMutationRequest(request)).toThrowError(
      MutationOriginError
    );
  });

  it("rejects mismatched origin headers", () => {
    const request = createRequest("http://localhost/api/videos/1/upvote", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
      },
    });

    expect(() => assertSameOriginMutationRequest(request)).toThrowError(
      MutationOriginError
    );
  });

  it("rejects unsafe requests that cannot establish a same origin", () => {
    const request = createRequest("http://localhost/api/videos/1/upvote", {
      method: "POST",
    });

    expect(() => assertSameOriginMutationRequest(request)).toThrowError(
      MutationOriginError
    );
  });

  it("allows safe methods without origin checks", () => {
    const request = createRequest("http://localhost/api/videos/1/upvote");

    expect(() => assertSameOriginMutationRequest(request)).not.toThrow();
  });

  it("builds a forbidden json response", async () => {
    const response = jsonForbidden();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden.",
    });
  });

  it("builds a scoped rate-limit json response with retry headers", async () => {
    const response = jsonRateLimitError({
      error: "Too many upvote attempts. Please try again later.",
      retryAfterMs: 1_250,
      scope: "global",
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("2");
    await expect(response.json()).resolves.toEqual({
      error: "Too many upvote attempts. Please try again later.",
      retryAfterMs: 1_250,
      scope: "global",
    });
  });

  it("builds a vote cooldown response with an explicit eligibility timestamp", async () => {
    const response = jsonVoteCooldownError({
      error: "This browser can upvote this video again later.",
      retryAfterMs: 60_000,
      nextEligibleUpvoteAt: new Date("2026-04-06T00:00:00.000Z"),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This browser can upvote this video again later.",
      retryAfterMs: 60_000,
      nextEligibleUpvoteAt: "2026-04-06T00:00:00.000Z",
    });
  });
});

function createRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  return new NextRequest(url, {
    method: options.method ?? "GET",
    headers: options.headers,
  });
}
