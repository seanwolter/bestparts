import { expect, test } from "@playwright/test";
import {
  buildSessionCookieForBaseUrl,
  createE2EPrismaClient,
  resetE2EDatabase,
  seedAdminSession,
  seedGuestVideo,
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
