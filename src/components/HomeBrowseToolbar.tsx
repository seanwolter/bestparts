import HomeMovieTitleSearch from "@/components/HomeMovieTitleSearch";
import HomeSortControls from "@/components/HomeSortControls";
import type { HomeSort } from "@/lib/videos/list-home-videos";

export default function HomeBrowseToolbar({
  sort,
  titleQuery,
}: {
  sort: HomeSort;
  titleQuery?: string;
}) {
  return (
    <div
      data-testid="home-browse-toolbar"
      className="mb-6 flex items-center gap-3 sm:gap-4"
    >
      <div data-testid="home-browse-sort-slot" className="shrink-0">
        <HomeSortControls sort={sort} titleQuery={titleQuery} />
      </div>
      <div
        data-testid="home-browse-search-slot"
        className="min-w-0 flex-1"
      >
        <div
          data-testid="home-browse-search-shell"
          className="min-w-0 w-full max-w-lg sm:ml-auto"
        >
          <HomeMovieTitleSearch
            sort={sort}
            titleQuery={titleQuery}
          />
        </div>
      </div>
    </div>
  );
}
