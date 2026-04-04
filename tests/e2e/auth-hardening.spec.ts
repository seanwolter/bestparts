import { expect, test, type Page } from "@playwright/test";
import { UserStatus } from "@prisma/client";
import {
  createE2EPrismaClient,
  resetE2EDatabase,
  seedSetupUser,
} from "../setup/e2e-db";
import { attachVirtualAuthenticator } from "../setup/webauthn";

test.describe("browser auth hardening flows", () => {
  const prisma = createE2EPrismaClient();

  test.beforeEach(async ({ context }) => {
    await resetE2EDatabase(prisma);
    await context.clearCookies();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("setup and login succeed through the existing passkey browser flow", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Virtual authenticators require Chromium.");

    const { rawToken, username } = await seedSetupUser(prisma, {
      username: "browser-passkey-user",
    });
    const authenticator = await attachVirtualAuthenticator(page);

    try {
      await page.goto(`/setup/${rawToken}`);

      await expectSetupScreen(page);

      await page.getByRole("button", { name: "Register passkey" }).click();

      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
      await expect(page.getByText(username)).toBeVisible();
      await expect(page.getByRole("link", { name: "+ Submit a scene" })).toBeVisible();

      const storedCredentials = await authenticator.getCredentials();
      expect(storedCredentials).toHaveLength(1);

      await page.getByRole("button", { name: "Log out" }).click();

      await expect(page).toHaveURL(/\/$/);
      await page.goto("/submit");

      await expect(page).toHaveURL(/\/login\?next=(%2Fsubmit|\/submit)$/);

      await page.getByLabel("Username").fill(username);
      await page.getByRole("button", { name: "Continue with passkey" }).click();

      await expect(page).toHaveURL(/\/submit$/);
      await expect(
        page.getByRole("heading", { name: "Submit a scene" })
      ).toBeVisible();
    } finally {
      await authenticator.dispose();
    }
  });

  test("fake usernames still fail with the same generic login UI", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Virtual authenticators require Chromium.");

    const { rawToken } = await seedSetupUser(prisma, {
      username: "known-browser-user",
    });
    const authenticator = await attachVirtualAuthenticator(page);

    try {
      await completeSetup(page, rawToken);
      await page.getByRole("button", { name: "Log out" }).click();

      await expect(page).toHaveURL(/\/$/);

      await page.goto("/login");
      await page.getByLabel("Username").fill("missing-browser-user");
      await page.getByRole("button", { name: "Continue with passkey" }).click();

      await expect(page).toHaveURL(/\/login$/);
      await expect(getFormAlert(page, "Authentication failed.")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Sign in with your username and passkey." })
      ).toBeVisible();
    } finally {
      await authenticator.dispose();
    }
  });

  test("tampered login responses stay on the login screen with a generic failure", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Virtual authenticators require Chromium.");

    const { rawToken, username } = await seedSetupUser(prisma, {
      username: "tampered-login-user",
    });
    const authenticator = await attachVirtualAuthenticator(page);

    try {
      await completeSetup(page, rawToken);
      await page.getByRole("button", { name: "Log out" }).click();

      await expect(page).toHaveURL(/\/$/);

      await authenticator.setResponseOverrideBits({
        isBogusSignature: true,
      });

      await page.goto("/login");
      await page.getByLabel("Username").fill(username);
      await page.getByRole("button", { name: "Continue with passkey" }).click();

      await expect(page).toHaveURL(/\/login$/);
      await expect(getFormAlert(page, "Authentication failed.")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Sign in with your username and passkey." })
      ).toBeVisible();
    } finally {
      await authenticator.dispose();
    }
  });

  test("tampered setup responses stay on the setup screen with a generic failure", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Virtual authenticators require Chromium.");

    const { rawToken, username } = await seedSetupUser(prisma, {
      username: "tampered-setup-user",
    });
    const authenticator = await attachVirtualAuthenticator(page);

    try {
      await tamperSetupVerifyRequest(page);

      await page.goto(`/setup/${rawToken}`);
      await page.getByRole("button", { name: "Register passkey" }).click();

      await expect(page).toHaveURL(new RegExp(`/setup/${rawToken}$`));
      await expectSetupScreen(page);
      await expect(getFormAlert(page, "Passkey setup failed.")).toBeVisible();

      const user = await prisma.user.findUnique({
        where: {
          username,
        },
        include: {
          passkeys: true,
        },
      });

      expect(user?.status).toBe(UserStatus.PENDING_SETUP);
      expect(user?.passkeys).toHaveLength(0);
    } finally {
      await authenticator.dispose();
    }
  });
});

async function completeSetup(page: Page, rawToken: string) {
  await page.goto(`/setup/${rawToken}`);
  await expectSetupScreen(page);
  await page.getByRole("button", { name: "Register passkey" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
}

async function expectSetupScreen(page: Page) {
  await expect(page.getByRole("heading", { name: "Complete passkey setup." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Register your passkey" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Register passkey" })).toBeVisible();
}

async function tamperSetupVerifyRequest(page: Page) {
  await page.route("**/api/auth/setup/verify", async (route, request) => {
    const payload = request.postDataJSON() as {
      response?: {
        response?: {
          clientDataJSON?: string;
        };
      };
    };
    const clientDataJSON = payload.response?.response?.clientDataJSON;

    if (clientDataJSON) {
      payload.response!.response!.clientDataJSON = tamperBase64Url(clientDataJSON);
    }

    const headers = { ...request.headers() };
    delete headers["content-length"];

    await route.continue({
      headers,
      postData: JSON.stringify(payload),
    });
  });
}

function tamperBase64Url(value: string): string {
  if (value.length === 0) {
    return "A";
  }

  const lastCharacter = value.at(-1);
  return `${value.slice(0, -1)}${lastCharacter === "A" ? "B" : "A"}`;
}

function getFormAlert(page: Page, text: string) {
  return page.locator('[role="alert"]').filter({ hasText: text });
}
