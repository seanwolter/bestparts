import { NextRequest, NextResponse } from "next/server";
import { UserStatus } from "@prisma/client";
import { db } from "@/lib/db";
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
  getClientIpAddress,
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

  const throttle = consumeThrottle(
    getLoginThrottleKey(username, getClientIpAddress(request))
  );

  if (!throttle.allowed) {
    return jsonError(AUTH_RATE_LIMIT_ERROR, 429);
  }

  const user = await db.user.findUnique({
    where: { username },
    include: {
      passkeys: true,
    },
  });

  if (!user || user.status !== UserStatus.ACTIVE || user.passkeys.length === 0) {
    return jsonError(GENERIC_LOGIN_FAILURE_MESSAGE);
  }

  const { state, cookie } = issueCeremonyState({
    flow: "login",
    userId: user.id,
    username: user.username,
  });

  const options = await createAuthenticationOptionsForUser({
    challenge: state.challenge,
    passkeys: user.passkeys.map((passkey) => ({
      credentialId: passkey.credentialId,
      transports: passkey.transports,
    })),
  });

  const response = NextResponse.json({
    options,
  });

  applyCookie(response, cookie);

  return response;
}
