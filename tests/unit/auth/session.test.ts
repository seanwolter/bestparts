import { beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus, type Session, type User } from "@prisma/client";
import {
  createSession,
  getSessionByToken,
  hashSessionToken,
  refreshSession,
  revokeSessionByToken,
  shouldRefreshSession,
  type SessionClientLike,
} from "@/lib/auth/session";

type SessionRecord = Session & { user: User };

function createSessionClient(): SessionClientLike & {
  records: SessionRecord[];
} {
  const user: User = {
    id: "user_123",
    username: "mark",
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    createdAt: new Date("2026-04-04T00:00:00.000Z"),
    updatedAt: new Date("2026-04-04T00:00:00.000Z"),
  };

  const records: SessionRecord[] = [];

  return {
    records,
    session: {
      async create({ data }) {
        const record: SessionRecord = {
          id: `session_${records.length + 1}`,
          userId: data.userId,
          sessionTokenHash: data.sessionTokenHash,
          expiresAt: data.expiresAt,
          createdAt: data.lastUsedAt,
          lastUsedAt: data.lastUsedAt,
          revokedAt: null,
          user,
        };

        records.push(record);
        return record;
      },
      async findUnique({ where }) {
        return (
          records.find((record) => record.sessionTokenHash === where.sessionTokenHash) ?? null
        );
      },
      async update({ where, data }) {
        const record = records.find((item) => item.id === where.id);

        if (!record) {
          throw new Error("Missing session");
        }

        Object.assign(record, data);
        return record;
      },
      async updateMany({ where, data }) {
        let count = 0;

        for (const record of records) {
          if (
            ("userId" in where ? record.userId === where.userId : true) &&
            ("revokedAt" in where ? record.revokedAt === where.revokedAt : true) &&
            ("id" in where ? record.id === where.id : true)
          ) {
            Object.assign(record, data);
            count += 1;
          }
        }

        return { count };
      },
    },
  };
}

describe("session helpers", () => {
  let client: ReturnType<typeof createSessionClient>;

  beforeEach(() => {
    client = createSessionClient();
  });

  it("creates a raw session token and stores only its hash", async () => {
    const created = await createSession(client, "user_123", new Date("2026-04-04T18:00:00.000Z"));

    expect(created.sessionToken).toBeTruthy();
    expect(client.records[0]?.sessionTokenHash).toBe(hashSessionToken(created.sessionToken));
    expect(client.records[0]?.sessionTokenHash).not.toBe(created.sessionToken);
  });

  it("returns null and revokes expired sessions", async () => {
    const created = await createSession(client, "user_123", new Date("2026-04-04T18:00:00.000Z"), 1_000);
    const loaded = await getSessionByToken(
      client,
      created.sessionToken,
      new Date("2026-04-04T18:00:02.000Z")
    );

    expect(loaded).toBeNull();
    expect(client.records[0]?.revokedAt).toEqual(new Date("2026-04-04T18:00:02.000Z"));
  });

  it("refreshes active sessions", async () => {
    const created = await createSession(client, "user_123", new Date("2026-04-04T18:00:00.000Z"));
    const refreshed = await refreshSession(
      client,
      created.session.id,
      new Date("2026-04-05T18:00:00.000Z")
    );

    expect(refreshed.lastUsedAt).toEqual(new Date("2026-04-05T18:00:00.000Z"));
    expect(refreshed.expiresAt.getTime()).toBeGreaterThan(
      new Date("2026-04-05T18:00:00.000Z").getTime()
    );
  });

  it("revokes sessions by token", async () => {
    const created = await createSession(client, "user_123");
    const revoked = await revokeSessionByToken(client, created.sessionToken);

    expect(revoked).toBe(true);
    expect(client.records[0]?.revokedAt).toBeInstanceOf(Date);
  });

  it("flags sessions that are nearing expiry for refresh", () => {
    expect(
      shouldRefreshSession(
        {
          expiresAt: new Date("2026-04-10T00:00:00.000Z"),
        },
        new Date("2026-04-04T00:00:00.000Z")
      )
    ).toBe(true);
  });
});
