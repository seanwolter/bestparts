import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, UserRole, UserStatus } from "@prisma/client";
import { bootstrapFirstAdmin } from "../../prisma/seed";
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
    await prisma.userSetupToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.passkey.deleteMany();
    await prisma.user.deleteMany();
  });

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
});
