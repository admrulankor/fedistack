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
  type StructuredLogger,
  type ValidatedSessionContext
} from "@fedistack/auth";
import {
  type ArticleStatus,
  createArticleInputSchema,
  createOrganizationInputSchema,
  createPublicationInputSchema,
  PublishingError,
  type PublishingService,
  updateArticleInputSchema,
  updateOrganizationInputSchema,
  updatePublicationInputSchema,
  upsertOrganizationMemberInputSchema,
  upsertPublicationMemberInputSchema
} from "@fedistack/publishing";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

const magicLinkRequestBodySchema = z.object({
  email: emailInputSchema
});

const magicLinkVerifyBodySchema = z.object({
  token: rawTokenInputSchema
});

const articleStatusQuerySchema = z.enum([
  "draft",
  "published",
  "unpublished"
]);

export interface ApiAppDependencies {
  authService: AuthService;
  rateLimiter: SlidingWindowRateLimiter;
  publishingService?: PublishingService;
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

    if (err instanceof PublishingError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message
          }
        },
        err.statusCode
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

  async function authenticateRequest(
    c: Context,
    requireCsrf: boolean
  ): Promise<ValidatedSessionContext> {
    const cookies = parseCookieHeader(c.req.header("cookie"));
    const rawSessionToken = cookies[cookieName];
    const sessionCtx = await deps.authService.validateSession(rawSessionToken);
    if (requireCsrf) {
      deps.authService.verifyCsrfToken(
        sessionCtx.session,
        c.req.header("x-csrf-token")
      );
    }
    return sessionCtx;
  }

  async function tryResolveViewerUserId(
    c: Context
  ): Promise<string | undefined> {
    const cookies = parseCookieHeader(c.req.header("cookie"));
    const rawSessionToken = cookies[cookieName];
    if (!rawSessionToken || rawSessionToken.trim().length < 20) {
      return undefined;
    }
    try {
      const sessionCtx = await deps.authService.validateSession(rawSessionToken);
      return sessionCtx.user.id;
    } catch {
      return undefined;
    }
  }

  async function parseValidatedJson<T>(
    c: Context,
    schema: z.ZodType<T>
  ): Promise<T> {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      throw new PublishingError(
        "VALIDATION_ERROR",
        "Request body must be valid JSON.",
        400
      );
    }
    const parsed = schema.safeParse(rawBody);
    if (!parsed.success) {
      throw new PublishingError(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Invalid request payload.",
        400
      );
    }
    return parsed.data;
  }

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

  if (deps.publishingService) {
    const publishing = deps.publishingService;

    app.get("/api/v1/organizations", async (c) => {
      const sessionCtx = await authenticateRequest(c, false);
      const organizations = await publishing.listUserOrganizations(
        sessionCtx.user
      );
      return c.json({ organizations });
    });

    app.post("/api/v1/organizations", async (c) => {
      const ipAddress = getClientIp(c.req.raw.headers);
      const sessionCtx = await authenticateRequest(c, true);
      const body = await parseValidatedJson(c, createOrganizationInputSchema);
      const organization = await publishing.createOrganization(
        sessionCtx.user,
        {
          ...body,
          ipAddress
        }
      );
      return c.json({ organization }, 201);
    });

    app.get("/api/v1/organizations/:organizationId", async (c) => {
      const sessionCtx = await authenticateRequest(c, false);
      const detail = await publishing.getOrganizationForActor(
        sessionCtx.user,
        c.req.param("organizationId")
      );
      return c.json(detail);
    });

    app.patch("/api/v1/organizations/:organizationId", async (c) => {
      const ipAddress = getClientIp(c.req.raw.headers);
      const sessionCtx = await authenticateRequest(c, true);
      const body = await parseValidatedJson(c, updateOrganizationInputSchema);
      const organization = await publishing.updateOrganization(
        sessionCtx.user,
        c.req.param("organizationId"),
        {
          ...body,
          ipAddress
        }
      );
      return c.json({ organization });
    });

    app.post("/api/v1/organizations/:organizationId/members", async (c) => {
      const ipAddress = getClientIp(c.req.raw.headers);
      const sessionCtx = await authenticateRequest(c, true);
      const body = await parseValidatedJson(
        c,
        upsertOrganizationMemberInputSchema
      );
      const member = await publishing.upsertOrganizationMember(
        sessionCtx.user,
        c.req.param("organizationId"),
        {
          ...body,
          ipAddress
        }
      );
      return c.json({ member });
    });

    app.delete(
      "/api/v1/organizations/:organizationId/members/:userId",
      async (c) => {
        const ipAddress = getClientIp(c.req.raw.headers);
        const sessionCtx = await authenticateRequest(c, true);
        await publishing.removeOrganizationMember(
          sessionCtx.user,
          c.req.param("organizationId"),
          c.req.param("userId"),
          ipAddress
        );
        return c.json({ ok: true });
      }
    );

    app.get("/api/v1/publications", async (c) => {
      const sessionCtx = await authenticateRequest(c, false);
      const organizationId = c.req.query("organizationId") || undefined;
      const publications = await publishing.listUserPublications(
        sessionCtx.user,
        organizationId
      );
      return c.json({ publications });
    });

    app.post("/api/v1/publications", async (c) => {
      const ipAddress = getClientIp(c.req.raw.headers);
      const sessionCtx = await authenticateRequest(c, true);
      const body = await parseValidatedJson(c, createPublicationInputSchema);
      const publication = await publishing.createPublication(sessionCtx.user, {
        ...body,
        ipAddress
      });
      return c.json({ publication }, 201);
    });

    app.get("/api/v1/publications/:publicationId", async (c) => {
      const sessionCtx = await authenticateRequest(c, false);
      const detail = await publishing.getPublicationForActor(
        sessionCtx.user,
        c.req.param("publicationId")
      );
      return c.json(detail);
    });

    app.patch("/api/v1/publications/:publicationId", async (c) => {
      const ipAddress = getClientIp(c.req.raw.headers);
      const sessionCtx = await authenticateRequest(c, true);
      const body = await parseValidatedJson(c, updatePublicationInputSchema);
      const publication = await publishing.updatePublication(
        sessionCtx.user,
        c.req.param("publicationId"),
        {
          ...body,
          ipAddress
        }
      );
      return c.json({ publication });
    });

    app.post("/api/v1/publications/:publicationId/members", async (c) => {
      const ipAddress = getClientIp(c.req.raw.headers);
      const sessionCtx = await authenticateRequest(c, true);
      const body = await parseValidatedJson(
        c,
        upsertPublicationMemberInputSchema
      );
      const member = await publishing.upsertPublicationMember(
        sessionCtx.user,
        c.req.param("publicationId"),
        {
          ...body,
          ipAddress
        }
      );
      return c.json({ member });
    });

    app.delete(
      "/api/v1/publications/:publicationId/members/:userId",
      async (c) => {
        const ipAddress = getClientIp(c.req.raw.headers);
        const sessionCtx = await authenticateRequest(c, true);
        await publishing.removePublicationMember(
          sessionCtx.user,
          c.req.param("publicationId"),
          c.req.param("userId"),
          ipAddress
        );
        return c.json({ ok: true });
      }
    );

    app.get("/api/v1/publications/:publicationId/articles", async (c) => {
      const sessionCtx = await authenticateRequest(c, false);
      const rawStatus = c.req.query("status");
      let status: ArticleStatus | undefined;
      if (rawStatus !== undefined && rawStatus !== "") {
        const parsedStatus = articleStatusQuerySchema.safeParse(rawStatus);
        if (!parsedStatus.success) {
          throw new PublishingError(
            "VALIDATION_ERROR",
            "Invalid status filter.",
            400
          );
        }
        status = parsedStatus.data;
      }
      const articles = await publishing.listEditorialArticles(
        sessionCtx.user,
        c.req.param("publicationId"),
        status ? { status } : undefined
      );
      return c.json({ articles });
    });

    app.post("/api/v1/publications/:publicationId/articles", async (c) => {
      const ipAddress = getClientIp(c.req.raw.headers);
      const sessionCtx = await authenticateRequest(c, true);
      const body = await parseValidatedJson(c, createArticleInputSchema);
      const article = await publishing.createArticle(
        sessionCtx.user,
        c.req.param("publicationId"),
        {
          ...body,
          ipAddress
        }
      );
      return c.json({ article }, 201);
    });

    app.get(
      "/api/v1/publications/:publicationId/articles/:articleId",
      async (c) => {
        const sessionCtx = await authenticateRequest(c, false);
        const article = await publishing.getEditorialArticle(
          sessionCtx.user,
          c.req.param("publicationId"),
          c.req.param("articleId")
        );
        return c.json({ article });
      }
    );

    app.patch(
      "/api/v1/publications/:publicationId/articles/:articleId",
      async (c) => {
        const ipAddress = getClientIp(c.req.raw.headers);
        const sessionCtx = await authenticateRequest(c, true);
        const body = await parseValidatedJson(c, updateArticleInputSchema);
        const article = await publishing.updateArticle(
          sessionCtx.user,
          c.req.param("publicationId"),
          c.req.param("articleId"),
          {
            ...body,
            ipAddress
          }
        );
        return c.json({ article });
      }
    );

    app.post(
      "/api/v1/publications/:publicationId/articles/:articleId/publish",
      async (c) => {
        const ipAddress = getClientIp(c.req.raw.headers);
        const sessionCtx = await authenticateRequest(c, true);
        const article = await publishing.publishArticle(
          sessionCtx.user,
          c.req.param("publicationId"),
          c.req.param("articleId"),
          ipAddress
        );
        return c.json({ article });
      }
    );

    app.post(
      "/api/v1/publications/:publicationId/articles/:articleId/unpublish",
      async (c) => {
        const ipAddress = getClientIp(c.req.raw.headers);
        const sessionCtx = await authenticateRequest(c, true);
        const article = await publishing.unpublishArticle(
          sessionCtx.user,
          c.req.param("publicationId"),
          c.req.param("articleId"),
          ipAddress
        );
        return c.json({ article });
      }
    );

    app.delete(
      "/api/v1/publications/:publicationId/articles/:articleId",
      async (c) => {
        const ipAddress = getClientIp(c.req.raw.headers);
        const sessionCtx = await authenticateRequest(c, true);
        await publishing.deleteArticle(
          sessionCtx.user,
          c.req.param("publicationId"),
          c.req.param("articleId"),
          ipAddress
        );
        return c.json({ ok: true });
      }
    );

    app.get("/api/v1/public/publications/:publicationSlug", async (c) => {
      const detail = await publishing.getPublicPublicationBySlug(
        c.req.param("publicationSlug")
      );
      return c.json(detail);
    });

    app.get(
      "/api/v1/public/publications/:publicationSlug/articles/:articleSlug",
      async (c) => {
        const viewerUserId = await tryResolveViewerUserId(c);
        const detail = await publishing.getPublicArticleBySlug(
          c.req.param("publicationSlug"),
          c.req.param("articleSlug"),
          viewerUserId
        );
        return c.json(detail);
      }
    );
  }

  return app;
}
