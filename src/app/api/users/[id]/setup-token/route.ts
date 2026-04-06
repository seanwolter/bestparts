import {
  Prisma,
  SetupTokenReason,
  SetupTokenReason as SetupTokenReasonEnum,
  UserStatus,
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  assertSameOriginMutationRequest,
  jsonForbidden,
  MutationOriginError,
} from "@/app/api/_shared";
import { db } from "@/lib/db";
import { requireApiAdmin } from "@/lib/auth/route-auth";
import {
  createSetupToken,
  revokeActiveSetupTokensForUser,
} from "@/lib/auth/setup-token";
import { revokeSessionsForUser } from "@/lib/auth/session";
import { jsonError, parseJsonBody } from "../../../auth/_shared";

interface IssueSetupTokenBody {
  reason?: SetupTokenReason;
}

function isSetupTokenReason(value: string | undefined): value is SetupTokenReason {
  return Boolean(
    value &&
      (Object.values(SetupTokenReasonEnum) as string[]).includes(value)
  );
}

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

  const currentUser = await requireApiAdmin(request);

  if (currentUser instanceof NextResponse) {
    return currentUser;
  }

  const { id } = await params;
  const body = await parseJsonBody<IssueSetupTokenBody>(request);
  const reason = body?.reason;

  if (!isSetupTokenReason(reason)) {
    return jsonError("A valid setup-token reason is required.");
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              passkeys: true,
            },
          },
        },
      });

      if (!user) {
        return null;
      }

      if (reason === SetupTokenReason.ADD_PASSKEY && user._count.passkeys === 0) {
        throw new Error("Cannot add a passkey for a user without an existing passkey.");
      }

      if (
        reason === SetupTokenReason.INITIAL_ENROLLMENT &&
        user._count.passkeys > 0
      ) {
        throw new Error("Initial enrollment is only available before a user has passkeys.");
      }

      let revokedPasskeyCount = 0;
      let revokedSessionCount = 0;

      if (reason === SetupTokenReason.RECOVERY) {
        revokedPasskeyCount = (
          await tx.passkey.deleteMany({
            where: {
              userId: user.id,
            },
          })
        ).count;
        revokedSessionCount = await revokeSessionsForUser(tx, user.id);
      }

      const revokedSetupTokenCount = await revokeActiveSetupTokensForUser(tx, user.id);

      const updatedUser =
        reason === SetupTokenReason.ADD_PASSKEY
          ? user
          : await tx.user.update({
              where: { id: user.id },
              data: {
                status: UserStatus.PENDING_SETUP,
              },
            });

      const setupToken = await createSetupToken(tx, {
        userId: user.id,
        issuedByUserId: currentUser.id,
        reason,
      });

      return {
        user: updatedUser,
        setupToken,
        revokedPasskeyCount,
        revokedSessionCount,
        revokedSetupTokenCount,
      };
    });

    if (!result) {
      return jsonError("User not found.", 404);
    }

    return NextResponse.json({
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
      recovery: {
        revokedPasskeyCount: result.revokedPasskeyCount,
        revokedSessionCount: result.revokedSessionCount,
        revokedSetupTokenCount: result.revokedSetupTokenCount,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      return jsonError(error.message);
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return jsonError("User not found.", 404);
    }

    throw error;
  }
}
