"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import MovieTitleInput from "@/components/MovieTitleInput";

export default function SubmitSceneForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    youtubeUrl: "",
    movieTitle: "",
    sceneTitle: "",
    description: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label
          htmlFor="youtubeUrl"
          className="block text-sm font-medium text-neutral-300 mb-1.5"
        >
          YouTube URL <span className="text-red-400">*</span>
        </label>
        <input
          id="youtubeUrl"
          name="youtubeUrl"
          type="url"
          required
          placeholder="https://www.youtube.com/watch?v=..."
          value={form.youtubeUrl}
          onChange={handleChange}
          className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 text-white placeholder-neutral-600 focus:outline-none focus:border-yellow-400 transition-colors"
        />
      </div>

      <div>
        <label
          htmlFor="movieTitle"
          className="block text-sm font-medium text-neutral-300 mb-1.5"
        >
          Movie title <span className="text-red-400">*</span>
        </label>
        <MovieTitleInput
          value={form.movieTitle}
          onChange={(val) => setForm((prev) => ({ ...prev, movieTitle: val }))}
          required
        />
      </div>

      <div>
        <label
          htmlFor="sceneTitle"
          className="block text-sm font-medium text-neutral-300 mb-1.5"
        >
          Scene title <span className="text-red-400">*</span>
        </label>
        <input
          id="sceneTitle"
          name="sceneTitle"
          type="text"
          required
          placeholder="e.g. The baptism montage"
          value={form.sceneTitle}
          onChange={handleChange}
          className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 text-white placeholder-neutral-600 focus:outline-none focus:border-yellow-400 transition-colors"
        />
      </div>

      <div>
        <label
          htmlFor="description"
          className="block text-sm font-medium text-neutral-300 mb-1.5"
        >
          Why is this scene memorable?{" "}
          <span className="text-neutral-600">(optional)</span>
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          placeholder="A brief description of why this scene stands out..."
          value={form.description}
          onChange={handleChange}
          className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 text-white placeholder-neutral-600 focus:outline-none focus:border-yellow-400 transition-colors resize-none"
        />
      </div>

      {error && (
        <div className="bg-red-950 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed text-neutral-950 font-semibold px-6 py-2.5 rounded-lg transition-colors"
        >
          {submitting ? "Submitting..." : "Submit scene"}
        </button>
        <Link
          href="/"
          className="text-neutral-500 hover:text-neutral-300 text-sm transition-colors"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
