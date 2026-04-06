import { randomUUID } from "node:crypto";
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
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { POST as setupOptionsPost } from "@/app/api/auth/setup/options/route";
import { POST as upvotePost } from "@/app/api/videos/[id]/upvote/route";
import { POST as issueSetupTokenPost } from "@/app/api/users/[id]/setup-token/route";
import { POST as createUserPost } from "@/app/api/users/route";
import {
  ANONYMOUS_VOTER_COOKIE_NAME,
  buildAnonymousVoterCookie,
} from "@/lib/votes/voter-cookie";
import { DEFAULT_UPVOTE_GLOBAL_LIMIT } from "@/lib/votes/rate-limit";

function createRequest(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  } = {}
) {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);

  if (options.body) {
    headers.set("content-type", "application/json");
  }

  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase()) &&
    !headers.has("origin")
  ) {
    headers.set("origin", "http://localhost");
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
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

function createUpvoteRequest(
  path: string,
  options: {
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  } = {}
) {
  return createRequest(path, {
    method: "POST",
    cookies: options.cookies,
    headers: {
      origin: "http://localhost",
      ...options.headers,
    },
  });
}

function createCrossSiteMutationRequest(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  } = {}
) {
  return createRequest(path, {
    method: options.method ?? "POST",
    body: options.body,
    cookies: options.cookies,
    headers: {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
      ...options.headers,
    },
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
    await prisma.videoUpvote.deleteMany();
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

  async function createPendingSession() {
    const user = await prisma.user.create({
      data: {
        username: "pending-api-user",
        role: UserRole.ADMIN,
        status: UserStatus.PENDING_SETUP,
      },
    });
    const sessionToken = "pending-api-session-token";

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

  it("keeps the public upvote route reachable without a session while other video mutations stay authenticated", async () => {
    const video = await prisma.video.create({
      data: {
        youtubeId: "def456ghi78",
        movieTitle: "Heat",
        sceneTitle: "Downtown shootout",
      },
    });

    const [upvoteResponse, createResponse, patchResponse, deleteResponse] =
      await Promise.all([
        upvotePost(createUpvoteRequest(`/api/videos/${video.id}/upvote`), {
          params: Promise.resolve({ id: String(video.id) }),
        }),
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
          createRequest(`/api/videos/${video.id}`, {
            method: "PATCH",
            body: {
              movieTitle: "Aliens",
              sceneTitle: "Power loader",
            },
          }),
          { params: Promise.resolve({ id: String(video.id) }) }
        ),
        videoDelete(createRequest(`/api/videos/${video.id}`, { method: "DELETE" }), {
          params: Promise.resolve({ id: String(video.id) }),
        }),
      ]);
    const updatedVideo = await prisma.video.findUnique({
      where: {
        id: video.id,
      },
    });

    expect(upvoteResponse.status).toBe(200);
    await expect(upvoteResponse.json()).resolves.toMatchObject({
      upvoteCount: 1,
    });
    expect(updatedVideo?.upvoteCount).toBe(1);

    for (const response of [createResponse, patchResponse, deleteResponse]) {
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

  it("rejects cross-site authenticated mutations before changing state", async () => {
    const { user: admin, sessionToken } = await createAuthenticatedSession();
    const targetUser = await prisma.user.create({
      data: {
        username: "cross-site-target",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    const video = await prisma.video.create({
      data: {
        youtubeId: "xyz987abc65",
        movieTitle: "The Matrix",
        sceneTitle: "Lobby shootout",
      },
    });
    const sessionCookie = {
      [SESSION_COOKIE_NAME]: sessionToken,
    };

    const createUserResponse = await createUserPost(
      createCrossSiteMutationRequest("/api/users", {
        cookies: sessionCookie,
        body: {
          username: "cross-site-created-user",
        },
      })
    );
    const issueSetupTokenResponse = await issueSetupTokenPost(
      createCrossSiteMutationRequest(`/api/users/${targetUser.id}/setup-token`, {
        cookies: sessionCookie,
        body: {
          reason: "INITIAL_ENROLLMENT",
        },
      }),
      { params: Promise.resolve({ id: targetUser.id }) }
    );
    const createVideoResponse = await videosPost(
      createCrossSiteMutationRequest("/api/videos", {
        cookies: sessionCookie,
        body: {
          youtubeUrl: "https://www.youtube.com/watch?v=abc123def45",
          movieTitle: "Alien",
          sceneTitle: "Final escape",
        },
      })
    );
    const patchResponse = await videoPatch(
      createCrossSiteMutationRequest(`/api/videos/${video.id}`, {
        method: "PATCH",
        cookies: sessionCookie,
        body: {
          movieTitle: "Aliens",
          sceneTitle: "Power loader",
          description: "Wake up.",
        },
      }),
      { params: Promise.resolve({ id: String(video.id) }) }
    );
    const deleteResponse = await videoDelete(
      createCrossSiteMutationRequest(`/api/videos/${video.id}`, {
        method: "DELETE",
        cookies: sessionCookie,
      }),
      { params: Promise.resolve({ id: String(video.id) }) }
    );
    const logoutResponse = await logoutPost(
      createCrossSiteMutationRequest("/api/auth/logout", {
        cookies: sessionCookie,
      })
    );

    for (const response of [
      createUserResponse,
      issueSetupTokenResponse,
      createVideoResponse,
      patchResponse,
      deleteResponse,
      logoutResponse,
    ]) {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "Forbidden.",
      });
    }

    await expect(
      prisma.user.findUnique({
        where: {
          username: "cross-site-created-user",
        },
      })
    ).resolves.toBeNull();
    await expect(
      prisma.user.findUnique({
        where: {
          id: targetUser.id,
        },
      })
    ).resolves.toMatchObject({
      status: UserStatus.ACTIVE,
    });
    await expect(
      prisma.userSetupToken.count({
        where: {
          userId: targetUser.id,
        },
      })
    ).resolves.toBe(0);
    await expect(
      prisma.video.findUnique({
        where: {
          id: video.id,
        },
      })
    ).resolves.toMatchObject({
      movieTitle: "The Matrix",
      sceneTitle: "Lobby shootout",
      description: null,
    });
    await expect(
      prisma.session.findFirst({
        where: {
          userId: admin.id,
        },
      })
    ).resolves.toMatchObject({
      revokedAt: null,
    });
  });

  it("rejects protected session routes for pending users without changing state", async () => {
    const { sessionToken } = await createPendingSession();
    const originalVideo = await prisma.video.create({
      data: {
        youtubeId: "pending001xyz",
        movieTitle: "Alien",
        sceneTitle: "Air shaft",
      },
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const [videosResponse, createResponse, patchResponse, deleteResponse, tmdbResponse] =
      await Promise.all([
        videosGet(
          createRequest("/api/videos", {
            cookies: {
              [SESSION_COOKIE_NAME]: sessionToken,
            },
          })
        ),
        videosPost(
          createRequest("/api/videos", {
            method: "POST",
            cookies: {
              [SESSION_COOKIE_NAME]: sessionToken,
            },
            body: {
              youtubeUrl: "https://www.youtube.com/watch?v=abc123def45",
              movieTitle: "Aliens",
              sceneTitle: "Power loader",
            },
          })
        ),
        videoPatch(
          createRequest(`/api/videos/${originalVideo.id}`, {
            method: "PATCH",
            cookies: {
              [SESSION_COOKIE_NAME]: sessionToken,
            },
            body: {
              movieTitle: "Aliens",
              sceneTitle: "Elevator ambush",
            },
          }),
          { params: Promise.resolve({ id: String(originalVideo.id) }) }
        ),
        videoDelete(
          createRequest(`/api/videos/${originalVideo.id}`, {
            method: "DELETE",
            cookies: {
              [SESSION_COOKIE_NAME]: sessionToken,
            },
          }),
          { params: Promise.resolve({ id: String(originalVideo.id) }) }
        ),
        tmdbGet(
          createRequest("/api/tmdb?query=alien", {
            cookies: {
              [SESSION_COOKIE_NAME]: sessionToken,
            },
          })
        ),
      ]);

    for (const response of [
      videosResponse,
      createResponse,
      patchResponse,
      deleteResponse,
      tmdbResponse,
    ]) {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "An active user account is required.",
      });
    }

    await expect(prisma.video.count()).resolves.toBe(1);
    await expect(
      prisma.video.findUnique({
        where: {
          id: originalVideo.id,
        },
      })
    ).resolves.toMatchObject({
      movieTitle: "Alien",
      sceneTitle: "Air shaft",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
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

  it("rejects cross-site public upvote requests before changing vote or throttle state", async () => {
    const video = await prisma.video.create({
      data: {
        youtubeId: "ghi789jkl01",
        movieTitle: "Jaws",
        sceneTitle: "Beach panic",
      },
    });

    const response = await upvotePost(
      createUpvoteRequest(`/api/videos/${video.id}/upvote`, {
        headers: {
          "sec-fetch-site": "cross-site",
          origin: "https://evil.example",
        },
      }),
      {
        params: Promise.resolve({ id: String(video.id) }),
      }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden.",
    });
    await expect(
      prisma.video.findUnique({
        where: {
          id: video.id,
        },
      })
    ).resolves.toMatchObject({
      upvoteCount: 0,
    });
    await expect(prisma.videoUpvote.count()).resolves.toBe(0);
    await expect(prisma.authThrottleBucket.count()).resolves.toBe(0);
  });

  it("recovers malformed anonymous voter cookies safely and persists the vote", async () => {
    const video = await prisma.video.create({
      data: {
        youtubeId: "jkl012mno34",
        movieTitle: "Alien",
        sceneTitle: "Air shaft",
      },
    });

    const response = await upvotePost(
      createUpvoteRequest(`/api/videos/${video.id}/upvote`, {
        cookies: {
          [ANONYMOUS_VOTER_COOKIE_NAME]: "not-a-valid-cookie",
        },
      }),
      {
        params: Promise.resolve({ id: String(video.id) }),
      }
    );

    expect(response.status).toBe(200);
    expect(response.cookies.get(ANONYMOUS_VOTER_COOKIE_NAME)?.value).toBeTruthy();
    await expect(
      prisma.video.findUnique({
        where: {
          id: video.id,
        },
      })
    ).resolves.toMatchObject({
      upvoteCount: 1,
    });
    await expect(prisma.videoUpvote.count()).resolves.toBe(1);
  });

  it("persists one vote, applies cooldown, and eventually returns a browser throttle response", async () => {
    const video = await prisma.video.create({
      data: {
        youtubeId: "mno345pqr67",
        movieTitle: "Heat",
        sceneTitle: "Bank exit",
      },
    });

    const firstResponse = await upvotePost(
      createUpvoteRequest(`/api/videos/${video.id}/upvote`),
      {
        params: Promise.resolve({ id: String(video.id) }),
      }
    );
    const cookieValue =
      firstResponse.cookies.get(ANONYMOUS_VOTER_COOKIE_NAME)?.value ?? "";

    const secondResponse = await upvotePost(
      createUpvoteRequest(`/api/videos/${video.id}/upvote`, {
        cookies: {
          [ANONYMOUS_VOTER_COOKIE_NAME]: cookieValue,
        },
      }),
      {
        params: Promise.resolve({ id: String(video.id) }),
      }
    );
    await upvotePost(
      createUpvoteRequest(`/api/videos/${video.id}/upvote`, {
        cookies: {
          [ANONYMOUS_VOTER_COOKIE_NAME]: cookieValue,
        },
      }),
      {
        params: Promise.resolve({ id: String(video.id) }),
      }
    );
    const throttledResponse = await upvotePost(
      createUpvoteRequest(`/api/videos/${video.id}/upvote`, {
        cookies: {
          [ANONYMOUS_VOTER_COOKIE_NAME]: cookieValue,
        },
      }),
      {
        params: Promise.resolve({ id: String(video.id) }),
      }
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(409);
    expect(throttledResponse.status).toBe(429);
    await expect(throttledResponse.json()).resolves.toMatchObject({
      error: "Too many upvote attempts. Please try again later.",
      scope: "browser",
    });
    await expect(
      prisma.video.findUnique({
        where: {
          id: video.id,
        },
      })
    ).resolves.toMatchObject({
      upvoteCount: 1,
    });
  });

  it("accepts only one of two concurrent same-cookie upvote attempts inside the 24-hour window", async () => {
    const voterId = randomUUID();
    const video = await prisma.video.create({
      data: {
        youtubeId: "pqr678stu90",
        movieTitle: "Arrival",
        sceneTitle: "First contact",
      },
    });
    const cookieValue = buildAnonymousVoterCookie({
      version: 1,
      voterId,
    }).value;

    const [firstResponse, secondResponse] = await Promise.all([
      upvotePost(
        createUpvoteRequest(`/api/videos/${video.id}/upvote`, {
          cookies: {
            [ANONYMOUS_VOTER_COOKIE_NAME]: cookieValue,
          },
        }),
        {
          params: Promise.resolve({ id: String(video.id) }),
        }
      ),
      upvotePost(
        createUpvoteRequest(`/api/videos/${video.id}/upvote`, {
          cookies: {
            [ANONYMOUS_VOTER_COOKIE_NAME]: cookieValue,
          },
        }),
        {
          params: Promise.resolve({ id: String(video.id) }),
        }
      ),
    ]);
    const statuses = [firstResponse.status, secondResponse.status].sort(
      (left, right) => left - right
    );

    expect(statuses).toEqual([200, 409]);
    await expect(
      prisma.video.findUnique({
        where: {
          id: video.id,
        },
      })
    ).resolves.toMatchObject({
      upvoteCount: 1,
    });
    await expect(prisma.videoUpvote.count()).resolves.toBe(1);
  });

  it("still applies the global upvote limiter when anonymous identities rotate", async () => {
    const video = await prisma.video.create({
      data: {
        youtubeId: "stu901vwx23",
        movieTitle: "Jaws",
        sceneTitle: "Orca launch",
      },
    });

    for (let attempt = 0; attempt < DEFAULT_UPVOTE_GLOBAL_LIMIT; attempt += 1) {
      const response = await upvotePost(
        createUpvoteRequest(`/api/videos/${video.id}/upvote`, {
          cookies: {
            [ANONYMOUS_VOTER_COOKIE_NAME]: buildAnonymousVoterCookie({
              version: 1,
              voterId: randomUUID(),
            }).value,
          },
        }),
        {
          params: Promise.resolve({ id: String(video.id) }),
        }
      );

      expect(response.status).toBe(200);
    }

    const throttledResponse = await upvotePost(
      createUpvoteRequest(`/api/videos/${video.id}/upvote`, {
        cookies: {
          [ANONYMOUS_VOTER_COOKIE_NAME]: buildAnonymousVoterCookie({
            version: 1,
            voterId: randomUUID(),
          }).value,
        },
      }),
      {
        params: Promise.resolve({ id: String(video.id) }),
      }
    );

    expect(throttledResponse.status).toBe(429);
    await expect(throttledResponse.json()).resolves.toMatchObject({
      error: "Too many upvote attempts. Please try again later.",
      scope: "global",
    });
    await expect(
      prisma.video.findUnique({
        where: {
          id: video.id,
        },
      })
    ).resolves.toMatchObject({
      upvoteCount: DEFAULT_UPVOTE_GLOBAL_LIMIT,
    });
  });
});
