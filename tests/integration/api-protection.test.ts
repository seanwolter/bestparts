import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  PrismaClient,
  SetupTokenReason,
  UserRole,
  UserStatus,
} from "@prisma/client";
import { getTestDatabaseUrl } from "../setup/test-db";
import { hashSessionToken } from "@/lib/auth/session";
import { hashSetupToken } from "@/lib/auth/setup-token";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { GET as videosGet, POST as videosPost } from "@/app/api/videos/route";
import {
  PATCH as videoPatch,
  DELETE as videoDelete,
} from "@/app/api/videos/[id]/route";
import { GET as tmdbGet } from "@/app/api/tmdb/route";
import { POST as setupOptionsPost } from "@/app/api/auth/setup/options/route";

function createRequest(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookies?: Record<string, string>;
  } = {}
) {
  const headers = new Headers();

  if (options.body) {
    headers.set("content-type", "application/json");
  }

  if (options.cookies) {
    headers.set(
      "cookie",
      Object.entries(options.cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join("; ")
    );
  }

  return new NextRequest(`http://localhost${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

describe("api route protection", () => {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: getTestDatabaseUrl(),
      },
    },
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.authThrottleBucket.deleteMany();
    await prisma.consumedCeremonyNonce.deleteMany();
    await prisma.video.deleteMany();
    await prisma.userSetupToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.passkey.deleteMany();
    await prisma.user.deleteMany();
  });

  async function createAuthenticatedSession() {
    const user = await prisma.user.create({
      data: {
        username: "api-user",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    const sessionToken = "api-session-token";

    await prisma.session.create({
      data: {
        userId: user.id,
        sessionTokenHash: hashSessionToken(sessionToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    return { user, sessionToken };
  }

  it("rejects each non-auth API route without a session", async () => {
    const createdVideo = await prisma.video.create({
      data: {
        youtubeId: "abc123def45",
        movieTitle: "Alien",
        sceneTitle: "Chestburster",
      },
    });

    const [videosResponse, postResponse, patchResponse, deleteResponse, tmdbResponse] =
      await Promise.all([
        videosGet(createRequest("/api/videos")),
        videosPost(
          createRequest("/api/videos", {
            method: "POST",
            body: {
              youtubeUrl: "https://www.youtube.com/watch?v=abc123def45",
              movieTitle: "Alien",
              sceneTitle: "Final escape",
            },
          })
        ),
        videoPatch(
          createRequest(`/api/videos/${createdVideo.id}`, {
            method: "PATCH",
            body: {
              movieTitle: "Aliens",
              sceneTitle: "Power loader",
            },
          }),
          { params: Promise.resolve({ id: String(createdVideo.id) }) }
        ),
        videoDelete(createRequest(`/api/videos/${createdVideo.id}`, { method: "DELETE" }), {
          params: Promise.resolve({ id: String(createdVideo.id) }),
        }),
        tmdbGet(createRequest("/api/tmdb?query=alien")),
      ]);

    for (const response of [
      videosResponse,
      postResponse,
      patchResponse,
      deleteResponse,
      tmdbResponse,
    ]) {
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "Authentication required.",
      });
    }
  });

  it("allows authenticated video creation and stamps the submitting user", async () => {
    const { user, sessionToken } = await createAuthenticatedSession();

    const response = await videosPost(
      createRequest("/api/videos", {
        method: "POST",
        cookies: {
          [SESSION_COOKIE_NAME]: sessionToken,
        },
        body: {
          youtubeUrl: "https://www.youtube.com/watch?v=abc123def45",
          movieTitle: "Heat",
          sceneTitle: "Downtown shootout",
          description: "Chaos on the street.",
        },
      })
    );
    const payload = await response.json();
    const storedVideo = await prisma.video.findUnique({
      where: {
        id: payload.id,
      },
    });

    expect(response.status).toBe(201);
    expect(storedVideo?.submittedByUserId).toBe(user.id);
  });

  it("allows authenticated patch and delete requests for videos", async () => {
    const { sessionToken } = await createAuthenticatedSession();
    const video = await prisma.video.create({
      data: {
        youtubeId: "abc123def45",
        movieTitle: "The Matrix",
        sceneTitle: "Lobby shootout",
      },
    });

    const patchResponse = await videoPatch(
      createRequest(`/api/videos/${video.id}`, {
        method: "PATCH",
        cookies: {
          [SESSION_COOKIE_NAME]: sessionToken,
        },
        body: {
          movieTitle: "The Matrix",
          sceneTitle: "Red pill",
          description: "Wake up.",
        },
      }),
      { params: Promise.resolve({ id: String(video.id) }) }
    );

    expect(patchResponse.status).toBe(200);
    await expect(
      prisma.video.findUnique({ where: { id: video.id } })
    ).resolves.toMatchObject({
      sceneTitle: "Red pill",
      description: "Wake up.",
    });

    const deleteResponse = await videoDelete(
      createRequest(`/api/videos/${video.id}`, {
        method: "DELETE",
        cookies: {
          [SESSION_COOKIE_NAME]: sessionToken,
        },
      }),
      { params: Promise.resolve({ id: String(video.id) }) }
    );

    expect(deleteResponse.status).toBe(204);
    await expect(
      prisma.video.findUnique({ where: { id: video.id } })
    ).resolves.toBeNull();
  });

  it("allows authenticated tmdb lookups", async () => {
    const { sessionToken } = await createAuthenticatedSession();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              { title: "Alien", release_date: "1979-05-25" },
              { title: "Aliens", release_date: "1986-07-18" },
            ],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          }
        )
      )
    );

    const response = await tmdbGet(
      createRequest("/api/tmdb?query=alien", {
        cookies: {
          [SESSION_COOKIE_NAME]: sessionToken,
        },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      "Alien (1979)",
      "Aliens (1986)",
    ]);
  });

  it("keeps setup ceremony routes reachable without an existing session", async () => {
    const user = await prisma.user.create({
      data: {
        username: "setup-user",
        role: UserRole.ADMIN,
        status: UserStatus.PENDING_SETUP,
      },
    });
    await prisma.userSetupToken.create({
      data: {
        userId: user.id,
        tokenHash: hashSetupToken("setup-token"),
        reason: SetupTokenReason.INITIAL_ENROLLMENT,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const response = await setupOptionsPost(
      createRequest("/api/auth/setup/options", {
        method: "POST",
        body: {
          token: "setup-token",
        },
      })
    );

    expect(response.status).not.toBe(401);
  });
});
