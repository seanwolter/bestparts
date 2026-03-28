"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getThumbnailUrl } from "@/lib/youtube";
import VideoModal from "./VideoModal";
import EditModal from "./EditModal";

interface VideoCardProps {
  id: number;
  youtubeId: string;
  movieTitle: string;
  sceneTitle: string;
  description: string | null;
  submittedAt: Date;
}

export default function VideoCard({
  id,
  youtubeId,
  movieTitle,
  sceneTitle,
  description,
  submittedAt,
}: VideoCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const formattedDate = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(submittedAt));

  async function handleDelete() {
    if (!confirm("Delete this scene?")) return;
    setDeleting(true);
    await fetch(`/api/videos/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <>
      <article className="bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 hover:border-neutral-600 transition-colors group flex flex-col">
        <div className="relative aspect-video bg-neutral-800 shrink-0">
          <button
            onClick={() => setOpen(true)}
            className="absolute inset-0 w-full h-full flex items-center justify-center group/btn"
            aria-label="Play video"
          >
            <Image
              src={getThumbnailUrl(youtubeId)}
              alt={`${movieTitle} — ${sceneTitle}`}
              fill
              className="object-cover"
            />
            <span className="relative z-10 bg-black/60 group-hover/btn:bg-yellow-400 transition-colors rounded-full w-14 h-14 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-white group-hover/btn:text-neutral-950 ml-1">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        </div>

        <div className="p-4 flex flex-col flex-1">
          <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wider mb-1">
            {movieTitle}
          </p>
          <h2 className="font-bold text-white text-lg leading-snug mb-2">
            {sceneTitle}
          </h2>
          {description && (
            <p className="text-neutral-400 text-sm leading-relaxed line-clamp-2">
              {description}
            </p>
          )}
          <div className="flex items-center justify-between mt-auto pt-3">
            <p className="text-neutral-600 text-xs">{formattedDate}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(true)}
                className="text-neutral-600 hover:text-neutral-300 text-xs transition-colors"
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-neutral-600 hover:text-red-400 text-xs transition-colors disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      </article>

      {open && (
        <VideoModal
          youtubeId={youtubeId}
          movieTitle={movieTitle}
          sceneTitle={sceneTitle}
          onClose={() => setOpen(false)}
        />
      )}

      {editing && (
        <EditModal
          id={id}
          movieTitle={movieTitle}
          sceneTitle={sceneTitle}
          description={description}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}
