import { createHash, randomBytes } from "node:crypto";
import type { Prisma, SetupTokenReason, UserSetupToken } from "@prisma/client";
import { SetupTokenReason as SetupTokenReasonEnum } from "@prisma/client";

export const SETUP_TOKEN_TTL_MS = 24 * 60 * 60_000;

export type SetupTokenWithRelations = Prisma.UserSetupTokenGetPayload<{
  include: {
    user: {
      include: {
        passkeys: true;
      };
    };
    issuedByUser: true;
  };
}>;

export interface UserSetupTokenDelegateLike {
  create(args: {
    data: {
      userId: string;
      issuedByUserId?: string;
      tokenHash: string;
      reason: SetupTokenReason;
      expiresAt: Date;
    };
    include: {
      user: {
        include: {
          passkeys: true;
        };
      };
      issuedByUser: true;
    };
  }): Promise<SetupTokenWithRelations>;
  findUnique(args: {
    where: { tokenHash: string };
    include: {
      user: {
        include: {
          passkeys: true;
        };
      };
      issuedByUser: true;
    };
  }): Promise<SetupTokenWithRelations | null>;
  update(args: {
    where: { id: string };
    data: Partial<Pick<UserSetupToken, "usedAt" | "revokedAt">>;
    include: {
      user: {
        include: {
          passkeys: true;
        };
      };
      issuedByUser: true;
    };
  }): Promise<SetupTokenWithRelations>;
  updateMany(args: {
    where: Partial<{
      id: string;
      userId: string;
      usedAt: null | Date;
      revokedAt: null | Date;
      expiresAt: { gt?: Date; lt?: Date };
    }>;
    data: Partial<Pick<UserSetupToken, "usedAt" | "revokedAt">>;
  }): Promise<{ count: number }>;
}

export interface SetupTokenClientLike {
  userSetupToken: UserSetupTokenDelegateLike;
}

export interface CreatedSetupToken {
  rawToken: string;
  setupPath: string;
  record: SetupTokenWithRelations;
}

export function createRawSetupToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashSetupToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function buildSetupPath(rawToken: string): string {
  return `/setup/${rawToken}`;
}

export function isSetupTokenActive(
  token: Pick<UserSetupToken, "expiresAt" | "usedAt" | "revokedAt">,
  now = new Date()
): boolean {
  return !token.usedAt && !token.revokedAt && token.expiresAt.getTime() > now.getTime();
}

export async function createSetupToken(
  client: SetupTokenClientLike,
  options: {
    userId: string;
    issuedByUserId?: string;
    reason?: SetupTokenReason;
    ttlMs?: number;
    now?: Date;
  }
): Promise<CreatedSetupToken> {
  const rawToken = createRawSetupToken();
  const now = options.now ?? new Date();
  const record = await client.userSetupToken.create({
    data: {
      userId: options.userId,
      issuedByUserId: options.issuedByUserId,
      tokenHash: hashSetupToken(rawToken),
      reason: options.reason ?? SetupTokenReasonEnum.INITIAL_ENROLLMENT,
      expiresAt: new Date(now.getTime() + (options.ttlMs ?? SETUP_TOKEN_TTL_MS)),
    },
    include: {
      user: {
        include: {
          passkeys: true,
        },
      },
      issuedByUser: true,
    },
  });

  return {
    rawToken,
    setupPath: buildSetupPath(rawToken),
    record,
  };
}

export async function findSetupToken(
  client: SetupTokenClientLike,
  rawToken: string
): Promise<SetupTokenWithRelations | null> {
  return client.userSetupToken.findUnique({
    where: {
      tokenHash: hashSetupToken(rawToken),
    },
    include: {
      user: {
        include: {
          passkeys: true,
        },
      },
      issuedByUser: true,
    },
  });
}

export async function getActiveSetupToken(
  client: SetupTokenClientLike,
  rawToken: string,
  now = new Date()
): Promise<SetupTokenWithRelations | null> {
  const record = await findSetupToken(client, rawToken);

  if (!record || !isSetupTokenActive(record, now)) {
    return null;
  }

  return record;
}

export async function consumeSetupToken(
  client: SetupTokenClientLike,
  rawToken: string,
  now = new Date()
): Promise<SetupTokenWithRelations | null> {
  const record = await getActiveSetupToken(client, rawToken, now);

  if (!record) {
    return null;
  }

  const result = await client.userSetupToken.updateMany({
    where: {
      id: record.id,
      usedAt: null,
      revokedAt: null,
    },
    data: {
      usedAt: now,
    },
  });

  if (result.count !== 1) {
    return null;
  }

  return client.userSetupToken.update({
    where: {
      id: record.id,
    },
    data: {
      usedAt: now,
    },
    include: {
      user: {
        include: {
          passkeys: true,
        },
      },
      issuedByUser: true,
    },
  });
}

export async function revokeActiveSetupTokensForUser(
  client: SetupTokenClientLike,
  userId: string,
  now = new Date()
): Promise<number> {
  const result = await client.userSetupToken.updateMany({
    where: {
      userId,
      usedAt: null,
      revokedAt: null,
      expiresAt: {
        gt: now,
      },
    },
    data: {
      revokedAt: now,
    },
  });

  return result.count;
}
