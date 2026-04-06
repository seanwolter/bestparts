import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient, SetupTokenReason, UserRole, UserStatus } from "@prisma/client";
import { getTestDatabaseUrl } from "../setup/test-db";
import { hashSetupToken } from "@/lib/auth/setup-token";
import { hashSessionToken } from "@/lib/auth/session";
import { issueCeremonyState } from "@/lib/auth/challenge";
import {
  SESSION_COOKIE_NAME,
  getCeremonyCookieName,
} from "@/lib/auth/cookies";

const mockFns = vi.hoisted(() => ({
  createRegistrationOptionsForUser: vi.fn(),
  verifyRegistration: vi.fn(),
  createAuthenticationOptionsForUser: vi.fn(),
  verifyAuthentication: vi.fn(),
}));

vi.mock("@/lib/auth/webauthn", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/webauthn")>(
    "@/lib/auth/webauthn"
  );

  return {
    ...actual,
    createRegistrationOptionsForUser: mockFns.createRegistrationOptionsForUser,
    verifyRegistration: mockFns.verifyRegistration,
    createAuthenticationOptionsForUser: mockFns.createAuthenticationOptionsForUser,
    verifyAuthentication: mockFns.verifyAuthentication,
  };
});

import { POST as setupOptionsPost } from "@/app/api/auth/setup/options/route";
import { POST as setupVerifyPost } from "@/app/api/auth/setup/verify/route";
import { POST as loginOptionsPost } from "@/app/api/auth/login/options/route";
import { POST as loginVerifyPost } from "@/app/api/auth/login/verify/route";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { GET as sessionGet } from "@/app/api/auth/session/route";

function createRequest(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  } = {}
) {
  const method = options.method ?? "POST";
  const headers = new Headers();
  headers.set("content-type", "application/json");

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

  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      headers.set(key, value);
    }
  }

  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

describe("auth route handlers", () => {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: getTestDatabaseUrl(),
      },
    },
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.authThrottleBucket.deleteMany();
    await prisma.consumedCeremonyNonce.deleteMany();
    await prisma.videoUpvote.deleteMany();
    await prisma.video.deleteMany();

    mockFns.createRegistrationOptionsForUser.mockResolvedValue({
      challenge: "setup-challenge",
      rp: { id: "localhost", name: "bestparts" },
      user: { id: "user-id", name: "setup-user", displayName: "setup-user" },
      pubKeyCredParams: [],
      timeout: 60000,
    });
    mockFns.createAuthenticationOptionsForUser.mockResolvedValue({
      challenge: "login-challenge",
      timeout: 60000,
      userVerification: "required",
    });
    mockFns.verifyRegistration.mockResolvedValue({
      verified: true,
      registrationInfo: {
        fmt: "none",
        aaguid: "aaguid",
        credential: {
          id: "credential-setup",
          publicKey: Buffer.from("public-key"),
          counter: 0,
          transports: ["internal"],
        },
        credentialType: "public-key",
        attestationObject: Buffer.from("attestation"),
        userVerified: true,
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
        origin: "http://localhost:3000",
        rpID: "localhost",
      },
    });
    mockFns.verifyAuthentication.mockResolvedValue({
      verified: true,
      authenticationInfo: {
        credentialID: "credential-login",
        newCounter: 9,
        userVerified: true,
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
        origin: "http://localhost:3000",
        rpID: "localhost",
      },
    });

    await prisma.userSetupToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.passkey.deleteMany();
    await prisma.user.deleteMany();
  });

  it("creates setup registration options and binds a ceremony cookie", async () => {
    const user = await prisma.user.create({
      data: {
        username: "setup-user",
        role: UserRole.ADMIN,
        status: UserStatus.PENDING_SETUP,
      },
    });
    const rawToken = "setup-token";
    await prisma.userSetupToken.create({
      data: {
        userId: user.id,
        tokenHash: hashSetupToken(rawToken),
        reason: SetupTokenReason.INITIAL_ENROLLMENT,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const response = await setupOptionsPost(
      createRequest("/api/auth/setup/options", {
        body: { token: rawToken },
      })
    );

    expect(response.status).toBe(200);
    expect(mockFns.createRegistrationOptionsForUser).toHaveBeenCalledOnce();
    expect(response.cookies.get(getCeremonyCookieName("setup"))?.value).toBeTruthy();
  });

  it("verifies setup, creates a passkey, activates the user, and sets a session cookie", async () => {
    const user = await prisma.user.create({
      data: {
        username: "setup-user",
        role: UserRole.ADMIN,
        status: UserStatus.PENDING_SETUP,
      },
    });
    const rawToken = "setup-token";
    await prisma.userSetupToken.create({
      data: {
        userId: user.id,
        tokenHash: hashSetupToken(rawToken),
        reason: SetupTokenReason.INITIAL_ENROLLMENT,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const optionsResponse = await setupOptionsPost(
      createRequest("/api/auth/setup/options", {
        body: { token: rawToken },
      })
    );
    const ceremonyCookie = optionsResponse.cookies.get(getCeremonyCookieName("setup"))?.value;

    const response = await setupVerifyPost(
      createRequest("/api/auth/setup/verify", {
        body: {
          token: rawToken,
          response: {
            id: "credential-setup",
            rawId: "credential-setup",
            type: "public-key",
            response: {
              clientDataJSON: "clientDataJSON",
              attestationObject: "attestationObject",
              transports: ["internal"],
            },
            clientExtensionResults: {},
          },
        },
        cookies: {
          [getCeremonyCookieName("setup")]: ceremonyCookie ?? "",
        },
      })
    );

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    const passkeys = await prisma.passkey.findMany({ where: { userId: user.id } });
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });

    expect(response.status).toBe(200);
    expect(updatedUser?.status).toBe(UserStatus.ACTIVE);
    expect(passkeys).toHaveLength(1);
    expect(sessions).toHaveLength(1);
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBeTruthy();
  });

  it("returns a generic setup failure when registration verification throws", async () => {
    const user = await prisma.user.create({
      data: {
        username: "setup-user",
        role: UserRole.ADMIN,
        status: UserStatus.PENDING_SETUP,
      },
    });
    const rawToken = "setup-token";
    await prisma.userSetupToken.create({
      data: {
        userId: user.id,
        tokenHash: hashSetupToken(rawToken),
        reason: SetupTokenReason.INITIAL_ENROLLMENT,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const optionsResponse = await setupOptionsPost(
      createRequest("/api/auth/setup/options", {
        body: { token: rawToken },
      })
    );
    const ceremonyCookie = optionsResponse.cookies.get(getCeremonyCookieName("setup"))?.value;
    mockFns.verifyRegistration.mockRejectedValueOnce(new Error("Missing credential ID"));

    const response = await setupVerifyPost(
      createRequest("/api/auth/setup/verify", {
        body: {
          token: rawToken,
          response: {
            id: "credential-setup",
            rawId: "credential-setup",
            type: "public-key",
            response: {
              clientDataJSON: "clientDataJSON",
              attestationObject: "attestationObject",
              transports: ["internal"],
            },
            clientExtensionResults: {},
          },
        },
        cookies: {
          [getCeremonyCookieName("setup")]: ceremonyCookie ?? "",
        },
      })
    );
    const payload = await response.json();
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    const passkeys = await prisma.passkey.findMany({ where: { userId: user.id } });
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Passkey setup failed.");
    expect(updatedUser?.status).toBe(UserStatus.PENDING_SETUP);
    expect(passkeys).toHaveLength(0);
    expect(sessions).toHaveLength(0);
  });

  it("returns a generic setup failure when verified passkey persistence conflicts", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = await prisma.user.create({
      data: {
        username: "setup-user",
        role: UserRole.ADMIN,
        status: UserStatus.PENDING_SETUP,
      },
    });
    const existingUser = await prisma.user.create({
      data: {
        username: "existing-user",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    const rawToken = "setup-token";
    await prisma.userSetupToken.create({
      data: {
        userId: user.id,
        tokenHash: hashSetupToken(rawToken),
        reason: SetupTokenReason.INITIAL_ENROLLMENT,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.passkey.create({
      data: {
        userId: existingUser.id,
        credentialId: "credential-setup",
        publicKey: Buffer.from("public-key").toString("base64url"),
        counter: 1,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        webAuthnUserID: Buffer.from(existingUser.id).toString("base64url"),
      },
    });

    const optionsResponse = await setupOptionsPost(
      createRequest("/api/auth/setup/options", {
        body: { token: rawToken },
      })
    );
    const ceremonyCookie = optionsResponse.cookies.get(getCeremonyCookieName("setup"))?.value;

    try {
      const response = await setupVerifyPost(
        createRequest("/api/auth/setup/verify", {
          body: {
            token: rawToken,
            response: {
              id: "credential-setup",
              rawId: "credential-setup",
              type: "public-key",
              response: {
                clientDataJSON: "clientDataJSON",
                attestationObject: "attestationObject",
                transports: ["internal"],
              },
              clientExtensionResults: {},
            },
          },
          cookies: {
            [getCeremonyCookieName("setup")]: ceremonyCookie ?? "",
          },
        })
      );
      const payload = await response.json();
      const refreshedToken = await prisma.userSetupToken.findUnique({
        where: { tokenHash: hashSetupToken(rawToken) },
      });
      const sessions = await prisma.session.findMany({ where: { userId: user.id } });

      expect(response.status).toBe(400);
      expect(payload.error).toBe("Passkey setup failed.");
      expect(refreshedToken?.usedAt).toBeNull();
      expect(sessions).toHaveLength(0);
      expect(consoleErrorSpy).toHaveBeenCalledOnce();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("rejects expired setup tokens", async () => {
    const user = await prisma.user.create({
      data: {
        username: "setup-user",
        role: UserRole.ADMIN,
        status: UserStatus.PENDING_SETUP,
      },
    });
    await prisma.userSetupToken.create({
      data: {
        userId: user.id,
        tokenHash: hashSetupToken("expired-token"),
        reason: SetupTokenReason.INITIAL_ENROLLMENT,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const response = await setupOptionsPost(
      createRequest("/api/auth/setup/options", {
        body: { token: "expired-token" },
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("invalid or expired");
  });

  it("rejects reused setup tokens after successful enrollment", async () => {
    const user = await prisma.user.create({
      data: {
        username: "setup-user",
        role: UserRole.ADMIN,
        status: UserStatus.PENDING_SETUP,
      },
    });
    const rawToken = "setup-token";
    await prisma.userSetupToken.create({
      data: {
        userId: user.id,
        tokenHash: hashSetupToken(rawToken),
        reason: SetupTokenReason.INITIAL_ENROLLMENT,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const optionsResponse = await setupOptionsPost(
      createRequest("/api/auth/setup/options", {
        body: { token: rawToken },
      })
    );
    const ceremonyCookie = optionsResponse.cookies.get(getCeremonyCookieName("setup"))?.value;

    const firstResponse = await setupVerifyPost(
      createRequest("/api/auth/setup/verify", {
        body: {
          token: rawToken,
          response: {
            id: "credential-setup",
            rawId: "credential-setup",
            type: "public-key",
            response: {
              clientDataJSON: "clientDataJSON",
              attestationObject: "attestationObject",
              transports: ["internal"],
            },
            clientExtensionResults: {},
          },
        },
        cookies: {
          [getCeremonyCookieName("setup")]: ceremonyCookie ?? "",
        },
      })
    );

    const replayedTokenResponse = await setupOptionsPost(
      createRequest("/api/auth/setup/options", {
        body: { token: rawToken },
      })
    );
    const replayedTokenPayload = await replayedTokenResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(replayedTokenResponse.status).toBe(400);
    expect(replayedTokenPayload.error).toContain("invalid or expired");
  });

  it("creates login options, verifies login, updates the counter, and sets a session cookie", async () => {
    const user = await prisma.user.create({
      data: {
        username: "login-user",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: "credential-login",
        publicKey: Buffer.from("public-key").toString("base64url"),
        counter: 1,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        webAuthnUserID: Buffer.from(user.id).toString("base64url"),
      },
    });

    const optionsResponse = await loginOptionsPost(
      createRequest("/api/auth/login/options", {
        body: { username: "login-user" },
      })
    );
    const ceremonyCookie = optionsResponse.cookies.get(getCeremonyCookieName("login"))?.value;

    const response = await loginVerifyPost(
      createRequest("/api/auth/login/verify", {
        body: {
          username: "login-user",
          response: {
            id: "credential-login",
            rawId: "credential-login",
            type: "public-key",
            response: {
              clientDataJSON: "clientDataJSON",
              authenticatorData: "authenticatorData",
              signature: "signature",
            },
            clientExtensionResults: {},
          },
        },
        cookies: {
          [getCeremonyCookieName("login")]: ceremonyCookie ?? "",
        },
      })
    );

    const updatedPasskey = await prisma.passkey.findUnique({
      where: { credentialId: "credential-login" },
    });
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });

    expect(response.status).toBe(200);
    expect(updatedPasskey?.counter).toBe(9);
    expect(updatedPasskey?.lastUsedAt).toBeInstanceOf(Date);
    expect(sessions).toHaveLength(1);
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBeTruthy();
  });

  it("returns the same outward login-options shape for known and unknown usernames", async () => {
    const user = await prisma.user.create({
      data: {
        username: "login-user",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: "credential-login",
        publicKey: Buffer.from("public-key").toString("base64url"),
        counter: 1,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        webAuthnUserID: Buffer.from(user.id).toString("base64url"),
      },
    });

    const knownResponse = await loginOptionsPost(
      createRequest("/api/auth/login/options", {
        body: { username: "login-user" },
      })
    );
    const unknownResponse = await loginOptionsPost(
      createRequest("/api/auth/login/options", {
        body: { username: "ghost-user" },
      })
    );
    const knownPayload = await knownResponse.json();
    const unknownPayload = await unknownResponse.json();

    expect(knownResponse.status).toBe(200);
    expect(unknownResponse.status).toBe(200);
    expect(knownPayload).toEqual({
      options: expect.objectContaining({
        challenge: "login-challenge",
        timeout: 60000,
        userVerification: "required",
      }),
    });
    expect(unknownPayload).toEqual({
      options: expect.objectContaining({
        challenge: "login-challenge",
        timeout: 60000,
        userVerification: "required",
      }),
    });
    expect(knownPayload.options.allowCredentials).toBeUndefined();
    expect(unknownPayload.options.allowCredentials).toBeUndefined();
    expect(knownResponse.cookies.get(getCeremonyCookieName("login"))?.value).toBeTruthy();
    expect(unknownResponse.cookies.get(getCeremonyCookieName("login"))?.value).toBeTruthy();
    expect(mockFns.createAuthenticationOptionsForUser).toHaveBeenCalledTimes(2);
    expect(mockFns.createAuthenticationOptionsForUser).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        challenge: expect.any(String),
      })
    );
    expect(mockFns.createAuthenticationOptionsForUser).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        challenge: expect.any(String),
      })
    );
  });

  it("returns a generic login failure when authentication verification throws", async () => {
    const user = await prisma.user.create({
      data: {
        username: "login-user",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: "credential-login",
        publicKey: Buffer.from("public-key").toString("base64url"),
        counter: 1,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        webAuthnUserID: Buffer.from(user.id).toString("base64url"),
      },
    });

    const optionsResponse = await loginOptionsPost(
      createRequest("/api/auth/login/options", {
        body: { username: "login-user" },
      })
    );
    const ceremonyCookie = optionsResponse.cookies.get(getCeremonyCookieName("login"))?.value;
    mockFns.verifyAuthentication.mockRejectedValueOnce(new Error("Missing credential ID"));

    const response = await loginVerifyPost(
      createRequest("/api/auth/login/verify", {
        body: {
          username: "login-user",
          response: {
            id: "credential-login",
            rawId: "credential-login",
            type: "public-key",
            response: {
              clientDataJSON: "clientDataJSON",
              authenticatorData: "authenticatorData",
              signature: "signature",
            },
            clientExtensionResults: {},
          },
        },
        cookies: {
          [getCeremonyCookieName("login")]: ceremonyCookie ?? "",
        },
      })
    );
    const payload = await response.json();
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Authentication failed.");
    expect(sessions).toHaveLength(0);
  });

  it("rejects login verification for an unknown username", async () => {
    const optionsResponse = await loginOptionsPost(
      createRequest("/api/auth/login/options", {
        body: { username: "ghost-user" },
      })
    );
    const ceremonyCookie = optionsResponse.cookies.get(getCeremonyCookieName("login"))?.value;

    const response = await loginVerifyPost(
      createRequest("/api/auth/login/verify", {
        body: {
          username: "ghost-user",
          response: {
            id: "missing-credential",
            rawId: "missing-credential",
            type: "public-key",
            response: {
              clientDataJSON: "clientDataJSON",
              authenticatorData: "authenticatorData",
              signature: "signature",
            },
            clientExtensionResults: {},
          },
        },
        cookies: {
          [getCeremonyCookieName("login")]: ceremonyCookie ?? "",
        },
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Authentication failed.");
    expect(mockFns.verifyAuthentication).not.toHaveBeenCalled();
  });

  it("rejects a valid credential when the submitted username does not match the owner", async () => {
    const user = await prisma.user.create({
      data: {
        username: "login-user",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: "credential-login",
        publicKey: Buffer.from("public-key").toString("base64url"),
        counter: 1,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        webAuthnUserID: Buffer.from(user.id).toString("base64url"),
      },
    });

    const optionsResponse = await loginOptionsPost(
      createRequest("/api/auth/login/options", {
        body: { username: "wrong-user" },
      })
    );
    const ceremonyCookie = optionsResponse.cookies.get(getCeremonyCookieName("login"))?.value;

    const response = await loginVerifyPost(
      createRequest("/api/auth/login/verify", {
        body: {
          username: "wrong-user",
          response: {
            id: "credential-login",
            rawId: "credential-login",
            type: "public-key",
            response: {
              clientDataJSON: "clientDataJSON",
              authenticatorData: "authenticatorData",
              signature: "signature",
            },
            clientExtensionResults: {},
          },
        },
        cookies: {
          [getCeremonyCookieName("login")]: ceremonyCookie ?? "",
        },
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Authentication failed.");
    expect(mockFns.verifyAuthentication).not.toHaveBeenCalled();
  });

  it("rejects login verification for a non-active credential owner", async () => {
    const user = await prisma.user.create({
      data: {
        username: "pending-user",
        role: UserRole.ADMIN,
        status: UserStatus.PENDING_SETUP,
      },
    });
    await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: "credential-login",
        publicKey: Buffer.from("public-key").toString("base64url"),
        counter: 1,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        webAuthnUserID: Buffer.from(user.id).toString("base64url"),
      },
    });

    const optionsResponse = await loginOptionsPost(
      createRequest("/api/auth/login/options", {
        body: { username: "pending-user" },
      })
    );
    const ceremonyCookie = optionsResponse.cookies.get(getCeremonyCookieName("login"))?.value;

    const response = await loginVerifyPost(
      createRequest("/api/auth/login/verify", {
        body: {
          username: "pending-user",
          response: {
            id: "credential-login",
            rawId: "credential-login",
            type: "public-key",
            response: {
              clientDataJSON: "clientDataJSON",
              authenticatorData: "authenticatorData",
              signature: "signature",
            },
            clientExtensionResults: {},
          },
        },
        cookies: {
          [getCeremonyCookieName("login")]: ceremonyCookie ?? "",
        },
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Authentication failed.");
    expect(mockFns.verifyAuthentication).not.toHaveBeenCalled();
  });

  it("rejects missing ceremony state during login verification", async () => {
    const user = await prisma.user.create({
      data: {
        username: "login-user",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: "credential-login",
        publicKey: Buffer.from("public-key").toString("base64url"),
        counter: 1,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        webAuthnUserID: Buffer.from(user.id).toString("base64url"),
      },
    });

    const response = await loginVerifyPost(
      createRequest("/api/auth/login/verify", {
        body: {
          username: "login-user",
          response: {
            id: "credential-login",
            rawId: "credential-login",
            type: "public-key",
            response: {
              clientDataJSON: "clientDataJSON",
              authenticatorData: "authenticatorData",
              signature: "signature",
            },
            clientExtensionResults: {},
          },
        },
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Authentication failed.");
  });

  it("rejects expired ceremony state during login verification", async () => {
    const user = await prisma.user.create({
      data: {
        username: "login-user",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: "credential-login",
        publicKey: Buffer.from("public-key").toString("base64url"),
        counter: 1,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        webAuthnUserID: Buffer.from(user.id).toString("base64url"),
      },
    });

    const { cookie } = issueCeremonyState({
      flow: "login",
      userId: user.id,
      username: user.username,
      now: new Date("2026-04-04T18:30:00.000Z"),
      ttlMs: 1_000,
    });

    const response = await loginVerifyPost(
      createRequest("/api/auth/login/verify", {
        body: {
          username: "login-user",
          response: {
            id: "credential-login",
            rawId: "credential-login",
            type: "public-key",
            response: {
              clientDataJSON: "clientDataJSON",
              authenticatorData: "authenticatorData",
              signature: "signature",
            },
            clientExtensionResults: {},
          },
        },
        cookies: {
          [getCeremonyCookieName("login")]: cookie.value,
        },
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Authentication failed.");
  });

  it("rejects replayed ceremony state during login verification", async () => {
    const user = await prisma.user.create({
      data: {
        username: "login-user",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: "credential-login",
        publicKey: Buffer.from("public-key").toString("base64url"),
        counter: 1,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        webAuthnUserID: Buffer.from(user.id).toString("base64url"),
      },
    });

    const optionsResponse = await loginOptionsPost(
      createRequest("/api/auth/login/options", {
        body: { username: "login-user" },
      })
    );
    const ceremonyCookie = optionsResponse.cookies.get(getCeremonyCookieName("login"))?.value;
    const requestBody = {
      username: "login-user",
      response: {
        id: "credential-login",
        rawId: "credential-login",
        type: "public-key",
        response: {
          clientDataJSON: "clientDataJSON",
          authenticatorData: "authenticatorData",
          signature: "signature",
        },
        clientExtensionResults: {},
      },
    };

    const firstResponse = await loginVerifyPost(
      createRequest("/api/auth/login/verify", {
        body: requestBody,
        cookies: {
          [getCeremonyCookieName("login")]: ceremonyCookie ?? "",
        },
      })
    );
    const replayResponse = await loginVerifyPost(
      createRequest("/api/auth/login/verify", {
        body: requestBody,
        cookies: {
          [getCeremonyCookieName("login")]: ceremonyCookie ?? "",
        },
      })
    );
    const replayPayload = await replayResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(400);
    expect(replayPayload.error).toBe("Authentication failed.");
  });

  it("covers successful login, malformed failure, replay rejection, and throttling in one flow", async () => {
    const user = await prisma.user.create({
      data: {
        username: "login-user",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: "credential-login",
        publicKey: Buffer.from("public-key").toString("base64url"),
        counter: 1,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        webAuthnUserID: Buffer.from(user.id).toString("base64url"),
      },
    });

    const initialOptionsResponse = await loginOptionsPost(
      createRequest("/api/auth/login/options", {
        body: { username: "login-user" },
      })
    );
    const initialCeremonyCookie = initialOptionsResponse.cookies.get(
      getCeremonyCookieName("login")
    )?.value;
    const requestBody = {
      username: "login-user",
      response: {
        id: "credential-login",
        rawId: "credential-login",
        type: "public-key",
        response: {
          clientDataJSON: "clientDataJSON",
          authenticatorData: "authenticatorData",
          signature: "signature",
        },
        clientExtensionResults: {},
      },
    };

    const successfulVerifyResponse = await loginVerifyPost(
      createRequest("/api/auth/login/verify", {
        body: requestBody,
        cookies: {
          [getCeremonyCookieName("login")]: initialCeremonyCookie ?? "",
        },
      })
    );
    const replayResponse = await loginVerifyPost(
      createRequest("/api/auth/login/verify", {
        body: requestBody,
        cookies: {
          [getCeremonyCookieName("login")]: initialCeremonyCookie ?? "",
        },
      })
    );
    const replayPayload = await replayResponse.json();

    const malformedOptionsResponse = await loginOptionsPost(
      createRequest("/api/auth/login/options", {
        body: { username: "login-user" },
      })
    );
    const malformedCeremonyCookie = malformedOptionsResponse.cookies.get(
      getCeremonyCookieName("login")
    )?.value;
    mockFns.verifyAuthentication.mockRejectedValueOnce(
      new Error("Credential missing response")
    );

    const malformedVerifyResponse = await loginVerifyPost(
      createRequest("/api/auth/login/verify", {
        body: requestBody,
        cookies: {
          [getCeremonyCookieName("login")]: malformedCeremonyCookie ?? "",
        },
      })
    );
    const malformedPayload = await malformedVerifyResponse.json();

    const throttledOptionsResponse = await loginOptionsPost(
      createRequest("/api/auth/login/options", {
        body: { username: "login-user" },
      })
    );
    const throttledPayload = await throttledOptionsResponse.json();
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });

    expect(initialOptionsResponse.status).toBe(200);
    expect(successfulVerifyResponse.status).toBe(200);
    expect(replayResponse.status).toBe(400);
    expect(replayPayload.error).toBe("Authentication failed.");
    expect(malformedOptionsResponse.status).toBe(200);
    expect(malformedVerifyResponse.status).toBe(400);
    expect(malformedPayload.error).toBe("Authentication failed.");
    expect(throttledOptionsResponse.status).toBe(429);
    expect(throttledPayload.error).toBe("Too many attempts. Please try again later.");
    expect(sessions).toHaveLength(1);
  });

  it("ignores spoofed forwarding headers for login throttling by default", async () => {
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await loginOptionsPost(
        createRequest("/api/auth/login/options", {
          body: { username: "login-user" },
          headers: {
            "x-forwarded-for": `203.0.113.${attempt}`,
            "x-real-ip": `198.51.100.${attempt}`,
          },
        })
      );

      statuses.push(response.status);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("ignores spoofed forwarding headers for setup throttling by default", async () => {
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await setupOptionsPost(
        createRequest("/api/auth/setup/options", {
          body: { token: "setup-token" },
          headers: {
            "x-forwarded-for": `203.0.113.${attempt}`,
            "x-real-ip": `198.51.100.${attempt}`,
          },
        })
      );

      statuses.push(response.status);
    }

    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
  });

  it("can trust proxy headers for distinct login throttle buckets when explicitly enabled", async () => {
    const originalSetting = process.env.AUTH_TRUST_PROXY_HEADERS;
    process.env.AUTH_TRUST_PROXY_HEADERS = "true";

    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await loginOptionsPost(
          createRequest("/api/auth/login/options", {
            body: { username: "login-user" },
            headers: {
              "x-forwarded-for": "203.0.113.10",
            },
          })
        );

        expect(response.status).toBe(200);
      }

      const blockedResponse = await loginOptionsPost(
        createRequest("/api/auth/login/options", {
          body: { username: "login-user" },
          headers: {
            "x-forwarded-for": "203.0.113.10",
          },
        })
      );
      const freshBucketResponse = await loginOptionsPost(
        createRequest("/api/auth/login/options", {
          body: { username: "login-user" },
          headers: {
            "x-forwarded-for": "203.0.113.11",
          },
        })
      );

      expect(blockedResponse.status).toBe(429);
      expect(freshBucketResponse.status).toBe(200);
    } finally {
      process.env.AUTH_TRUST_PROXY_HEADERS = originalSetting;
    }
  });

  it("revokes sessions and clears cookies on logout", async () => {
    const user = await prisma.user.create({
      data: {
        username: "logout-user",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    const sessionToken = "logout-session-token";
    await prisma.session.create({
      data: {
        userId: user.id,
        sessionTokenHash: hashSessionToken(sessionToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const response = await logoutPost(
      createRequest("/api/auth/logout", {
        cookies: {
          [SESSION_COOKIE_NAME]: sessionToken,
        },
      })
    );

    const session = await prisma.session.findFirst({
      where: {
        userId: user.id,
      },
    });

    expect(response.status).toBe(200);
    expect(session?.revokedAt).toBeInstanceOf(Date);
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBe("");
  });

  it("returns guest or authenticated auth session state", async () => {
    const guestResponse = await sessionGet(
      createRequest("/api/auth/session", {
        method: "GET",
      })
    );
    const guestPayload = await guestResponse.json();

    const user = await prisma.user.create({
      data: {
        username: "session-user",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    const sessionToken = "session-token";
    await prisma.session.create({
      data: {
        userId: user.id,
        sessionTokenHash: hashSessionToken(sessionToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const authenticatedResponse = await sessionGet(
      createRequest("/api/auth/session", {
        method: "GET",
        cookies: {
          [SESSION_COOKIE_NAME]: sessionToken,
        },
      })
    );
    const authenticatedPayload = await authenticatedResponse.json();

    expect(guestPayload).toEqual({ authenticated: false, user: null });
    expect(authenticatedPayload.authenticated).toBe(true);
    expect(authenticatedPayload.user.username).toBe("session-user");
  });
});
