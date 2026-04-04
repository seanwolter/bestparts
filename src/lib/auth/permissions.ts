export interface PermissionSubject {
  role: "ADMIN";
  status?: "PENDING_SETUP" | "ACTIVE";
}

export class AuthorizationError extends Error {
  readonly status = 403;

  constructor(message = "Forbidden") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function isAdminRole(role: PermissionSubject["role"] | null | undefined): boolean {
  return role === "ADMIN";
}

export function isActiveUserStatus(
  status: PermissionSubject["status"] | null | undefined
): boolean {
  return status === "ACTIVE";
}

export function canManageVideos(
  subject: PermissionSubject | null | undefined
): boolean {
  return Boolean(subject && isAdminRole(subject.role) && isActiveUserStatus(subject.status));
}

export function canManageUsers(
  subject: PermissionSubject | null | undefined
): boolean {
  return Boolean(subject && isAdminRole(subject.role) && isActiveUserStatus(subject.status));
}

export function assertAdmin<T extends PermissionSubject>(
  subject: T | null | undefined,
  message = "Admin access is required."
): T {
  if (!subject || !isAdminRole(subject.role)) {
    throw new AuthorizationError(message);
  }

  return subject;
}

export function assertActiveUser<T extends PermissionSubject>(
  subject: T | null | undefined,
  message = "An active user account is required."
): T {
  if (!subject || !isActiveUserStatus(subject.status)) {
    throw new AuthorizationError(message);
  }

  return subject;
}
