import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  supportedCOSEAlgorithmIdentifiers,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type Base64URLString,
  type CredentialDeviceType,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import {
  createPrismaAuthProtectionStore,
  type AuthProtectionStore,
  type ThrottleDecision,
} from "./protection-store";

export const GENERIC_LOGIN_FAILURE_MESSAGE = "Authentication failed.";
export const GENERIC_SETUP_FAILURE_MESSAGE = "Passkey setup failed.";
export const DEFAULT_AUTH_THROTTLE_LIMIT = 5;
export const DEFAULT_AUTH_THROTTLE_WINDOW_MS = 60_000;
const defaultAuthProtectionStore = createPrismaAuthProtectionStore();

export interface WebAuthnConfig {
  rpName: string;
  rpID: string;
  expectedOrigins: string[];
}

export interface WebAuthnUserLike {
  id: string;
  username: string;
}

export interface StoredPasskeyLike {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
  webAuthnUserID: string;
}

export interface PersistablePasskey {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: AuthenticatorTransportFuture[];
  deviceType: CredentialDeviceType;
  backedUp: boolean;
  webAuthnUserID: string;
}

export function getWebAuthnConfig(): WebAuthnConfig {
  const rpName = process.env.WEBAUTHN_RP_NAME?.trim();
  const rpID = process.env.WEBAUTHN_RP_ID?.trim();
  const originValue = process.env.WEBAUTHN_ORIGIN?.trim();

  if (!rpName || !rpID || !originValue) {
    throw new Error(
      "Missing WebAuthn configuration. Expected WEBAUTHN_RP_NAME, WEBAUTHN_RP_ID, and WEBAUTHN_ORIGIN."
    );
  }

  const expectedOrigins = originValue
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (expectedOrigins.length === 0) {
    throw new Error("WEBAUTHN_ORIGIN must contain at least one origin.");
  }

  return {
    rpName,
    rpID,
    expectedOrigins,
  };
}

export function getWebAuthnUserID(userId: string): string {
  return Buffer.from(userId, "utf8").toString("base64url");
}

export function getWebAuthnUserIDBuffer(
  userId: string
): Parameters<typeof generateRegistrationOptions>[0]["userID"] {
  return Buffer.from(userId, "utf8") as unknown as Parameters<
    typeof generateRegistrationOptions
  >[0]["userID"];
}

export function getLoginThrottleKey(username: string, ipAddress?: string): string {
  const key = `login:${username.trim().toLowerCase()}`;
  const normalizedIpAddress = ipAddress?.trim().toLowerCase();

  return normalizedIpAddress ? `${key}:ip:${normalizedIpAddress}` : key;
}

export function getSetupThrottleKey(tokenHash: string, ipAddress?: string): string {
  const key = `setup:${tokenHash.trim().toLowerCase()}`;
  const normalizedIpAddress = ipAddress?.trim().toLowerCase();

  return normalizedIpAddress ? `${key}:ip:${normalizedIpAddress}` : key;
}

export async function consumeThrottle(
  key: string,
  options: {
    limit?: number;
    windowMs?: number;
    now?: number;
    store?: AuthProtectionStore;
  } = {}
): Promise<ThrottleDecision> {
  const limit = options.limit ?? DEFAULT_AUTH_THROTTLE_LIMIT;
  const windowMs = options.windowMs ?? DEFAULT_AUTH_THROTTLE_WINDOW_MS;
  return (options.store ?? defaultAuthProtectionStore).consumeThrottle(key, {
    limit,
    windowMs,
    now: options.now,
  });
}

export async function resetThrottle(
  key?: string,
  store: AuthProtectionStore = defaultAuthProtectionStore
): Promise<void> {
  await store.resetThrottle(key);
}

export function toWebAuthnCredential(
  passkey: Pick<StoredPasskeyLike, "credentialId" | "publicKey" | "counter" | "transports">
): WebAuthnCredential {
  return {
    id: passkey.credentialId as Base64URLString,
    publicKey: Buffer.from(passkey.publicKey, "base64url"),
    counter: passkey.counter,
    transports: normalizeAuthenticatorTransports(passkey.transports),
  };
}

export async function createRegistrationOptionsForUser(options: {
  user: WebAuthnUserLike;
  passkeys?: Pick<StoredPasskeyLike, "credentialId" | "transports">[];
  challenge?: string;
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const config = getWebAuthnConfig();

  return generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userName: options.user.username,
    userDisplayName: options.user.username,
    userID: getWebAuthnUserIDBuffer(options.user.id),
    challenge: options.challenge,
    attestationType: "none",
    excludeCredentials: (options.passkeys ?? []).map((passkey) => ({
      id: passkey.credentialId as Base64URLString,
      transports: normalizeAuthenticatorTransports(passkey.transports),
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    supportedAlgorithmIDs: supportedCOSEAlgorithmIdentifiers,
  });
}

export async function verifyRegistration(options: {
  response: RegistrationResponseJSON;
  expectedChallenge: string;
}): Promise<VerifiedRegistrationResponse> {
  const config = getWebAuthnConfig();

  return verifyRegistrationResponse({
    response: options.response,
    expectedChallenge: normalizeExpectedChallenge(options.expectedChallenge),
    expectedOrigin: config.expectedOrigins,
    expectedRPID: config.rpID,
    requireUserVerification: true,
  });
}

export function mapVerifiedRegistrationToPasskey(
  verification: VerifiedRegistrationResponse,
  userId: string,
  transports: string[] = []
): PersistablePasskey {
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Registration response was not verified.");
  }

  const credential = verification.registrationInfo.credential;

  return {
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: normalizeAuthenticatorTransports(transports) ?? [],
    deviceType: verification.registrationInfo.credentialDeviceType,
    backedUp: verification.registrationInfo.credentialBackedUp,
    webAuthnUserID: getWebAuthnUserID(userId),
  };
}

export async function createAuthenticationOptionsForUser(options: {
  passkeys?: Pick<StoredPasskeyLike, "credentialId" | "transports">[];
  challenge?: string;
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const config = getWebAuthnConfig();

  return generateAuthenticationOptions({
    rpID: config.rpID,
    challenge: options.challenge,
    userVerification: "required",
    allowCredentials:
      options.passkeys && options.passkeys.length > 0
        ? options.passkeys.map((passkey) => ({
            id: passkey.credentialId as Base64URLString,
            transports: normalizeAuthenticatorTransports(passkey.transports),
          }))
        : undefined,
  });
}

export async function verifyAuthentication(options: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  passkey: Pick<StoredPasskeyLike, "credentialId" | "publicKey" | "counter" | "transports">;
}): Promise<VerifiedAuthenticationResponse> {
  const config = getWebAuthnConfig();

  return verifyAuthenticationResponse({
    response: options.response,
    expectedChallenge: normalizeExpectedChallenge(options.expectedChallenge),
    expectedOrigin: config.expectedOrigins,
    expectedRPID: config.rpID,
    credential: toWebAuthnCredential(options.passkey),
    requireUserVerification: true,
  });
}

export function mapVerifiedAuthenticationToPasskeyUpdate(
  verification: VerifiedAuthenticationResponse
): Pick<PersistablePasskey, "counter" | "deviceType" | "backedUp"> {
  if (!verification.verified) {
    throw new Error("Authentication response was not verified.");
  }

  return {
    counter: verification.authenticationInfo.newCounter,
    deviceType: verification.authenticationInfo.credentialDeviceType,
    backedUp: verification.authenticationInfo.credentialBackedUp,
  };
}

function normalizeAuthenticatorTransports(
  transports: string[] | undefined
): AuthenticatorTransportFuture[] | undefined {
  if (!transports || transports.length === 0) {
    return undefined;
  }

  return transports.filter(isAuthenticatorTransport) as AuthenticatorTransportFuture[];
}

function normalizeExpectedChallenge(challenge: string): string {
  return Buffer.from(challenge, "utf8").toString("base64url");
}

function isAuthenticatorTransport(
  value: string
): value is AuthenticatorTransportFuture {
  return [
    "ble",
    "cable",
    "hybrid",
    "internal",
    "nfc",
    "smart-card",
    "usb",
  ].includes(value);
}
