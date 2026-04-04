"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

const GENERIC_LOGIN_FAILURE_MESSAGE = "Authentication failed.";
const UNSUPPORTED_WEBAUTHN_MESSAGE =
  "This browser does not support passkeys.";

interface LoginOptionsResponse {
  options: PublicKeyCredentialRequestOptionsJSON;
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

function getErrorMessage(payload: AuthErrorResponse | null, fallback: string): string {
  const message = payload?.error?.trim();
  return message ? message : fallback;
}

export default function LoginForm({
  nextPath = "/",
}: {
  nextPath?: string;
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedUsername = username.trim();

    if (!trimmedUsername) {
      setError(GENERIC_LOGIN_FAILURE_MESSAGE);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (!(await browserSupportsWebAuthn())) {
        setError(UNSUPPORTED_WEBAUTHN_MESSAGE);
        return;
      }

      const optionsResponse = await fetch("/api/auth/login/options", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username: trimmedUsername,
        }),
      });
      const optionsPayload = await readJson<LoginOptionsResponse & AuthErrorResponse>(
        optionsResponse
      );

      if (!optionsResponse.ok || !optionsPayload?.options) {
        setError(getErrorMessage(optionsPayload, GENERIC_LOGIN_FAILURE_MESSAGE));
        return;
      }

      const authenticationResponse = await startAuthentication({
        optionsJSON: optionsPayload.options,
      });

      const verifyResponse = await fetch("/api/auth/login/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username: trimmedUsername,
          response: authenticationResponse,
        }),
      });
      const verifyPayload = await readJson<AuthErrorResponse>(verifyResponse);

      if (!verifyResponse.ok) {
        setError(getErrorMessage(verifyPayload, GENERIC_LOGIN_FAILURE_MESSAGE));
        return;
      }

      router.push(nextPath);
      router.refresh();
    } catch {
      setError(GENERIC_LOGIN_FAILURE_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label
          htmlFor="username"
          className="mb-1.5 block text-sm font-medium text-neutral-300"
        >
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username webauthn"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={submitting}
          placeholder="e.g. mark"
          className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white placeholder-neutral-600 transition-colors focus:border-yellow-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
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
        type="submit"
        disabled={submitting}
        className="w-full rounded-xl bg-yellow-400 px-4 py-3 font-semibold text-neutral-950 transition-colors hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Checking passkey..." : "Continue with passkey"}
      </button>
    </form>
  );
}
