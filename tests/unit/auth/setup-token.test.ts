import { beforeEach, describe, expect, it } from "vitest";
import {
  SetupTokenReason,
  type Passkey,
  UserRole,
  UserStatus,
  type User,
  type UserSetupToken,
} from "@prisma/client";
import {
  createSetupToken,
  getActiveSetupToken,
  hashSetupToken,
  consumeSetupToken,
  revokeActiveSetupTokensForUser,
  type SetupTokenClientLike,
} from "@/lib/auth/setup-token";

type SetupTokenRecord = UserSetupToken & {
  user: User & { passkeys: Passkey[] };
  issuedByUser: User | null;
};

function createSetupTokenClient(): SetupTokenClientLike & { records: SetupTokenRecord[] } {
  const user: User & { passkeys: Passkey[] } = {
    id: "user_123",
    username: "mark",
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    createdAt: new Date("2026-04-04T00:00:00.000Z"),
    updatedAt: new Date("2026-04-04T00:00:00.000Z"),
    passkeys: [],
  };
  const records: SetupTokenRecord[] = [];

  return {
    records,
    userSetupToken: {
      async create({ data }) {
        const record: SetupTokenRecord = {
          id: `token_${records.length + 1}`,
          userId: data.userId,
          issuedByUserId: data.issuedByUserId ?? null,
          tokenHash: data.tokenHash,
          reason: data.reason,
          expiresAt: data.expiresAt,
          usedAt: null,
          revokedAt: null,
          createdAt: new Date("2026-04-04T00:00:00.000Z"),
          user,
          issuedByUser: null,
        };

        records.push(record);
        return record;
      },
      async findUnique({ where }) {
        return records.find((record) => record.tokenHash === where.tokenHash) ?? null;
      },
      async update({ where, data }) {
        const record = records.find((item) => item.id === where.id);

        if (!record) {
          throw new Error("Missing token");
        }

        Object.assign(record, data);
        return record;
      },
      async updateMany({ where, data }) {
        let count = 0;

        for (const record of records) {
          if (
            ("id" in where ? record.id === where.id : true) &&
            ("userId" in where ? record.userId === where.userId : true) &&
            ("usedAt" in where ? record.usedAt === where.usedAt : true) &&
            ("revokedAt" in where ? record.revokedAt === where.revokedAt : true)
          ) {
            if (
              where.expiresAt?.gt &&
              !(record.expiresAt.getTime() > where.expiresAt.gt.getTime())
            ) {
              continue;
            }

            Object.assign(record, data);
            count += 1;
          }
        }

        return { count };
      },
    },
  };
}

describe("setup token helpers", () => {
  let client: ReturnType<typeof createSetupTokenClient>;

  beforeEach(() => {
    client = createSetupTokenClient();
  });

  it("hashes tokens deterministically", () => {
    expect(hashSetupToken("abc")).toBe(hashSetupToken("abc"));
  });

  it("creates active setup tokens with a setup path", async () => {
    const created = await createSetupToken(client, {
      userId: "user_123",
      reason: SetupTokenReason.INITIAL_ENROLLMENT,
      now: new Date("2026-04-04T18:00:00.000Z"),
    });

    const loaded = await getActiveSetupToken(client, created.rawToken);

    expect(created.setupPath).toContain(created.rawToken);
    expect(loaded?.id).toBe(created.record.id);
  });

  it("consumes setup tokens once", async () => {
    const created = await createSetupToken(client, {
      userId: "user_123",
    });

    const consumed = await consumeSetupToken(client, created.rawToken);
    const secondConsume = await consumeSetupToken(client, created.rawToken);

    expect(consumed?.usedAt).toBeInstanceOf(Date);
    expect(secondConsume).toBeNull();
  });

  it("rejects expired setup tokens", async () => {
    const created = await createSetupToken(client, {
      userId: "user_123",
      now: new Date("2026-04-04T18:00:00.000Z"),
      ttlMs: 1_000,
    });

    const loaded = await getActiveSetupToken(
      client,
      created.rawToken,
      new Date("2026-04-04T18:00:02.000Z")
    );

    expect(loaded).toBeNull();
  });

  it("revokes all active tokens for a user", async () => {
    await createSetupToken(client, { userId: "user_123" });
    await createSetupToken(client, { userId: "user_123", reason: SetupTokenReason.RECOVERY });

    const revokedCount = await revokeActiveSetupTokensForUser(
      client,
      "user_123",
      new Date("2026-04-04T18:00:00.000Z")
    );

    expect(revokedCount).toBe(2);
    expect(client.records.every((record) => record.revokedAt instanceof Date)).toBe(true);
  });
});
