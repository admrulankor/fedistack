import {
  AuthService,
  createStructuredLogger,
  SlidingWindowRateLimiter,
  SmtpMagicLinkTransport
} from "@fedistack/auth";
import { createDatabaseConnection } from "@fedistack/database";
import { serve } from "@hono/node-server";
import { createApiApp } from "./app.js";
import { loadApiConfig } from "./config.js";

const config = loadApiConfig();
const logger = createStructuredLogger();

const dbConnection = createDatabaseConnection({
  connectionString: config.DATABASE_URL
});

const mailer = new SmtpMagicLinkTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  fromEmail: config.SMTP_FROM_EMAIL,
  fromName: config.SMTP_FROM_NAME
});

const authService = new AuthService({
  db: dbConnection.db,
  mailer,
  appBaseUrl: config.NEXT_PUBLIC_APP_URL,
  initialAdminEmail: config.INITIAL_ADMIN_EMAIL,
  magicLinkTtlMinutes: config.AUTH_MAGIC_LINK_TTL_MINUTES,
  sessionTtlDays: config.AUTH_SESSION_TTL_DAYS,
  logger
});

const rateLimiter = new SlidingWindowRateLimiter({
  windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
  maxRequests: config.AUTH_RATE_LIMIT_MAX_REQUESTS
});

const app = createApiApp({
  authService,
  rateLimiter,
  cookieName: config.AUTH_COOKIE_NAME,
  cookieDomain: config.AUTH_COOKIE_DOMAIN,
  cookieSecure: config.NODE_ENV === "production",
  sessionTtlDays: config.AUTH_SESSION_TTL_DAYS,
  allowedOrigin: config.NEXT_PUBLIC_APP_URL,
  logger
});

serve(
  {
    fetch: app.fetch,
    hostname: config.API_HOST,
    port: config.API_PORT
  },
  (info) => {
    logger.info("api.server.started", {
      host: info.address,
      port: info.port,
      env: config.NODE_ENV
    });
  }
);
