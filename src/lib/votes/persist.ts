import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const UPVOTE_COOLDOWN_MS = 24 * 60 * 60_000;
export const DEFAULT_UPVOTE_SERIALIZATION_RETRY_LIMIT = 3;

export type AnonymousUpvotePersistenceResult =
  | {
      kind: "success";
      upvoteCount: number;
      nextEligibleUpvoteAt: Date;
    }
  | {
      kind: "cooldown";
      retryAfterMs: number;
      nextEligibleUpvoteAt: Date;
    }
  | {
      kind: "missing";
    };

export interface UpvotePersistenceTransactionClientLike {
  video: {
    findUnique(args: {
      where: {
        id: number;
      };
      select: {
        id: true;
      };
    }): Promise<{ id: number } | null>;
    update(args: {
      where: {
        id: number;
      };
      data: {
        upvoteCount: {
          increment: number;
        };
      };
      select: {
        upvoteCount: true;
      };
    }): Promise<{ upvoteCount: number }>;
  };
  videoUpvote: {
    findFirst(args: {
      where: {
        videoId: number;
        voterKeyHash: string;
      };
      orderBy: {
        createdAt: "desc";
      };
      select: {
        createdAt: true;
      };
    }): Promise<{ createdAt: Date } | null>;
    create(args: {
      data: {
        videoId: number;
        voterKeyHash: string;
        createdAt: Date;
      };
    }): Promise<unknown>;
  };
}

export interface UpvotePersistenceClientLike {
  $transaction<T>(
    callback: (tx: UpvotePersistenceTransactionClientLike) => Promise<T>,
    options: {
      isolationLevel: Prisma.TransactionIsolationLevel;
    }
  ): Promise<T>;
}

export interface RecordAnonymousUpvoteInput {
  videoId: number;
  voterKeyHash: string;
  now?: Date;
  retryLimit?: number;
  client?: UpvotePersistenceClientLike;
}

export async function recordAnonymousUpvote(
  input: RecordAnonymousUpvoteInput
): Promise<AnonymousUpvotePersistenceResult> {
  const now = input.now ?? new Date();
  const retryLimit =
    input.retryLimit ?? DEFAULT_UPVOTE_SERIALIZATION_RETRY_LIMIT;
  const client: UpvotePersistenceClientLike =
    input.client ?? (db as unknown as UpvotePersistenceClientLike);

  for (let attempt = 0; attempt < retryLimit; attempt += 1) {
    try {
      return await client.$transaction(
        async (tx: UpvotePersistenceTransactionClientLike) => {
          const video = await tx.video.findUnique({
            where: {
              id: input.videoId,
            },
            select: {
              id: true,
            },
          });

          if (!video) {
            return { kind: "missing" } satisfies AnonymousUpvotePersistenceResult;
          }

          const previousUpvote = await tx.videoUpvote.findFirst({
            where: {
              videoId: input.videoId,
              voterKeyHash: input.voterKeyHash,
            },
            orderBy: {
              createdAt: "desc",
            },
            select: {
              createdAt: true,
            },
          });

          if (previousUpvote) {
            const nextEligibleUpvoteAt = new Date(
              previousUpvote.createdAt.getTime() + UPVOTE_COOLDOWN_MS
            );

            if (nextEligibleUpvoteAt.getTime() > now.getTime()) {
              return {
                kind: "cooldown",
                retryAfterMs: Math.max(
                  nextEligibleUpvoteAt.getTime() - now.getTime(),
                  0
                ),
                nextEligibleUpvoteAt,
              } satisfies AnonymousUpvotePersistenceResult;
            }
          }

          await tx.videoUpvote.create({
            data: {
              videoId: input.videoId,
              voterKeyHash: input.voterKeyHash,
              createdAt: now,
            },
          });

          const updatedVideo = await tx.video.update({
            where: {
              id: input.videoId,
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

          return {
            kind: "success",
            upvoteCount: updatedVideo.upvoteCount,
            nextEligibleUpvoteAt: new Date(now.getTime() + UPVOTE_COOLDOWN_MS),
          } satisfies AnonymousUpvotePersistenceResult;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }
      );
    } catch (error) {
      if (isPrismaSerializationError(error) && attempt + 1 < retryLimit) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Anonymous upvote persistence failed after retries.");
}

function isPrismaSerializationError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    return true;
  }

  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}
