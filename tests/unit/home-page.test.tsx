import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAnonymousVoterCookie,
  hashAnonymousVoterId,
} from "@/lib/votes/voter-cookie";
import { UPVOTE_COOLDOWN_MS } from "@/lib/votes/persist";

const NEWEST_ORDER_BY = [
  { submittedAt: "desc" },
  { upvoteCount: "desc" },
  { id: "desc" },
] as const;

const TOP_VOTED_ORDER_BY = [
  { upvoteCount: "desc" },
  { submittedAt: "desc" },
  { id: "desc" },
] as const;

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
  default: ({
    canSubmit,
    titleQuery,
    clearSearchHref,
  }: {
    canSubmit: boolean;
    titleQuery?: string;
    clearSearchHref?: string;
  }) => (
    <div>
      {titleQuery
        ? `no results for ${titleQuery}|${clearSearchHref}`
        : canSubmit
          ? "can submit"
          : "guest empty state"}
    </div>
  ),
}));

vi.mock("@/components/HomeSortControls", () => ({
  default: ({ sort }: { sort: "votes" | "date" }) => (
    <div data-testid="home-sort-controls">{sort}</div>
  ),
}));

vi.mock("@/components/HomeMovieTitleSearch", () => ({
  default: () => <div data-testid="home-movie-title-search" />,
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T21:00:00.000Z"));
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.cookies.mockResolvedValue(createCookieStore());
    mocks.findVideoUpvotes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
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
      orderBy: NEWEST_ORDER_BY,
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
      orderBy: NEWEST_ORDER_BY,
    });
    expect(
      screen.getAllByTestId("video-card").map((card) => card.textContent)
    ).toEqual(["Newest scene", "Older scene"]);
    expect(screen.getByTestId("home-sort-controls")).toHaveTextContent("date");
  });

  it("filters videos by movie title using a case-insensitive free-text query", async () => {
    mocks.findVideos.mockResolvedValue([
      createVideo({
        id: 5,
        movieTitle: "Alien",
        sceneTitle: "Chestburster",
        submittedAt: createRelativeDate(-60_000),
      }),
      createVideo({
        id: 6,
        movieTitle: "Aliens",
        sceneTitle: "Power loader",
        submittedAt: createRelativeDate(-30_000),
      }),
    ]);

    render(
      await Home({
        searchParams: Promise.resolve({ title: "alien" }),
      })
    );

    expect(mocks.findVideos).toHaveBeenCalledWith({
      where: {
        movieTitle: {
          contains: "alien",
          mode: "insensitive",
        },
      },
      orderBy: NEWEST_ORDER_BY,
    });
    expect(
      screen.getAllByTestId("video-card").map((card) => card.textContent)
    ).toEqual(["Chestburster", "Power loader"]);
    expect(screen.getByTestId("home-sort-controls")).toHaveTextContent("date");
  });

  it("ignores a whitespace-only movie title query", async () => {
    mocks.findVideos.mockResolvedValue([
      createVideo({
        id: 7,
        sceneTitle: "Whitespace search scene",
        submittedAt: createRelativeDate(-45_000),
      }),
    ]);

    render(
      await Home({
        searchParams: Promise.resolve({ title: "   " }),
      })
    );

    expect(mocks.findVideos).toHaveBeenCalledWith({
      orderBy: NEWEST_ORDER_BY,
    });
  });

  it("applies the movie title query alongside top-voted sorting", async () => {
    mocks.findVideos.mockResolvedValue([
      createVideo({
        id: 8,
        movieTitle: "Alien",
        sceneTitle: "Space jockey",
        upvoteCount: 8,
        submittedAt: createRelativeDate(-120_000),
      }),
      createVideo({
        id: 9,
        movieTitle: "Aliens",
        sceneTitle: "Nuke the site from orbit",
        upvoteCount: 4,
        submittedAt: createRelativeDate(-90_000),
      }),
    ]);

    render(
      await Home({
        searchParams: Promise.resolve({ sort: "votes", title: "ali" }),
      })
    );

    expect(mocks.findVideos).toHaveBeenCalledWith({
      where: {
        movieTitle: {
          contains: "ali",
          mode: "insensitive",
        },
      },
      orderBy: TOP_VOTED_ORDER_BY,
    });
    expect(screen.getByTestId("home-sort-controls")).toHaveTextContent("votes");
  });

  it("keeps cooldown lookup scoped to the filtered search results", async () => {
    const voterId = "3b32a5ef-9059-4acc-bd6e-a8f2e37295ee";
    const issuedCookie = buildAnonymousVoterCookie({
      version: 1,
      voterId,
    });
    const latestVoteAt = new Date(Date.now() - 60_000);
    const expiredVoteAt = new Date(Date.now() - (UPVOTE_COOLDOWN_MS + 60_000));

    mocks.cookies.mockResolvedValue(
      createCookieStore({
        bestparts_voter: issuedCookie.value,
      })
    );
    mocks.findVideos.mockResolvedValue([
      createVideo({
        id: 11,
        movieTitle: "Heat",
        sceneTitle: "Cooling down",
        upvoteCount: 4,
      }),
    ]);
    mocks.findVideoUpvotes.mockResolvedValue([
      {
        videoId: 11,
        createdAt: latestVoteAt,
      },
    ]);

    render(
      await Home({
        searchParams: Promise.resolve({ title: "heat" }),
      })
    );

    expect(mocks.findVideos).toHaveBeenCalledWith({
      where: {
        movieTitle: {
          contains: "heat",
          mode: "insensitive",
        },
      },
      orderBy: NEWEST_ORDER_BY,
    });
    expect(mocks.findVideoUpvotes).toHaveBeenCalledTimes(1);
    expect(mocks.findVideoUpvotes).toHaveBeenCalledWith({
      where: {
        videoId: {
          in: [11],
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
    ]);
  });

  it("shows a search-specific empty state when no movie titles match", async () => {
    mocks.findVideos.mockResolvedValue([]);

    render(
      await Home({
        searchParams: Promise.resolve({ sort: "votes", title: "alien" }),
      })
    );

    expect(screen.getByText("no results for alien|/?sort=votes")).toBeInTheDocument();
    expect(mocks.findVideoUpvotes).not.toHaveBeenCalled();
  });

  it("keeps the default empty state when there is no active title query", async () => {
    mocks.findVideos.mockResolvedValue([]);

    render(
      await Home({
        searchParams: Promise.resolve({}),
      })
    );

    expect(screen.getByText("guest empty state")).toBeInTheDocument();
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

function createRelativeDate(offsetMs: number) {
  return new Date(Date.now() + offsetMs);
}

function createCookieStore(values: Record<string, string> = {}) {
  return {
    get(name: string) {
      const value = values[name];
      return value ? { value } : undefined;
    },
  };
}
