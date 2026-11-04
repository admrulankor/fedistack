import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AuthError,
  AuthService,
  authorizeInstanceAdmin,
  authorizeOrganizationRole,
  authorizePublicationRole,
  createStructuredLogger,
  hashToken,
  InMemoryMagicLinkTransport,
  SlidingWindowRateLimiter
} from "@fedistack/auth";
import {
  auditLogs,
  authMagicLinkTokens,
  authSessions,
  createDatabaseConnection,
  type DatabaseConnection,
  organizationMemberships,
  organizations,
  publicationMemberships,
  publications,
  runMigrations,
  users
} from "@fedistack/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../apps/api/src/app.js";

interface EphemeralPgCluster {
  connectionString: string;
  stop: () => void;
}

function startEphemeralPostgresCluster(): EphemeralPgCluster {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fedistack-pg-test-"));
  const dataDir = path.join(tmpRoot, "data");
  const socketDir = path.join(tmpRoot, "socket");
  const logFile = path.join(tmpRoot, "postgres.log");
  fs.mkdirSync(socketDir, { recursive: true });

  const port = 55432 + Math.floor(Math.random() * 2000);

  execFileSync(
    "initdb",
    [
      "-D",
      dataDir,
      "-U",
      "postgres",
      "--auth=trust",
      "--no-instructions",
      "--encoding=UTF8"
    ],
    { stdio: "pipe" }
  );

  execFileSync(
    "pg_ctl",
    [
      "-D",
      dataDir,
      "-l",
      logFile,
      "-o",
      `-F -p ${port} -k ${socketDir} -h 127.0.0.1`,
      "-w",
      "start"
    ],
    { stdio: "pipe" }
  );

  const connectionString = `postgresql://postgres@127.0.0.1:${port}/postgres`;

  return {
    connectionString,
    stop: () => {
      try {
        execFileSync("pg_ctl", ["-D", dataDir, "-m", "immediate", "stop"], {
          stdio: "pipe"
        });
      } catch {
        // Ignore shutdown errors on cleanup
      }
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  };
}

function extractTokenFromMagicLinkUrl(magicLinkUrl: string): string {
  const url = new URL(magicLinkUrl);
  const token = url.searchParams.get("token");
  if (!token) {
    throw new Error(`Missing token param in URL: ${magicLinkUrl}`);
  }
  return token;
}

function extractSessionCookieValue(
  setCookieHeader: string | null,
  cookieName = "fedistack_session"
): string {
  if (!setCookieHeader) {
    throw new Error("Expected Set-Cookie header to be present");
  }
  const match = setCookieHeader.match(
    new RegExp(`${cookieName}=([^;]+)`)
  );
  if (!match || !match[1]) {
    throw new Error(`Could not extract ${cookieName} from ${setCookieHeader}`);
  }
  return decodeURIComponent(match[1]);
}

describe("Database migrations, Passwordless Auth, Sessions, CSRF & Multi-Tenant RBAC integration", () => {
  let cluster: EphemeralPgCluster | null = null;
  let dbConn: DatabaseConnection;
  let mailer: InMemoryMagicLinkTransport;
  let rateLimiter: SlidingWindowRateLimiter;
  let authService: AuthService;
  const logLines: string[] = [];

  beforeAll(async () => {
    const externalDbUrl = process.env.TEST_DATABASE_URL;
    let connectionString: string;

    if (externalDbUrl) {
      connectionString = externalDbUrl;
    } else {
      cluster = startEphemeralPostgresCluster();
      connectionString = cluster.connectionString;
    }

    dbConn = createDatabaseConnection({
      connectionString,
      maxConnections: 5
    });

    await runMigrations(dbConn.db);

    mailer = new InMemoryMagicLinkTransport();
    rateLimiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 5
    });

    const logger = createStructuredLogger((line: string) =>
      logLines.push(line)
    );

    authService = new AuthService({
      db: dbConn.db,
      mailer,
      appBaseUrl: "http://localhost:3000",
      initialAdminEmail: "admin@fedistack.org",
      magicLinkTtlMinutes: 15,
      sessionTtlDays: 30,
      csrfSigningSecret: "integration-test-csrf-secret-key-0123456789",
      logger
    });
  });

  beforeEach(async () => {
    mailer.clear();
    rateLimiter.reset();
    logLines.length = 0;

    await dbConn.db.delete(auditLogs);
    await dbConn.db.delete(publicationMemberships);
    await dbConn.db.delete(publications);
    await dbConn.db.delete(organizationMemberships);
    await dbConn.db.delete(organizations);
    await dbConn.db.delete(authSessions);
    await dbConn.db.delete(authMagicLinkTokens);
    await dbConn.db.delete(users);
  });

  afterAll(async () => {
    if (dbConn) {
      await dbConn.close();
    }
    if (cluster) {
      cluster.stop();
    }
  });

  it("completes the full magic-link flow, hashes tokens in DB, enforces single-use, and handles CSRF-protected logout", async () => {
    const app = createApiApp({
      authService,
      rateLimiter,
      cookieName: "fedistack_session",
      cookieSecure: true
    });

    // 1. Request a magic link for the bootstrap instance administrator
    const reqRes = await app.request("/api/v1/auth/magic-link/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.10"
      },
      body: JSON.stringify({ email: "  ADMIN@fedistack.org " })
    });

    expect(reqRes.status).toBe(202);
    expect(mailer.deliveries).toHaveLength(1);

    const delivery = mailer.deliveries[0]!;
    expect(delivery.to).toBe("admin@fedistack.org");
    const rawMagicToken = extractTokenFromMagicLinkUrl(delivery.magicLinkUrl);

    // Verify raw token is NEVER stored in the database; only SHA-256 hash is stored
    const storedTokens = await dbConn.db.select().from(authMagicLinkTokens);
    expect(storedTokens).toHaveLength(1);
    expect(storedTokens[0]!.tokenHash).toBe(hashToken(rawMagicToken));
    expect(storedTokens[0]!.tokenHash).not.toBe(rawMagicToken);
    expect(storedTokens[0]!.consumedAt).toBeNull();

    // Verify raw token is NEVER written to structured logs
    for (const line of logLines) {
      expect(line).not.toContain(rawMagicToken);
    }

    // 2. Verify the magic link token
    const verifyRes = await app.request("/api/v1/auth/magic-link/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.10"
      },
      body: JSON.stringify({ token: rawMagicToken })
    });

    expect(verifyRes.status).toBe(200);
    const setCookie = verifyRes.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");

    const rawSessionToken = extractSessionCookieValue(setCookie);
    const verifyBody = (await verifyRes.json()) as {
      user: { id: string; email: string; instanceRole: string };
      csrfToken: string;
    };

    expect(verifyBody.user.email).toBe("admin@fedistack.org");
    expect(verifyBody.user.instanceRole).toBe("instance_admin");
    expect(verifyBody.csrfToken.length).toBeGreaterThan(20);

    // Verify raw session token is NEVER stored in the database
    const storedSessions = await dbConn.db.select().from(authSessions);
    expect(storedSessions).toHaveLength(1);
    expect(storedSessions[0]!.sessionTokenHash).toBe(
      hashToken(rawSessionToken)
    );
    expect(storedSessions[0]!.sessionTokenHash).not.toBe(rawSessionToken);

    // 3. Replay attack: using the same single-use magic link token again must fail with 401
    const replayRes = await app.request("/api/v1/auth/magic-link/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: rawMagicToken })
    });
    expect(replayRes.status).toBe(401);

    // 4. Fetch current authenticated session using the cookie
    const sessionRes = await app.request("/api/v1/auth/session", {
      method: "GET",
      headers: {
        Cookie: `fedistack_session=${rawSessionToken}`
      }
    });
    expect(sessionRes.status).toBe(200);
    const sessionBody = (await sessionRes.json()) as {
      user: { email: string };
      csrfToken: string;
    };
    expect(sessionBody.user.email).toBe("admin@fedistack.org");
    expect(sessionBody.csrfToken).toBe(verifyBody.csrfToken);

    // 5. Attempt logout WITHOUT CSRF token -> must be rejected with 403
    const logoutNoCsrf = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `fedistack_session=${rawSessionToken}`
      }
    });
    expect(logoutNoCsrf.status).toBe(403);

    // Attempt logout WITH forged CSRF token -> must be rejected with 403
    const logoutBadCsrf = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `fedistack_session=${rawSessionToken}`,
        "X-CSRF-Token": "forged_csrf_token_value_1234567890"
      }
    });
    expect(logoutBadCsrf.status).toBe(403);

    // 6. Logout WITH valid CSRF token -> immediately invalidates session
    const logoutOk = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `fedistack_session=${rawSessionToken}`,
        "X-CSRF-Token": verifyBody.csrfToken
      }
    });
    expect(logoutOk.status).toBe(200);
    expect(logoutOk.headers.get("set-cookie")).toContain("Max-Age=0");

    // 7. Subsequent request with the revoked session cookie must return 401
    const afterLogoutRes = await app.request("/api/v1/auth/session", {
      method: "GET",
      headers: {
        Cookie: `fedistack_session=${rawSessionToken}`
      }
    });
    expect(afterLogoutRes.status).toBe(401);
  });

  it("rejects expired magic link tokens", async () => {
    const expiredRawToken = "expired_token_value_0123456789abcdef0123456789";
    await dbConn.db.insert(authMagicLinkTokens).values({
      email: "reader@example.com",
      tokenHash: hashToken(expiredRawToken),
      expiresAt: new Date(Date.now() - 60_000)
    });

    await expect(
      authService.verifyMagicLink({ rawToken: expiredRawToken })
    ).rejects.toMatchObject({
      code: "INVALID_OR_EXPIRED_MAGIC_LINK",
      statusCode: 401
    });
  });

  it("enforces rate limiting on authentication endpoints", async () => {
    const strictLimiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 2
    });

    const app = createApiApp({
      authService,
      rateLimiter: strictLimiter
    });

    const payload = JSON.stringify({ email: "ratelimited@example.com" });
    const headers = {
      "Content-Type": "application/json",
      "X-Forwarded-For": "198.51.100.77"
    };

    const r1 = await app.request("/api/v1/auth/magic-link/request", {
      method: "POST",
      headers,
      body: payload
    });
    expect(r1.status).toBe(202);

    const r2 = await app.request("/api/v1/auth/magic-link/request", {
      method: "POST",
      headers,
      body: payload
    });
    expect(r2.status).toBe(202);

    const r3 = await app.request("/api/v1/auth/magic-link/request", {
      method: "POST",
      headers,
      body: payload
    });
    expect(r3.status).toBe(429);
    expect(r3.headers.get("retry-after")).toBeTruthy();
  });

  it("strictly enforces multi-tenant RBAC and isolates Organization A from Organization B", async () => {
    // Create users
    const [instanceAdmin] = await dbConn.db
      .insert(users)
      .values({
        email: "root@fedistack.org",
        instanceRole: "instance_admin"
      })
      .returning();

    const [userOrgA] = await dbConn.db
      .insert(users)
      .values({
        email: "alice@org-a.org",
        instanceRole: "user"
      })
      .returning();

    const [userOrgB] = await dbConn.db
      .insert(users)
      .values({
        email: "bob@org-b.org",
        instanceRole: "user"
      })
      .returning();

    // Create two separate organizations and publications
    const [orgA] = await dbConn.db
      .insert(organizations)
      .values({
        slug: "org-a",
        name: "Organization A"
      })
      .returning();

    const [orgB] = await dbConn.db
      .insert(organizations)
      .values({
        slug: "org-b",
        name: "Organization B"
      })
      .returning();

    const [pubA] = await dbConn.db
      .insert(publications)
      .values({
        organizationId: orgA!.id,
        slug: "pub-a",
        name: "Publication A"
      })
      .returning();

    const [pubB] = await dbConn.db
      .insert(publications)
      .values({
        organizationId: orgB!.id,
        slug: "pub-b",
        name: "Publication B"
      })
      .returning();

    // Alice is owner of Organization A
    await dbConn.db.insert(organizationMemberships).values({
      organizationId: orgA!.id,
      userId: userOrgA!.id,
      role: "owner"
    });

    // Bob is a publication editor on Publication B only
    await dbConn.db.insert(publicationMemberships).values({
      publicationId: pubB!.id,
      userId: userOrgB!.id,
      role: "editor"
    });

    // 1. Instance admin checks
    expect(() => authorizeInstanceAdmin(instanceAdmin!)).not.toThrow();
    expect(() => authorizeInstanceAdmin(userOrgA!)).toThrowError(AuthError);

    // 2. Alice can administer Organization A and Publication A
    const aliceOrgGrant = await authorizeOrganizationRole(
      dbConn.db,
      userOrgA!,
      orgA!.id,
      "owner"
    );
    expect(aliceOrgGrant.role).toBe("owner");

    const alicePubGrant = await authorizePublicationRole(
      dbConn.db,
      userOrgA!,
      pubA!.id,
      "admin",
      orgA!.id
    );
    expect(alicePubGrant.effectiveRole).toBe("admin");

    // 3. Cross-tenant isolation: Alice (Organization A owner) CANNOT access Organization B or Publication B
    await expect(
      authorizeOrganizationRole(dbConn.db, userOrgA!, orgB!.id, "editor")
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403
    });

    await expect(
      authorizePublicationRole(dbConn.db, userOrgA!, pubB!.id, "author")
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403
    });

    // 4. Cross-organization parameter tampering: passing pubB with expectedOrganizationId = orgA.id is rejected
    await expect(
      authorizePublicationRole(
        dbConn.db,
        userOrgB!,
        pubB!.id,
        "editor",
        orgA!.id
      )
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403
    });

    // 5. Bob can perform editor & author actions on Publication B, but NOT admin actions on Publication B or Organization B
    const bobPubGrant = await authorizePublicationRole(
      dbConn.db,
      userOrgB!,
      pubB!.id,
      "editor",
      orgB!.id
    );
    expect(bobPubGrant.effectiveRole).toBe("editor");

    await expect(
      authorizePublicationRole(dbConn.db, userOrgB!, pubB!.id, "admin")
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403
    });

    await expect(
      authorizeOrganizationRole(dbConn.db, userOrgB!, orgB!.id, "editor")
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403
    });
  });
});
