import { NextRequest, NextResponse } from "next/server";
import { UserStatus } from "@prisma/client";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { buildSessionCookie } from "@/lib/auth/cookies";
import { consumeCeremonyState, CeremonyStateError } from "@/lib/auth/challenge";
import { createSession } from "@/lib/auth/session";
import { getActiveSetupToken, consumeSetupToken } from "@/lib/auth/setup-token";
import {
  GENERIC_SETUP_FAILURE_MESSAGE,
  consumeThrottle,
  getSetupThrottleKey,
  mapVerifiedRegistrationToPasskey,
  verifyRegistration,
} from "@/lib/auth/webauthn";
import {
  AUTH_RATE_LIMIT_ERROR,
  INVALID_SETUP_TOKEN_ERROR,
  applyCookies,
  getClientIpAddress,
  jsonError,
  parseJsonBody,
} from "../../_shared";

interface SetupVerifyBody {
  token?: string;
  response?: RegistrationResponseJSON;
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBody<SetupVerifyBody>(request);
  const token = body?.token?.trim();
  const registrationResponse = body?.response;

  if (!token || !registrationResponse) {
    return jsonError(GENERIC_SETUP_FAILURE_MESSAGE);
  }

  const throttle = consumeThrottle(
    getSetupThrottleKey(token, getClientIpAddress(request))
  );

  if (!throttle.allowed) {
    return jsonError(AUTH_RATE_LIMIT_ERROR, 429);
  }

  const setupToken = await getActiveSetupToken(db, token);

  if (!setupToken) {
    return jsonError(INVALID_SETUP_TOKEN_ERROR);
  }

  let ceremonyState;
  let clearedCeremonyCookie;

  try {
    const consumed = consumeCeremonyState(
      request.cookies.get("bestparts_webauthn_setup")?.value,
      "setup",
      {
        userId: setupToken.user.id,
        username: setupToken.user.username,
      }
    );
    ceremonyState = consumed.state;
    clearedCeremonyCookie = consumed.clearedCookie;
  } catch (error) {
    if (error instanceof CeremonyStateError) {
      return jsonError(GENERIC_SETUP_FAILURE_MESSAGE);
    }

    throw error;
  }

  const verification = await verifyRegistration({
    response: registrationResponse,
    expectedChallenge: ceremonyState.challenge,
  });

  if (!verification.verified) {
    return jsonError(GENERIC_SETUP_FAILURE_MESSAGE);
  }

  const result = await db.$transaction(async (tx) => {
    const consumedToken = await consumeSetupToken(tx, token);

    if (!consumedToken) {
      throw new Error(INVALID_SETUP_TOKEN_ERROR);
    }

    const passkey = mapVerifiedRegistrationToPasskey(
      verification,
      consumedToken.user.id,
      registrationResponse.response.transports ?? []
    );

    await tx.passkey.create({
      data: {
        userId: consumedToken.user.id,
        credentialId: passkey.credentialId,
        publicKey: passkey.publicKey,
        counter: passkey.counter,
        transports: passkey.transports,
        deviceType: passkey.deviceType,
        backedUp: passkey.backedUp,
        webAuthnUserID: passkey.webAuthnUserID,
      },
    });

    await tx.user.update({
      where: { id: consumedToken.user.id },
      data: { status: UserStatus.ACTIVE },
    });

    return createSession(tx, consumedToken.user.id);
  });

  const response = NextResponse.json({
    ok: true,
    username: setupToken.user.username,
  });

  applyCookies(response, [
    clearedCeremonyCookie,
    buildSessionCookie(result.sessionToken, result.session.expiresAt),
  ]);

  return response;
}
