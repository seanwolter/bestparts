import Link from "next/link";

export type HomeSort = "votes" | "date";

export default function HomeSortControls({ sort }: { sort: HomeSort }) {
  return (
    <nav
      aria-label="Sort videos"
      className="mb-6 flex items-center gap-2 text-sm"
    >
      <SortLink href="/" label="Top voted" active={sort === "votes"} />
      <SortLink href="/?sort=date" label="Newest" active={sort === "date"} />
    </nav>
  );
}

function SortLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "rounded-full border border-yellow-300 bg-yellow-400 px-3 py-1.5 font-semibold text-neutral-950"
          : "rounded-full border border-neutral-700 px-3 py-1.5 font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
      }
    >
      {label}
    </Link>
  );
}
