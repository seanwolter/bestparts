import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { AuthFlow } from "./cookies";

export interface ThrottleDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface AuthProtectionStore {
  consumeCeremonyNonce(
    flow: AuthFlow,
    nonce: string,
    expiresAt: Date,
    now?: Date
  ): Promise<boolean>;
  resetConsumedCeremonyNonces(): Promise<void>;
  consumeThrottle(
    key: string,
    options: {
      limit: number;
      windowMs: number;
      now?: number;
    }
  ): Promise<ThrottleDecision>;
  resetThrottle(key?: string): Promise<void>;
}

interface ConsumedCeremonyNonceDelegateLike {
  create(args: {
    data: {
      nonceKeyHash: string;
      expiresAt: Date;
    };
  }): Promise<unknown>;
  deleteMany(args?: {
    where?: {
      nonceKeyHash?: string;
      expiresAt?: {
        lte?: Date;
      };
    };
  }): Promise<{ count: number }>;
}

interface AuthThrottleBucketRecord {
  count: number;
  resetAt: Date;
}

interface AuthThrottleBucketDelegateLike {
  create(args: {
    data: {
      keyHash: string;
      count: number;
      resetAt: Date;
    };
  }): Promise<AuthThrottleBucketRecord>;
  findUnique(args: {
    where: {
      keyHash: string;
    };
  }): Promise<AuthThrottleBucketRecord | null>;
  updateMany(args: {
    where: {
      keyHash: string;
      resetAt?: {
        gt?: Date;
      };
      count?: {
        lt?: number;
      };
    };
    data: {
      count: {
        increment: number;
      };
    };
  }): Promise<{ count: number }>;
  deleteMany(args?: {
    where?: {
      keyHash?: string;
      resetAt?: {
        lte?: Date;
      };
    };
  }): Promise<{ count: number }>;
}

interface AuthProtectionPrismaClientLike {
  consumedCeremonyNonce: ConsumedCeremonyNonceDelegateLike;
  authThrottleBucket: AuthThrottleBucketDelegateLike;
}

export function createPrismaAuthProtectionStore(
  client: AuthProtectionPrismaClientLike = db
): AuthProtectionStore {
  return {
    async consumeCeremonyNonce(flow, nonce, expiresAt, now = new Date()) {
      await client.consumedCeremonyNonce.deleteMany({
        where: {
          expiresAt: {
            lte: now,
          },
        },
      });

      try {
        await client.consumedCeremonyNonce.create({
          data: {
            nonceKeyHash: hashProtectionValue(`${flow}:${nonce}`),
            expiresAt,
          },
        });
        return true;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          return false;
        }

        throw error;
      }
    },

    async resetConsumedCeremonyNonces() {
      await client.consumedCeremonyNonce.deleteMany();
    },

    async consumeThrottle(key, options) {
      const nowMs = options.now ?? Date.now();
      const now = new Date(nowMs);
      const keyHash = hashProtectionValue(key);
      const resetAt = new Date(nowMs + options.windowMs);

      await client.authThrottleBucket.deleteMany({
        where: {
          resetAt: {
            lte: now,
          },
        },
      });

      try {
        await client.authThrottleBucket.create({
          data: {
            keyHash,
            count: 1,
            resetAt,
          },
        });

        return {
          allowed: true,
          remaining: Math.max(options.limit - 1, 0),
          retryAfterMs: 0,
        };
      } catch (error) {
        if (
          !(
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          )
        ) {
          throw error;
        }
      }

      const updated = await client.authThrottleBucket.updateMany({
        where: {
          keyHash,
          resetAt: {
            gt: now,
          },
          count: {
            lt: options.limit,
          },
        },
        data: {
          count: {
            increment: 1,
          },
        },
      });
      const bucket = await client.authThrottleBucket.findUnique({
        where: {
          keyHash,
        },
      });

      if (!bucket || bucket.resetAt.getTime() <= nowMs) {
        await client.authThrottleBucket.deleteMany({
          where: {
            keyHash,
            resetAt: {
              lte: now,
            },
          },
        });

        return this.consumeThrottle(key, options);
      }

      if (updated.count === 1) {
        return {
          allowed: true,
          remaining: Math.max(options.limit - bucket.count, 0),
          retryAfterMs: 0,
        };
      }

      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(bucket.resetAt.getTime() - nowMs, 0),
      };
    },

    async resetThrottle(key) {
      await client.authThrottleBucket.deleteMany({
        where: key
          ? {
              keyHash: hashProtectionValue(key),
            }
          : undefined,
      });
    },
  };
}

export function createInMemoryAuthProtectionStore(): AuthProtectionStore {
  const consumedCeremonyNonces = new Map<string, number>();
  const authThrottleBuckets = new Map<string, { count: number; resetAt: number }>();

  return {
    async consumeCeremonyNonce(flow, nonce, expiresAt, now = new Date()) {
      pruneExpiredCeremonyNonces(consumedCeremonyNonces, now.getTime());
      const nonceKeyHash = hashProtectionValue(`${flow}:${nonce}`);

      if (consumedCeremonyNonces.has(nonceKeyHash)) {
        return false;
      }

      consumedCeremonyNonces.set(nonceKeyHash, expiresAt.getTime());
      return true;
    },

    async resetConsumedCeremonyNonces() {
      consumedCeremonyNonces.clear();
    },

    async consumeThrottle(key, options) {
      const now = options.now ?? Date.now();
      const keyHash = hashProtectionValue(key);
      pruneExpiredThrottleBuckets(authThrottleBuckets, now);
      const entry = authThrottleBuckets.get(keyHash);

      if (!entry) {
        authThrottleBuckets.set(keyHash, {
          count: 1,
          resetAt: now + options.windowMs,
        });

        return {
          allowed: true,
          remaining: Math.max(options.limit - 1, 0),
          retryAfterMs: 0,
        };
      }

      if (entry.count >= options.limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: Math.max(entry.resetAt - now, 0),
        };
      }

      entry.count += 1;

      return {
        allowed: true,
        remaining: Math.max(options.limit - entry.count, 0),
        retryAfterMs: 0,
      };
    },

    async resetThrottle(key) {
      if (key) {
        authThrottleBuckets.delete(hashProtectionValue(key));
        return;
      }

      authThrottleBuckets.clear();
    },
  };
}

function hashProtectionValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pruneExpiredCeremonyNonces(
  store: Map<string, number>,
  nowMs: number
): void {
  for (const [key, expiresAt] of store.entries()) {
    if (expiresAt <= nowMs) {
      store.delete(key);
    }
  }
}

function pruneExpiredThrottleBuckets(
  store: Map<string, { count: number; resetAt: number }>,
  nowMs: number
): void {
  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt <= nowMs) {
      store.delete(key);
    }
  }
}
