import type { Prisma, Video } from "@prisma/client";

export type HomeSort = "votes" | "date";

type VideoQueryClient = {
  video: {
    findMany(args: Prisma.VideoFindManyArgs): Promise<Video[]>;
  };
};

export function normalizeHomeSort(sort: string | undefined): HomeSort {
  return sort === "votes" ? "votes" : "date";
}

export async function listHomeVideos(
  client: VideoQueryClient,
  {
    sort,
    titleQuery,
  }: {
    sort: HomeSort;
    titleQuery?: string;
  }
): Promise<Video[]> {
  const normalizedTitleQuery = normalizeTitleQuery(titleQuery);
  const orderBy = getHomePageOrderBy(sort);

  return client.video.findMany({
    ...(normalizedTitleQuery
      ? {
          where: {
            movieTitle: {
              contains: normalizedTitleQuery,
              mode: "insensitive",
            },
          },
        }
      : {}),
    orderBy,
  });
}

function normalizeTitleQuery(titleQuery: string | undefined): string | undefined {
  const normalizedTitleQuery = titleQuery?.trim();

  return normalizedTitleQuery ? normalizedTitleQuery : undefined;
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
