import type {
  AuthProtectionStore,
  ThrottleDecision,
} from "@/lib/auth/protection-store";
import { consumeThrottle, resetThrottle } from "@/lib/auth/webauthn";

export const DEFAULT_UPVOTE_LIMIT = 3;
export const DEFAULT_UPVOTE_WINDOW_MS = 60_000;
export const DEFAULT_UPVOTE_IP_LIMIT = 30;
export const DEFAULT_UPVOTE_GLOBAL_LIMIT = 300;

export type UpvoteThrottleScope = "browser" | "ip" | "global";
export type UpvoteThrottleDecision = ThrottleDecision;

export interface ConsumeUpvoteThrottleOptions {
  scope?: UpvoteThrottleScope;
  limit?: number;
  windowMs?: number;
  now?: number;
  store?: AuthProtectionStore;
}

export function getUpvoteBrowserThrottleKey(
  videoId: number,
  voterId: string
): string {
  return `upvote:video:${videoId}:voter:${normalizeUpvoteKeyPart(voterId)}`;
}

export function getUpvoteEndpointIpThrottleKey(ipAddress: string): string {
  return `upvote:endpoint:ip:${normalizeUpvoteKeyPart(ipAddress)}`;
}

export function getUpvoteGlobalThrottleKey(): string {
  return "upvote:endpoint:global";
}

export async function consumeUpvoteThrottle(
  key: string,
  options: ConsumeUpvoteThrottleOptions = {}
): Promise<UpvoteThrottleDecision> {
  const defaults = getUpvoteThrottleDefaults(options.scope);

  return consumeThrottle(key, {
    limit: options.limit ?? defaults.limit,
    windowMs: options.windowMs ?? defaults.windowMs,
    now: options.now,
    store: options.store,
  });
}

export async function resetUpvoteThrottle(
  key?: string,
  store?: AuthProtectionStore
): Promise<void> {
  await resetThrottle(key, store);
}

function getUpvoteThrottleDefaults(
  scope: UpvoteThrottleScope = "browser"
): { limit: number; windowMs: number } {
  return {
    limit:
      scope === "ip"
        ? DEFAULT_UPVOTE_IP_LIMIT
        : scope === "global"
          ? DEFAULT_UPVOTE_GLOBAL_LIMIT
          : DEFAULT_UPVOTE_LIMIT,
    windowMs: DEFAULT_UPVOTE_WINDOW_MS,
  };
}

function normalizeUpvoteKeyPart(value: string): string {
  return value.trim().toLowerCase();
}
