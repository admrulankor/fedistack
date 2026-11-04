import { defineConfig } from "drizzle-kit";
import { loadRootEnvIfPresent } from "./src/migrate.js";

loadRootEnvIfPresent();

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://fedistack:fedistack_dev_password@localhost:5432/fedistack"
  },
  strict: true,
  verbose: true
});
