import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  decodeSignedCookiePayload,
  encodeSignedCookiePayload,
  getDefaultCookieOptions,
  type AuthCookieDescriptor,
} from "@/lib/auth/cookies";

export const ANONYMOUS_VOTER_COOKIE_NAME = "bestparts_voter";
export const ANONYMOUS_VOTER_COOKIE_VERSION = 1;
export const ANONYMOUS_VOTER_COOKIE_TTL_MS = 365 * 24 * 60 * 60_000;

const ANONYMOUS_VOTER_COOKIE_MAX_AGE_SECONDS = Math.floor(
  ANONYMOUS_VOTER_COOKIE_TTL_MS / 1000
);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AnonymousVoterCookiePayload {
  version: typeof ANONYMOUS_VOTER_COOKIE_VERSION;
  voterId: string;
}

export interface AnonymousVoterIdentity {
  voterId: string;
  voterKeyHash: string;
  cookie: AuthCookieDescriptor | null;
}

export function getOrCreateAnonymousVoter(
  request: Pick<NextRequest, "cookies">,
  now = new Date()
): AnonymousVoterIdentity {
  const rawCookieValue = request.cookies.get(ANONYMOUS_VOTER_COOKIE_NAME)?.value;
  const payload = tryReadAnonymousVoterCookie(rawCookieValue);

  if (payload) {
    return {
      voterId: payload.voterId,
      voterKeyHash: hashAnonymousVoterId(payload.voterId),
      cookie: null,
    };
  }

  const voterId = randomUUID();

  return {
    voterId,
    voterKeyHash: hashAnonymousVoterId(voterId),
    cookie: buildAnonymousVoterCookie(
      {
        version: ANONYMOUS_VOTER_COOKIE_VERSION,
        voterId,
      },
      now
    ),
  };
}

export function buildAnonymousVoterCookie(
  payload: AnonymousVoterCookiePayload,
  now = new Date()
): AuthCookieDescriptor {
  const normalizedPayload = normalizeAnonymousVoterCookiePayload(payload);
  const expires = new Date(now.getTime() + ANONYMOUS_VOTER_COOKIE_TTL_MS);

  return {
    name: ANONYMOUS_VOTER_COOKIE_NAME,
    value: encodeSignedCookiePayload(normalizedPayload),
    options: {
      ...getDefaultCookieOptions(),
      expires,
      maxAge: ANONYMOUS_VOTER_COOKIE_MAX_AGE_SECONDS,
    },
  };
}

export function tryReadAnonymousVoterCookie(
  rawCookieValue: string | undefined
): AnonymousVoterCookiePayload | null {
  if (!rawCookieValue) {
    return null;
  }

  try {
    return normalizeAnonymousVoterCookiePayload(
      decodeSignedCookiePayload<AnonymousVoterCookiePayload>(rawCookieValue)
    );
  } catch {
    return null;
  }
}

export function hashAnonymousVoterId(voterId: string): string {
  const normalizedVoterId = normalizeVoterId(voterId);

  if (!normalizedVoterId) {
    throw new Error("Anonymous voter ID is invalid.");
  }

  return createHash("sha256").update(normalizedVoterId).digest("hex");
}

function normalizeAnonymousVoterCookiePayload(
  payload: unknown
): AnonymousVoterCookiePayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Anonymous voter cookie payload is invalid.");
  }

  const candidate = payload as Partial<AnonymousVoterCookiePayload>;
  const voterId = normalizeVoterId(candidate.voterId);

  if (candidate.version !== ANONYMOUS_VOTER_COOKIE_VERSION || !voterId) {
    throw new Error("Anonymous voter cookie payload is invalid.");
  }

  return {
    version: ANONYMOUS_VOTER_COOKIE_VERSION,
    voterId,
  };
}

function normalizeVoterId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return UUID_PATTERN.test(normalized) ? normalized : null;
}
