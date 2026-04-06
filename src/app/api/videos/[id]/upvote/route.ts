import { NextRequest, NextResponse } from "next/server";
import {
  MutationOriginError,
  assertSameOriginMutationRequest,
  getTrustedClientIpAddress,
  jsonForbidden,
  jsonRateLimitError,
  jsonVoteCooldownError,
} from "@/app/api/_shared";
import type { AuthCookieDescriptor } from "@/lib/auth/cookies";
import {
  consumeUpvoteThrottle,
  getUpvoteBrowserThrottleKey,
  getUpvoteEndpointIpThrottleKey,
  getUpvoteGlobalThrottleKey,
} from "@/lib/votes/rate-limit";
import { recordAnonymousUpvote } from "@/lib/votes/persist";
import { getOrCreateAnonymousVoter } from "@/lib/votes/voter-cookie";

const UPVOTE_RATE_LIMIT_ERROR = "Too many upvote attempts. Please try again later.";
const UPVOTE_COOLDOWN_ERROR = "This browser can upvote this video again later.";
const INVALID_ID_ERROR = "Invalid ID";
const VIDEO_NOT_FOUND_ERROR = "Video not found.";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOriginMutationRequest(request);
  } catch (error) {
    if (error instanceof MutationOriginError) {
      return jsonForbidden();
    }

    throw error;
  }

  const { id } = await params;
  const videoId = Number.parseInt(id, 10);

  if (!Number.isInteger(videoId) || String(videoId) !== id) {
    return NextResponse.json({ error: INVALID_ID_ERROR }, { status: 400 });
  }

  const anonymousVoter = getOrCreateAnonymousVoter(request);

  const globalThrottle = await consumeUpvoteThrottle(getUpvoteGlobalThrottleKey(), {
    scope: "global",
  });

  if (!globalThrottle.allowed) {
    return withAnonymousVoterCookie(
      jsonRateLimitError({
        error: UPVOTE_RATE_LIMIT_ERROR,
        retryAfterMs: globalThrottle.retryAfterMs,
        scope: "global",
      }),
      anonymousVoter.cookie
    );
  }

  const trustedClientIpAddress = getTrustedClientIpAddress(request);

  if (trustedClientIpAddress) {
    const ipThrottle = await consumeUpvoteThrottle(
      getUpvoteEndpointIpThrottleKey(trustedClientIpAddress),
      {
        scope: "ip",
      }
    );

    if (!ipThrottle.allowed) {
      return withAnonymousVoterCookie(
        jsonRateLimitError({
          error: UPVOTE_RATE_LIMIT_ERROR,
          retryAfterMs: ipThrottle.retryAfterMs,
          scope: "ip",
        }),
        anonymousVoter.cookie
      );
    }
  }

  const browserThrottle = await consumeUpvoteThrottle(
    getUpvoteBrowserThrottleKey(videoId, anonymousVoter.voterId)
  );

  if (!browserThrottle.allowed) {
    return withAnonymousVoterCookie(
      jsonRateLimitError({
        error: UPVOTE_RATE_LIMIT_ERROR,
        retryAfterMs: browserThrottle.retryAfterMs,
        scope: "browser",
      }),
      anonymousVoter.cookie
    );
  }

  const persistenceResult = await recordAnonymousUpvote({
    videoId,
    voterKeyHash: anonymousVoter.voterKeyHash,
    now: new Date(),
  });

  if (persistenceResult.kind === "missing") {
    return withAnonymousVoterCookie(
      NextResponse.json({ error: VIDEO_NOT_FOUND_ERROR }, { status: 404 }),
      anonymousVoter.cookie
    );
  }

  if (persistenceResult.kind === "cooldown") {
    return withAnonymousVoterCookie(
      jsonVoteCooldownError({
        error: UPVOTE_COOLDOWN_ERROR,
        retryAfterMs: persistenceResult.retryAfterMs,
        nextEligibleUpvoteAt: persistenceResult.nextEligibleUpvoteAt,
      }),
      anonymousVoter.cookie
    );
  }

  return withAnonymousVoterCookie(
    NextResponse.json({
      upvoteCount: persistenceResult.upvoteCount,
      nextEligibleUpvoteAt: persistenceResult.nextEligibleUpvoteAt.toISOString(),
    }),
    anonymousVoter.cookie
  );
}

function withAnonymousVoterCookie(
  response: NextResponse,
  cookie: AuthCookieDescriptor | null
): NextResponse {
  if (!cookie) {
    return response;
  }

  response.cookies.set({
    name: cookie.name,
    value: cookie.value,
    ...cookie.options,
  });

  return response;
}
