import { Prisma, SetupTokenReason, UserRole, UserStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  assertSameOriginMutationRequest,
  jsonForbidden,
  MutationOriginError,
} from "@/app/api/_shared";
import { db } from "@/lib/db";
import { createSetupToken } from "@/lib/auth/setup-token";
import { requireApiAdmin } from "@/lib/auth/route-auth";
import { jsonError, parseJsonBody } from "../auth/_shared";

interface CreateUserBody {
  username?: string;
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutationRequest(request);
  } catch (error) {
    if (error instanceof MutationOriginError) {
      return jsonForbidden();
    }

    throw error;
  }

  const currentUser = await requireApiAdmin(request);

  if (currentUser instanceof NextResponse) {
    return currentUser;
  }

  const body = await parseJsonBody<CreateUserBody>(request);
  const username = body?.username?.trim();

  if (!username) {
    return jsonError("Username is required.");
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          role: UserRole.ADMIN,
          status: UserStatus.PENDING_SETUP,
        },
      });

      const setupToken = await createSetupToken(tx, {
        userId: user.id,
        issuedByUserId: currentUser.id,
        reason: SetupTokenReason.INITIAL_ENROLLMENT,
      });

      return {
        user,
        setupToken,
      };
    });

    return NextResponse.json(
      {
        user: {
          id: result.user.id,
          username: result.user.username,
          role: result.user.role,
          status: result.user.status,
        },
        setupToken: {
          reason: result.setupToken.record.reason,
          expiresAt: result.setupToken.record.expiresAt.toISOString(),
          setupUrl: new URL(result.setupToken.setupPath, request.nextUrl.origin).toString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError(`User "${username}" already exists.`, 409);
    }

    throw error;
  }
}
