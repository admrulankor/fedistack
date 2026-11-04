import { loadRootEnvIfPresent } from "@fedistack/database";
import { z } from "zod";

export const apiConfigSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .default(
      "postgresql://fedistack:fedistack_dev_password@localhost:5432/fedistack"
    ),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url()
    .default("http://localhost:3000"),
  INITIAL_ADMIN_EMAIL: z
    .string()
    .email()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  AUTH_MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  AUTH_SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  AUTH_COOKIE_NAME: z.string().min(1).default("fedistack_session"),
  AUTH_COOKIE_DOMAIN: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(10),
  SMTP_HOST: z.string().min(1).default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM_EMAIL: z.string().email().default("noreply@fedistack.local"),
  SMTP_FROM_NAME: z.string().default("Fedistack")
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;

export function loadApiConfig(
  env: Record<string, string | undefined> = process.env
): ApiConfig {
  if (env === process.env) {
    loadRootEnvIfPresent();
  }
  return apiConfigSchema.parse(env);
}
