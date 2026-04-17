import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomeMovieTitleSearch from "@/components/HomeMovieTitleSearch";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mocks.replace,
  }),
}));

describe("HomeMovieTitleSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reflects the current title query", () => {
    render(<HomeMovieTitleSearch sort="votes" titleQuery="alien" />);

    expect(
      screen.getByRole("searchbox", { name: "Search movie titles" })
    ).toHaveValue("alien");
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
  });

  it("replaces the URL as text is entered while preserving top-voted sorting", () => {
    render(<HomeMovieTitleSearch sort="votes" titleQuery="alien" />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search movie titles" }), {
      target: { value: "aliens" },
    });
    vi.advanceTimersByTime(150);

    expect(mocks.replace).toHaveBeenCalledWith("/?title=aliens&sort=votes", {
      scroll: false,
    });
  });

  it("clears only the title filter while preserving the active sort", () => {
    render(<HomeMovieTitleSearch sort="votes" titleQuery="alien" />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search movie titles" }), {
      target: { value: "" },
    });
    vi.advanceTimersByTime(150);

    expect(mocks.replace).toHaveBeenCalledWith("/?sort=votes", {
      scroll: false,
    });
  });
});
