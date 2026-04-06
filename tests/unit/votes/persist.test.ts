import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  DEFAULT_UPVOTE_SERIALIZATION_RETRY_LIMIT,
  UPVOTE_COOLDOWN_MS,
  recordAnonymousUpvote,
  type UpvotePersistenceClientLike,
  type UpvotePersistenceTransactionClientLike,
} from "@/lib/votes/persist";

describe("anonymous upvote persistence", () => {
  it("returns missing when the target video does not exist", async () => {
    const tx = createTransactionClient({
      video: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });
    const client = createPersistenceClient(tx);

    await expect(
      recordAnonymousUpvote({
        videoId: 42,
        voterKeyHash: "hash",
        now: new Date("2026-04-05T21:00:00.000Z"),
        client,
      })
    ).resolves.toEqual({ kind: "missing" });
    expect(tx.videoUpvote.create).not.toHaveBeenCalled();
    expect(tx.video.update).not.toHaveBeenCalled();
  });

  it("returns cooldown when the same browser voted within 24 hours", async () => {
    const now = new Date("2026-04-05T21:00:00.000Z");
    const previousUpvoteAt = new Date(now.getTime() - 60_000);
    const tx = createTransactionClient({
      videoUpvote: {
        findFirst: vi.fn().mockResolvedValue({
          createdAt: previousUpvoteAt,
        }),
      },
    });
    const client = createPersistenceClient(tx);

    const result = await recordAnonymousUpvote({
      videoId: 42,
      voterKeyHash: "hash",
      now,
      client,
    });

    expect(result).toEqual({
      kind: "cooldown",
      retryAfterMs: UPVOTE_COOLDOWN_MS - 60_000,
      nextEligibleUpvoteAt: new Date(previousUpvoteAt.getTime() + UPVOTE_COOLDOWN_MS),
    });
    expect(tx.videoUpvote.create).not.toHaveBeenCalled();
    expect(tx.video.update).not.toHaveBeenCalled();
  });

  it("records a new upvote and returns the updated count", async () => {
    const now = new Date("2026-04-05T21:00:00.000Z");
    const tx = createTransactionClient({
      video: {
        update: vi.fn().mockResolvedValue({
          upvoteCount: 7,
        }),
      },
    });
    const client = createPersistenceClient(tx);

    await expect(
      recordAnonymousUpvote({
        videoId: 42,
        voterKeyHash: "hash",
        now,
        client,
      })
    ).resolves.toEqual({
      kind: "success",
      upvoteCount: 7,
      nextEligibleUpvoteAt: new Date(now.getTime() + UPVOTE_COOLDOWN_MS),
    });
    expect(tx.videoUpvote.create).toHaveBeenCalledWith({
      data: {
        videoId: 42,
        voterKeyHash: "hash",
        createdAt: now,
      },
    });
    expect(tx.video.update).toHaveBeenCalledWith({
      where: {
        id: 42,
      },
      data: {
        upvoteCount: {
          increment: 1,
        },
      },
      select: {
        upvoteCount: true,
      },
    });
  });

  it("allows a repeat vote after the 24 hour cooldown expires", async () => {
    const now = new Date("2026-04-05T21:00:00.000Z");
    const previousUpvoteAt = new Date(now.getTime() - (UPVOTE_COOLDOWN_MS + 1));
    const tx = createTransactionClient({
      videoUpvote: {
        findFirst: vi.fn().mockResolvedValue({
          createdAt: previousUpvoteAt,
        }),
      },
      video: {
        update: vi.fn().mockResolvedValue({
          upvoteCount: 2,
        }),
      },
    });
    const client = createPersistenceClient(tx);

    await expect(
      recordAnonymousUpvote({
        videoId: 42,
        voterKeyHash: "hash",
        now,
        client,
      })
    ).resolves.toEqual({
      kind: "success",
      upvoteCount: 2,
      nextEligibleUpvoteAt: new Date(now.getTime() + UPVOTE_COOLDOWN_MS),
    });
    expect(tx.videoUpvote.create).toHaveBeenCalledTimes(1);
  });

  it("retries serialization conflicts before succeeding", async () => {
    const tx = createTransactionClient();
    const transactionalWork = vi
      .fn()
      .mockRejectedValueOnce({ code: "P2034" })
      .mockRejectedValueOnce({ code: "P2034" })
      .mockImplementationOnce(
        async (
          callback: (tx: UpvotePersistenceTransactionClientLike) => Promise<unknown>
        ) => callback(tx)
      );
    const client: UpvotePersistenceClientLike = {
      $transaction: vi.fn((callback, options) => {
        expect(options).toEqual({
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
        return transactionalWork(callback);
      }),
    };

    await expect(
      recordAnonymousUpvote({
        videoId: 42,
        voterKeyHash: "hash",
        now: new Date("2026-04-05T21:00:00.000Z"),
        client,
      })
    ).resolves.toMatchObject({
      kind: "success",
      upvoteCount: 1,
    });
    expect(client.$transaction).toHaveBeenCalledTimes(3);
  });

  it("throws when serialization conflicts exceed the retry budget", async () => {
    const client: UpvotePersistenceClientLike = {
      $transaction: vi.fn().mockRejectedValue({ code: "P2034" }),
    };

    await expect(
      recordAnonymousUpvote({
        videoId: 42,
        voterKeyHash: "hash",
        now: new Date("2026-04-05T21:00:00.000Z"),
        retryLimit: DEFAULT_UPVOTE_SERIALIZATION_RETRY_LIMIT,
        client,
      })
    ).rejects.toMatchObject({
      code: "P2034",
    });
    expect(client.$transaction).toHaveBeenCalledTimes(
      DEFAULT_UPVOTE_SERIALIZATION_RETRY_LIMIT
    );
  });
});

function createPersistenceClient(
  tx: UpvotePersistenceTransactionClientLike
): UpvotePersistenceClientLike {
  return {
    $transaction: vi.fn((callback, options) => {
      expect(options).toEqual({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      return callback(tx);
    }),
  };
}

function createTransactionClient(
  overrides: {
    video?: Partial<UpvotePersistenceTransactionClientLike["video"]>;
    videoUpvote?: Partial<UpvotePersistenceTransactionClientLike["videoUpvote"]>;
  } = {}
): UpvotePersistenceTransactionClientLike {
  return {
    video: {
      findUnique: vi.fn().mockResolvedValue({ id: 42 }),
      update: vi.fn().mockResolvedValue({ upvoteCount: 1 }),
      ...overrides.video,
    },
    videoUpvote: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "vote_123" }),
      ...overrides.videoUpvote,
    },
  };
}
