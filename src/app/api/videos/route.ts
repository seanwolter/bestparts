import { NextRequest, NextResponse } from "next/server";
import {
  assertSameOriginMutationRequest,
  jsonForbidden,
  MutationOriginError,
} from "@/app/api/_shared";
import { db } from "@/lib/db";
import { requireApiSession } from "@/lib/auth/route-auth";
import { extractYouTubeId } from "@/lib/youtube";

export async function GET(req: NextRequest) {
  const currentUser = await requireApiSession(req);

  if (currentUser instanceof NextResponse) {
    return currentUser;
  }

  const videos = await db.video.findMany({
    orderBy: { submittedAt: "desc" },
  });
  return NextResponse.json(videos);
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutationRequest(req);
  } catch (error) {
    if (error instanceof MutationOriginError) {
      return jsonForbidden();
    }

    throw error;
  }

  const currentUser = await requireApiSession(req);

  if (currentUser instanceof NextResponse) {
    return currentUser;
  }

  const body = await req.json();
  const { youtubeUrl, movieTitle, sceneTitle, description } = body;

  if (!youtubeUrl || !movieTitle || !sceneTitle) {
    return NextResponse.json(
      { error: "YouTube URL, movie title, and scene title are required." },
      { status: 400 }
    );
  }

  const youtubeId = extractYouTubeId(String(youtubeUrl));
  if (!youtubeId) {
    return NextResponse.json(
      { error: "Could not extract a valid YouTube video ID from the URL. Please use a standard YouTube link." },
      { status: 400 }
    );
  }

  const video = await db.video.create({
    data: {
      youtubeId,
      movieTitle: String(movieTitle).trim(),
      sceneTitle: String(sceneTitle).trim(),
      description: description ? String(description).trim() : null,
      submittedByUserId: currentUser.id,
    },
  });

  return NextResponse.json(video, { status: 201 });
}
