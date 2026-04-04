import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { SESSION_COOKIE_NAME } from "./cookies";
import {
  getSessionByToken,
  type CurrentSession,
  type SessionClientLike,
} from "./session";
import { assertAdmin } from "./permissions";

export interface CookieReaderLike {
  get(name: string): { value: string } | undefined;
}

export interface CurrentUser {
  id: string;
  username: string;
  role: CurrentSession["user"]["role"];
  status: CurrentSession["user"]["status"];
  sessionId: string;
  sessionExpiresAt: Date;
  sessionLastUsedAt: Date;
}

export class AuthenticationError extends Error {
  readonly status = 401;

  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function getCurrentUser(
  client: SessionClientLike = db
): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  return getCurrentUserFromCookieStore(cookieStore, client);
}

export async function getCurrentUserFromCookieStore(
  cookieStore: CookieReaderLike,
  client: SessionClientLike = db
): Promise<CurrentUser | null> {
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return null;
  }

  const session = await getSessionByToken(client, sessionToken);

  if (!session) {
    return null;
  }

  return mapSessionToCurrentUser(session);
}

export async function verifySession(
  client: SessionClientLike = db
): Promise<CurrentUser> {
  const currentUser = await getCurrentUser(client);

  if (!currentUser) {
    throw new AuthenticationError();
  }

  return currentUser;
}

export async function requireAdmin(
  client: SessionClientLike = db
): Promise<CurrentUser> {
  const currentUser = await verifySession(client);
  assertAdmin(currentUser);
  return currentUser;
}

function mapSessionToCurrentUser(session: CurrentSession): CurrentUser {
  return {
    id: session.user.id,
    username: session.user.username,
    role: session.user.role,
    status: session.user.status,
    sessionId: session.id,
    sessionExpiresAt: session.expiresAt,
    sessionLastUsedAt: session.lastUsedAt,
  };
}
