import { SetupTokenReason } from "@prisma/client";
import IssueSetupTokenButton from "./IssueSetupTokenButton";

export interface AdminUserListItem {
  id: string;
  username: string;
  role: "ADMIN";
  status: "PENDING_SETUP" | "ACTIVE";
  createdAt: Date;
  passkeyCount: number;
  latestSetupToken: {
    reason: SetupTokenReason;
    createdAt: Date;
    expiresAt: Date;
    usedAt: Date | null;
    revokedAt: Date | null;
  } | null;
  submissions: {
    id: number;
    movieTitle: string;
    sceneTitle: string;
    submittedAt: Date;
  }[];
}

function describeLatestTokenState(user: AdminUserListItem): string {
  const latestToken = user.latestSetupToken;

  if (!latestToken) {
    return "No setup link issued yet.";
  }

  if (latestToken.usedAt) {
    return `Used ${latestToken.usedAt.toLocaleString()}`;
  }

  if (latestToken.revokedAt) {
    return `Revoked ${latestToken.revokedAt.toLocaleString()}`;
  }

  if (latestToken.expiresAt.getTime() <= Date.now()) {
    return `Expired ${latestToken.expiresAt.toLocaleString()}`;
  }

  return `Active until ${latestToken.expiresAt.toLocaleString()}`;
}

export default function UserList({
  users,
  currentUserId,
}: {
  users: AdminUserListItem[];
  currentUserId: string;
}) {
  return (
    <section className="space-y-4">
      {users.map((user) => {
        const hasPasskeys = user.passkeyCount > 0;
        const canRecoverUser = user.id !== currentUserId;

        return (
          <article
            key={user.id}
            className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-yellow-400">
                    {user.role}
                  </p>
                  <h2 className="mt-2 text-xl font-black text-white">{user.username}</h2>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-neutral-700 px-3 py-1 text-neutral-200">
                    {user.status}
                  </span>
                  <span className="rounded-full border border-neutral-700 px-3 py-1 text-neutral-400">
                    {user.passkeyCount} passkey{user.passkeyCount === 1 ? "" : "s"}
                  </span>
                  <span className="rounded-full border border-neutral-700 px-3 py-1 text-neutral-400">
                    Created {user.createdAt.toLocaleDateString()}
                  </span>
                </div>

                <div className="rounded-xl border border-neutral-800 bg-black/20 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
                    Latest setup link
                  </p>
                  {user.latestSetupToken ? (
                    <>
                      <p className="mt-2 text-sm text-neutral-200">
                        {user.latestSetupToken.reason}
                      </p>
                      <p className="mt-1 text-xs text-neutral-400">
                        Issued {user.latestSetupToken.createdAt.toLocaleString()}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {describeLatestTokenState(user)}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-neutral-500">
                      No setup link issued yet.
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-neutral-800 bg-black/20 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
                    Submissions ({user.submissions.length})
                  </p>
                  {user.submissions.length === 0 ? (
                    <p className="mt-2 text-sm text-neutral-500">No submissions yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {user.submissions.map((video) => (
                        <li key={video.id} className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="truncate text-sm text-neutral-200">
                              {video.sceneTitle}
                            </p>
                            <p className="text-xs text-neutral-500">{video.movieTitle}</p>
                          </div>
                          <p className="shrink-0 text-xs text-neutral-600">
                            {new Date(video.submittedAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              timeZone: "UTC",
                            })}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:w-[28rem]">
                {!hasPasskeys && (
                  <IssueSetupTokenButton
                    userId={user.id}
                    username={user.username}
                    reason="INITIAL_ENROLLMENT"
                    label="Issue setup link"
                  />
                )}
                {hasPasskeys && (
                  <IssueSetupTokenButton
                    userId={user.id}
                    username={user.username}
                    reason="ADD_PASSKEY"
                    label="Add passkey"
                  />
                )}
                {canRecoverUser && (
                  <IssueSetupTokenButton
                    userId={user.id}
                    username={user.username}
                    reason="RECOVERY"
                    label="Recovery"
                  />
                )}
                {!hasPasskeys && (
                  <p className="self-center text-xs text-neutral-500 sm:col-span-2">
                    Add-passkey links become available after the user has completed initial enrollment.
                  </p>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
