import { describe, expect, it } from "vitest";
import {
  assertActiveUser,
  assertAdmin,
  AuthorizationError,
  canManageUsers,
  canManageVideos,
} from "@/lib/auth/permissions";

describe("permission helpers", () => {
  const activeAdmin = {
    role: "ADMIN" as const,
    status: "ACTIVE" as const,
  };

  const pendingAdmin = {
    role: "ADMIN" as const,
    status: "PENDING_SETUP" as const,
  };

  it("allows management actions only for active admins", () => {
    expect(canManageVideos(activeAdmin)).toBe(true);
    expect(canManageUsers(activeAdmin)).toBe(true);
    expect(canManageVideos(pendingAdmin)).toBe(false);
    expect(canManageUsers(pendingAdmin)).toBe(false);
    expect(canManageVideos(null)).toBe(false);
    expect(canManageUsers(undefined)).toBe(false);
  });

  it("assertAdmin accepts admin subjects and rejects missing subjects", () => {
    expect(assertAdmin(activeAdmin)).toBe(activeAdmin);
    expect(assertAdmin(pendingAdmin)).toBe(pendingAdmin);
    expect(() => assertAdmin(null)).toThrowError(AuthorizationError);
    expect(() => assertAdmin(undefined)).toThrowError("Admin access is required.");
  });

  it("assertActiveUser accepts active admins and rejects pending or missing subjects", () => {
    expect(assertActiveUser(activeAdmin)).toBe(activeAdmin);
    expect(() => assertActiveUser(pendingAdmin)).toThrowError(AuthorizationError);
    expect(() => assertActiveUser(pendingAdmin)).toThrowError(
      "An active user account is required."
    );
    expect(() => assertActiveUser(undefined)).toThrowError(
      "An active user account is required."
    );
  });
});
