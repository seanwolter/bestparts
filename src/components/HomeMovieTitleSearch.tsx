"use client";

import { startTransition, useEffect, useRef } from "react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutIdRef = useRef<number | null>(null);
  const normalizedTitleQuery = titleQuery ?? "";

  useEffect(() => {
    if (searchTimeoutIdRef.current !== null) {
      window.clearTimeout(searchTimeoutIdRef.current);
      searchTimeoutIdRef.current = null;
    }

    if (inputRef.current && inputRef.current.value !== normalizedTitleQuery) {
      inputRef.current.value = normalizedTitleQuery;
    }
  }, [normalizedTitleQuery]);

  useEffect(() => {
    return () => {
      if (searchTimeoutIdRef.current !== null) {
        window.clearTimeout(searchTimeoutIdRef.current);
      }
    };
  }, []);

  function handleChange(nextValue: string) {
    if (searchTimeoutIdRef.current !== null) {
      window.clearTimeout(searchTimeoutIdRef.current);
    }

    const normalizedValue = nextValue.trim();

    if (normalizedValue === normalizedTitleQuery) {
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
    <div className="min-w-0 w-full">
      <label htmlFor="movie-title-search" className="sr-only">
        Search movie titles
      </label>
      <input
        ref={inputRef}
        id="movie-title-search"
        name="title"
        type="search"
        defaultValue={normalizedTitleQuery}
        placeholder="Search Movies"
        onChange={(event) => handleChange(event.currentTarget.value)}
        className="h-11 min-w-0 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 pt-2 pb-3 text-white placeholder-neutral-500 transition-colors focus:border-yellow-400 focus:outline-none"
      />
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
