"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { HomeSort } from "@/lib/videos/list-home-videos";

const LIVE_SEARCH_DEBOUNCE_MS = 150;

export default function HomeMovieTitleSearch({
  sort,
  titleQuery,
}: {
  sort: HomeSort;
  titleQuery?: string;
}) {
  const router = useRouter();
  const searchTimeoutIdRef = useRef<number | null>(null);
  const [value, setValue] = useState(titleQuery ?? "");

  useEffect(() => {
    return () => {
      if (searchTimeoutIdRef.current !== null) {
        window.clearTimeout(searchTimeoutIdRef.current);
      }
    };
  }, []);

  function handleChange(nextValue: string) {
    setValue(nextValue);

    if (searchTimeoutIdRef.current !== null) {
      window.clearTimeout(searchTimeoutIdRef.current);
    }

    const normalizedValue = nextValue.trim();

    if (normalizedValue === (titleQuery ?? "")) {
      return;
    }

    searchTimeoutIdRef.current = window.setTimeout(() => {
      startTransition(() => {
        router.replace(buildSearchHref(sort, normalizedValue), {
          scroll: false,
        });
      });
      searchTimeoutIdRef.current = null;
    }, LIVE_SEARCH_DEBOUNCE_MS);
  }

  return (
    <div className="mb-6 pt-1">
      <div className="w-full max-w-lg">
        <label htmlFor="movie-title-search" className="sr-only">
          Search movie titles
        </label>
        <input
          id="movie-title-search"
          name="title"
          type="search"
          value={value}
          placeholder="Movie title"
          onChange={(event) => handleChange(event.currentTarget.value)}
          className="h-11 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 pt-2 pb-3 text-white placeholder-neutral-500 focus:border-yellow-400 focus:outline-none transition-colors"
        />
      </div>
    </div>
  );
}

function buildSearchHref(sort: HomeSort, titleQuery: string): string {
  const params = new URLSearchParams();

  if (titleQuery) {
    params.set("title", titleQuery);
  }

  if (sort === "votes") {
    params.set("sort", "votes");
  }

  const query = params.toString();

  return query ? `/?${query}` : "/";
}
