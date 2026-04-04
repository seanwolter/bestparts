import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInMemoryAuthProtectionStore } from "@/lib/auth/protection-store";
import {
  createAuthenticationOptionsForUser,
  createRegistrationOptionsForUser,
  getLoginThrottleKey,
  getSetupThrottleKey,
  getWebAuthnConfig,
  mapVerifiedRegistrationToPasskey,
  consumeThrottle,
  resetThrottle,
} from "@/lib/auth/webauthn";
import { hashSetupToken } from "@/lib/auth/setup-token";

describe("webauthn helpers", () => {
  const originalEnv = {
    rpName: process.env.WEBAUTHN_RP_NAME,
    rpId: process.env.WEBAUTHN_RP_ID,
    origin: process.env.WEBAUTHN_ORIGIN,
  };
  let store = createInMemoryAuthProtectionStore();

  beforeEach(async () => {
    process.env.WEBAUTHN_RP_NAME = "bestparts";
    process.env.WEBAUTHN_RP_ID = "localhost";
    process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";
    store = createInMemoryAuthProtectionStore();
    await resetThrottle(undefined, store);
  });

  afterEach(async () => {
    process.env.WEBAUTHN_RP_NAME = originalEnv.rpName;
    process.env.WEBAUTHN_RP_ID = originalEnv.rpId;
    process.env.WEBAUTHN_ORIGIN = originalEnv.origin;
    await resetThrottle(undefined, store);
  });

  it("loads validated WebAuthn config", () => {
    expect(getWebAuthnConfig()).toEqual({
      rpName: "bestparts",
      rpID: "localhost",
      expectedOrigins: ["http://localhost:3000"],
    });
  });

  it("creates discoverable registration options", async () => {
    const options = await createRegistrationOptionsForUser({
      user: {
        id: "user_123",
        username: "mark",
      },
      challenge: "challenge_123",
      passkeys: [{ credentialId: "credential_123", transports: ["internal"] }],
    });

    expect(options.challenge).toBe(Buffer.from("challenge_123").toString("base64url"));
    expect(options.authenticatorSelection?.residentKey).toBe("required");
    expect(options.excludeCredentials).toHaveLength(1);
  });

  it("creates discoverable authentication options with required user verification", async () => {
    const options = await createAuthenticationOptionsForUser({
      challenge: "challenge_123",
    });

    expect(options.challenge).toBe(Buffer.from("challenge_123").toString("base64url"));
    expect(options.userVerification).toBe("required");
    expect(options.allowCredentials).toBeUndefined();
  });

  it("maps verified registration results into persistable passkey fields", () => {
    const mapped = mapVerifiedRegistrationToPasskey(
      {
        verified: true,
        registrationInfo: {
          fmt: "none",
          aaguid: "aaguid",
          credential: {
            id: "credential_123",
            publicKey: Buffer.from("public-key"),
            counter: 5,
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
      },
      "user_123",
      ["internal"]
    );

    expect(mapped.credentialId).toBe("credential_123");
    expect(mapped.counter).toBe(5);
    expect(mapped.webAuthnUserID).toBe(Buffer.from("user_123").toString("base64url"));
  });

  it("throttles repeated auth attempts", async () => {
    const key = getLoginThrottleKey("mark");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await consumeThrottle(key, { store })).allowed).toBe(true);
    }

    const blocked = await consumeThrottle(key, { store });

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("keys login throttles by normalized username by default", () => {
    expect(getLoginThrottleKey(" Mark ")).toBe("login:mark");
  });

  it("can augment throttle keys with a trusted proxy ip", () => {
    expect(getLoginThrottleKey("Mark", "203.0.113.10")).toBe(
      "login:mark:ip:203.0.113.10"
    );
  });

  it("keys setup throttles by hashed token and optional trusted proxy ip", () => {
    const tokenHash = hashSetupToken("setup-token");

    expect(getSetupThrottleKey(tokenHash)).toBe(`setup:${tokenHash}`);
    expect(getSetupThrottleKey(tokenHash, "203.0.113.10")).toBe(
      `setup:${tokenHash}:ip:203.0.113.10`
    );
  });
});
