import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getTestDatabaseUrl } from "../setup/test-db";
import {
  CeremonyStateError,
  consumeCeremonyState,
  issueCeremonyState,
} from "@/lib/auth/challenge";
import {
  consumeThrottle,
  getLoginThrottleKey,
} from "@/lib/auth/webauthn";
import { createPrismaAuthProtectionStore } from "@/lib/auth/protection-store";

describe("shared auth protection state", () => {
  let firstClient: PrismaClient;
  let secondClient: PrismaClient;
  const originalSecret = process.env.SESSION_SECRET;

  beforeAll(() => {
    firstClient = new PrismaClient({
      datasources: {
        db: {
          url: getTestDatabaseUrl(),
        },
      },
    });
    secondClient = new PrismaClient({
      datasources: {
        db: {
          url: getTestDatabaseUrl(),
        },
      },
    });
  });

  beforeEach(async () => {
    process.env.SESSION_SECRET = "test-session-secret";
    await firstClient.authThrottleBucket.deleteMany();
    await firstClient.consumedCeremonyNonce.deleteMany();
  });

  afterAll(async () => {
    process.env.SESSION_SECRET = originalSecret;
    await firstClient.$disconnect();
    await secondClient.$disconnect();
  });

  it("rejects a replayed ceremony after helper reinitialization", async () => {
    const firstStore = createPrismaAuthProtectionStore(firstClient);
    const secondStore = createPrismaAuthProtectionStore(secondClient);
    const { cookie } = issueCeremonyState({
      flow: "login",
      username: "mark",
    });

    await consumeCeremonyState(
      cookie.value,
      "login",
      { username: "mark" },
      new Date(),
      { store: firstStore }
    );

    await expect(
      consumeCeremonyState(
        cookie.value,
        "login",
        { username: "mark" },
        new Date(),
        { store: secondStore }
      )
    ).rejects.toThrowError(CeremonyStateError);
  });

  it("keeps throttling effective after helper reinitialization", async () => {
    const firstStore = createPrismaAuthProtectionStore(firstClient);
    const secondStore = createPrismaAuthProtectionStore(secondClient);
    const key = getLoginThrottleKey("mark");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await consumeThrottle(key, { store: firstStore })).allowed).toBe(true);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect((await consumeThrottle(key, { store: secondStore })).allowed).toBe(true);
    }

    const blocked = await consumeThrottle(key, { store: secondStore });

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });
});
