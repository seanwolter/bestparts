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
  },
});
