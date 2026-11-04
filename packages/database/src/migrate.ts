import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabaseConnection, type Database } from "./client.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_FOLDER = path.resolve(
  currentDir,
  "../drizzle"
);
const MONOREPO_ROOT_ENV_PATH = path.resolve(currentDir, "../../../.env");

/**
 * Loads key-value pairs from the monorepo root `.env` file into `process.env`
 * without overriding variables already set in the environment.
 */
export function loadRootEnvIfPresent(
  envFilePath: string = MONOREPO_ROOT_ENV_PATH
): void {
  if (!fs.existsSync(envFilePath)) {
    return;
  }

  const content = fs.readFileSync(envFilePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export async function runMigrations(
  db: Database,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER
): Promise<void> {
  await migrate(db, { migrationsFolder });
}

async function main(): Promise<void> {
  loadRootEnvIfPresent();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is required to run migrations."
    );
  }

  const connection = createDatabaseConnection({
    connectionString,
    maxConnections: 1
  });

  try {
    await runMigrations(connection.db);
    console.log("Database migrations applied successfully.");
  } finally {
    await connection.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error("Database migration failed:", err);
    process.exit(1);
  });
}
