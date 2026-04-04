"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

interface CreatedSetupTokenState {
  username: string;
  setupUrl: string;
  reason: string;
  expiresAt: string;
}

interface CreateUserResponse {
  user: {
    username: string;
  };
  setupToken: {
    setupUrl: string;
    reason: string;
    expiresAt: string;
  };
}

interface CreateUserErrorResponse {
  error?: string;
}

export default function CreateUserForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdToken, setCreatedToken] = useState<CreatedSetupTokenState | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedUsername = username.trim();

    if (!trimmedUsername) {
      setError("Username is required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setCopyStatus("idle");

    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username: trimmedUsername,
        }),
      });
      const payload = (await response.json()) as CreateUserResponse | CreateUserErrorResponse;

      if (!response.ok || !("setupToken" in payload)) {
        setError(
          "error" in payload ? payload.error ?? "Failed to create the user." : "Failed to create the user."
        );
        return;
      }

      setCreatedToken({
        username: payload.user.username,
        setupUrl: payload.setupToken.setupUrl,
        reason: payload.setupToken.reason,
        expiresAt: payload.setupToken.expiresAt,
      });
      setUsername("");
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!createdToken) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createdToken.setupUrl);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/80 p-6">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-yellow-400">
          Add admin
        </p>
        <h2 className="mt-2 text-xl font-black text-white">Create a new admin user</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-400">
          New users are created in <span className="font-semibold text-neutral-200">PENDING_SETUP</span>
          {" "}with a one-time setup link.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="create-user-username"
            className="mb-1.5 block text-sm font-medium text-neutral-300"
          >
            Username
          </label>
          <input
            id="create-user-username"
            name="username"
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={submitting}
            placeholder="e.g. second-admin"
            className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white placeholder-neutral-600 transition-colors focus:border-yellow-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-xl bg-yellow-400 px-4 py-3 font-semibold text-neutral-950 transition-colors hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Creating user..." : "Create user"}
        </button>
      </form>

      {createdToken && (
        <div className="mt-5 rounded-2xl border border-yellow-500/30 bg-yellow-400/10 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-white">
                Setup link ready for {createdToken.username}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.24em] text-yellow-400">
                {createdToken.reason}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-lg border border-neutral-700 px-3 py-2 text-xs font-semibold text-neutral-200 transition-colors hover:border-neutral-500 hover:text-white"
            >
              Copy link
            </button>
          </div>
          <p
            data-testid="created-setup-url"
            className="mt-3 break-all rounded-xl bg-black/20 px-3 py-3 font-mono text-xs text-neutral-200"
          >
            {createdToken.setupUrl}
          </p>
          <p className="mt-3 text-xs text-neutral-400">
            Expires at {new Date(createdToken.expiresAt).toLocaleString()}
          </p>
          {copyStatus === "copied" && (
            <p className="mt-2 text-xs text-emerald-300">Link copied.</p>
          )}
          {copyStatus === "failed" && (
            <p className="mt-2 text-xs text-red-300">Unable to copy link.</p>
          )}
        </div>
      )}
    </section>
  );
}
