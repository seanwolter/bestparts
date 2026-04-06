"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface UpvoteButtonProps {
  videoId: number;
  upvoteCount: number;
  nextEligibleUpvoteAt: Date | null;
}

interface UpvoteResponsePayload {
  error?: string;
  retryAfterMs?: number;
  nextEligibleUpvoteAt?: string;
  upvoteCount?: number;
}

interface StoredUpvoteCooldown {
  dailyCooldownAt: Date | null;
  burstCooldownAt: Date | null;
}

const STORAGE_KEY_PREFIX = "bestparts:upvote-cooldown:";

export default function UpvoteButton({
  videoId,
  upvoteCount,
  nextEligibleUpvoteAt,
}: UpvoteButtonProps) {
  const router = useRouter();
  const [currentUpvoteCount, setCurrentUpvoteCount] = useState(upvoteCount);
  const [dailyCooldownAt, setDailyCooldownAt] =
    useState<Date | null>(nextEligibleUpvoteAt);
  const [burstCooldownAt, setBurstCooldownAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentNextAllowedAt = getLatestCooldown(dailyCooldownAt, burstCooldownAt);

  const coolingDown =
    currentNextAllowedAt !== null && currentNextAllowedAt.getTime() > Date.now();

  useEffect(() => {
    setCurrentUpvoteCount(upvoteCount);
  }, [upvoteCount]);

  useEffect(() => {
    const storedCooldown = readStoredCooldown(videoId);
    const nextDailyCooldownAt = normalizeFutureDate(nextEligibleUpvoteAt);
    const nextCooldown = {
      dailyCooldownAt: nextDailyCooldownAt,
      burstCooldownAt: storedCooldown.burstCooldownAt,
    };

    setDailyCooldownAt(nextCooldown.dailyCooldownAt);
    setBurstCooldownAt(nextCooldown.burstCooldownAt);
    writeStoredCooldown(videoId, nextCooldown);
  }, [videoId, nextEligibleUpvoteAt]);

  async function handleUpvote() {
    if (submitting || coolingDown) {
      if (coolingDown) {
        setError("Please wait before trying again.");
      }

      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/videos/${videoId}/upvote`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | UpvoteResponsePayload
        | null;

      if (!response.ok) {
        if (response.status === 409 && payload?.nextEligibleUpvoteAt) {
          const nextDailyCooldownAt = new Date(payload.nextEligibleUpvoteAt);

          setDailyCooldownAt(nextDailyCooldownAt);
          writeStoredCooldown(videoId, {
            dailyCooldownAt: nextDailyCooldownAt,
            burstCooldownAt,
          });
        }

        if (response.status === 429 && typeof payload?.retryAfterMs === "number") {
          const nextBurstCooldownAt = extendBurstCooldown(
            burstCooldownAt,
            payload.retryAfterMs
          );

          setBurstCooldownAt(nextBurstCooldownAt);
          writeStoredCooldown(videoId, {
            dailyCooldownAt,
            burstCooldownAt: nextBurstCooldownAt,
          });
        }

        setError(payload?.error ?? "Failed to upvote. Please try again.");
        return;
      }

      if (typeof payload?.upvoteCount === "number") {
        setCurrentUpvoteCount(payload.upvoteCount);
      }

      if (payload?.nextEligibleUpvoteAt) {
        const nextDailyCooldownAt = new Date(payload.nextEligibleUpvoteAt);

        setDailyCooldownAt(nextDailyCooldownAt);
        setBurstCooldownAt(null);
        writeStoredCooldown(videoId, {
          dailyCooldownAt: nextDailyCooldownAt,
          burstCooldownAt: null,
        });
      }

      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleUpvote}
          disabled={submitting || coolingDown}
          aria-label={`Upvote video (${currentUpvoteCount} votes)`}
          className="rounded-full border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:border-yellow-400 hover:text-yellow-300 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-500"
        >
          👍✌️
        </button>
        <span className="text-sm font-semibold text-neutral-200">
          {currentUpvoteCount}
        </span>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}

function getStorageKey(videoId: number): string {
  return `${STORAGE_KEY_PREFIX}${videoId}`;
}

function readStoredCooldown(videoId: number): StoredUpvoteCooldown {
  if (typeof window === "undefined") {
    return {
      dailyCooldownAt: null,
      burstCooldownAt: null,
    };
  }

  const rawValue = window.localStorage.getItem(getStorageKey(videoId));

  if (!rawValue) {
    return {
      dailyCooldownAt: null,
      burstCooldownAt: null,
    };
  }

  try {
    const parsed = JSON.parse(rawValue) as {
      dailyCooldownAt?: string;
      burstCooldownAt?: string;
    };
    const storedCooldown = {
      dailyCooldownAt: normalizeFutureDate(parsed.dailyCooldownAt),
      burstCooldownAt: normalizeFutureDate(parsed.burstCooldownAt),
    };

    writeStoredCooldown(videoId, storedCooldown);

    return storedCooldown;
  } catch {
    window.localStorage.removeItem(getStorageKey(videoId));

    return {
      dailyCooldownAt: null,
      burstCooldownAt: null,
    };
  }
}

function writeStoredCooldown(
  videoId: number,
  cooldown: StoredUpvoteCooldown
): void {
  if (typeof window === "undefined") {
    return;
  }

  const nextCooldown = {
    dailyCooldownAt: normalizeFutureDate(cooldown.dailyCooldownAt),
    burstCooldownAt: normalizeFutureDate(cooldown.burstCooldownAt),
  };

  if (!nextCooldown.dailyCooldownAt && !nextCooldown.burstCooldownAt) {
    window.localStorage.removeItem(getStorageKey(videoId));
    return;
  }

  window.localStorage.setItem(
    getStorageKey(videoId),
    JSON.stringify({
      dailyCooldownAt: nextCooldown.dailyCooldownAt?.toISOString() ?? null,
      burstCooldownAt: nextCooldown.burstCooldownAt?.toISOString() ?? null,
    })
  );
}

function normalizeFutureDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
    return null;
  }

  return parsed;
}

function getLatestCooldown(
  dailyCooldownAt: Date | null,
  burstCooldownAt: Date | null
): Date | null {
  if (!dailyCooldownAt) {
    return burstCooldownAt;
  }

  if (!burstCooldownAt) {
    return dailyCooldownAt;
  }

  return dailyCooldownAt.getTime() >= burstCooldownAt.getTime()
    ? dailyCooldownAt
    : burstCooldownAt;
}

function extendBurstCooldown(
  currentBurstCooldownAt: Date | null,
  retryAfterMs: number
): Date | null {
  const nextBurstCooldownAt = normalizeFutureDate(
    new Date(Date.now() + retryAfterMs)
  );

  if (!currentBurstCooldownAt) {
    return nextBurstCooldownAt;
  }

  if (!nextBurstCooldownAt) {
    return currentBurstCooldownAt;
  }

  return currentBurstCooldownAt.getTime() >= nextBurstCooldownAt.getTime()
    ? currentBurstCooldownAt
    : nextBurstCooldownAt;
}
