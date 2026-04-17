import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomeMovieTitleSearch from "@/components/HomeMovieTitleSearch";

describe("HomeMovieTitleSearch", () => {
  beforeEach(() => {
    HTMLFormElement.prototype.requestSubmit = vi.fn();
  });

  it("reflects the current title query and preserves top-voted sorting on submit", () => {
    const { container } = render(
      <HomeMovieTitleSearch sort="votes" titleQuery="alien" />
    );

    expect(screen.getByRole("searchbox", { name: "Search movie titles" })).toHaveValue(
      "alien"
    );
    expect(container.querySelector('form[method="get"]')).toHaveAttribute(
      "action",
      "/"
    );
    expect(
      container.querySelector('input[type="hidden"][name="sort"]')
    ).toHaveAttribute("value", "votes");
  });

  it("omits the hidden sort field for the default newest sort", () => {
    const { container } = render(
      <HomeMovieTitleSearch sort="date" titleQuery="alien" />
    );

    expect(
      container.querySelector('input[type="hidden"][name="sort"]')
    ).toBeNull();
  });

  it("auto-submits when an active search is cleared from the input", () => {
    render(<HomeMovieTitleSearch sort="votes" titleQuery="alien" />);

    fireEvent.input(screen.getByRole("searchbox", { name: "Search movie titles" }), {
      target: { value: "" },
    });

    expect(HTMLFormElement.prototype.requestSubmit).toHaveBeenCalledTimes(1);
  });
});
