import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInMemoryAuthProtectionStore } from "@/lib/auth/protection-store";
import {
  DEFAULT_UPVOTE_GLOBAL_LIMIT,
  DEFAULT_UPVOTE_IP_LIMIT,
  DEFAULT_UPVOTE_LIMIT,
  consumeUpvoteThrottle,
  getUpvoteBrowserThrottleKey,
  getUpvoteEndpointIpThrottleKey,
  getUpvoteGlobalThrottleKey,
  resetUpvoteThrottle,
} from "@/lib/votes/rate-limit";

describe("vote rate-limit helpers", () => {
  let store = createInMemoryAuthProtectionStore();

  beforeEach(async () => {
    store = createInMemoryAuthProtectionStore();
    await resetUpvoteThrottle(undefined, store);
  });

  afterEach(async () => {
    await resetUpvoteThrottle(undefined, store);
  });

  it("builds distinct throttle keys for browser, ip, and global scopes", () => {
    expect(
      getUpvoteBrowserThrottleKey(
        42,
        " 3B32A5EF-9059-4ACC-BD6E-A8F2E37295EE "
      )
    ).toBe("upvote:video:42:voter:3b32a5ef-9059-4acc-bd6e-a8f2e37295ee");
    expect(getUpvoteEndpointIpThrottleKey(" 203.0.113.10 ")).toBe(
      "upvote:endpoint:ip:203.0.113.10"
    );
    expect(getUpvoteGlobalThrottleKey()).toBe("upvote:endpoint:global");
  });

  it("throttles rapid per-video per-browser voting with the vote defaults", async () => {
    const key = getUpvoteBrowserThrottleKey(
      42,
      "3b32a5ef-9059-4acc-bd6e-a8f2e37295ee"
    );

    for (let attempt = 0; attempt < DEFAULT_UPVOTE_LIMIT; attempt += 1) {
      const decision = await consumeUpvoteThrottle(key, { store });
      expect(decision.allowed).toBe(true);
      expect(decision.retryAfterMs).toBe(0);
    }

    const blocked = await consumeUpvoteThrottle(key, { store });

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("supports a separate ip-scoped endpoint limiter", async () => {
    const key = getUpvoteEndpointIpThrottleKey("203.0.113.10");

    for (let attempt = 0; attempt < DEFAULT_UPVOTE_IP_LIMIT; attempt += 1) {
      expect(
        (await consumeUpvoteThrottle(key, { scope: "ip", store })).allowed
      ).toBe(true);
    }

    const blocked = await consumeUpvoteThrottle(key, { scope: "ip", store });

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("supports a global limiter that is independent of voter identity", async () => {
    const key = getUpvoteGlobalThrottleKey();

    for (let attempt = 0; attempt < DEFAULT_UPVOTE_GLOBAL_LIMIT; attempt += 1) {
      expect(
        (await consumeUpvoteThrottle(key, { scope: "global", store })).allowed
      ).toBe(true);
    }

    const blocked = await consumeUpvoteThrottle(key, { scope: "global", store });

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });
});
