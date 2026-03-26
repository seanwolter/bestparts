import { db } from "@/lib/db";
import VideoCard from "@/components/VideoCard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const videos = await db.video.findMany({
    orderBy: { submittedAt: "desc" },
  });

  return (
    <div>
      <div className="mb-10">
        <h1 className="text-3xl font-black text-white mb-2">
          The best parts of movies
        </h1>
      </div>

      {videos.length === 0 ? (
        <div className="text-center py-24 text-neutral-600">
          <p className="text-xl font-semibold text-neutral-400 mb-2">
            No scenes yet
          </p>
          <p className="mb-6">Submit the best part of a movie.</p>
          <a
            href="/submit"
            className="bg-yellow-400 hover:bg-yellow-300 text-neutral-950 font-semibold px-6 py-3 rounded-lg transition-colors"
          >
            Submit the first scene
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {videos.map((video) => (
            <VideoCard key={video.id} {...video} />
          ))}
        </div>
      )}
    </div>
  );
}
