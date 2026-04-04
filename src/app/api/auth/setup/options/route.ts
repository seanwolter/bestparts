import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashSetupToken, getActiveSetupToken } from "@/lib/auth/setup-token";
import { issueCeremonyState } from "@/lib/auth/challenge";
import {
  AUTH_RATE_LIMIT_ERROR,
  INVALID_SETUP_TOKEN_ERROR,
  applyCookie,
  getAuthThrottleIpAddress,
  jsonError,
  parseJsonBody,
} from "../../_shared";
import {
  consumeThrottle,
  createRegistrationOptionsForUser,
  getSetupThrottleKey,
} from "@/lib/auth/webauthn";

interface SetupOptionsBody {
  token?: string;
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBody<SetupOptionsBody>(request);
  const token = body?.token?.trim();

  if (!token) {
    return jsonError(INVALID_SETUP_TOKEN_ERROR);
  }

  const throttle = await consumeThrottle(
    getSetupThrottleKey(hashSetupToken(token), getAuthThrottleIpAddress(request))
  );

  if (!throttle.allowed) {
    return jsonError(AUTH_RATE_LIMIT_ERROR, 429);
  }

  const setupToken = await getActiveSetupToken(db, token);

  if (!setupToken) {
    return jsonError(INVALID_SETUP_TOKEN_ERROR);
  }

  const { state, cookie } = issueCeremonyState({
    flow: "setup",
    userId: setupToken.user.id,
    username: setupToken.user.username,
  });

  const options = await createRegistrationOptionsForUser({
    user: {
      id: setupToken.user.id,
      username: setupToken.user.username,
    },
    challenge: state.challenge,
    passkeys: setupToken.user.passkeys.map((passkey) => ({
      credentialId: passkey.credentialId,
      transports: passkey.transports,
    })),
  });

  const response = NextResponse.json({
    options,
    user: {
      username: setupToken.user.username,
      status: setupToken.user.status,
      reason: setupToken.reason,
    },
  });

  applyCookie(response, cookie);

  return response;
}
