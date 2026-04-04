import { randomBytes, createHash } from "node:crypto";
import type { Prisma, Session, User } from "@prisma/client";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
export const SESSION_REFRESH_TTL_MS = 7 * 24 * 60 * 60_000;

export type SessionWithUser = Prisma.SessionGetPayload<{
  include: { user: true };
}>;

export interface SessionDelegateLike {
  create(args: {
    data: {
      userId: string;
      sessionTokenHash: string;
      expiresAt: Date;
      lastUsedAt: Date;
    };
  }): Promise<Session>;
  findUnique(args: {
    where: { sessionTokenHash: string };
    include: { user: true };
  }): Promise<SessionWithUser | null>;
  update(args: {
    where: { id: string };
    data: Partial<Pick<Session, "expiresAt" | "lastUsedAt" | "revokedAt">>;
  }): Promise<Session>;
  updateMany(args: {
    where: Partial<{
      id: string;
      userId: string;
      revokedAt: null | Date;
      expiresAt: { lt?: Date; gt?: Date };
    }>;
    data: Partial<Pick<Session, "revokedAt" | "lastUsedAt" | "expiresAt">>;
  }): Promise<{ count: number }>;
}

export interface SessionClientLike {
  session: SessionDelegateLike;
}

export interface CreatedSession {
  session: Session;
  sessionToken: string;
}

export interface CurrentSession extends Pick<Session, "id" | "expiresAt" | "lastUsedAt"> {
  user: Pick<User, "id" | "username" | "role" | "status">;
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(sessionToken: string): string {
  return createHash("sha256").update(sessionToken).digest("hex");
}

export async function createSession(
  client: SessionClientLike,
  userId: string,
  now = new Date(),
  ttlMs = SESSION_TTL_MS
): Promise<CreatedSession> {
  const sessionToken = createSessionToken();
  const session = await client.session.create({
    data: {
      userId,
      sessionTokenHash: hashSessionToken(sessionToken),
      expiresAt: new Date(now.getTime() + ttlMs),
      lastUsedAt: now,
    },
  });

  return {
    session,
    sessionToken,
  };
}

export async function getSessionByToken(
  client: SessionClientLike,
  sessionToken: string,
  now = new Date()
): Promise<CurrentSession | null> {
  const record = await client.session.findUnique({
    where: {
      sessionTokenHash: hashSessionToken(sessionToken),
    },
    include: {
      user: true,
    },
  });

  if (!record) {
    return null;
  }

  if (record.revokedAt || record.expiresAt.getTime() <= now.getTime()) {
    if (!record.revokedAt) {
      await client.session.update({
        where: { id: record.id },
        data: { revokedAt: now },
      });
    }

    return null;
  }

  return {
    id: record.id,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
    user: {
      id: record.user.id,
      username: record.user.username,
      role: record.user.role,
      status: record.user.status,
    },
  };
}

export function shouldRefreshSession(
  session: Pick<Session, "expiresAt">,
  now = new Date(),
  refreshThresholdMs = SESSION_REFRESH_TTL_MS
): boolean {
  return session.expiresAt.getTime() - now.getTime() <= refreshThresholdMs;
}

export async function refreshSession(
  client: SessionClientLike,
  sessionId: string,
  now = new Date(),
  ttlMs = SESSION_TTL_MS
): Promise<Session> {
  return client.session.update({
    where: { id: sessionId },
    data: {
      expiresAt: new Date(now.getTime() + ttlMs),
      lastUsedAt: now,
    },
  });
}

export async function touchSession(
  client: SessionClientLike,
  sessionId: string,
  now = new Date()
): Promise<Session> {
  return client.session.update({
    where: { id: sessionId },
    data: {
      lastUsedAt: now,
    },
  });
}

export async function revokeSessionById(
  client: SessionClientLike,
  sessionId: string,
  now = new Date()
): Promise<void> {
  await client.session.update({
    where: { id: sessionId },
    data: { revokedAt: now },
  });
}

export async function revokeSessionByToken(
  client: SessionClientLike,
  sessionToken: string,
  now = new Date()
): Promise<boolean> {
  const result = await client.session.updateMany({
    where: {
      sessionTokenHash: hashSessionToken(sessionToken),
      revokedAt: null,
    } as never,
    data: {
      revokedAt: now,
    },
  });

  return result.count > 0;
}

export async function revokeSessionsForUser(
  client: SessionClientLike,
  userId: string,
  now = new Date()
): Promise<number> {
  const result = await client.session.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt: now,
    },
  });

  return result.count;
}
