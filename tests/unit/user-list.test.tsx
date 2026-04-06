import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SetupTokenReason } from "@prisma/client";
import UserList, { type AdminUserListItem } from "@/components/UserList";

vi.mock("@/components/IssueSetupTokenButton", () => ({
  default: ({
    label,
    reason,
  }: {
    label: string;
    reason: string;
  }) => <button type="button">{`${label}:${reason}`}</button>,
}));

function createUser(overrides: Partial<AdminUserListItem> = {}): AdminUserListItem {
  return {
    id: "user_123",
    username: "mark",
    role: "ADMIN",
    status: "PENDING_SETUP",
    createdAt: new Date("2026-04-04T20:00:00.000Z"),
    passkeyCount: 0,
    latestSetupToken: {
      reason: SetupTokenReason.INITIAL_ENROLLMENT,
      createdAt: new Date("2026-04-04T20:00:00.000Z"),
      expiresAt: new Date("2026-04-05T20:00:00.000Z"),
      usedAt: null,
      revokedAt: null,
    },
    submissions: [],
    ...overrides,
  };
}

describe("UserList", () => {
  it("shows initial enrollment and recovery actions for users without passkeys", () => {
    render(<UserList users={[createUser()]} currentUserId="different-user" />);

    expect(
      screen.getByRole("button", { name: "Issue setup link:INITIAL_ENROLLMENT" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add passkey:ADD_PASSKEY" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recovery:RECOVERY" })).toBeInTheDocument();
  });

  it("shows add-passkey and recovery actions once a user already has a passkey", () => {
    render(
      <UserList
        users={[
          createUser({
            passkeyCount: 1,
            status: "ACTIVE",
            latestSetupToken: {
              reason: SetupTokenReason.ADD_PASSKEY,
              createdAt: new Date("2026-04-04T20:00:00.000Z"),
              expiresAt: new Date("2026-04-05T20:00:00.000Z"),
              usedAt: null,
              revokedAt: null,
            },
          }),
        ]}
        currentUserId="different-user"
      />
    );

    expect(
      screen.queryByRole("button", { name: "Issue setup link:INITIAL_ENROLLMENT" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add passkey:ADD_PASSKEY" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recovery:RECOVERY" })).toBeInTheDocument();
  });

  it("hides the recovery action for the currently logged in user", () => {
    render(<UserList users={[createUser()]} currentUserId="user_123" />);

    expect(
      screen.getByRole("button", { name: "Issue setup link:INITIAL_ENROLLMENT" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recovery:RECOVERY" })).not.toBeInTheDocument();
  });
});
