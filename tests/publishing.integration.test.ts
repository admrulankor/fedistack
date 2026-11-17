import {
  AuthService,
  createStructuredLogger,
  InMemoryMagicLinkTransport,
  SlidingWindowRateLimiter
} from "@fedistack/auth";
import {
  articles,
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
import {
  type ArticleDocument,
  type EntitlementChecker,
  PublishingService
} from "@fedistack/publishing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../apps/api/src/app.js";
import {
  type EphemeralPgCluster,
  startEphemeralPostgresCluster
} from "./pg-test-cluster.js";

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
  const match = setCookieHeader.match(new RegExp(`${cookieName}=([^;]+)`));
  if (!match || !match[1]) {
    throw new Error(`Could not extract ${cookieName} from ${setCookieHeader}`);
  }
  return decodeURIComponent(match[1]);
}

async function signInUser(
  app: ReturnType<typeof createApiApp>,
  mailer: InMemoryMagicLinkTransport,
  email: string
): Promise<{ userId: string; sessionToken: string; csrfToken: string }> {
  const startIndex = mailer.deliveries.length;
  const reqRes = await app.request("/api/v1/auth/magic-link/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": `198.51.100.${10 + startIndex}`
    },
    body: JSON.stringify({ email })
  });
  expect(reqRes.status).toBe(202);

  const delivery = mailer.deliveries[startIndex];
  if (!delivery) {
    throw new Error(`Expected magic link delivery for ${email}`);
  }
  const rawMagicToken = extractTokenFromMagicLinkUrl(delivery.magicLinkUrl);

  const verifyRes = await app.request("/api/v1/auth/magic-link/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": `198.51.100.${10 + startIndex}`
    },
    body: JSON.stringify({ token: rawMagicToken })
  });
  expect(verifyRes.status).toBe(200);

  const sessionToken = extractSessionCookieValue(
    verifyRes.headers.get("set-cookie")
  );
  const body = (await verifyRes.json()) as {
    user: { id: string };
    csrfToken: string;
  };

  return {
    userId: body.user.id,
    sessionToken,
    csrfToken: body.csrfToken
  };
}

describe("Publishing module, multi-tenant isolation, editorial lifecycle & paywall stripping integration", () => {
  let cluster: EphemeralPgCluster | null = null;
  let dbConn: DatabaseConnection;
  let mailer: InMemoryMagicLinkTransport;
  let rateLimiter: SlidingWindowRateLimiter;
  let authService: AuthService;
  let entitledPairs: Set<string>;
  let publishingService: PublishingService;
  let app: ReturnType<typeof createApiApp>;

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
      maxRequests: 50
    });
    const logger = createStructuredLogger(() => {
      // Silence test log stdout
    });

    authService = new AuthService({
      db: dbConn.db,
      mailer,
      appBaseUrl: "http://localhost:3000",
      initialAdminEmail: "admin@fedistack.org",
      magicLinkTtlMinutes: 15,
      sessionTtlDays: 30,
      csrfSigningSecret: "publishing-integration-csrf-secret-key-0123456789",
      logger
    });

    entitledPairs = new Set<string>();
    const entitlementChecker: EntitlementChecker = {
      async hasPublicationEntitlement({ userId, publicationId }) {
        return entitledPairs.has(`${userId}:${publicationId}`);
      }
    };

    publishingService = new PublishingService({
      db: dbConn.db,
      entitlementChecker,
      logger
    });

    app = createApiApp({
      authService,
      rateLimiter,
      publishingService,
      cookieName: "fedistack_session",
      cookieSecure: false,
      logger
    });
  });

  beforeEach(async () => {
    mailer.clear();
    rateLimiter.reset();
    entitledPairs.clear();

    await dbConn.db.delete(auditLogs);
    await dbConn.db.delete(articles);
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

  it("manages organizations, publications, team roles, sole-owner protection, and records audit logs", async () => {
    const owner = await signInUser(app, mailer, "owner@org-alpha.test");
    const editor = await signInUser(app, mailer, "editor@org-alpha.test");

    // 1. Create organization
    const createOrgRes = await app.request("/api/v1/organizations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `fedistack_session=${owner.sessionToken}`,
        "X-CSRF-Token": owner.csrfToken
      },
      body: JSON.stringify({
        name: "Alpha Media",
        slug: "alpha-media"
      })
    });
    expect(createOrgRes.status).toBe(201);
    const { organization: org } = (await createOrgRes.json()) as {
      organization: { id: string; slug: string; name: string; role: string };
    };
    expect(org.slug).toBe("alpha-media");
    expect(org.role).toBe("owner");

    // 2. List user organizations
    const listOrgRes = await app.request("/api/v1/organizations", {
      method: "GET",
      headers: { Cookie: `fedistack_session=${owner.sessionToken}` }
    });
    expect(listOrgRes.status).toBe(200);
    const listOrgJson = (await listOrgRes.json()) as {
      organizations: Array<{ id: string }>;
    };
    expect(listOrgJson.organizations).toHaveLength(1);
    expect(listOrgJson.organizations[0]?.id).toBe(org.id);

    // 3. Update organization
    const updateOrgRes = await app.request(`/api/v1/organizations/${org.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: `fedistack_session=${owner.sessionToken}`,
        "X-CSRF-Token": owner.csrfToken
      },
      body: JSON.stringify({ name: "Alpha Media Cooperative" })
    });
    expect(updateOrgRes.status).toBe(200);

    // 4. Sole-owner protection: cannot demote or remove sole owner
    const demoteSoleOwnerRes = await app.request(
      `/api/v1/organizations/${org.id}/members`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `fedistack_session=${owner.sessionToken}`,
          "X-CSRF-Token": owner.csrfToken
        },
        body: JSON.stringify({
          email: "owner@org-alpha.test",
          role: "admin"
        })
      }
    );
    expect(demoteSoleOwnerRes.status).toBe(422);
    const demoteErr = (await demoteSoleOwnerRes.json()) as {
      error: { code: string };
    };
    expect(demoteErr.error.code).toBe("INVALID_STATE_TRANSITION");

    const removeSoleOwnerRes = await app.request(
      `/api/v1/organizations/${org.id}/members/${owner.userId}`,
      {
        method: "DELETE",
        headers: {
          Cookie: `fedistack_session=${owner.sessionToken}`,
          "X-CSRF-Token": owner.csrfToken
        }
      }
    );
    expect(removeSoleOwnerRes.status).toBe(422);

    // 5. Add organization editor
    const addOrgMemberRes = await app.request(
      `/api/v1/organizations/${org.id}/members`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `fedistack_session=${owner.sessionToken}`,
          "X-CSRF-Token": owner.csrfToken
        },
        body: JSON.stringify({
          email: "editor@org-alpha.test",
          role: "editor"
        })
      }
    );
    expect(addOrgMemberRes.status).toBe(200);

    // Org editor can view org detail, but cannot create a publication (requires org admin/owner)
    const orgEditorReadRes = await app.request(
      `/api/v1/organizations/${org.id}`,
      {
        method: "GET",
        headers: { Cookie: `fedistack_session=${editor.sessionToken}` }
      }
    );
    expect(orgEditorReadRes.status).toBe(200);

    const orgEditorCreatePubRes = await app.request("/api/v1/publications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `fedistack_session=${editor.sessionToken}`,
        "X-CSRF-Token": editor.csrfToken
      },
      body: JSON.stringify({
        organizationId: org.id,
        name: "Unauthorized Pub",
        slug: "unauthorized-pub"
      })
    });
    expect(orgEditorCreatePubRes.status).toBe(403);

    // 6. Owner creates publication
    const createPubRes = await app.request("/api/v1/publications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `fedistack_session=${owner.sessionToken}`,
        "X-CSRF-Token": owner.csrfToken
      },
      body: JSON.stringify({
        organizationId: org.id,
        name: "Morning Dispatch",
        slug: "morning-dispatch",
        description: "Independent dispatches."
      })
    });
    expect(createPubRes.status).toBe(201);
    const { publication: pub } = (await createPubRes.json()) as {
      publication: { id: string; slug: string };
    };

    // Duplicate publication slug rejected with 409 CONFLICT
    const dupPubRes = await app.request("/api/v1/publications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `fedistack_session=${owner.sessionToken}`,
        "X-CSRF-Token": owner.csrfToken
      },
      body: JSON.stringify({
        organizationId: org.id,
        name: "Another Dispatch",
        slug: "morning-dispatch"
      })
    });
    expect(dupPubRes.status).toBe(409);

    // Update publication metadata & add publication team member
    const patchPubRes = await app.request(`/api/v1/publications/${pub.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: `fedistack_session=${owner.sessionToken}`,
        "X-CSRF-Token": owner.csrfToken
      },
      body: JSON.stringify({
        name: "Morning Dispatch Daily",
        description: "Updated description"
      })
    });
    expect(patchPubRes.status).toBe(200);

    const addPubMemberRes = await app.request(
      `/api/v1/publications/${pub.id}/members`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `fedistack_session=${owner.sessionToken}`,
          "X-CSRF-Token": owner.csrfToken
        },
        body: JSON.stringify({
          email: "writer@org-alpha.test",
          role: "author"
        })
      }
    );
    expect(addPubMemberRes.status).toBe(200);

    // Verify audit logs recorded lifecycle mutations
    const logs = await dbConn.db.select().from(auditLogs);
    const actions = logs.map((entry) => entry.action);
    expect(actions).toContain("organization.created");
    expect(actions).toContain("organization.updated");
    expect(actions).toContain("organization.member.upserted");
    expect(actions).toContain("publication.created");
    expect(actions).toContain("publication.updated");
    expect(actions).toContain("publication.member.upserted");
  });

  it("enforces strict multi-tenant isolation, CSRF checks, author vs editor permissions, and per-publication slug uniqueness", async () => {
    const ownerA = await signInUser(app, mailer, "alice@org-a.test");
    const authorA = await signInUser(app, mailer, "author-a@org-a.test");
    const editorA = await signInUser(app, mailer, "editor-a@org-a.test");
    const ownerB = await signInUser(app, mailer, "bob@org-b.test");

    // Org A + Pub A
    const orgARes = await app.request("/api/v1/organizations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `fedistack_session=${ownerA.sessionToken}`,
        "X-CSRF-Token": ownerA.csrfToken
      },
      body: JSON.stringify({ name: "Org A", slug: "org-a" })
    });
    const { organization: orgA } = (await orgARes.json()) as {
      organization: { id: string };
    };

    const pubARes = await app.request("/api/v1/publications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `fedistack_session=${ownerA.sessionToken}`,
        "X-CSRF-Token": ownerA.csrfToken
      },
      body: JSON.stringify({
        organizationId: orgA.id,
        name: "Pub A",
        slug: "pub-a"
      })
    });
    const { publication: pubA } = (await pubARes.json()) as {
      publication: { id: string };
    };

    // Org B + Pub B
    const orgBRes = await app.request("/api/v1/organizations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `fedistack_session=${ownerB.sessionToken}`,
        "X-CSRF-Token": ownerB.csrfToken
      },
      body: JSON.stringify({ name: "Org B", slug: "org-b" })
    });
    const { organization: orgB } = (await orgBRes.json()) as {
      organization: { id: string };
    };

    const pubBRes = await app.request("/api/v1/publications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `fedistack_session=${ownerB.sessionToken}`,
        "X-CSRF-Token": ownerB.csrfToken
      },
      body: JSON.stringify({
        organizationId: orgB.id,
        name: "Pub B",
        slug: "pub-b"
      })
    });
    const { publication: pubB } = (await pubBRes.json()) as {
      publication: { id: string };
    };

    // Assign authorA and editorA to Pub A
    await app.request(`/api/v1/publications/${pubA.id}/members`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `fedistack_session=${ownerA.sessionToken}`,
        "X-CSRF-Token": ownerA.csrfToken
      },
      body: JSON.stringify({ email: "author-a@org-a.test", role: "author" })
    });
    await app.request(`/api/v1/publications/${pubA.id}/members`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `fedistack_session=${ownerA.sessionToken}`,
        "X-CSRF-Token": ownerA.csrfToken
      },
      body: JSON.stringify({ email: "editor-a@org-a.test", role: "editor" })
    });

    // CSRF rejection on state-changing publishing request without X-CSRF-Token
    const noCsrfRes = await app.request(
      `/api/v1/publications/${pubA.id}/articles`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `fedistack_session=${authorA.sessionToken}`
        },
        body: JSON.stringify({ title: "No CSRF Draft" })
      }
    );
    expect(noCsrfRes.status).toBe(403);
    const noCsrfErr = (await noCsrfRes.json()) as { error: { code: string } };
    expect(noCsrfErr.error.code).toBe("CSRF_VALIDATION_FAILED");

    // Author creates own draft in Pub A
    const createDraftRes = await app.request(
      `/api/v1/publications/${pubA.id}/articles`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `fedistack_session=${authorA.sessionToken}`,
          "X-CSRF-Token": authorA.csrfToken
        },
        body: JSON.stringify({
          title: "First Draft",
          slug: "shared-slug",
          visibility: "public",
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Initial body." }]
              }
            ]
          }
        })
      }
    );
    expect(createDraftRes.status).toBe(201);
    const { article: authorDraft } = (await createDraftRes.json()) as {
      article: { id: string; slug: string; status: string };
    };

    // Owner A also creates a draft in Pub A (different author)
    const ownerDraftRes = await app.request(
      `/api/v1/publications/${pubA.id}/articles`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `fedistack_session=${ownerA.sessionToken}`,
          "X-CSRF-Token": ownerA.csrfToken
        },
        body: JSON.stringify({
          title: "Owner Draft",
          slug: "owner-draft"
        })
      }
    );
    expect(ownerDraftRes.status).toBe(201);
    const { article: ownerDraft } = (await ownerDraftRes.json()) as {
      article: { id: string };
    };

    // Author updates own draft (allowed), but CANNOT edit Owner's draft (403) and CANNOT publish (403)
    const authorUpdateOwnRes = await app.request(
      `/api/v1/publications/${pubA.id}/articles/${authorDraft.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: `fedistack_session=${authorA.sessionToken}`,
          "X-CSRF-Token": authorA.csrfToken
        },
        body: JSON.stringify({ title: "Updated First Draft" })
      }
    );
    expect(authorUpdateOwnRes.status).toBe(200);

    const authorEditOtherRes = await app.request(
      `/api/v1/publications/${pubA.id}/articles/${ownerDraft.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: `fedistack_session=${authorA.sessionToken}`,
          "X-CSRF-Token": authorA.csrfToken
        },
        body: JSON.stringify({ title: "Tampered" })
      }
    );
    expect(authorEditOtherRes.status).toBe(403);

    const authorPublishRes = await app.request(
      `/api/v1/publications/${pubA.id}/articles/${authorDraft.id}/publish`,
      {
        method: "POST",
        headers: {
          Cookie: `fedistack_session=${authorA.sessionToken}`,
          "X-CSRF-Token": authorA.csrfToken
        }
      }
    );
    expect(authorPublishRes.status).toBe(403);

    // Editor CAN edit author's draft, publish it, and unpublish it
    const editorPublishRes = await app.request(
      `/api/v1/publications/${pubA.id}/articles/${authorDraft.id}/publish`,
      {
        method: "POST",
        headers: {
          Cookie: `fedistack_session=${editorA.sessionToken}`,
          "X-CSRF-Token": editorA.csrfToken
        }
      }
    );
    expect(editorPublishRes.status).toBe(200);
    const publishedJson = (await editorPublishRes.json()) as {
      article: { status: string };
    };
    expect(publishedJson.article.status).toBe("published");

    const editorUnpublishRes = await app.request(
      `/api/v1/publications/${pubA.id}/articles/${authorDraft.id}/unpublish`,
      {
        method: "POST",
        headers: {
          Cookie: `fedistack_session=${editorA.sessionToken}`,
          "X-CSRF-Token": editorA.csrfToken
        }
      }
    );
    expect(editorUnpublishRes.status).toBe(200);
    const unpublishedJson = (await editorUnpublishRes.json()) as {
      article: { status: string };
    };
    expect(unpublishedJson.article.status).toBe("unpublished");

    // Article slug uniqueness is per-publication:
    // Duplicate slug in Pub A -> 409 CONFLICT
    const dupArticleInPubARes = await app.request(
      `/api/v1/publications/${pubA.id}/articles`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `fedistack_session=${ownerA.sessionToken}`,
          "X-CSRF-Token": ownerA.csrfToken
        },
        body: JSON.stringify({ title: "Dup Slug", slug: "shared-slug" })
      }
    );
    expect(dupArticleInPubARes.status).toBe(409);

    // Same slug in Pub B -> 201 Created
    const sameSlugInPubBRes = await app.request(
      `/api/v1/publications/${pubB.id}/articles`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `fedistack_session=${ownerB.sessionToken}`,
          "X-CSRF-Token": ownerB.csrfToken
        },
        body: JSON.stringify({ title: "Pub B Post", slug: "shared-slug" })
      }
    );
    expect(sameSlugInPubBRes.status).toBe(201);

    // Cross-tenant isolation: ownerA cannot read/mutate Org B, Pub B, or Pub B's articles
    expect(
      (
        await app.request(`/api/v1/organizations/${orgB.id}`, {
          method: "GET",
          headers: { Cookie: `fedistack_session=${ownerA.sessionToken}` }
        })
      ).status
    ).toBe(403);

    expect(
      (
        await app.request(`/api/v1/organizations/${orgB.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Cookie: `fedistack_session=${ownerA.sessionToken}`,
            "X-CSRF-Token": ownerA.csrfToken
          },
          body: JSON.stringify({ name: "Hijacked Org B" })
        })
      ).status
    ).toBe(403);

    expect(
      (
        await app.request("/api/v1/publications", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `fedistack_session=${ownerA.sessionToken}`,
            "X-CSRF-Token": ownerA.csrfToken
          },
          body: JSON.stringify({
            organizationId: orgB.id,
            name: "Injected Pub",
            slug: "injected-pub"
          })
        })
      ).status
    ).toBe(403);

    expect(
      (
        await app.request(`/api/v1/publications/${pubB.id}/articles`, {
          method: "GET",
          headers: { Cookie: `fedistack_session=${ownerA.sessionToken}` }
        })
      ).status
    ).toBe(403);
  });

  it("enforces draft privacy and strips restricted nodes server-side for unentitled members-only readers", async () => {
    const publisher = await signInUser(app, mailer, "pub@fedistack.test");
    const reader = await signInUser(app, mailer, "reader@fedistack.test");

    const orgRes = await app.request("/api/v1/organizations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `fedistack_session=${publisher.sessionToken}`,
        "X-CSRF-Token": publisher.csrfToken
      },
      body: JSON.stringify({ name: "Reader Press", slug: "reader-press" })
    });
    const { organization: org } = (await orgRes.json()) as {
      organization: { id: string };
    };

    const pubRes = await app.request("/api/v1/publications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `fedistack_session=${publisher.sessionToken}`,
        "X-CSRF-Token": publisher.csrfToken
      },
      body: JSON.stringify({
        organizationId: org.id,
        name: "Reader Gazette",
        slug: "reader-gazette"
      })
    });
    const { publication: pub } = (await pubRes.json()) as {
      publication: { id: string; slug: string };
    };

    // 1. Draft article (never published)
    await app.request(`/api/v1/publications/${pub.id}/articles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `fedistack_session=${publisher.sessionToken}`,
        "X-CSRF-Token": publisher.csrfToken
      },
      body: JSON.stringify({
        title: "Secret Draft",
        slug: "secret-draft",
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Unpublished leak test." }]
            }
          ]
        }
      })
    });

    // 2. Public published article
    const publicDoc: ArticleDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Open journalism for everyone." }]
        }
      ]
    };
    const publicArtRes = await app.request(
      `/api/v1/publications/${pub.id}/articles`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `fedistack_session=${publisher.sessionToken}`,
          "X-CSRF-Token": publisher.csrfToken
        },
        body: JSON.stringify({
          title: "Open Post",
          slug: "open-post",
          visibility: "public",
          body: publicDoc
        })
      }
    );
    const { article: publicArt } = (await publicArtRes.json()) as {
      article: { id: string };
    };
    await app.request(
      `/api/v1/publications/${pub.id}/articles/${publicArt.id}/publish`,
      {
        method: "POST",
        headers: {
          Cookie: `fedistack_session=${publisher.sessionToken}`,
          "X-CSRF-Token": publisher.csrfToken
        }
      }
    );

    // 3. Members-only published article WITH paywallBoundary
    const paywalledWithBoundaryDoc: ArticleDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Free teaser before paywall." }]
        },
        { type: "paywallBoundary" },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "PREMIUM_SECRET_TOKEN_AFTER_BOUNDARY" }
          ]
        }
      ]
    };
    const boundaryArtRes = await app.request(
      `/api/v1/publications/${pub.id}/articles`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `fedistack_session=${publisher.sessionToken}`,
          "X-CSRF-Token": publisher.csrfToken
        },
        body: JSON.stringify({
          title: "Members Investigation",
          slug: "members-investigation",
          visibility: "members_only",
          body: paywalledWithBoundaryDoc
        })
      }
    );
    const { article: boundaryArt } = (await boundaryArtRes.json()) as {
      article: { id: string };
    };
    await app.request(
      `/api/v1/publications/${pub.id}/articles/${boundaryArt.id}/publish`,
      {
        method: "POST",
        headers: {
          Cookie: `fedistack_session=${publisher.sessionToken}`,
          "X-CSRF-Token": publisher.csrfToken
        }
      }
    );

    // 4. Members-only published article WITHOUT paywallBoundary
    const paywalledNoBoundaryDoc: ArticleDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "ENTIRE_BODY_MUST_BE_STRIPPED" }]
        }
      ]
    };
    const noBoundaryArtRes = await app.request(
      `/api/v1/publications/${pub.id}/articles`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `fedistack_session=${publisher.sessionToken}`,
          "X-CSRF-Token": publisher.csrfToken
        },
        body: JSON.stringify({
          title: "Fully Gated Note",
          slug: "fully-gated-note",
          visibility: "members_only",
          body: paywalledNoBoundaryDoc
        })
      }
    );
    const { article: noBoundaryArt } = (await noBoundaryArtRes.json()) as {
      article: { id: string };
    };
    await app.request(
      `/api/v1/publications/${pub.id}/articles/${noBoundaryArt.id}/publish`,
      {
        method: "POST",
        headers: {
          Cookie: `fedistack_session=${publisher.sessionToken}`,
          "X-CSRF-Token": publisher.csrfToken
        }
      }
    );

    // Verify public publication feed excludes drafts
    const publicFeedRes = await app.request(
      `/api/v1/public/publications/${pub.slug}`,
      { method: "GET" }
    );
    expect(publicFeedRes.status).toBe(200);
    const feedBody = (await publicFeedRes.json()) as {
      articles: Array<{ slug: string }>;
    };
    const feedSlugs = feedBody.articles.map((a) => a.slug);
    expect(feedSlugs).not.toContain("secret-draft");
    expect(feedSlugs).toContain("open-post");
    expect(feedSlugs).toContain("members-investigation");
    expect(feedSlugs).toContain("fully-gated-note");

    // Draft article returns 404 publicly
    expect(
      (
        await app.request(
          `/api/v1/public/publications/${pub.slug}/articles/secret-draft`,
          { method: "GET" }
        )
      ).status
    ).toBe(404);

    // Public article returns full HTML anonymously
    const openRes = await app.request(
      `/api/v1/public/publications/${pub.slug}/articles/open-post`,
      { method: "GET" }
    );
    expect(openRes.status).toBe(200);
    const openBody = (await openRes.json()) as {
      article: { html: string; isPaywalled: boolean; isEntitled: boolean };
    };
    expect(openBody.article.isPaywalled).toBe(false);
    expect(openBody.article.isEntitled).toBe(true);
    expect(openBody.article.html).toContain("Open journalism for everyone.");

    // Unentitled reader accessing members-only article WITH boundary: teaser only
    const unentitledBoundaryRes = await app.request(
      `/api/v1/public/publications/${pub.slug}/articles/members-investigation`,
      {
        method: "GET",
        headers: { Cookie: `fedistack_session=${reader.sessionToken}` }
      }
    );
    expect(unentitledBoundaryRes.status).toBe(200);
    const unentitledBoundaryRaw = await unentitledBoundaryRes.text();
    expect(unentitledBoundaryRaw).not.toContain(
      "PREMIUM_SECRET_TOKEN_AFTER_BOUNDARY"
    );
    const unentitledBoundaryJson = JSON.parse(unentitledBoundaryRaw) as {
      article: { html: string; isPaywalled: boolean; isEntitled: boolean };
    };
    expect(unentitledBoundaryJson.article.isPaywalled).toBe(true);
    expect(unentitledBoundaryJson.article.isEntitled).toBe(false);
    expect(unentitledBoundaryJson.article.html).toContain(
      "Free teaser before paywall."
    );

    // Unentitled anonymous accessing members-only article WITHOUT boundary: empty HTML
    const unentitledNoBoundaryRes = await app.request(
      `/api/v1/public/publications/${pub.slug}/articles/fully-gated-note`,
      { method: "GET" }
    );
    expect(unentitledNoBoundaryRes.status).toBe(200);
    const unentitledNoBoundaryRaw = await unentitledNoBoundaryRes.text();
    expect(unentitledNoBoundaryRaw).not.toContain(
      "ENTIRE_BODY_MUST_BE_STRIPPED"
    );
    const unentitledNoBoundaryJson = JSON.parse(unentitledNoBoundaryRaw) as {
      article: { html: string; isPaywalled: boolean; isEntitled: boolean };
    };
    expect(unentitledNoBoundaryJson.article.isPaywalled).toBe(true);
    expect(unentitledNoBoundaryJson.article.isEntitled).toBe(false);
    expect(unentitledNoBoundaryJson.article.html).toBe("");

    // Entitled reader receives full HTML
    entitledPairs.add(`${reader.userId}:${pub.id}`);
    const entitledRes = await app.request(
      `/api/v1/public/publications/${pub.slug}/articles/members-investigation`,
      {
        method: "GET",
        headers: { Cookie: `fedistack_session=${reader.sessionToken}` }
      }
    );
    expect(entitledRes.status).toBe(200);
    const entitledJson = (await entitledRes.json()) as {
      article: { html: string; isPaywalled: boolean; isEntitled: boolean };
    };
    expect(entitledJson.article.isPaywalled).toBe(false);
    expect(entitledJson.article.isEntitled).toBe(true);
    expect(entitledJson.article.html).toContain("Free teaser before paywall.");
    expect(entitledJson.article.html).toContain(
      "PREMIUM_SECRET_TOKEN_AFTER_BOUNDARY"
    );

    // Unpublished article returns 404 publicly
    await app.request(
      `/api/v1/publications/${pub.id}/articles/${publicArt.id}/unpublish`,
      {
        method: "POST",
        headers: {
          Cookie: `fedistack_session=${publisher.sessionToken}`,
          "X-CSRF-Token": publisher.csrfToken
        }
      }
    );
    expect(
      (
        await app.request(
          `/api/v1/public/publications/${pub.slug}/articles/open-post`,
          { method: "GET" }
        )
      ).status
    ).toBe(404);
  });
});
