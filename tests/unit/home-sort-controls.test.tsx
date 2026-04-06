import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomeSortControls from "@/components/HomeSortControls";

describe("HomeSortControls", () => {
  it("renders date sorting as the default active state", () => {
    render(<HomeSortControls sort="date" />);

    expect(screen.getByRole("link", { name: "Newest" })).toHaveAttribute(
      "href",
      "/"
    );
    expect(screen.getByRole("link", { name: "Newest" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Top voted" })).toHaveAttribute(
      "href",
      "/?sort=votes"
    );
    expect(screen.getByRole("link", { name: "Top voted" })).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("marks the top-voted link active when vote sorting is selected", () => {
    render(<HomeSortControls sort="votes" />);

    expect(screen.getByRole("link", { name: "Top voted" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Newest" })).not.toHaveAttribute(
      "aria-current"
    );
  });
});
