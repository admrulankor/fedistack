import {
  AuthError,
  type AuthService,
  createStructuredLogger,
  emailInputSchema,
  parseCookieHeader,
  rawTokenInputSchema,
  serializeClearSessionCookie,
  serializeSessionCookie,
  type SlidingWindowRateLimiter,
  type StructuredLogger
} from "@fedistack/auth";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

const magicLinkRequestBodySchema = z.object({
  email: emailInputSchema
});

const magicLinkVerifyBodySchema = z.object({
  token: rawTokenInputSchema
});

export interface ApiAppDependencies {
  authService: AuthService;
  rateLimiter: SlidingWindowRateLimiter;
  cookieName?: string;
  cookieDomain?: string;
  cookieSecure?: boolean;
  sessionTtlDays?: number;
  allowedOrigin?: string;
  logger?: StructuredLogger;
}

function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  return headers.get("x-real-ip")?.trim() ?? "127.0.0.1";
}

export function createApiApp(deps: ApiAppDependencies): Hono {
  const app = new Hono();
  const cookieName = deps.cookieName ?? "fedistack_session";
  const cookieSecure = deps.cookieSecure ?? false;
  const sessionMaxAgeSeconds = (deps.sessionTtlDays ?? 30) * 24 * 60 * 60;
  const logger = deps.logger ?? createStructuredLogger();

  app.use(
    "/api/*",
    cors({
      origin: deps.allowedOrigin ?? "http://localhost:3000",
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "X-CSRF-Token"]
    })
  );

  app.onError((err, c) => {
    if (err instanceof AuthError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message
          }
        },
        err.statusCode as 400 | 401 | 403 | 429
      );
    }

    logger.error("api.unhandled_error", {
      message: err instanceof Error ? err.message : "Unknown error",
      path: c.req.path
    });

    return c.json(
      {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected server error occurred."
        }
      },
      500
    );
  });

  app.get("/api/v1/health", (c) => {
    return c.json({
      status: "ok",
      service: "fedistack-api"
    });
  });

  app.post("/api/v1/auth/magic-link/request", async (c) => {
    const ipAddress = getClientIp(c.req.raw.headers);
    const userAgent = c.req.header("user-agent") ?? undefined;

    const ipRate = deps.rateLimiter.consume(`magic-req:ip:${ipAddress}`);
    if (!ipRate.allowed) {
      c.header("Retry-After", String(ipRate.retryAfterSeconds));
      throw new AuthError(
        "RATE_LIMIT_EXCEEDED",
        "Too many authentication attempts. Please try again later.",
        429
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      throw new AuthError(
        "VALIDATION_ERROR",
        "Request body must be valid JSON.",
        400
      );
    }

    const parsed = magicLinkRequestBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new AuthError(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid request payload.",
        400
      );
    }

    const emailRate = deps.rateLimiter.consume(
      `magic-req:email:${parsed.data.email}`
    );
    if (!emailRate.allowed) {
      c.header("Retry-After", String(emailRate.retryAfterSeconds));
      throw new AuthError(
        "RATE_LIMIT_EXCEEDED",
        "Too many authentication attempts for this email. Please try again later.",
        429
      );
    }

    await deps.authService.requestMagicLink({
      email: parsed.data.email,
      ipAddress,
      userAgent
    });

    return c.json(
      {
        ok: true,
        message:
          "If the email address is valid, a sign-in link has been dispatched."
      },
      202
    );
  });

  app.post("/api/v1/auth/magic-link/verify", async (c) => {
    const ipAddress = getClientIp(c.req.raw.headers);
    const userAgent = c.req.header("user-agent") ?? undefined;

    const ipRate = deps.rateLimiter.consume(`magic-verify:ip:${ipAddress}`);
    if (!ipRate.allowed) {
      c.header("Retry-After", String(ipRate.retryAfterSeconds));
      throw new AuthError(
        "RATE_LIMIT_EXCEEDED",
        "Too many verification attempts. Please try again later.",
        429
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      throw new AuthError(
        "VALIDATION_ERROR",
        "Request body must be valid JSON.",
        400
      );
    }

    const parsed = magicLinkVerifyBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new AuthError(
        "INVALID_OR_EXPIRED_MAGIC_LINK",
        "The sign-in link is invalid or has expired.",
        401
      );
    }

    const result = await deps.authService.verifyMagicLink({
      rawToken: parsed.data.token,
      ipAddress,
      userAgent
    });

    const cookieHeaderValue = serializeSessionCookie(result.sessionToken, {
      cookieName,
      secure: cookieSecure,
      sameSite: "Lax",
      domain: deps.cookieDomain,
      path: "/",
      maxAgeSeconds: sessionMaxAgeSeconds
    });

    c.header("Set-Cookie", cookieHeaderValue);

    return c.json({
      user: {
        id: result.user.id,
        email: result.user.email,
        displayName: result.user.displayName,
        instanceRole: result.user.instanceRole,
        emailVerifiedAt:
          result.user.emailVerifiedAt?.toISOString() ?? null
      },
      scopes: result.scopes,
      csrfToken: result.csrfToken,
      expiresAt: result.session.expiresAt.toISOString()
    });
  });

  app.get("/api/v1/auth/session", async (c) => {
    const cookies = parseCookieHeader(c.req.header("cookie"));
    const rawSessionToken = cookies[cookieName];

    const sessionCtx = await deps.authService.validateSession(rawSessionToken);

    return c.json({
      user: {
        id: sessionCtx.user.id,
        email: sessionCtx.user.email,
        displayName: sessionCtx.user.displayName,
        instanceRole: sessionCtx.user.instanceRole,
        emailVerifiedAt:
          sessionCtx.user.emailVerifiedAt?.toISOString() ?? null
      },
      scopes: sessionCtx.scopes,
      csrfToken: sessionCtx.csrfToken,
      expiresAt: sessionCtx.session.expiresAt.toISOString()
    });
  });

  app.post("/api/v1/auth/logout", async (c) => {
    const ipAddress = getClientIp(c.req.raw.headers);
    const cookies = parseCookieHeader(c.req.header("cookie"));
    const rawSessionToken = cookies[cookieName];

    const sessionCtx = await deps.authService.validateSession(rawSessionToken);
    const csrfHeader = c.req.header("x-csrf-token");

    deps.authService.verifyCsrfToken(sessionCtx.session, csrfHeader);

    await deps.authService.revokeSession(
      sessionCtx.session.id,
      sessionCtx.user.id,
      ipAddress
    );

    c.header(
      "Set-Cookie",
      serializeClearSessionCookie({
        cookieName,
        secure: cookieSecure,
        sameSite: "Lax",
        domain: deps.cookieDomain,
        path: "/"
      })
    );

    return c.json({ ok: true });
  });

  app.post("/api/v1/auth/sessions/revoke-all", async (c) => {
    const ipAddress = getClientIp(c.req.raw.headers);
    const cookies = parseCookieHeader(c.req.header("cookie"));
    const rawSessionToken = cookies[cookieName];

    const sessionCtx = await deps.authService.validateSession(rawSessionToken);
    const csrfHeader = c.req.header("x-csrf-token");

    deps.authService.verifyCsrfToken(sessionCtx.session, csrfHeader);

    await deps.authService.revokeAllUserSessions(
      sessionCtx.user.id,
      sessionCtx.user.id,
      ipAddress
    );

    c.header(
      "Set-Cookie",
      serializeClearSessionCookie({
        cookieName,
        secure: cookieSecure,
        sameSite: "Lax",
        domain: deps.cookieDomain,
        path: "/"
      })
    );

    return c.json({ ok: true });
  });

  return app;
}
