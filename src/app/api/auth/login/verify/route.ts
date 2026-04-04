import { NextRequest, NextResponse } from "next/server";
import { UserStatus } from "@prisma/client";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { buildSessionCookie } from "@/lib/auth/cookies";
import { consumeCeremonyState, CeremonyStateError } from "@/lib/auth/challenge";
import { createSession } from "@/lib/auth/session";
import {
  consumeThrottle,
  GENERIC_LOGIN_FAILURE_MESSAGE,
  getLoginThrottleKey,
  mapVerifiedAuthenticationToPasskeyUpdate,
  verifyAuthentication,
} from "@/lib/auth/webauthn";
import {
  AUTH_RATE_LIMIT_ERROR,
  applyCookies,
  getAuthThrottleIpAddress,
  isWebAuthnConfigurationError,
  jsonError,
  parseJsonBody,
} from "../../_shared";

interface LoginVerifyBody {
  username?: string;
  response?: AuthenticationResponseJSON;
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBody<LoginVerifyBody>(request);
  const username = body?.username?.trim();
  const authenticationResponse = body?.response;

  if (!username || !authenticationResponse) {
    return jsonError(GENERIC_LOGIN_FAILURE_MESSAGE);
  }

  const throttle = await consumeThrottle(
    getLoginThrottleKey(username, getAuthThrottleIpAddress(request))
  );

  if (!throttle.allowed) {
    return jsonError(AUTH_RATE_LIMIT_ERROR, 429);
  }

  let ceremonyState;
  let clearedCeremonyCookie;

  try {
    const consumed = await consumeCeremonyState(
      request.cookies.get("bestparts_webauthn_login")?.value,
      "login",
      {
        username,
      }
    );
    ceremonyState = consumed.state;
    clearedCeremonyCookie = consumed.clearedCookie;
  } catch (error) {
    if (error instanceof CeremonyStateError) {
      return jsonError(GENERIC_LOGIN_FAILURE_MESSAGE);
    }

    throw error;
  }

  const passkey = await db.passkey.findUnique({
    where: {
      credentialId: authenticationResponse.id,
    },
    include: {
      user: true,
    },
  });

  if (
    !passkey ||
    passkey.user.status !== UserStatus.ACTIVE ||
    passkey.user.username !== username
  ) {
    return jsonError(GENERIC_LOGIN_FAILURE_MESSAGE);
  }

  let verification;

  try {
    verification = await verifyAuthentication({
      response: authenticationResponse,
      expectedChallenge: ceremonyState.challenge,
      passkey: {
        credentialId: passkey.credentialId,
        publicKey: passkey.publicKey,
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });
  } catch (error) {
    if (isWebAuthnConfigurationError(error)) {
      throw error;
    }

    return jsonError(GENERIC_LOGIN_FAILURE_MESSAGE);
  }

  if (!verification.verified) {
    return jsonError(GENERIC_LOGIN_FAILURE_MESSAGE);
  }

  const updatedPasskey = mapVerifiedAuthenticationToPasskeyUpdate(verification);
  const result = await db.$transaction(async (tx) => {
    await tx.passkey.update({
      where: { id: passkey.id },
      data: {
        counter: updatedPasskey.counter,
        deviceType: updatedPasskey.deviceType,
        backedUp: updatedPasskey.backedUp,
        lastUsedAt: new Date(),
      },
    });

    return createSession(tx, passkey.user.id);
  });

  const response = NextResponse.json({
    ok: true,
    username: passkey.user.username,
  });

  applyCookies(response, [
    clearedCeremonyCookie,
    buildSessionCookie(result.sessionToken, result.session.expiresAt),
  ]);

  return response;
}
