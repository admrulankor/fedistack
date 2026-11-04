import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema/index.js";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  sql: Sql;
  close: () => Promise<void>;
}

export interface CreateDatabaseOptions {
  connectionString: string;
  maxConnections?: number;
}

export function createDatabaseConnection(
  options: CreateDatabaseOptions
): DatabaseConnection {
  const sql = postgres(options.connectionString, {
    max: options.maxConnections ?? 10,
    onnotice: () => {
      // Suppress noisy PostgreSQL notices during migrations/queries
    }
  });

  const db = drizzle(sql, { schema });

  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    }
  };
}
