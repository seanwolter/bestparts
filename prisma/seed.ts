import { PrismaClient, UserRole, UserStatus, SetupTokenReason } from "@prisma/client";
import { SETUP_TOKEN_TTL_MS, createSetupToken, revokeActiveSetupTokensForUser } from "../src/lib/auth/setup-token";

export interface BootstrapAdminOptions {
  username: string;
  baseUrl: string;
}

export interface BootstrapAdminResult {
  createdUser: boolean;
  revokedTokenCount: number;
  userId: string;
  username: string;
  setupUrl: string;
  expiresAt: Date;
}

type BootstrapPrismaClient = Pick<
  PrismaClient,
  "$transaction" | "$disconnect" | "user"
>;

export async function bootstrapFirstAdmin(
  prisma: BootstrapPrismaClient,
  options: BootstrapAdminOptions
): Promise<BootstrapAdminResult> {
  const username = normalizeUsername(options.username);
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  return prisma.$transaction(async (tx) => {
    const allUsers = await tx.user.findMany({
      select: {
        id: true,
        username: true,
      },
    });

    const existingUser = await tx.user.findUnique({
      where: { username },
      include: {
        _count: {
          select: {
            passkeys: true,
          },
        },
      },
    });

    if (allUsers.length > 0 && !existingUser) {
      throw new Error(
        "Bootstrap is only allowed before the system has additional users. Use the existing bootstrap username or wait for the admin user-management flow."
      );
    }

    if (
      existingUser &&
      allUsers.some((user) => user.username !== username)
    ) {
      throw new Error(
        "Bootstrap user already exists, but other users are also present. Refusing to mutate an initialized system."
      );
    }

    if (existingUser && existingUser._count.passkeys > 0) {
      throw new Error(
        `User "${username}" already has registered passkeys. Bootstrap is only for first-time enrollment.`
      );
    }

    const user = existingUser
      ? await tx.user.update({
          where: { id: existingUser.id },
          data: {
            role: UserRole.ADMIN,
            status: UserStatus.PENDING_SETUP,
          },
        })
      : await tx.user.create({
          data: {
            username,
            role: UserRole.ADMIN,
            status: UserStatus.PENDING_SETUP,
          },
        });

    const revokedTokenCount = await revokeActiveSetupTokensForUser(tx, user.id);
    const setupToken = await createSetupToken(tx, {
      userId: user.id,
      reason: SetupTokenReason.INITIAL_ENROLLMENT,
    });

    return {
      createdUser: !existingUser,
      revokedTokenCount,
      userId: user.id,
      username: user.username,
      setupUrl: new URL(setupToken.setupPath, baseUrl).toString(),
      expiresAt: setupToken.record.expiresAt,
    };
  });
}

function normalizeUsername(username: string): string {
  const trimmed = username.trim();

  if (!trimmed) {
    throw new Error("A bootstrap username is required.");
  }

  return trimmed;
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim();

  if (!normalized) {
    throw new Error("A bootstrap base URL is required.");
  }

  return new URL(normalized).toString();
}

export function parseBootstrapArgs(argv: string[]): BootstrapAdminOptions {
  let username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim() ?? "";
  let baseUrl =
    process.env.BOOTSTRAP_ADMIN_BASE_URL?.trim() ??
    process.env.WEBAUTHN_ORIGIN?.trim() ??
    "http://localhost:3000";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--username") {
      username = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--base-url") {
      baseUrl = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      throw new Error(getBootstrapUsage());
    }
  }

  return {
    username: normalizeUsername(username),
    baseUrl: normalizeBaseUrl(baseUrl),
  };
}

function getBootstrapUsage(): string {
  return [
    "Usage: npm run db:bootstrap-admin -- --username <username> [--base-url <url>]",
    "You can also set BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_BASE_URL.",
  ].join("\n");
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    const result = await bootstrapFirstAdmin(prisma, parseBootstrapArgs(process.argv.slice(2)));

    console.log("Bootstrap admin prepared.");
    console.log(`Username: ${result.username}`);
    console.log(`User ID: ${result.userId}`);
    console.log(`Created user: ${result.createdUser ? "yes" : "no"}`);
    console.log(`Revoked outstanding setup tokens: ${result.revokedTokenCount}`);
    console.log(`Setup URL: ${result.setupUrl}`);
    console.log(`Expires at: ${result.expiresAt.toISOString()}`);
    console.log(
      `Token TTL: ${Math.floor(SETUP_TOKEN_TTL_MS / 60_000)} minutes (single use).`
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Bootstrap failed.";
    console.error(message);
    process.exit(1);
  });
}
