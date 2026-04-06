import { NextRequest, NextResponse } from "next/server";
import {
  assertSameOriginMutationRequest,
  jsonForbidden,
  MutationOriginError,
} from "@/app/api/_shared";
import { db } from "@/lib/db";
import { buildExpiredSessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { revokeSessionByToken } from "@/lib/auth/session";
import { applyCookie } from "../_shared";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutationRequest(request);
  } catch (error) {
    if (error instanceof MutationOriginError) {
      return jsonForbidden();
    }

    throw error;
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (sessionToken) {
    await revokeSessionByToken(db, sessionToken);
  }

  const response = NextResponse.json({ ok: true });
  applyCookie(response, buildExpiredSessionCookie());
  return response;
}
