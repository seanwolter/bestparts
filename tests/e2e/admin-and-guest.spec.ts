import { expect, test, type Page } from "@playwright/test";
import {
  buildSessionCookieForBaseUrl,
  createE2EPrismaClient,
  resetE2EDatabase,
  seedAdminSession,
  seedGuestVideo,
  seedGuestSortScenario,
} from "../setup/e2e-db";

test.describe("browser auth and admin flows", () => {
  const prisma = createE2EPrismaClient();

  test.beforeEach(async ({ context }) => {
    await resetE2EDatabase(prisma);
    await context.clearCookies();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("guest browsing hides privileged actions and redirects /submit to login", async ({
    page,
  }) => {
    await seedGuestVideo(prisma);

    await page.goto("/");

    await expect(
      page.getByRole("link", { name: "+ Submit a scene" })
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Manage users" })).toHaveCount(0);
    await expect(page.getByText("Heat")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);

    await page.goto("/submit");

    await expect(page).toHaveURL(/\/login\?next=%2Fsubmit$/);
    await expect(
      page.getByRole("heading", { name: "Sign in with your username and passkey." })
    ).toBeVisible();
  });

  test("guest upvoting uses vote sorting by default and preserves cooldown across reloads", async ({
    page,
  }) => {
    await seedGuestSortScenario(prisma);

    let upvoteRequestCount = 0;

    await page.route("**/api/videos/*/upvote", async (route) => {
      upvoteRequestCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
      await route.continue();
    });

    await page.goto("/");

    await expect(page.getByRole("link", { name: "Top voted" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect.poll(() => getSceneTitleOrder(page)).toEqual([
      "Already top voted",
      "Almost top voted",
    ]);

    const almostTopCard = getVideoCard(page, "Almost top voted");
    const voteButton = almostTopCard.getByRole("button", {
      name: "Upvote video (1 votes)",
    });

    await expect(voteButton).toBeEnabled();
    await expect(voteButton).toHaveText("👍✌️");
    await expect(almostTopCard.getByText("1", { exact: true })).toBeVisible();

    await page.goto("/?sort=date");

    await expect(page.getByRole("link", { name: "Newest" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect.poll(() => getSceneTitleOrder(page)).toEqual([
      "Almost top voted",
      "Already top voted",
    ]);

    await page.goto("/");

    const voteButtonAfterReturn = getVideoCard(page, "Almost top voted").getByRole(
      "button",
      {
        name: "Upvote video (1 votes)",
      }
    );

    await voteButtonAfterReturn.dblclick();

    await expect.poll(() => upvoteRequestCount).toBe(1);
    await expect
      .poll(() => getSceneTitleOrder(page))
      .toEqual(["Almost top voted", "Already top voted"]);

    const cooledDownButton = getVideoCard(page, "Almost top voted").getByRole("button", {
      name: "Upvote video (2 votes)",
    });

    await expect(
      getVideoCard(page, "Almost top voted").getByText("2", { exact: true })
    ).toBeVisible();
    await expect(cooledDownButton).toBeDisabled();
    await page.reload();
    const reloadedTopCard = getVideoCard(page, "Almost top voted");

    await expect(
      reloadedTopCard.getByRole("button", {
        name: "Upvote video (2 votes)",
      })
    ).toBeDisabled();
    await expect(reloadedTopCard.getByText("2", { exact: true })).toBeVisible();
  });

  test("an authenticated admin can create a user and copy a setup URL", async ({
    page,
    context,
    baseURL,
    browserName,
  }) => {
    test.skip(!baseURL, "Playwright baseURL is required.");
    test.skip(browserName !== "chromium", "Clipboard verification is only configured for Chromium.");

    const { sessionToken } = await seedAdminSession(prisma);
    const resolvedBaseUrl = new URL(baseURL!);

    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: resolvedBaseUrl.origin,
    });
    await context.addCookies([
      buildSessionCookieForBaseUrl(resolvedBaseUrl, sessionToken),
    ]);

    await page.goto("/admin/users");

    await expect(
      page.getByRole("heading", {
        name: "Manage setup links, passkey additions, and recovery.",
      })
    ).toBeVisible();

    await page.getByLabel("Username").fill("copied-admin");
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(
      page.getByText("Setup link ready for copied-admin")
    ).toBeVisible();

    const setupUrl = await page.getByTestId("created-setup-url").innerText();

    expect(setupUrl).toMatch(/\/setup\//);

    await page.getByRole("button", { name: "Copy link" }).click();

    await expect.poll(async () => {
      return page.evaluate(() => navigator.clipboard.readText());
    }).toBe(setupUrl);

    await expect(page.getByText("Link copied.")).toBeVisible();
  });
});

function getVideoCard(page: Page, sceneTitle: string) {
  return page.locator("article").filter({
    has: page.getByRole("heading", { level: 2, name: sceneTitle }),
  });
}

async function getSceneTitleOrder(page: Page): Promise<string[]> {
  return page.locator("article h2").allTextContents();
}
