import { createHmac, timingSafeEqual } from "node:crypto";

export type AuthFlow = "login" | "setup";

export interface AuthCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  path: string;
  expires?: Date;
  maxAge?: number;
}

export interface AuthCookieDescriptor {
  name: string;
  value: string;
  options: AuthCookieOptions;
}

export interface SignedCeremonyCookiePayload {
  flow: AuthFlow;
  challenge: string;
  expiresAt: string;
  nonce: string;
  userId?: string;
  username?: string;
}

export const SESSION_COOKIE_NAME = "bestparts_session";
export const CEREMONY_COOKIE_PREFIX = "bestparts_webauthn";

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error("Missing SESSION_SECRET.");
  }

  return secret;
}

export function getDefaultCookieOptions(): AuthCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}

export function getCeremonyCookieName(flow: AuthFlow): string {
  return `${CEREMONY_COOKIE_PREFIX}_${flow}`;
}

export function buildSessionCookie(
  sessionToken: string,
  expiresAt: Date
): AuthCookieDescriptor {
  return {
    name: SESSION_COOKIE_NAME,
    value: sessionToken,
    options: {
      ...getDefaultCookieOptions(),
      expires: expiresAt,
    },
  };
}

export function buildExpiredSessionCookie(): AuthCookieDescriptor {
  return {
    name: SESSION_COOKIE_NAME,
    value: "",
    options: {
      ...getDefaultCookieOptions(),
      expires: new Date(0),
      maxAge: 0,
    },
  };
}

export function buildCeremonyCookie(
  payload: SignedCeremonyCookiePayload
): AuthCookieDescriptor {
  return {
    name: getCeremonyCookieName(payload.flow),
    value: encodeSignedCookiePayload(payload),
    options: {
      ...getDefaultCookieOptions(),
      expires: new Date(payload.expiresAt),
    },
  };
}

export function buildExpiredCeremonyCookie(flow: AuthFlow): AuthCookieDescriptor {
  return {
    name: getCeremonyCookieName(flow),
    value: "",
    options: {
      ...getDefaultCookieOptions(),
      expires: new Date(0),
      maxAge: 0,
    },
  };
}

export function encodeSignedCookiePayload(payload: unknown): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signCookiePayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function decodeSignedCookiePayload<T>(value: string): T {
  const [encodedPayload, encodedSignature] = value.split(".");

  if (!encodedPayload || !encodedSignature) {
    throw new Error("Invalid signed cookie format.");
  }

  const expectedSignature = signCookiePayload(encodedPayload);

  if (!safeCompare(encodedSignature, expectedSignature)) {
    throw new Error("Invalid signed cookie signature.");
  }

  return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as T;
}

function signCookiePayload(encodedPayload: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}
