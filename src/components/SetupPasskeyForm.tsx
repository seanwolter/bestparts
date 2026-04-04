"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  browserSupportsWebAuthn,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";

const GENERIC_SETUP_FAILURE_MESSAGE = "Passkey setup failed.";
const INVALID_SETUP_TOKEN_ERROR = "Setup token is invalid or expired.";
const UNSUPPORTED_WEBAUTHN_MESSAGE =
  "This browser does not support passkeys.";
const ADD_PASSKEY_EXISTING_DEVICE_MESSAGE =
  "This device or passkey manager already has a passkey for this account. Use a different device or browser to add another passkey, or use recovery if you need to replace the current one.";

type SetupTokenReason = "INITIAL_ENROLLMENT" | "ADD_PASSKEY" | "RECOVERY";

interface SetupOptionsResponse {
  options: PublicKeyCredentialCreationOptionsJSON;
  user?: {
    username?: string;
    status?: "PENDING_SETUP" | "ACTIVE";
    reason?: SetupTokenReason;
  };
}

interface AuthErrorResponse {
  error?: string;
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function getSetupErrorMessage(payload: AuthErrorResponse | null): string {
  const message = payload?.error?.trim();

  if (!message) {
    return GENERIC_SETUP_FAILURE_MESSAGE;
  }

  if (message === INVALID_SETUP_TOKEN_ERROR) {
    return INVALID_SETUP_TOKEN_ERROR;
  }

  return GENERIC_SETUP_FAILURE_MESSAGE;
}

function getClientSetupErrorMessage(
  error: unknown,
  setupReason: SetupTokenReason | null
): string {
  if (
    setupReason === "ADD_PASSKEY" &&
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "InvalidStateError"
  ) {
    return ADD_PASSKEY_EXISTING_DEVICE_MESSAGE;
  }

  return GENERIC_SETUP_FAILURE_MESSAGE;
}

function getSetupHeading(setupReason: SetupTokenReason | null): string {
  if (setupReason === "ADD_PASSKEY") {
    return "Add another passkey";
  }

  if (setupReason === "RECOVERY") {
    return "Recover account access";
  }

  return "Register your passkey";
}

function getSetupDescription(setupReason: SetupTokenReason | null): string {
  if (setupReason === "ADD_PASSKEY") {
    return "Use a device or passkey manager that does not already have one of this account's passkeys. If you are replacing your current passkey, use recovery instead.";
  }

  if (setupReason === "RECOVERY") {
    return "This one-time recovery link replaces the previous passkey setup. Finish registration on the device you want to use going forward.";
  }

  return "This link can only be used once. Finish passkey setup on the device you plan to sign in with.";
}

export default function SetupPasskeyForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [setupReason, setSetupReason] = useState<SetupTokenReason | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleRegister() {
    setSubmitting(true);
    setError(null);
    let nextSetupReason: SetupTokenReason | null = null;

    try {
      if (!(await browserSupportsWebAuthn())) {
        setError(UNSUPPORTED_WEBAUTHN_MESSAGE);
        return;
      }

      const optionsResponse = await fetch("/api/auth/setup/options", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          token,
        }),
      });
      const optionsPayload = await readJson<SetupOptionsResponse & AuthErrorResponse>(
        optionsResponse
      );

      if (!optionsResponse.ok || !optionsPayload?.options) {
        setError(getSetupErrorMessage(optionsPayload));
        return;
      }

      setUsername(optionsPayload.user?.username?.trim() || null);
      nextSetupReason = optionsPayload.user?.reason ?? null;
      setSetupReason(nextSetupReason);

      const registrationResponse = await startRegistration({
        optionsJSON: optionsPayload.options,
      });

      const verifyResponse = await fetch("/api/auth/setup/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          token,
          response: registrationResponse,
        }),
      });
      const verifyPayload = await readJson<AuthErrorResponse>(verifyResponse);

      if (!verifyResponse.ok) {
        setError(getSetupErrorMessage(verifyPayload));
        return;
      }

      router.push("/");
      router.refresh();
    } catch (error) {
      setError(getClientSetupErrorMessage(error, nextSetupReason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/80 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-yellow-400">
          One-time setup
        </p>
        <h2 className="mt-3 text-xl font-black text-white">
          {getSetupHeading(setupReason)}
        </h2>
        <p className="mt-2 text-sm leading-6 text-neutral-400">
          {getSetupDescription(setupReason)}
        </p>
        {username && (
          <p className="mt-4 text-sm text-neutral-300">
            Creating passkey for <span className="font-semibold text-white">{username}</span>
          </p>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleRegister}
        disabled={submitting}
        className="w-full rounded-xl bg-yellow-400 px-4 py-3 font-semibold text-neutral-950 transition-colors hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Registering passkey..." : "Register passkey"}
      </button>
    </div>
  );
}
