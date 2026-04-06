import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAnonymousVoterCookie,
  hashAnonymousVoterId,
} from "@/lib/votes/voter-cookie";
import { UPVOTE_COOLDOWN_MS } from "@/lib/votes/persist";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getCurrentUser: vi.fn(),
  findVideos: vi.fn(),
  findVideoUpvotes: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/db", () => ({
  db: {
    video: {
      findMany: mocks.findVideos,
    },
    videoUpvote: {
      findMany: mocks.findVideoUpvotes,
    },
  },
}));

vi.mock("@/components/HomeEmptyState", () => ({
  default: ({ canSubmit }: { canSubmit: boolean }) => (
    <div>{canSubmit ? "can submit" : "guest empty state"}</div>
  ),
}));

vi.mock("@/components/HomeSortControls", () => ({
  default: ({ sort }: { sort: "votes" | "date" }) => (
    <div data-testid="home-sort-controls">{sort}</div>
  ),
}));

vi.mock("@/components/VideoCard", () => ({
  default: ({
    sceneTitle,
    nextEligibleUpvoteAt,
  }: {
    sceneTitle: string;
    nextEligibleUpvoteAt?: Date | null;
  }) => (
    <div data-testid="video-card">
      {sceneTitle}
      {nextEligibleUpvoteAt ? `|${nextEligibleUpvoteAt.toISOString()}` : ""}
    </div>
  ),
}));

import Home from "@/app/page";

describe("Home page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.cookies.mockResolvedValue(createCookieStore());
    mocks.findVideoUpvotes.mockResolvedValue([]);
  });

  it("defaults to newest ordering with deterministic tie-breakers", async () => {
    mocks.findVideos.mockResolvedValue([
      createVideo({
        id: 2,
        sceneTitle: "Higher votes",
        upvoteCount: 5,
        submittedAt: new Date("2026-04-05T20:00:00.000Z"),
      }),
      createVideo({
        id: 1,
        sceneTitle: "Lower votes",
        upvoteCount: 1,
        submittedAt: new Date("2026-04-04T20:00:00.000Z"),
      }),
    ]);

    render(
      await Home({
        searchParams: Promise.resolve({}),
      })
    );

    expect(mocks.findVideos).toHaveBeenCalledWith({
      orderBy: [
        { submittedAt: "desc" },
        { upvoteCount: "desc" },
        { id: "desc" },
      ],
    });
    expect(
      screen.getAllByTestId("video-card").map((card) => card.textContent)
    ).toEqual(["Higher votes", "Lower votes"]);
    expect(screen.getByTestId("home-sort-controls")).toHaveTextContent("date");
  });

  it("supports newest ordering via the sort query param", async () => {
    mocks.findVideos.mockResolvedValue([
      createVideo({
        id: 3,
        sceneTitle: "Newest scene",
        upvoteCount: 1,
        submittedAt: new Date("2026-04-05T20:00:00.000Z"),
      }),
      createVideo({
        id: 4,
        sceneTitle: "Older scene",
        upvoteCount: 9,
        submittedAt: new Date("2026-04-04T20:00:00.000Z"),
      }),
    ]);

    render(
      await Home({
        searchParams: Promise.resolve({ sort: "date" }),
      })
    );

    expect(mocks.findVideos).toHaveBeenCalledWith({
      orderBy: [
        { submittedAt: "desc" },
        { upvoteCount: "desc" },
        { id: "desc" },
      ],
    });
    expect(
      screen.getAllByTestId("video-card").map((card) => card.textContent)
    ).toEqual(["Newest scene", "Older scene"]);
    expect(screen.getByTestId("home-sort-controls")).toHaveTextContent("date");
  });

  it("batches cooldown lookup for the current anonymous voter and passes it to cards", async () => {
    const voterId = "3b32a5ef-9059-4acc-bd6e-a8f2e37295ee";
    const issuedCookie = buildAnonymousVoterCookie({
      version: 1,
      voterId,
    });
    const latestVoteAt = new Date("2026-04-05T20:00:00.000Z");
    const expiredVoteAt = new Date(Date.now() - (UPVOTE_COOLDOWN_MS + 60_000));

    mocks.cookies.mockResolvedValue(
      createCookieStore({
        bestparts_voter: issuedCookie.value,
      })
    );
    mocks.findVideos.mockResolvedValue([
      createVideo({ id: 11, sceneTitle: "Cooling down", upvoteCount: 4 }),
      createVideo({ id: 12, sceneTitle: "Already eligible", upvoteCount: 2 }),
    ]);
    mocks.findVideoUpvotes.mockResolvedValue([
      {
        videoId: 11,
        createdAt: latestVoteAt,
      },
      {
        videoId: 12,
        createdAt: expiredVoteAt,
      },
    ]);

    render(
      await Home({
        searchParams: Promise.resolve({}),
      })
    );

    expect(mocks.findVideoUpvotes).toHaveBeenCalledTimes(1);
    expect(mocks.findVideoUpvotes).toHaveBeenCalledWith({
      where: {
        videoId: {
          in: [11, 12],
        },
        voterKeyHash: hashAnonymousVoterId(voterId),
      },
      orderBy: [{ videoId: "asc" }, { createdAt: "desc" }],
      select: {
        videoId: true,
        createdAt: true,
      },
    });
    expect(
      screen.getAllByTestId("video-card").map((card) => card.textContent)
    ).toEqual([
      `Cooling down|${new Date(latestVoteAt.getTime() + UPVOTE_COOLDOWN_MS).toISOString()}`,
      "Already eligible",
    ]);
  });
});

function createVideo(
  overrides: Partial<{
    id: number;
    youtubeId: string;
    movieTitle: string;
    sceneTitle: string;
    description: string | null;
    submittedAt: Date;
    upvoteCount: number;
  }> = {}
) {
  return {
    id: overrides.id ?? 1,
    youtubeId: overrides.youtubeId ?? "abc123def45",
    movieTitle: overrides.movieTitle ?? "Heat",
    sceneTitle: overrides.sceneTitle ?? "Downtown shootout",
    description: overrides.description ?? "Chaos on the street.",
    submittedAt:
      overrides.submittedAt ?? new Date("2026-04-04T20:00:00.000Z"),
    upvoteCount: overrides.upvoteCount ?? 0,
  };
}

function createCookieStore(values: Record<string, string> = {}) {
  return {
    get(name: string) {
      const value = values[name];
      return value ? { value } : undefined;
    },
  };
}
