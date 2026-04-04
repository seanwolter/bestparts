import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const envFilePath = path.join(repoRoot, ".env");
const defaultPlaywrightBaseUrl = "http://localhost:3001";

function loadLocalEnvFile(): void {
  if (!existsSync(envFilePath)) {
    return;
  }

  const contents = readFileSync(envFilePath, "utf8");

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    const quoted =
      (rawValue.startsWith("\"") && rawValue.endsWith("\"")) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"));
    const value = quoted ? rawValue.slice(1, -1) : rawValue;

    process.env[key] = value;
  }
}

loadLocalEnvFile();

export function getPlaywrightTestDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL_TEST?.trim();

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL_TEST for Playwright.");
  }

  if (databaseUrl === process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL_TEST must not match DATABASE_URL.");
  }

  return databaseUrl;
}

export function getPlaywrightBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL?.trim() || defaultPlaywrightBaseUrl;
}

export function createPlaywrightWebServerEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  env.DATABASE_URL = getPlaywrightTestDatabaseUrl();
  env.WEBAUTHN_RP_ID = new URL(getPlaywrightBaseUrl()).hostname;
  env.WEBAUTHN_ORIGIN = getPlaywrightBaseUrl();

  return env;
}

export function resetPlaywrightTestDatabase(): void {
  const prismaCliPath = path.join(repoRoot, "node_modules/prisma/build/index.js");
  const result = spawnSync(
    process.execPath,
    [prismaCliPath, "db", "push", "--force-reset", "--skip-generate"],
    {
      cwd: repoRoot,
      env: createPlaywrightWebServerEnv() as NodeJS.ProcessEnv,
      stdio: "inherit",
    }
  );

  if (result.status !== 0) {
    throw new Error("Playwright test database reset failed.");
  }
}
