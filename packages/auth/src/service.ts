import crypto from "node:crypto";
import {
  auditLogs,
  authMagicLinkTokens,
  authSessions,
  type Database,
  organizationMemberships,
  publicationMemberships,
  users
} from "@fedistack/database";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  generateSecureToken,
  hashToken,
  verifyTokenHashConstantTime
} from "./crypto.js";
import { AuthError } from "./errors.js";
import { createStructuredLogger, type StructuredLogger } from "./logger.js";
import type { MagicLinkTransport } from "./mailer.js";
import type {
  InstanceRole,
  OrganizationRole,
  PublicationRole
} from "./rbac.js";

export const emailInputSchema = z
  .string()
  .trim()
  .min(3, "Email address is required.")
  .max(254, "Email address is too long.")
  .email("Please provide a valid email address.")
  .transform((val) => val.toLowerCase());

export const rawTokenInputSchema = z
  .string()
  .trim()
  .min(20, "Invalid authentication token.")
  .max(256, "Invalid authentication token.");

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string | null;
  instanceRole: InstanceRole;
  emailVerifiedAt: Date | null;
}

export interface UserTenantScopes {
  organizations: Array<{
    organizationId: string;
    role: OrganizationRole;
  }>;
  publications: Array<{
    publicationId: string;
    role: PublicationRole;
  }>;
}

export interface ActiveSession {
  id: string;
  userId: string;
  csrfTokenHash: string;
  expiresAt: Date;
  lastActiveAt: Date;
  createdAt: Date;
}

export interface ValidatedSessionContext {
  user: AuthenticatedUser;
  session: ActiveSession;
  scopes: UserTenantScopes;
  csrfToken: string;
}

export interface AuthServiceConfig {
  db: Database;
  mailer: MagicLinkTransport;
  appBaseUrl: string;
  initialAdminEmail?: string;
  magicLinkTtlMinutes?: number;
  sessionTtlDays?: number;
  csrfSigningSecret?: string;
  logger?: StructuredLogger;
}

export interface RequestMagicLinkInput {
  email: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface VerifyMagicLinkInput {
  rawToken: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface VerifyMagicLinkResult {
  user: AuthenticatedUser;
  session: ActiveSession;
  scopes: UserTenantScopes;
  sessionToken: string;
  csrfToken: string;
}

export class AuthService {
  private readonly db: Database;
  private readonly mailer: MagicLinkTransport;
  private readonly appBaseUrl: string;
  private readonly initialAdminEmail?: string;
  private readonly magicLinkTtlMs: number;
  private readonly sessionTtlMs: number;
  private readonly csrfSigningSecret: string;
  private readonly logger: StructuredLogger;

  constructor(config: AuthServiceConfig) {
    this.db = config.db;
    this.mailer = config.mailer;
    this.appBaseUrl = config.appBaseUrl.replace(/\/+$/, "");
    this.initialAdminEmail = config.initialAdminEmail
      ?.trim()
      .toLowerCase();
    this.magicLinkTtlMs = (config.magicLinkTtlMinutes ?? 15) * 60 * 1000;
    this.sessionTtlMs = (config.sessionTtlDays ?? 30) * 24 * 60 * 60 * 1000;
    this.csrfSigningSecret =
      config.csrfSigningSecret ?? generateSecureToken(32);
    this.logger = config.logger ?? createStructuredLogger();
  }

  /**
   * Derives a deterministic session-bound CSRF token from the raw session token
   * so the client can retrieve its CSRF token via `GET /api/v1/auth/session`
   * while the database only stores `SHA-256(csrfToken)`.
   */
  public deriveCsrfTokenForSession(rawSessionToken: string): string {
    return crypto
      .createHmac("sha256", this.csrfSigningSecret)
      .update(rawSessionToken, "utf8")
      .digest("base64url");
  }

  public async requestMagicLink(
    input: RequestMagicLinkInput
  ): Promise<{ expiresAt: Date }> {
    const parsedEmail = emailInputSchema.safeParse(input.email);
    if (!parsedEmail.success) {
      throw new AuthError(
        "VALIDATION_ERROR",
        parsedEmail.error.issues[0]?.message ?? "Invalid email address.",
        400
      );
    }

    const email = parsedEmail.data;
    const rawToken = generateSecureToken(32);
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + this.magicLinkTtlMs);

    await this.db.insert(authMagicLinkTokens).values({
      email,
      tokenHash,
      expiresAt,
      requestIp: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null
    });

    const magicLinkUrl = `${this.appBaseUrl}/auth/verify?token=${encodeURIComponent(
      rawToken
    )}`;

    await this.mailer.sendMagicLink({
      to: email,
      magicLinkUrl,
      expiresAt
    });

    await this.db.insert(auditLogs).values({
      actorUserId: null,
      scopeType: "instance",
      scopeId: null,
      action: "auth.magic_link.requested",
      metadata: { email },
      ipAddress: input.ipAddress ?? null
    });

    this.logger.info("auth.magic_link.requested", {
      email,
      expiresAt: expiresAt.toISOString(),
      ipAddress: input.ipAddress ?? null
    });

    return { expiresAt };
  }

  public async verifyMagicLink(
    input: VerifyMagicLinkInput
  ): Promise<VerifyMagicLinkResult> {
    const parsedToken = rawTokenInputSchema.safeParse(input.rawToken);
    if (!parsedToken.success) {
      throw new AuthError(
        "INVALID_OR_EXPIRED_MAGIC_LINK",
        "The sign-in link is invalid or has expired.",
        401
      );
    }

    const rawToken = parsedToken.data;
    const tokenHash = hashToken(rawToken);
    const now = new Date();

    return await this.db.transaction(async (tx) => {
      // Atomically consume the single-use token if it exists, is unconsumed, and has not expired
      const [consumedToken] = await tx
        .update(authMagicLinkTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(authMagicLinkTokens.tokenHash, tokenHash),
            isNull(authMagicLinkTokens.consumedAt),
            gt(authMagicLinkTokens.expiresAt, now)
          )
        )
        .returning();

      if (!consumedToken) {
        this.logger.warn("auth.magic_link.verify_failed", {
          ipAddress: input.ipAddress ?? null
        });
        throw new AuthError(
          "INVALID_OR_EXPIRED_MAGIC_LINK",
          "The sign-in link is invalid, has expired, or has already been used.",
          401
        );
      }

      const normalizedEmail = consumedToken.email.toLowerCase();
      const shouldGrantInstanceAdmin =
        Boolean(this.initialAdminEmail) &&
        this.initialAdminEmail === normalizedEmail;

      const [existingUser] = await tx
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

      let userRecord = existingUser;

      if (!userRecord) {
        const [createdUser] = await tx
          .insert(users)
          .values({
            email: normalizedEmail,
            instanceRole: shouldGrantInstanceAdmin ? "instance_admin" : "user",
            emailVerifiedAt: now,
            updatedAt: now
          })
          .returning();

        if (!createdUser) {
          throw new Error("Failed to create user record.");
        }
        userRecord = createdUser;
      } else {
        const nextRole: InstanceRole =
          shouldGrantInstanceAdmin ||
          userRecord.instanceRole === "instance_admin"
            ? "instance_admin"
            : userRecord.instanceRole;

        const [updatedUser] = await tx
          .update(users)
          .set({
            emailVerifiedAt: userRecord.emailVerifiedAt ?? now,
            instanceRole: nextRole,
            updatedAt: now
          })
          .where(eq(users.id, userRecord.id))
          .returning();

        if (updatedUser) {
          userRecord = updatedUser;
        }
      }

      const sessionToken = generateSecureToken(32);
      const sessionTokenHash = hashToken(sessionToken);
      const csrfToken = this.deriveCsrfTokenForSession(sessionToken);
      const csrfTokenHash = hashToken(csrfToken);
      const sessionExpiresAt = new Date(now.getTime() + this.sessionTtlMs);

      const [createdSession] = await tx
        .insert(authSessions)
        .values({
          userId: userRecord.id,
          sessionTokenHash,
          csrfTokenHash,
          expiresAt: sessionExpiresAt,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          lastActiveAt: now
        })
        .returning();

      if (!createdSession) {
        throw new Error("Failed to create authentication session.");
      }

      await tx.insert(auditLogs).values({
        actorUserId: userRecord.id,
        scopeType: "instance",
        scopeId: null,
        action: "auth.session.created",
        metadata: {
          authSessionRecordId: createdSession.id
        },
        ipAddress: input.ipAddress ?? null
      });

      const orgRows = await tx
        .select({
          organizationId: organizationMemberships.organizationId,
          role: organizationMemberships.role
        })
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, userRecord.id));

      const pubRows = await tx
        .select({
          publicationId: publicationMemberships.publicationId,
          role: publicationMemberships.role
        })
        .from(publicationMemberships)
        .where(eq(publicationMemberships.userId, userRecord.id));

      this.logger.info("auth.session.created", {
        userId: userRecord.id,
        instanceRole: userRecord.instanceRole,
        ipAddress: input.ipAddress ?? null
      });

      return {
        user: {
          id: userRecord.id,
          email: userRecord.email,
          displayName: userRecord.displayName,
          instanceRole: userRecord.instanceRole,
          emailVerifiedAt: userRecord.emailVerifiedAt
        },
        session: {
          id: createdSession.id,
          userId: createdSession.userId,
          csrfTokenHash: createdSession.csrfTokenHash,
          expiresAt: createdSession.expiresAt,
          lastActiveAt: createdSession.lastActiveAt,
          createdAt: createdSession.createdAt
        },
        scopes: {
          organizations: orgRows,
          publications: pubRows
        },
        sessionToken,
        csrfToken
      };
    });
  }

  public async validateSession(
    rawSessionToken: string | undefined | null
  ): Promise<ValidatedSessionContext> {
    if (!rawSessionToken || rawSessionToken.trim().length < 20) {
      throw new AuthError(
        "UNAUTHENTICATED",
        "Authentication is required.",
        401
      );
    }

    const tokenHash = hashToken(rawSessionToken);
    const now = new Date();

    const [row] = await this.db
      .select({
        session: authSessions,
        user: users
      })
      .from(authSessions)
      .innerJoin(users, eq(authSessions.userId, users.id))
      .where(eq(authSessions.sessionTokenHash, tokenHash))
      .limit(1);

    if (
      !row ||
      row.session.revokedAt !== null ||
      row.session.expiresAt.getTime() <= now.getTime()
    ) {
      throw new AuthError(
        "SESSION_EXPIRED_OR_REVOKED",
        "Your session has expired or been revoked. Please sign in again.",
        401
      );
    }

    await this.db
      .update(authSessions)
      .set({ lastActiveAt: now })
      .where(eq(authSessions.id, row.session.id));

    const orgRows = await this.db
      .select({
        organizationId: organizationMemberships.organizationId,
        role: organizationMemberships.role
      })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, row.user.id));

    const pubRows = await this.db
      .select({
        publicationId: publicationMemberships.publicationId,
        role: publicationMemberships.role
      })
      .from(publicationMemberships)
      .where(eq(publicationMemberships.userId, row.user.id));

    const csrfToken = this.deriveCsrfTokenForSession(rawSessionToken);

    return {
      user: {
        id: row.user.id,
        email: row.user.email,
        displayName: row.user.displayName,
        instanceRole: row.user.instanceRole,
        emailVerifiedAt: row.user.emailVerifiedAt
      },
      session: {
        id: row.session.id,
        userId: row.session.userId,
        csrfTokenHash: row.session.csrfTokenHash,
        expiresAt: row.session.expiresAt,
        lastActiveAt: now,
        createdAt: row.session.createdAt
      },
      scopes: {
        organizations: orgRows,
        publications: pubRows
      },
      csrfToken
    };
  }

  public verifyCsrfToken(
    session: Pick<ActiveSession, "csrfTokenHash">,
    rawCsrfToken: string | undefined | null
  ): void {
    if (
      !rawCsrfToken ||
      !verifyTokenHashConstantTime(rawCsrfToken, session.csrfTokenHash)
    ) {
      throw new AuthError(
        "CSRF_VALIDATION_FAILED",
        "Invalid or missing CSRF token.",
        403
      );
    }
  }

  public async revokeSession(
    sessionRecordId: string,
    actorUserId: string,
    ipAddress?: string
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(authSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(authSessions.id, sessionRecordId),
          isNull(authSessions.revokedAt)
        )
      );

    await this.db.insert(auditLogs).values({
      actorUserId,
      scopeType: "instance",
      scopeId: null,
      action: "auth.session.revoked",
      metadata: { authSessionRecordId: sessionRecordId },
      ipAddress: ipAddress ?? null
    });

    this.logger.info("auth.session.revoked", {
      userId: actorUserId,
      ipAddress: ipAddress ?? null
    });
  }

  public async revokeAllUserSessions(
    userId: string,
    actorUserId: string,
    ipAddress?: string
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(authSessions)
      .set({ revokedAt: now })
      .where(
        and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt))
      );

    await this.db.insert(auditLogs).values({
      actorUserId,
      scopeType: "instance",
      scopeId: null,
      action: "auth.session.revoked_all",
      metadata: { targetUserId: userId },
      ipAddress: ipAddress ?? null
    });

    this.logger.info("auth.session.revoked_all", {
      targetUserId: userId,
      actorUserId,
      ipAddress: ipAddress ?? null
    });
  }
}
