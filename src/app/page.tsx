import type { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import HomeEmptyState from "@/components/HomeEmptyState";
import HomeSortControls, { type HomeSort } from "@/components/HomeSortControls";
import VideoCard from "@/components/VideoCard";
import { getCurrentUser } from "@/lib/auth/current-user";
import { UPVOTE_COOLDOWN_MS } from "@/lib/votes/persist";
import {
  ANONYMOUS_VOTER_COOKIE_NAME,
  hashAnonymousVoterId,
  tryReadAnonymousVoterCookie,
} from "@/lib/votes/voter-cookie";

export const dynamic = "force-dynamic";

function normalizeHomeSort(sort: string | undefined): HomeSort {
  return sort === "votes" ? "votes" : "date";
}

function getHomePageOrderBy(sort: HomeSort): Prisma.VideoOrderByWithRelationInput[] {
  return sort === "date"
    ? [
        { submittedAt: "desc" },
        { upvoteCount: "desc" },
        { id: "desc" },
      ]
    : [
        { upvoteCount: "desc" },
        { submittedAt: "desc" },
        { id: "desc" },
      ];
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const sort = normalizeHomeSort(resolvedSearchParams.sort);
  const cookieStore = await cookies();
  const currentUser = await getCurrentUser();
  const videos = await db.video.findMany({
    orderBy: getHomePageOrderBy(sort),
  });
  const nextEligibleUpvoteAtByVideoId = await getNextEligibleUpvoteAtByVideoId(
    cookieStore,
    videos.map((video) => video.id)
  );

  return (
    <div>
      <div className="mb-10">
        <h1 className="text-3xl font-black text-white mb-2">
          The best parts of movies
        </h1>
      </div>
      <HomeSortControls sort={sort} />

      {videos.length === 0 ? (
        <HomeEmptyState canSubmit={Boolean(currentUser)} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              {...video}
              canManage={Boolean(currentUser)}
              nextEligibleUpvoteAt={
                nextEligibleUpvoteAtByVideoId.get(video.id) ?? null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

async function getNextEligibleUpvoteAtByVideoId(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  videoIds: number[]
): Promise<Map<number, Date>> {
  if (videoIds.length === 0) {
    return new Map();
  }

  const anonymousVoterCookie = tryReadAnonymousVoterCookie(
    cookieStore.get(ANONYMOUS_VOTER_COOKIE_NAME)?.value
  );

  if (!anonymousVoterCookie) {
    return new Map();
  }

  const now = Date.now();
  const votes = await db.videoUpvote.findMany({
    where: {
      videoId: {
        in: videoIds,
      },
      voterKeyHash: hashAnonymousVoterId(anonymousVoterCookie.voterId),
    },
    orderBy: [{ videoId: "asc" }, { createdAt: "desc" }],
    select: {
      videoId: true,
      createdAt: true,
    },
  });
  const nextEligibleByVideoId = new Map<number, Date>();

  for (const vote of votes) {
    if (nextEligibleByVideoId.has(vote.videoId)) {
      continue;
    }

    const nextEligibleUpvoteAt = new Date(
      vote.createdAt.getTime() + UPVOTE_COOLDOWN_MS
    );

    if (nextEligibleUpvoteAt.getTime() > now) {
      nextEligibleByVideoId.set(vote.videoId, nextEligibleUpvoteAt);
    }
  }

  return nextEligibleByVideoId;
}
