import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  PrismaClient,
  SetupTokenReason,
  UserRole,
  UserStatus,
} from "@prisma/client";
import { getTestDatabaseUrl } from "../setup/test-db";
import { hashSessionToken } from "@/lib/auth/session";
import { hashSetupToken } from "@/lib/auth/setup-token";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { POST as createUserPost } from "@/app/api/users/route";
import { POST as issueSetupTokenPost } from "@/app/api/users/[id]/setup-token/route";

function createRequest(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookies?: Record<string, string>;
  } = {}
) {
  const method = options.method ?? "POST";
  const headers = new Headers();

  if (options.body) {
    headers.set("content-type", "application/json");
  }

  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase()) &&
    !headers.has("origin")
  ) {
    headers.set("origin", "http://localhost");
  }

  if (options.cookies) {
    headers.set(
      "cookie",
      Object.entries(options.cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join("; ")
    );
  }

  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

describe("admin user management routes", () => {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: getTestDatabaseUrl(),
      },
    },
  });

  beforeEach(async () => {
    await prisma.videoUpvote.deleteMany();
    await prisma.video.deleteMany();
    await prisma.userSetupToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.passkey.deleteMany();
    await prisma.user.deleteMany();
  });

  async function createAdminSession() {
    const admin = await prisma.user.create({
      data: {
        username: "primary-admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    const sessionToken = "admin-session-token";

    await prisma.session.create({
      data: {
        userId: admin.id,
        sessionTokenHash: hashSessionToken(sessionToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    return { admin, sessionToken };
  }

  async function createPendingSession() {
    const user = await prisma.user.create({
      data: {
        username: "pending-admin",
        role: UserRole.ADMIN,
        status: UserStatus.PENDING_SETUP,
      },
    });
    const sessionToken = "pending-admin-session-token";

    await prisma.session.create({
      data: {
        userId: user.id,
        sessionTokenHash: hashSessionToken(sessionToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    return { user, sessionToken };
  }

  it("creates a pending admin user with an initial setup token", async () => {
    const { admin, sessionToken } = await createAdminSession();

    const response = await createUserPost(
      createRequest("/api/users", {
        body: {
          username: "second-admin",
        },
        cookies: {
          [SESSION_COOKIE_NAME]: sessionToken,
        },
      })
    );
    const payload = await response.json();
    const createdUser = await prisma.user.findUnique({
      where: {
        username: "second-admin",
      },
    });
    const setupTokens = await prisma.userSetupToken.findMany({
      where: {
        userId: createdUser?.id,
      },
    });

    expect(response.status).toBe(201);
    expect(payload.user.status).toBe("PENDING_SETUP");
    expect(payload.user.role).toBe("ADMIN");
    expect(payload.setupToken.reason).toBe("INITIAL_ENROLLMENT");
    expect(payload.setupToken.setupUrl).toContain("/setup/");
    expect(createdUser?.status).toBe(UserStatus.PENDING_SETUP);
    expect(setupTokens).toHaveLength(1);
    expect(setupTokens[0]?.reason).toBe(SetupTokenReason.INITIAL_ENROLLMENT);
    expect(setupTokens[0]?.issuedByUserId).toBe(admin.id);
  });

  it("issues an add-passkey token without removing the user's current passkeys", async () => {
    const { admin, sessionToken } = await createAdminSession();
    const user = await prisma.user.create({
      data: {
        username: "existing-admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: "credential-existing",
        publicKey: Buffer.from("public-key").toString("base64url"),
        counter: 4,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        webAuthnUserID: Buffer.from(user.id).toString("base64url"),
      },
    });
    const olderToken = await prisma.userSetupToken.create({
      data: {
        userId: user.id,
        issuedByUserId: admin.id,
        tokenHash: hashSetupToken("older-add-passkey-token"),
        reason: SetupTokenReason.ADD_PASSKEY,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const response = await issueSetupTokenPost(
      createRequest(`/api/users/${user.id}/setup-token`, {
        body: {
          reason: "ADD_PASSKEY",
        },
        cookies: {
          [SESSION_COOKIE_NAME]: sessionToken,
        },
      }),
      { params: Promise.resolve({ id: user.id }) }
    );
    const payload = await response.json();
    const passkeys = await prisma.passkey.findMany({
      where: {
        userId: user.id,
      },
    });
    const setupTokens = await prisma.userSetupToken.findMany({
      where: {
        userId: user.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    expect(response.status).toBe(200);
    expect(payload.setupToken.reason).toBe("ADD_PASSKEY");
    expect(passkeys).toHaveLength(1);
    expect(setupTokens).toHaveLength(2);
    expect(setupTokens[0]?.id).toBe(olderToken.id);
    expect(setupTokens[0]?.revokedAt).toBeInstanceOf(Date);
    expect(setupTokens[1]?.reason).toBe(SetupTokenReason.ADD_PASSKEY);
    expect(setupTokens[1]?.issuedByUserId).toBe(admin.id);
  });

  it("recovery revokes outstanding tokens, passkeys, and sessions before issuing a fresh token", async () => {
    const { admin, sessionToken } = await createAdminSession();
    const user = await prisma.user.create({
      data: {
        username: "recovery-user",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: "credential-recovery",
        publicKey: Buffer.from("public-key").toString("base64url"),
        counter: 8,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        webAuthnUserID: Buffer.from(user.id).toString("base64url"),
      },
    });
    const targetSession = await prisma.session.create({
      data: {
        userId: user.id,
        sessionTokenHash: hashSessionToken("recovery-session-token"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const outstandingToken = await prisma.userSetupToken.create({
      data: {
        userId: user.id,
        issuedByUserId: admin.id,
        tokenHash: hashSetupToken("outstanding-recovery-token"),
        reason: SetupTokenReason.ADD_PASSKEY,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const response = await issueSetupTokenPost(
      createRequest(`/api/users/${user.id}/setup-token`, {
        body: {
          reason: "RECOVERY",
        },
        cookies: {
          [SESSION_COOKIE_NAME]: sessionToken,
        },
      }),
      { params: Promise.resolve({ id: user.id }) }
    );
    const payload = await response.json();
    const updatedUser = await prisma.user.findUnique({
      where: {
        id: user.id,
      },
    });
    const passkeys = await prisma.passkey.findMany({
      where: {
        userId: user.id,
      },
    });
    const updatedSession = await prisma.session.findUnique({
      where: {
        id: targetSession.id,
      },
    });
    const allTokens = await prisma.userSetupToken.findMany({
      where: {
        userId: user.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    expect(response.status).toBe(200);
    expect(payload.setupToken.reason).toBe("RECOVERY");
    expect(payload.recovery.revokedPasskeyCount).toBe(1);
    expect(payload.recovery.revokedSessionCount).toBe(1);
    expect(payload.recovery.revokedSetupTokenCount).toBe(1);
    expect(updatedUser?.status).toBe(UserStatus.PENDING_SETUP);
    expect(passkeys).toHaveLength(0);
    expect(updatedSession?.revokedAt).toBeInstanceOf(Date);
    expect(allTokens).toHaveLength(2);
    expect(allTokens[0]?.id).toBe(outstandingToken.id);
    expect(allTokens[0]?.revokedAt).toBeInstanceOf(Date);
    expect(allTokens[1]?.reason).toBe(SetupTokenReason.RECOVERY);
    expect(allTokens[1]?.usedAt).toBeNull();
    expect(allTokens[1]?.revokedAt).toBeNull();
  });

  it("rejects pending users from admin-only user management routes without changing state", async () => {
    const { sessionToken } = await createPendingSession();
    const targetUser = await prisma.user.create({
      data: {
        username: "existing-target-user",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });

    const createUserResponse = await createUserPost(
      createRequest("/api/users", {
        body: {
          username: "blocked-created-user",
        },
        cookies: {
          [SESSION_COOKIE_NAME]: sessionToken,
        },
      })
    );
    const issueSetupTokenResponse = await issueSetupTokenPost(
      createRequest(`/api/users/${targetUser.id}/setup-token`, {
        body: {
          reason: "INITIAL_ENROLLMENT",
        },
        cookies: {
          [SESSION_COOKIE_NAME]: sessionToken,
        },
      }),
      { params: Promise.resolve({ id: targetUser.id }) }
    );

    for (const response of [createUserResponse, issueSetupTokenResponse]) {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "An active user account is required.",
      });
    }

    await expect(
      prisma.user.findUnique({
        where: {
          username: "blocked-created-user",
        },
      })
    ).resolves.toBeNull();
    await expect(
      prisma.userSetupToken.count({
        where: {
          userId: targetUser.id,
        },
      })
    ).resolves.toBe(0);
    await expect(
      prisma.user.findUnique({
        where: {
          id: targetUser.id,
        },
      })
    ).resolves.toMatchObject({
      status: UserStatus.ACTIVE,
    });
  });
});
