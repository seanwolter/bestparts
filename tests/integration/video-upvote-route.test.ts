import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getTestDatabaseUrl } from "../setup/test-db";
import { POST as upvotePost } from "@/app/api/videos/[id]/upvote/route";
import {
  ANONYMOUS_VOTER_COOKIE_NAME,
  buildAnonymousVoterCookie,
  hashAnonymousVoterId,
} from "@/lib/votes/voter-cookie";
import {
  DEFAULT_UPVOTE_GLOBAL_LIMIT,
  DEFAULT_UPVOTE_IP_LIMIT,
} from "@/lib/votes/rate-limit";

describe("public video upvote route", () => {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: getTestDatabaseUrl(),
      },
    },
  });

  beforeEach(async () => {
    await prisma.authThrottleBucket.deleteMany();
    await prisma.videoUpvote.deleteMany();
    await prisma.video.deleteMany();
  });

  it("allows a guest to upvote and issues an anonymous voter cookie", async () => {
    const video = await prisma.video.create({
      data: {
        youtubeId: "abc123def45",
        movieTitle: "Heat",
        sceneTitle: "Downtown shootout",
      },
    });

    const response = await upvotePost(createRequest(`/api/videos/${video.id}/upvote`), {
      params: Promise.resolve({ id: String(video.id) }),
    });
    const payload = await response.json();
    const storedVideo = await prisma.video.findUnique({
      where: {
        id: video.id,
      },
    });
    const storedUpvotes = await prisma.videoUpvote.findMany({
      where: {
        videoId: video.id,
      },
    });

    expect(response.status).toBe(200);
    expect(payload.upvoteCount).toBe(1);
    expect(payload.nextEligibleUpvoteAt).toBeTruthy();
    expect(response.cookies.get(ANONYMOUS_VOTER_COOKIE_NAME)?.value).toBeTruthy();
    expect(storedVideo?.upvoteCount).toBe(1);
    expect(storedUpvotes).toHaveLength(1);
  });

  it("rejects cross-site upvote attempts before changing vote state", async () => {
    const video = await prisma.video.create({
      data: {
        youtubeId: "abc123def45",
        movieTitle: "Alien",
        sceneTitle: "Chestburster",
      },
    });

    const response = await upvotePost(
      createRequest(`/api/videos/${video.id}/upvote`, {
        headers: {
          "sec-fetch-site": "cross-site",
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
  });

  it("rejects invalid ids and missing videos", async () => {
    const invalidResponse = await upvotePost(
      createRequest("/api/videos/not-a-number/upvote"),
      {
        params: Promise.resolve({ id: "not-a-number" }),
      }
    );
    const missingResponse = await upvotePost(
      createRequest("/api/videos/999/upvote"),
      {
        params: Promise.resolve({ id: "999" }),
      }
    );

    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toEqual({
      error: "Invalid ID",
    });
    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toEqual({
      error: "Video not found.",
    });
  });

  it("rejects a repeat upvote from the same browser within 24 hours", async () => {
    const video = await prisma.video.create({
      data: {
        youtubeId: "abc123def45",
        movieTitle: "Heat",
        sceneTitle: "Downtown shootout",
      },
    });
    const initialResponse = await upvotePost(
      createRequest(`/api/videos/${video.id}/upvote`),
      {
        params: Promise.resolve({ id: String(video.id) }),
      }
    );
    const cookieValue =
      initialResponse.cookies.get(ANONYMOUS_VOTER_COOKIE_NAME)?.value ?? "";

    const repeatResponse = await upvotePost(
      createRequest(`/api/videos/${video.id}/upvote`, {
        cookies: {
          [ANONYMOUS_VOTER_COOKIE_NAME]: cookieValue,
        },
      }),
      {
        params: Promise.resolve({ id: String(video.id) }),
      }
    );
    const repeatPayload = await repeatResponse.json();

    expect(repeatResponse.status).toBe(409);
    expect(repeatPayload.error).toBe(
      "This browser can upvote this video again later."
    );
    expect(repeatPayload.retryAfterMs).toBeGreaterThan(0);
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

  it("allows the same browser to upvote again after 24 hours", async () => {
    const voterId = "3b32a5ef-9059-4acc-bd6e-a8f2e37295ee";
    const video = await prisma.video.create({
      data: {
        youtubeId: "abc123def45",
        movieTitle: "Heat",
        sceneTitle: "Downtown shootout",
        upvoteCount: 1,
      },
    });

    await prisma.videoUpvote.create({
      data: {
        videoId: video.id,
        voterKeyHash: hashAnonymousVoterId(voterId),
        createdAt: new Date(Date.now() - 25 * 60 * 60_000),
      },
    });

    const response = await upvotePost(
      createRequest(`/api/videos/${video.id}/upvote`, {
        cookies: {
          [ANONYMOUS_VOTER_COOKIE_NAME]: buildAnonymousVoterCookie({
            version: 1,
            voterId,
          }).value,
        },
      }),
      {
        params: Promise.resolve({ id: String(video.id) }),
      }
    );

    expect(response.status).toBe(200);
    await expect(
      prisma.video.findUnique({
        where: {
          id: video.id,
        },
      })
    ).resolves.toMatchObject({
      upvoteCount: 2,
    });
  });

  it("rotates malformed anonymous voter cookies without a server error", async () => {
    const video = await prisma.video.create({
      data: {
        youtubeId: "abc123def45",
        movieTitle: "Heat",
        sceneTitle: "Downtown shootout",
      },
    });

    const response = await upvotePost(
      createRequest(`/api/videos/${video.id}/upvote`, {
        cookies: {
          [ANONYMOUS_VOTER_COOKIE_NAME]: "not-a-valid-signed-cookie",
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
  });

  it("eventually rate-limits rapid repeat requests from the same browser", async () => {
    const video = await prisma.video.create({
      data: {
        youtubeId: "abc123def45",
        movieTitle: "Heat",
        sceneTitle: "Downtown shootout",
      },
    });
    const initialResponse = await upvotePost(
      createRequest(`/api/videos/${video.id}/upvote`),
      {
        params: Promise.resolve({ id: String(video.id) }),
      }
    );
    const cookieValue =
      initialResponse.cookies.get(ANONYMOUS_VOTER_COOKIE_NAME)?.value ?? "";

    await upvotePost(
      createRequest(`/api/videos/${video.id}/upvote`, {
        cookies: {
          [ANONYMOUS_VOTER_COOKIE_NAME]: cookieValue,
        },
      }),
      {
        params: Promise.resolve({ id: String(video.id) }),
      }
    );
    await upvotePost(
      createRequest(`/api/videos/${video.id}/upvote`, {
        cookies: {
          [ANONYMOUS_VOTER_COOKIE_NAME]: cookieValue,
        },
      }),
      {
        params: Promise.resolve({ id: String(video.id) }),
      }
    );

    const throttledResponse = await upvotePost(
      createRequest(`/api/videos/${video.id}/upvote`, {
        cookies: {
          [ANONYMOUS_VOTER_COOKIE_NAME]: cookieValue,
        },
      }),
      {
        params: Promise.resolve({ id: String(video.id) }),
      }
    );
    const throttledPayload = await throttledResponse.json();

    expect(throttledResponse.status).toBe(429);
    expect(throttledPayload.error).toBe(
      "Too many upvote attempts. Please try again later."
    );
    expect(throttledPayload.scope).toBe("browser");
    expect(throttledPayload.retryAfterMs).toBeGreaterThan(0);
    expect(throttledResponse.headers.get("Retry-After")).toBeTruthy();
  });

  it("rate-limits globally even when the anonymous voter cookie changes between requests", async () => {
    const video = await prisma.video.create({
      data: {
        youtubeId: "abc123def45",
        movieTitle: "Heat",
        sceneTitle: "Downtown shootout",
      },
    });

    for (let attempt = 0; attempt < DEFAULT_UPVOTE_GLOBAL_LIMIT; attempt += 1) {
      const response = await upvotePost(
        createRequest(`/api/videos/${video.id}/upvote`, {
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
      createRequest(`/api/videos/${video.id}/upvote`, {
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
    const throttledPayload = await throttledResponse.json();

    expect(throttledResponse.status).toBe(429);
    expect(throttledPayload.scope).toBe("global");
    expect(throttledPayload.retryAfterMs).toBeGreaterThan(0);
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

  it("rate-limits by trusted proxy ip when proxy headers are explicitly enabled", async () => {
    const originalSetting = process.env.AUTH_TRUST_PROXY_HEADERS;
    process.env.AUTH_TRUST_PROXY_HEADERS = "true";

    try {
      const video = await prisma.video.create({
        data: {
          youtubeId: "trustedip001",
          movieTitle: "Heat",
          sceneTitle: "Armored car ambush",
        },
      });

      for (let attempt = 0; attempt < DEFAULT_UPVOTE_IP_LIMIT; attempt += 1) {
        const response = await upvotePost(
          createRequest(`/api/videos/${video.id}/upvote`, {
            cookies: {
              [ANONYMOUS_VOTER_COOKIE_NAME]: buildAnonymousVoterCookie({
                version: 1,
                voterId: randomUUID(),
              }).value,
            },
            headers: {
              "x-forwarded-for": "203.0.113.10",
            },
          }),
          {
            params: Promise.resolve({ id: String(video.id) }),
          }
        );

        expect(response.status).toBe(200);
      }

      const blockedResponse = await upvotePost(
        createRequest(`/api/videos/${video.id}/upvote`, {
          cookies: {
            [ANONYMOUS_VOTER_COOKIE_NAME]: buildAnonymousVoterCookie({
              version: 1,
              voterId: randomUUID(),
            }).value,
          },
          headers: {
            "x-forwarded-for": "203.0.113.10",
          },
        }),
        {
          params: Promise.resolve({ id: String(video.id) }),
        }
      );
      const blockedPayload = await blockedResponse.json();

      expect(blockedResponse.status).toBe(429);
      expect(blockedPayload.scope).toBe("ip");
      expect(blockedPayload.retryAfterMs).toBeGreaterThan(0);

      const freshIpResponse = await upvotePost(
        createRequest(`/api/videos/${video.id}/upvote`, {
          cookies: {
            [ANONYMOUS_VOTER_COOKIE_NAME]: buildAnonymousVoterCookie({
              version: 1,
              voterId: randomUUID(),
            }).value,
          },
          headers: {
            "x-forwarded-for": "203.0.113.11",
          },
        }),
        {
          params: Promise.resolve({ id: String(video.id) }),
        }
      );
      const updatedVideo = await prisma.video.findUnique({
        where: {
          id: video.id,
        },
      });

      expect(freshIpResponse.status).toBe(200);
      expect(updatedVideo?.upvoteCount).toBe(DEFAULT_UPVOTE_IP_LIMIT + 1);
    } finally {
      process.env.AUTH_TRUST_PROXY_HEADERS = originalSetting;
    }
  });

  it("ignores spoofed proxy headers for ip throttling when proxy trust is disabled", async () => {
    const originalSetting = process.env.AUTH_TRUST_PROXY_HEADERS;
    delete process.env.AUTH_TRUST_PROXY_HEADERS;

    try {
      const video = await prisma.video.create({
        data: {
          youtubeId: "defaultip001",
          movieTitle: "Alien",
          sceneTitle: "Self-destruct sequence",
        },
      });

      for (let attempt = 0; attempt < DEFAULT_UPVOTE_IP_LIMIT + 1; attempt += 1) {
        const response = await upvotePost(
          createRequest(`/api/videos/${video.id}/upvote`, {
            cookies: {
              [ANONYMOUS_VOTER_COOKIE_NAME]: buildAnonymousVoterCookie({
                version: 1,
                voterId: randomUUID(),
              }).value,
            },
            headers: {
              "x-forwarded-for": "203.0.113.10",
              "x-real-ip": "198.51.100.20",
            },
          }),
          {
            params: Promise.resolve({ id: String(video.id) }),
          }
        );

        expect(response.status).toBe(200);
      }

      await expect(
        prisma.video.findUnique({
          where: {
            id: video.id,
          },
        })
      ).resolves.toMatchObject({
        upvoteCount: DEFAULT_UPVOTE_IP_LIMIT + 1,
      });
    } finally {
      process.env.AUTH_TRUST_PROXY_HEADERS = originalSetting;
    }
  });

  it("only increments once for concurrent attempts from the same anonymous voter", async () => {
    const voterId = randomUUID();
    const video = await prisma.video.create({
      data: {
        youtubeId: "abc123def45",
        movieTitle: "Heat",
        sceneTitle: "Downtown shootout",
      },
    });

    const [firstResponse, secondResponse] = await Promise.all([
      upvotePost(
        createRequest(`/api/videos/${video.id}/upvote`, {
          cookies: {
            [ANONYMOUS_VOTER_COOKIE_NAME]: buildAnonymousVoterCookie({
              version: 1,
              voterId,
            }).value,
          },
        }),
        {
          params: Promise.resolve({ id: String(video.id) }),
        }
      ),
      upvotePost(
        createRequest(`/api/videos/${video.id}/upvote`, {
          cookies: {
            [ANONYMOUS_VOTER_COOKIE_NAME]: buildAnonymousVoterCookie({
              version: 1,
              voterId,
            }).value,
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
    const storedVideo = await prisma.video.findUnique({
      where: {
        id: video.id,
      },
    });
    const storedUpvotes = await prisma.videoUpvote.findMany({
      where: {
        videoId: video.id,
        voterKeyHash: hashAnonymousVoterId(voterId),
      },
    });

    expect(statuses).toEqual([200, 409]);
    expect(storedVideo?.upvoteCount).toBe(1);
    expect(storedUpvotes).toHaveLength(1);
  });
});

function createRequest(
  path: string,
  options: {
    method?: string;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  const headers = new Headers(options.headers);
  const method = options.method ?? "POST";

  if (!headers.has("origin") && !headers.has("referer")) {
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
  });
}
