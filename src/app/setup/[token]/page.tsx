import SetupPasskeyForm from "@/components/SetupPasskeyForm";

export const dynamic = "force-dynamic";

export default async function SetupPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1fr_0.95fr] lg:items-start">
      <section className="space-y-5">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-yellow-400">
          Invite-only setup
        </p>
        <h1 className="max-w-xl text-4xl font-black tracking-tight text-white sm:text-5xl">
          Complete passkey setup.
        </h1>
        <p className="max-w-lg text-lg leading-8 text-neutral-400">
          This one-time link can be used for first-time setup, adding another
          passkey, or account recovery. Once registration succeeds, the link
          expires and future sign-in happens from the normal login page.
        </p>
      </section>

      <section className="rounded-3xl border border-neutral-800 bg-neutral-950/80 p-6 shadow-2xl shadow-black/20">
        <SetupPasskeyForm token={token} />
      </section>
    </div>
  );
}
