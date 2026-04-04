import { NextRequest, NextResponse } from "next/server";
import type { AuthCookieDescriptor } from "@/lib/auth/cookies";

export const AUTH_RATE_LIMIT_ERROR = "Too many attempts. Please try again later.";
export const INVALID_SETUP_TOKEN_ERROR = "Setup token is invalid or expired.";

export async function parseJsonBody<T>(request: NextRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function getClientIpAddress(request: NextRequest): string | undefined {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim();
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
