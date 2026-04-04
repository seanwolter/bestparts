import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function getPrismaDatasourceUrl(): string | undefined {
  if (process.env.NODE_ENV !== "test") {
    return undefined;
  }

  return process.env.DATABASE_URL_TEST?.trim() || undefined;
}

const datasourceUrl = getPrismaDatasourceUrl();

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: datasourceUrl
      ? {
          db: {
            url: datasourceUrl,
          },
        }
      : undefined,
    log: process.env.NODE_ENV === "development" ? ["error"] : [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
