import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "tests/**/*.test.ts"
    ],
    globals: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    server: {
      deps: {
        inline: ["zod", "drizzle-orm", "hono", "postgres"]
      }
    }
  },
  resolve: {
    alias: {
      "@fedistack/database": path.resolve(__dirname, "packages/database/src/index.ts"),
      "@fedistack/auth": path.resolve(__dirname, "packages/auth/src/index.ts"),
      "@fedistack/ui": path.resolve(__dirname, "packages/ui/src/index.tsx")
    }
  }
});
