import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getTestDatabaseUrl } from "../setup/test-db";

describe("integration database setup", () => {
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

  it("connects to the isolated postgres test database", async () => {
    const result = await prisma.$queryRaw<Array<{ value: number }>>`SELECT 1 as value`;

    expect(result[0]?.value).toBe(1);
  });
});
