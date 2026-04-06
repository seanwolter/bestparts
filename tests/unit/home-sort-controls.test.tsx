import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomeSortControls from "@/components/HomeSortControls";

describe("HomeSortControls", () => {
  it("renders vote sorting as the default active state", () => {
    render(<HomeSortControls sort="votes" />);

    expect(screen.getByRole("link", { name: "Top voted" })).toHaveAttribute(
      "href",
      "/"
    );
    expect(screen.getByRole("link", { name: "Top voted" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Newest" })).toHaveAttribute(
      "href",
      "/?sort=date"
    );
    expect(screen.getByRole("link", { name: "Newest" })).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("marks the newest link active when date sorting is selected", () => {
    render(<HomeSortControls sort="date" />);

    expect(screen.getByRole("link", { name: "Newest" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Top voted" })).not.toHaveAttribute(
      "aria-current"
    );
  });
});
