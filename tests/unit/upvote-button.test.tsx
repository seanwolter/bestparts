import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UpvoteButton from "@/components/UpvoteButton";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.refresh,
  }),
}));

describe("UpvoteButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T21:00:00.000Z"));
    clearStoredCooldown(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearStoredCooldown(1);
  });

  it("renders the vote label and count", () => {
    render(
      <UpvoteButton
        videoId={1}
        upvoteCount={12}
        nextEligibleUpvoteAt={null}
      />
    );

    expect(
      screen.getByRole("button", { name: "Upvote video (12 votes)" })
    ).toHaveTextContent("👍✌️");
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("disables the button when the server says the browser is cooling down", () => {
    render(
      <UpvoteButton
        videoId={1}
        upvoteCount={12}
        nextEligibleUpvoteAt={new Date("2026-04-05T21:01:00.000Z")}
      />
    );

    expect(
      screen.getByRole("button", { name: "Upvote video (12 votes)" })
    ).toBeDisabled();
  });

  it("updates the count and refreshes after a successful upvote", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          upvoteCount: 13,
          nextEligibleUpvoteAt: "2026-04-06T00:00:00.000Z",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    render(
      <UpvoteButton
        videoId={1}
        upvoteCount={12}
        nextEligibleUpvoteAt={null}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upvote video (12 votes)" }));
      await settle();
    });

    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.getByText("13")).toBeInTheDocument();
    expect(readStoredCooldown(1)).toEqual({
      dailyCooldownAt: "2026-04-06T00:00:00.000Z",
      burstCooldownAt: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stores a short burst cooldown after a 429 and blocks immediate repeats", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Too many upvote attempts. Please try again later.",
          retryAfterMs: 30_000,
          scope: "browser",
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
          },
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    render(
      <UpvoteButton
        videoId={1}
        upvoteCount={12}
        nextEligibleUpvoteAt={null}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upvote video (12 votes)" }));
      await settle();
    });

    expect(
      screen.getByText("Too many upvote attempts. Please try again later.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upvote video (12 votes)" })).toBeDisabled();
    expect(readStoredCooldown(1)).toEqual({
      dailyCooldownAt: null,
      burstCooldownAt: "2026-04-05T21:00:30.000Z",
    });

    fireEvent.click(screen.getByRole("button", { name: "Upvote video (12 votes)" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stores the server cooldown after a 409 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "This browser can upvote this video again later.",
            retryAfterMs: 60_000,
            nextEligibleUpvoteAt: "2026-04-06T00:00:00.000Z",
          }),
          {
            status: 409,
            headers: {
              "content-type": "application/json",
            },
          }
        )
      )
    );

    render(
      <UpvoteButton
        videoId={1}
        upvoteCount={12}
        nextEligibleUpvoteAt={null}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upvote video (12 votes)" }));
      await settle();
    });

    expect(
      screen.getByText("This browser can upvote this video again later.")
    ).toBeInTheDocument();
    expect(readStoredCooldown(1)).toEqual({
      dailyCooldownAt: "2026-04-06T00:00:00.000Z",
      burstCooldownAt: null,
    });
    expect(screen.getByRole("button", { name: "Upvote video (12 votes)" })).toBeDisabled();
  });

  it("trusts the server-provided cooldown over stored daily local state on first render", async () => {
    window.localStorage.setItem(
      "bestparts:upvote-cooldown:1",
      JSON.stringify({
        dailyCooldownAt: "2026-04-07T00:00:00.000Z",
        burstCooldownAt: null,
      })
    );

    vi.stubGlobal(
      "fetch",
      vi.fn()
    );

    render(
      <UpvoteButton
        videoId={1}
        upvoteCount={12}
        nextEligibleUpvoteAt={new Date("2026-04-06T00:00:00.000Z")}
      />
    );

    await act(async () => {
      await settle();
    });

    expect(readStoredCooldown(1)).toEqual({
      dailyCooldownAt: "2026-04-06T00:00:00.000Z",
      burstCooldownAt: null,
    });
    expect(screen.getByRole("button", { name: "Upvote video (12 votes)" })).toBeDisabled();
  });
});

function readStoredCooldown(videoId: number) {
  const rawValue = window.localStorage.getItem(
    `bestparts:upvote-cooldown:${videoId}`
  );

  return rawValue ? JSON.parse(rawValue) : null;
}

function clearStoredCooldown(videoId: number) {
  window.localStorage.removeItem(`bestparts:upvote-cooldown:${videoId}`);
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}
