import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageUsers } from "@/lib/auth/permissions";
import CreateUserForm from "@/components/CreateUserForm";
import UserList, { type AdminUserListItem } from "@/components/UserList";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect("/login?next=/admin/users");
  }

  if (!canManageUsers(currentUser)) {
    redirect("/");
  }

  const users = await db.user.findMany({
    orderBy: [
      { status: "asc" },
      { createdAt: "asc" },
    ],
    include: {
      _count: {
        select: {
          passkeys: true,
        },
      },
      setupTokens: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
        select: {
          reason: true,
          createdAt: true,
          expiresAt: true,
          usedAt: true,
          revokedAt: true,
        },
      },
    },
  });

  const mappedUsers: AdminUserListItem[] = users.map((user) => ({
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    passkeyCount: user._count.passkeys,
    latestSetupToken: user.setupTokens[0] ?? null,
  }));

  return (
    <div className="space-y-8">
      <section className="max-w-3xl space-y-4">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-yellow-400">
          Admin users
        </p>
        <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
          Manage setup links, passkey additions, and recovery.
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-neutral-400">
          This screen keeps setup entirely out-of-band. Create a username-only admin,
          issue the right enrollment flow, and copy the resulting one-time URL without
          any email workflow.
        </p>
      </section>

      <CreateUserForm />
      <UserList users={mappedUsers} currentUserId={currentUser.id} />
    </div>
  );
}
