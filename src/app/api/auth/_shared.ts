import { NextRequest, NextResponse } from "next/server";
import type { AuthCookieDescriptor } from "@/lib/auth/cookies";

export const AUTH_RATE_LIMIT_ERROR = "Too many attempts. Please try again later.";
export const INVALID_SETUP_TOKEN_ERROR = "Setup token is invalid or expired.";
export const AUTH_TRUST_PROXY_HEADERS_ENV = "AUTH_TRUST_PROXY_HEADERS";
const WEBAUTHN_CONFIGURATION_ERRORS = new Set([
  "Missing WebAuthn configuration. Expected WEBAUTHN_RP_NAME, WEBAUTHN_RP_ID, and WEBAUTHN_ORIGIN.",
  "WEBAUTHN_ORIGIN must contain at least one origin.",
]);

export async function parseJsonBody<T>(request: NextRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function getAuthThrottleIpAddress(request: NextRequest): string | undefined {
  if (!shouldTrustAuthProxyHeaders()) {
    return undefined;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstForwardedAddress = forwardedFor
      .split(",")
      .map((value) => value.trim())
      .find(Boolean);

    if (firstForwardedAddress) {
      return firstForwardedAddress;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || undefined;
}

export function applyCookie(
  response: NextResponse,
  cookie: AuthCookieDescriptor
): void {
  response.cookies.set({
    name: cookie.name,
    value: cookie.value,
    ...cookie.options,
  });
}

export function applyCookies(
  response: NextResponse,
  cookies: AuthCookieDescriptor[]
): void {
  for (const cookie of cookies) {
    applyCookie(response, cookie);
  }
}

export function jsonError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function isWebAuthnConfigurationError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    WEBAUTHN_CONFIGURATION_ERRORS.has(error.message)
  );
}

function shouldTrustAuthProxyHeaders(): boolean {
  const value = process.env[AUTH_TRUST_PROXY_HEADERS_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}
