"use client";

import { useRef } from "react";
import Link from "next/link";
import type { HomeSort } from "@/lib/videos/list-home-videos";

export default function HomeMovieTitleSearch({
  sort,
  titleQuery,
}: {
  sort: HomeSort;
  titleQuery?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const clearSearchHref = buildClearSearchHref(sort);

  function handleInput(event: React.FormEvent<HTMLInputElement>) {
    if (titleQuery && event.currentTarget.value === "") {
      formRef.current?.requestSubmit();
    }
  }

  return (
    <div className="mb-6 flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
      <form
        ref={formRef}
        action="/"
        method="get"
        className="flex w-full max-w-lg items-stretch gap-3"
      >
        {sort === "votes" ? (
          <input type="hidden" name="sort" value="votes" />
        ) : null}
        <div className="flex-1">
          <label htmlFor="movie-title-search" className="sr-only">
            Search movie titles
          </label>
          <input
            id="movie-title-search"
            name="title"
            type="search"
            defaultValue={titleQuery ?? ""}
            placeholder="Movie title"
            onInput={handleInput}
            className="h-11 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 pt-2 pb-3 text-white placeholder-neutral-500 focus:border-yellow-400 focus:outline-none transition-colors"
          />
        </div>
        <button
          type="submit"
          className="h-11 shrink-0 rounded-lg bg-yellow-400 px-5 pt-2 pb-3 font-semibold text-neutral-950 transition-colors hover:bg-yellow-300"
        >
          Search
        </button>
      </form>
    </div>
  );
}

function buildClearSearchHref(sort: HomeSort): string {
  return sort === "votes" ? "/?sort=votes" : "/";
}
