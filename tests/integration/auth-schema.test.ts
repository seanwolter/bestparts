import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PrismaClient,
  SetupTokenReason,
  UserRole,
  UserStatus,
} from "@prisma/client";
import { hashSessionToken } from "@/lib/auth/session";
import { hashSetupToken } from "@/lib/auth/setup-token";
import { getTestDatabaseUrl } from "../setup/test-db";

describe("auth schema persistence", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: getTestDatabaseUrl(),
        },
      },
    });
  });

  beforeEach(async () => {
    await prisma.authThrottleBucket.deleteMany();
    await prisma.consumedCeremonyNonce.deleteMany();
    await prisma.userSetupToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.passkey.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persists and retrieves auth records with relations", async () => {
    const user = await prisma.user.create({
      data: {
        username: "auth-schema-admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });

    const sessionToken = "integration-session-token";
    const setupToken = "integration-setup-token";
    const throttleKeyHash = hashSetupToken("auth-schema-throttle");
    const nonceKeyHash = hashSetupToken("auth-schema-nonce");

    await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: "credential-123",
        publicKey: Buffer.from("public-key").toString("base64url"),
        counter: 7,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        webAuthnUserID: Buffer.from(user.id).toString("base64url"),
      },
    });

    await prisma.session.create({
      data: {
        userId: user.id,
        sessionTokenHash: hashSessionToken(sessionToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await prisma.userSetupToken.create({
      data: {
        userId: user.id,
        tokenHash: hashSetupToken(setupToken),
        reason: SetupTokenReason.INITIAL_ENROLLMENT,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await prisma.authThrottleBucket.create({
      data: {
        keyHash: throttleKeyHash,
        count: 3,
        resetAt: new Date(Date.now() + 60_000),
      },
    });

    await prisma.consumedCeremonyNonce.create({
      data: {
        nonceKeyHash,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const loaded = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        passkeys: true,
        sessions: true,
        setupTokens: true,
      },
    });

    expect(loaded?.passkeys).toHaveLength(1);
    expect(loaded?.sessions).toHaveLength(1);
    expect(loaded?.setupTokens).toHaveLength(1);
    expect(loaded?.passkeys[0]?.credentialId).toBe("credential-123");
    expect(loaded?.sessions[0]?.sessionTokenHash).toBe(
      hashSessionToken(sessionToken)
    );
    expect(loaded?.setupTokens[0]?.tokenHash).toBe(hashSetupToken(setupToken));
    await expect(
      prisma.authThrottleBucket.findUnique({
        where: {
          keyHash: throttleKeyHash,
        },
      })
    ).resolves.toMatchObject({
      keyHash: throttleKeyHash,
      count: 3,
    });
    await expect(
      prisma.consumedCeremonyNonce.findUnique({
        where: {
          nonceKeyHash,
        },
      })
    ).resolves.toMatchObject({
      nonceKeyHash,
    });
  });
});
