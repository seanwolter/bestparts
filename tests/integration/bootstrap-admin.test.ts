import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, SetupTokenReason, UserRole, UserStatus } from "@prisma/client";
import { bootstrapFirstAdmin } from "../../prisma/seed";
import { hashSetupToken } from "../../src/lib/auth/setup-token";
import { getTestDatabaseUrl } from "../setup/test-db";

describe("bootstrap first admin", () => {
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

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.videoUpvote.deleteMany();
    await prisma.video.deleteMany();
    await prisma.userSetupToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.passkey.deleteMany();
    await prisma.user.deleteMany();
  });

  async function createPasskey(userId: string, credentialId: string) {
    return prisma.passkey.create({
      data: {
        userId,
        credentialId,
        publicKey: Buffer.from("public-key").toString("base64url"),
        counter: 1,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        webAuthnUserID: Buffer.from(userId).toString("base64url"),
      },
    });
  }

  it("creates the first admin and issues a setup URL", async () => {
    const result = await bootstrapFirstAdmin(prisma, {
      username: "bootstrap-admin",
      baseUrl: "http://localhost:3000",
    });

    const user = await prisma.user.findUnique({
      where: { username: "bootstrap-admin" },
      include: {
        setupTokens: true,
      },
    });

    expect(result.createdUser).toBe(true);
    expect(result.setupUrl).toContain("/setup/");
    expect(user?.role).toBe(UserRole.ADMIN);
    expect(user?.status).toBe(UserStatus.PENDING_SETUP);
    expect(user?.setupTokens).toHaveLength(1);
  });

  it("reissues a setup token for the same pending bootstrap user", async () => {
    const first = await bootstrapFirstAdmin(prisma, {
      username: "bootstrap-admin",
      baseUrl: "http://localhost:3000",
    });
    const second = await bootstrapFirstAdmin(prisma, {
      username: "bootstrap-admin",
      baseUrl: "http://localhost:3000",
    });

    const tokens = await prisma.userSetupToken.findMany({
      orderBy: { createdAt: "asc" },
    });

    expect(first.setupUrl).not.toBe(second.setupUrl);
    expect(second.createdUser).toBe(false);
    expect(second.revokedTokenCount).toBe(1);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]?.revokedAt).toBeInstanceOf(Date);
    expect(tokens[1]?.revokedAt).toBeNull();
  });

  it("refuses bootstrap when a different user already exists", async () => {
    const existingUser = await prisma.user.create({
      data: {
        username: "existing-admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });

    await expect(
      bootstrapFirstAdmin(prisma, {
        username: "bootstrap-admin",
        baseUrl: "http://localhost:3000",
      })
    ).rejects.toThrowError(
      "Bootstrap is only allowed before the system has additional users."
    );

    await expect(
      prisma.user.findUnique({
        where: {
          username: "bootstrap-admin",
        },
      })
    ).resolves.toBeNull();
    await expect(prisma.userSetupToken.count()).resolves.toBe(0);
    await expect(
      prisma.user.findUnique({
        where: {
          id: existingUser.id,
        },
      })
    ).resolves.toMatchObject({
      username: "existing-admin",
      status: UserStatus.ACTIVE,
      role: UserRole.ADMIN,
    });
  });

  it("refuses bootstrap when the bootstrap username exists but other users are also present", async () => {
    const bootstrapUser = await prisma.user.create({
      data: {
        username: "bootstrap-admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    const unrelatedUser = await prisma.user.create({
      data: {
        username: "other-admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    const existingToken = await prisma.userSetupToken.create({
      data: {
        userId: bootstrapUser.id,
        tokenHash: hashSetupToken("existing-bootstrap-token"),
        reason: SetupTokenReason.INITIAL_ENROLLMENT,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await expect(
      bootstrapFirstAdmin(prisma, {
        username: "bootstrap-admin",
        baseUrl: "http://localhost:3000",
      })
    ).rejects.toThrowError(
      "Bootstrap user already exists, but other users are also present."
    );

    await expect(
      prisma.user.findUnique({
        where: {
          id: bootstrapUser.id,
        },
      })
    ).resolves.toMatchObject({
      status: UserStatus.ACTIVE,
      role: UserRole.ADMIN,
    });
    await expect(
      prisma.user.findUnique({
        where: {
          id: unrelatedUser.id,
        },
      })
    ).resolves.toMatchObject({
      username: "other-admin",
      status: UserStatus.ACTIVE,
    });
    await expect(
      prisma.userSetupToken.findMany({
        where: {
          userId: bootstrapUser.id,
        },
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: existingToken.id,
        revokedAt: null,
        usedAt: null,
      }),
    ]);
  });

  it("refuses bootstrap when the bootstrap user already has passkeys", async () => {
    const bootstrapUser = await prisma.user.create({
      data: {
        username: "bootstrap-admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    const existingToken = await prisma.userSetupToken.create({
      data: {
        userId: bootstrapUser.id,
        tokenHash: hashSetupToken("existing-passkey-token"),
        reason: SetupTokenReason.INITIAL_ENROLLMENT,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await createPasskey(bootstrapUser.id, "credential-bootstrap-admin");

    await expect(
      bootstrapFirstAdmin(prisma, {
        username: "bootstrap-admin",
        baseUrl: "http://localhost:3000",
      })
    ).rejects.toThrowError(
      'User "bootstrap-admin" already has registered passkeys.'
    );

    await expect(
      prisma.user.findUnique({
        where: {
          id: bootstrapUser.id,
        },
      })
    ).resolves.toMatchObject({
      status: UserStatus.ACTIVE,
      role: UserRole.ADMIN,
    });
    await expect(
      prisma.passkey.count({
        where: {
          userId: bootstrapUser.id,
        },
      })
    ).resolves.toBe(1);
    await expect(
      prisma.userSetupToken.findMany({
        where: {
          userId: bootstrapUser.id,
        },
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: existingToken.id,
        revokedAt: null,
        usedAt: null,
      }),
    ]);
  });
});
