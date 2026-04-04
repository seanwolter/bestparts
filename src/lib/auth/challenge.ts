import { randomBytes } from "node:crypto";
import {
  buildCeremonyCookie,
  buildExpiredCeremonyCookie,
  decodeSignedCookiePayload,
  type AuthCookieDescriptor,
  type AuthFlow,
  type SignedCeremonyCookiePayload,
} from "./cookies";

export const CEREMONY_TTL_MS = 10 * 60_000;

export type CeremonyErrorCode =
  | "missing"
  | "invalid"
  | "expired"
  | "replayed"
  | "flow_mismatch"
  | "principal_mismatch";

export interface CeremonyPrincipalBinding {
  userId?: string;
  username?: string;
}

export interface CeremonyState extends CeremonyPrincipalBinding {
  flow: AuthFlow;
  challenge: string;
  expiresAt: Date;
  nonce: string;
}

const consumedCeremonyNonces = new Map<string, number>();

export interface IssueCeremonyStateOptions extends CeremonyPrincipalBinding {
  flow: AuthFlow;
  now?: Date;
  ttlMs?: number;
}

export class CeremonyStateError extends Error {
  constructor(
    readonly code: CeremonyErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CeremonyStateError";
  }
}

export function issueCeremonyState(
  options: IssueCeremonyStateOptions
): { state: CeremonyState; cookie: AuthCookieDescriptor } {
  const now = options.now ?? new Date();
  pruneConsumedCeremonyNonces(now);
  const expiresAt = new Date(now.getTime() + (options.ttlMs ?? CEREMONY_TTL_MS));
  const state: CeremonyState = {
    flow: options.flow,
    challenge: randomBytes(32).toString("base64url"),
    expiresAt,
    nonce: randomBytes(16).toString("base64url"),
    userId: normalizePrincipalValue(options.userId),
    username: normalizePrincipalValue(options.username),
  };

  return {
    state,
    cookie: buildCeremonyCookie({
      ...serializeCeremonyState(state),
    }),
  };
}

export function readCeremonyState(
  rawCookieValue: string | undefined,
  expectedFlow: AuthFlow,
  expectedPrincipal?: CeremonyPrincipalBinding,
  now = new Date()
): CeremonyState {
  pruneConsumedCeremonyNonces(now);

  if (!rawCookieValue) {
    throw new CeremonyStateError("missing", "Missing ceremony cookie.");
  }

  let payload: SignedCeremonyCookiePayload;

  try {
    payload = decodeSignedCookiePayload<SignedCeremonyCookiePayload>(rawCookieValue);
  } catch {
    throw new CeremonyStateError("invalid", "Invalid ceremony cookie.");
  }

  const state = deserializeCeremonyState(payload);

  if (state.flow !== expectedFlow) {
    throw new CeremonyStateError("flow_mismatch", "Ceremony flow did not match.");
  }

  if (state.expiresAt.getTime() <= now.getTime()) {
    throw new CeremonyStateError("expired", "Ceremony state has expired.");
  }

  if (!matchesPrincipal(state, expectedPrincipal)) {
    throw new CeremonyStateError(
      "principal_mismatch",
      "Ceremony principal binding did not match."
    );
  }

  return state;
}

export function consumeCeremonyState(
  rawCookieValue: string | undefined,
  expectedFlow: AuthFlow,
  expectedPrincipal?: CeremonyPrincipalBinding,
  now = new Date()
): { state: CeremonyState; clearedCookie: AuthCookieDescriptor } {
  const state = readCeremonyState(
    rawCookieValue,
    expectedFlow,
    expectedPrincipal,
    now
  );

  const nonceKey = getCeremonyNonceKey(state);

  if (consumedCeremonyNonces.has(nonceKey)) {
    throw new CeremonyStateError("replayed", "Ceremony state was already used.");
  }

  consumedCeremonyNonces.set(nonceKey, state.expiresAt.getTime());

  return {
    state,
    clearedCookie: buildExpiredCeremonyCookie(expectedFlow),
  };
}

export function resetConsumedCeremonyState(): void {
  consumedCeremonyNonces.clear();
}

export function serializeCeremonyState(
  state: CeremonyState
): SignedCeremonyCookiePayload {
  return {
    flow: state.flow,
    challenge: state.challenge,
    expiresAt: state.expiresAt.toISOString(),
    nonce: state.nonce,
    userId: normalizePrincipalValue(state.userId),
    username: normalizePrincipalValue(state.username),
  };
}

function deserializeCeremonyState(
  payload: SignedCeremonyCookiePayload
): CeremonyState {
  if (
    typeof payload.challenge !== "string" ||
    typeof payload.expiresAt !== "string" ||
    typeof payload.nonce !== "string" ||
    (payload.flow !== "login" && payload.flow !== "setup")
  ) {
    throw new CeremonyStateError("invalid", "Ceremony payload was malformed.");
  }

  const expiresAt = new Date(payload.expiresAt);

  if (Number.isNaN(expiresAt.getTime())) {
    throw new CeremonyStateError("invalid", "Ceremony expiry was malformed.");
  }

  return {
    flow: payload.flow,
    challenge: payload.challenge,
    expiresAt,
    nonce: payload.nonce,
    userId: normalizePrincipalValue(payload.userId),
    username: normalizePrincipalValue(payload.username),
  };
}

function matchesPrincipal(
  state: CeremonyState,
  expectedPrincipal?: CeremonyPrincipalBinding
): boolean {
  if (!expectedPrincipal) {
    return true;
  }

  const expectedUserId = normalizePrincipalValue(expectedPrincipal.userId);
  const expectedUsername = normalizePrincipalValue(expectedPrincipal.username);

  if (expectedUserId && state.userId !== expectedUserId) {
    return false;
  }

  if (expectedUsername && state.username !== expectedUsername) {
    return false;
  }

  return true;
}

function normalizePrincipalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getCeremonyNonceKey(state: Pick<CeremonyState, "flow" | "nonce">): string {
  return `${state.flow}:${state.nonce}`;
}

function pruneConsumedCeremonyNonces(now: Date): void {
  const nowMs = now.getTime();

  for (const [nonceKey, expiresAt] of consumedCeremonyNonces.entries()) {
    if (expiresAt <= nowMs) {
      consumedCeremonyNonces.delete(nonceKey);
    }
  }
}
