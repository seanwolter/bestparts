import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const srcDir = path.resolve(rootDir, "src");

export default defineConfig({
  resolve: {
    alias: {
      "@": srcDir,
    },
  },
  test: {
    globals: true,
    passWithNoTests: true,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      exclude: ["tests/**", "node_modules/**"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
          setupFiles: ["./tests/setup/vitest.setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["./tests/setup/vitest.setup.ts"],
          globalSetup: ["./tests/setup/test-db.ts"],
          pool: "threads",
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
