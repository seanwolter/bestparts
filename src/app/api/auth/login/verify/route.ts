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
  getClientIpAddress,
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

  let ceremonyState;
  let clearedCeremonyCookie;

  try {
    const consumed = consumeCeremonyState(
      request.cookies.get("bestparts_webauthn_login")?.value,
      "login",
      {
        userId: user.id,
        username: user.username,
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

  const passkey = user.passkeys.find(
    (entry) => entry.credentialId === authenticationResponse.id
  );

  if (!passkey) {
    return jsonError(GENERIC_LOGIN_FAILURE_MESSAGE);
  }

  const verification = await verifyAuthentication({
    response: authenticationResponse,
    expectedChallenge: ceremonyState.challenge,
    passkey: {
      credentialId: passkey.credentialId,
      publicKey: passkey.publicKey,
      counter: passkey.counter,
      transports: passkey.transports,
    },
  });

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

    return createSession(tx, user.id);
  });

  const response = NextResponse.json({
    ok: true,
    username: user.username,
  });

  applyCookies(response, [
    clearedCeremonyCookie,
    buildSessionCookie(result.sessionToken, result.session.expiresAt),
  ]);

  return response;
}
