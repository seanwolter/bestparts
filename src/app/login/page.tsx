import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

function normalizeNextPath(nextPath: string | undefined): string {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/";
  }

  return nextPath;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const nextPath = normalizeNextPath(resolvedSearchParams.next);

  return (
    <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
      <section className="space-y-5">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-yellow-400">
          Internal access
        </p>
        <h1 className="max-w-xl text-4xl font-black tracking-tight text-white sm:text-5xl">
          Sign in with your username and passkey.
        </h1>
        <p className="max-w-lg text-lg leading-8 text-neutral-400">
          bestparts keeps admin access intentionally small. Start with your
          username, then finish with the passkey already registered to your
          account.
        </p>
      </section>

      <section className="rounded-3xl border border-neutral-800 bg-neutral-950/80 p-6 shadow-2xl shadow-black/20">
        <LoginForm nextPath={nextPath} />
        <p className="mt-5 text-sm leading-6 text-neutral-500">
          Unknown usernames and failed passkey checks return the same generic
          error by design.
        </p>
      </section>
    </div>
  );
}
