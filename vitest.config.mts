import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup-env.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    // Integration tests share one Postgres database and each resetDb()
    // truncates it — files must not run concurrently against it.
    fileParallelism: false,
  },
});
