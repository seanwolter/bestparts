import { NextResponse, type NextRequest } from "next/server";

export const TRUST_PROXY_HEADERS_ENV = "AUTH_TRUST_PROXY_HEADERS";

const UNSAFE_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type JsonRateLimitScope = "browser" | "ip" | "global";

export class MutationOriginError extends Error {
  constructor(message = "Cross-site mutation requests are not allowed.") {
    super(message);
    this.name = "MutationOriginError";
  }
}

export function getTrustedClientIpAddress(
  request: Pick<NextRequest, "headers">
): string | undefined {
  if (!shouldTrustProxyHeaders()) {
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

export function assertSameOriginMutationRequest(
  request: Pick<NextRequest, "method" | "headers" | "nextUrl">
): void {
  if (!UNSAFE_HTTP_METHODS.has(request.method.toUpperCase())) {
    return;
  }

  const secFetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();

  if (secFetchSite === "cross-site") {
    throw new MutationOriginError();
  }

  const expectedOrigin = request.nextUrl.origin;
  const origin = request.headers.get("origin")?.trim();

  if (origin) {
    if (origin !== expectedOrigin) {
      throw new MutationOriginError();
    }

    return;
  }

  const referer = request.headers.get("referer")?.trim();

  if (referer) {
    let refererOrigin: string;

    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      throw new MutationOriginError();
    }

    if (refererOrigin !== expectedOrigin) {
      throw new MutationOriginError();
    }

    return;
  }

  if (secFetchSite === "same-origin") {
    return;
  }

  throw new MutationOriginError();
}

export function jsonForbidden(message = "Forbidden."): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function jsonRateLimitError(options: {
  error: string;
  retryAfterMs: number;
  scope: JsonRateLimitScope;
}): NextResponse {
  const headers = new Headers();

  if (options.retryAfterMs > 0) {
    headers.set(
      "Retry-After",
      String(Math.max(Math.ceil(options.retryAfterMs / 1000), 1))
    );
  }

  return NextResponse.json(
    {
      error: options.error,
      retryAfterMs: options.retryAfterMs,
      scope: options.scope,
    },
    {
      status: 429,
      headers,
    }
  );
}

export function jsonVoteCooldownError(options: {
  error: string;
  retryAfterMs: number;
  nextEligibleUpvoteAt: Date | string;
}): NextResponse {
  return NextResponse.json(
    {
      error: options.error,
      retryAfterMs: options.retryAfterMs,
      nextEligibleUpvoteAt: serializeDateLike(options.nextEligibleUpvoteAt),
    },
    {
      status: 409,
    }
  );
}

function shouldTrustProxyHeaders(): boolean {
  const value = process.env[TRUST_PROXY_HEADERS_ENV]?.trim().toLowerCase();

  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function serializeDateLike(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
