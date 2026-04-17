import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getTestDatabaseUrl } from "../setup/test-db";
import { listHomeVideos } from "@/lib/videos/list-home-videos";

describe("home video search", () => {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: getTestDatabaseUrl(),
      },
    },
  });

  beforeEach(async () => {
    await prisma.videoUpvote.deleteMany();
    await prisma.video.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns partial movie title matches and excludes unrelated titles", async () => {
    const now = Date.now();

    await prisma.video.createMany({
      data: [
        createVideoRecord({
          movieTitle: "Alien",
          sceneTitle: "Air shaft",
          submittedAt: new Date(now - 120_000),
          upvoteCount: 2,
        }),
        createVideoRecord({
          movieTitle: "Aliens",
          sceneTitle: "Power loader",
          submittedAt: new Date(now - 60_000),
          upvoteCount: 5,
        }),
        createVideoRecord({
          movieTitle: "Heat",
          sceneTitle: "Downtown shootout",
          submittedAt: new Date(now - 30_000),
          upvoteCount: 9,
        }),
      ],
    });

    const videos = await listHomeVideos(prisma, {
      sort: "date",
      titleQuery: "ali",
    });

    expect(videos.map((video) => video.movieTitle)).toEqual(["Aliens", "Alien"]);
  });

  it("matches movie titles case-insensitively", async () => {
    const now = Date.now();

    await prisma.video.createMany({
      data: [
        createVideoRecord({
          movieTitle: "Alien",
          sceneTitle: "Chestburster",
          submittedAt: new Date(now - 90_000),
          upvoteCount: 1,
        }),
        createVideoRecord({
          movieTitle: "Aliens",
          sceneTitle: "Med lab",
          submittedAt: new Date(now - 45_000),
          upvoteCount: 3,
        }),
      ],
    });

    const videos = await listHomeVideos(prisma, {
      sort: "date",
      titleQuery: "ALI",
    });

    expect(videos.map((video) => video.movieTitle)).toEqual(["Aliens", "Alien"]);
  });

  it("preserves top-voted ordering within the filtered movie titles", async () => {
    const now = Date.now();

    await prisma.video.createMany({
      data: [
        createVideoRecord({
          movieTitle: "Alien",
          sceneTitle: "Dallas in the vents",
          submittedAt: new Date(now - 120_000),
          upvoteCount: 3,
        }),
        createVideoRecord({
          movieTitle: "Aliens",
          sceneTitle: "Get away from her",
          submittedAt: new Date(now - 60_000),
          upvoteCount: 7,
        }),
        createVideoRecord({
          movieTitle: "Heat",
          sceneTitle: "Coffee shop",
          submittedAt: new Date(now - 30_000),
          upvoteCount: 100,
        }),
      ],
    });

    const videos = await listHomeVideos(prisma, {
      sort: "votes",
      titleQuery: "ali",
    });

    expect(
      videos.map((video) => ({
        movieTitle: video.movieTitle,
        upvoteCount: video.upvoteCount,
      }))
    ).toEqual([
      { movieTitle: "Aliens", upvoteCount: 7 },
      { movieTitle: "Alien", upvoteCount: 3 },
    ]);
  });
});

function createVideoRecord({
  movieTitle,
  sceneTitle,
  submittedAt,
  upvoteCount,
}: {
  movieTitle: string;
  sceneTitle: string;
  submittedAt: Date;
  upvoteCount: number;
}) {
  return {
    youtubeId: randomUUID().replace(/-/g, "").slice(0, 11),
    movieTitle,
    sceneTitle,
    submittedAt,
    upvoteCount,
  };
}
