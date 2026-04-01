import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query");
  if (!query || query.trim().length < 2) {
    return NextResponse.json([]);
  }

  const res = await fetch(
    `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_TOKEN}`,
        accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    return NextResponse.json([], { status: 200 });
  }

  const data = await res.json();
  const results = (data.results ?? []).slice(0, 8).map((movie: { title: string; release_date?: string }) => {
    const year = movie.release_date ? movie.release_date.slice(0, 4) : null;
    return year ? `${movie.title} (${year})` : movie.title;
  });

  return NextResponse.json(results);
}
