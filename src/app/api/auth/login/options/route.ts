import { NextRequest, NextResponse } from "next/server";
import { issueCeremonyState } from "@/lib/auth/challenge";
import {
  consumeThrottle,
  createAuthenticationOptionsForUser,
  GENERIC_LOGIN_FAILURE_MESSAGE,
  getLoginThrottleKey,
} from "@/lib/auth/webauthn";
import {
  AUTH_RATE_LIMIT_ERROR,
  applyCookie,
  getAuthThrottleIpAddress,
  jsonError,
  parseJsonBody,
} from "../../_shared";

interface LoginOptionsBody {
  username?: string;
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBody<LoginOptionsBody>(request);
  const username = body?.username?.trim();

  if (!username) {
    return jsonError(GENERIC_LOGIN_FAILURE_MESSAGE);
  }

  const throttle = await consumeThrottle(
    getLoginThrottleKey(username, getAuthThrottleIpAddress(request))
  );

  if (!throttle.allowed) {
    return jsonError(AUTH_RATE_LIMIT_ERROR, 429);
  }

  const { state, cookie } = issueCeremonyState({
    flow: "login",
    username,
  });

  const options = await createAuthenticationOptionsForUser({
    challenge: state.challenge,
  });

  const response = NextResponse.json({
    options,
  });

  applyCookie(response, cookie);

  return response;
}
