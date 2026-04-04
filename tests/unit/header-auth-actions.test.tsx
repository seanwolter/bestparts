import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth/current-user";
import HeaderAuthActions from "@/components/HeaderAuthActions";

vi.mock("@/components/LogoutButton", () => ({
  default: () => <button type="button">Log out</button>,
}));

function createCurrentUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: "user_123",
    username: "mark",
    role: "ADMIN",
    status: "ACTIVE",
    sessionId: "session_123",
    sessionExpiresAt: new Date("2026-04-04T20:00:00.000Z"),
    sessionLastUsedAt: new Date("2026-04-04T19:30:00.000Z"),
    ...overrides,
  };
}

describe("HeaderAuthActions", () => {
  it("shows a login link for guests", () => {
    render(<HeaderAuthActions currentUser={null} />);

    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login"
    );
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
  });

  it("shows the username, role, and logout action for authenticated users", () => {
    render(<HeaderAuthActions currentUser={createCurrentUser()} />);

    expect(screen.getByText("mark")).toBeInTheDocument();
    expect(screen.getByText("ADMIN")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });
});
