import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/current-user";
import LogoutButton from "./LogoutButton";

export default function HeaderAuthActions({
  currentUser,
}: {
  currentUser: CurrentUser | null;
}) {
  if (!currentUser) {
    return (
      <Link
        href="/login"
        className="rounded-lg border border-neutral-700 px-3 py-2 text-sm font-medium text-neutral-200 transition-colors hover:border-neutral-500 hover:text-white"
      >
        Log in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-yellow-400">
          {currentUser.role}
        </p>
        <p className="text-sm text-neutral-300">{currentUser.username}</p>
      </div>
      <LogoutButton />
    </div>
  );
}
