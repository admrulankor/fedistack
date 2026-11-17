import {
  type AuthenticatedActor,
  AuthError,
  authorizeOrganizationRole,
  authorizePublicationRole,
  createStructuredLogger,
  emailInputSchema,
  type OrganizationRole,
  type PublicationRole,
  type StructuredLogger
} from "@fedistack/auth";
import {
  type ArticleRecord,
  articles,
  auditLogs,
  type Database,
  organizationMemberships,
  organizations,
  publicationMemberships,
  publications,
  users
} from "@fedistack/database";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  type ArticleDocument,
  type ArticleVisibility,
  createEmptyArticleDocument,
  renderArticleDocumentToHtml,
  stripRestrictedNodesForUnentitledReader,
  validateArticleDocument
} from "./document.js";
import { PublishingError } from "./errors.js";
import { slugifyText, slugSchema } from "./slug.js";

export type ArticleStatus = "draft" | "published" | "unpublished";

export interface EntitlementChecker {
  hasPublicationEntitlement(params: {
    userId: string;
    publicationId: string;
  }): Promise<boolean>;
}

const defaultEntitlementChecker: EntitlementChecker = {
  async hasPublicationEntitlement() {
    return false;
  }
};

export interface PublishingServiceConfig {
  db: Database;
  entitlementChecker?: EntitlementChecker;
  logger?: StructuredLogger;
}

const uuidSchema = z.string().uuid("Invalid identifier format.");

export const createOrganizationInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Organization name must be at least 2 characters.")
    .max(120, "Organization name must be at most 120 characters."),
  slug: slugSchema
});

export const updateOrganizationInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Organization name must be at least 2 characters.")
      .max(120, "Organization name must be at most 120 characters.")
      .optional(),
    slug: slugSchema.optional()
  })
  .refine((data) => data.name !== undefined || data.slug !== undefined, {
    message: "At least one field must be provided to update the organization."
  });

export const upsertOrganizationMemberInputSchema = z.object({
  email: emailInputSchema,
  role: z.enum(["owner", "admin", "editor"])
});

export const createPublicationInputSchema = z.object({
  organizationId: uuidSchema,
  name: z
    .string()
    .trim()
    .min(2, "Publication name must be at least 2 characters.")
    .max(120, "Publication name must be at most 120 characters."),
  slug: slugSchema,
  description: z
    .string()
    .trim()
    .max(500, "Description must be at most 500 characters.")
    .nullable()
    .optional()
});

export const updatePublicationInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Publication name must be at least 2 characters.")
      .max(120, "Publication name must be at most 120 characters.")
      .optional(),
    slug: slugSchema.optional(),
    description: z
      .string()
      .trim()
      .max(500, "Description must be at most 500 characters.")
      .nullable()
      .optional()
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.slug !== undefined ||
      data.description !== undefined,
    {
      message: "At least one field must be provided to update the publication."
    }
  );

export const upsertPublicationMemberInputSchema = z.object({
  email: emailInputSchema,
  role: z.enum(["admin", "editor", "author"])
});

export const createArticleInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Article title is required.")
    .max(200, "Article title must be at most 200 characters."),
  slug: slugSchema.optional(),
  subtitle: z
    .string()
    .trim()
    .max(300, "Subtitle must be at most 300 characters.")
    .nullable()
    .optional(),
  excerpt: z
    .string()
    .trim()
    .max(500, "Excerpt must be at most 500 characters.")
    .nullable()
    .optional(),
  visibility: z.enum(["public", "members_only"]).default("public"),
  body: z.unknown().optional()
});

export const updateArticleInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Article title is required.")
    .max(200, "Article title must be at most 200 characters.")
    .optional(),
  slug: slugSchema.optional(),
  subtitle: z
    .string()
    .trim()
    .max(300, "Subtitle must be at most 300 characters.")
    .nullable()
    .optional(),
  excerpt: z
    .string()
    .trim()
    .max(500, "Excerpt must be at most 500 characters.")
    .nullable()
    .optional(),
  visibility: z.enum(["public", "members_only"]).optional(),
  body: z.unknown().optional()
});

export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
  role: OrganizationRole;
  publicationCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMemberView {
  userId: string;
  email: string;
  displayName: string | null;
  role: OrganizationRole;
  createdAt: Date;
}

export interface OrganizationPublicationItem {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationDetail {
  organization: {
    id: string;
    slug: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
  };
  role: OrganizationRole;
  members: OrganizationMemberView[];
  publications: OrganizationPublicationItem[];
}

export interface PublicationSummary {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  slug: string;
  name: string;
  description: string | null;
  effectiveRole: PublicationRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicationMemberView {
  userId: string;
  email: string;
  displayName: string | null;
  role: PublicationRole;
  createdAt: Date;
}

export interface PublicationDetail {
  publication: OrganizationPublicationItem;
  organization: {
    id: string;
    slug: string;
    name: string;
  };
  effectiveRole: PublicationRole;
  members: PublicationMemberView[];
}

export interface EditorialArticleSummary {
  id: string;
  publicationId: string;
  authorUserId: string;
  authorEmail: string;
  authorDisplayName: string | null;
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  status: ArticleStatus;
  visibility: ArticleVisibility;
  publishedAt: Date | null;
  unpublishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EditorialArticleDetail extends EditorialArticleSummary {
  body: ArticleDocument;
  html: string;
}

export interface PublicPublicationArticleItem {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  visibility: ArticleVisibility;
  publishedAt: Date | null;
  authorName: string;
}

export interface PublicPublicationDetail {
  publication: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    createdAt: Date;
  };
  articles: PublicPublicationArticleItem[];
}

export interface PublicArticleDetail {
  publication: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
  };
  article: {
    id: string;
    slug: string;
    title: string;
    subtitle: string | null;
    excerpt: string | null;
    visibility: ArticleVisibility;
    publishedAt: Date | null;
    authorName: string;
    html: string;
    isPaywalled: boolean;
    isEntitled: boolean;
  };
}

function parseInput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new PublishingError(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid request input.",
      400
    );
  }
  return parsed.data;
}

function parseUuid(value: string, label = "identifier"): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new PublishingError("VALIDATION_ERROR", `Invalid ${label}.`, 400);
  }
  return parsed.data;
}

function isPgUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

function derivePublicAuthorName(
  displayName: string | null,
  email: string
): string {
  const trimmedDisplay = displayName?.trim();
  if (trimmedDisplay && trimmedDisplay.length > 0) {
    return trimmedDisplay;
  }
  const prefix = email.split("@")[0]?.trim();
  return prefix && prefix.length > 0 ? prefix : "Publication Author";
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatEditorialSummary(
  row: ArticleRecord,
  author: { email: string; displayName: string | null }
): EditorialArticleSummary {
  return {
    id: row.id,
    publicationId: row.publicationId,
    authorUserId: row.authorUserId,
    authorEmail: author.email,
    authorDisplayName: author.displayName,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    excerpt: row.excerpt,
    status: row.status,
    visibility: row.visibility,
    publishedAt: row.publishedAt,
    unpublishedAt: row.unpublishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export class PublishingService {
  private readonly db: Database;
  private readonly entitlementChecker: EntitlementChecker;
  private readonly logger: StructuredLogger;

  constructor(config: PublishingServiceConfig) {
    this.db = config.db;
    this.entitlementChecker =
      config.entitlementChecker ?? defaultEntitlementChecker;
    this.logger = config.logger ?? createStructuredLogger();
  }

  public async createOrganization(
    actor: AuthenticatedActor,
    rawInput: { name: string; slug: string; ipAddress?: string }
  ): Promise<OrganizationSummary> {
    const input = parseInput(createOrganizationInputSchema, rawInput);

    const [existing] = await this.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, input.slug))
      .limit(1);

    if (existing) {
      throw new PublishingError(
        "CONFLICT",
        "An organization with this slug already exists.",
        409
      );
    }

    try {
      const created = await this.db.transaction(async (tx) => {
        const [org] = await tx
          .insert(organizations)
          .values({
            name: input.name,
            slug: input.slug
          })
          .returning();

        if (!org) {
          throw new Error("Failed to create organization record.");
        }

        await tx.insert(organizationMemberships).values({
          organizationId: org.id,
          userId: actor.id,
          role: "owner"
        });

        await tx.insert(auditLogs).values({
          actorUserId: actor.id,
          scopeType: "organization",
          scopeId: org.id,
          action: "organization.created",
          metadata: {
            slug: org.slug,
            name: org.name
          },
          ipAddress: rawInput.ipAddress ?? null
        });

        return org;
      });

      this.logger.info("publishing.organization.created", {
        organizationId: created.id,
        actorUserId: actor.id
      });

      return {
        id: created.id,
        slug: created.slug,
        name: created.name,
        role: "owner",
        publicationCount: 0,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt
      };
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        throw new PublishingError(
          "CONFLICT",
          "An organization with this slug already exists.",
          409
        );
      }
      throw err;
    }
  }

  public async listUserOrganizations(
    actor: AuthenticatedActor
  ): Promise<OrganizationSummary[]> {
    const rows = await this.db
      .select({
        org: organizations,
        role: organizationMemberships.role
      })
      .from(organizationMemberships)
      .innerJoin(
        organizations,
        eq(organizationMemberships.organizationId, organizations.id)
      )
      .where(eq(organizationMemberships.userId, actor.id))
      .orderBy(desc(organizations.createdAt));

    if (rows.length === 0) {
      return [];
    }

    const orgIds = rows.map((row) => row.org.id);
    const pubCounts = await this.db
      .select({
        organizationId: publications.organizationId,
        count: sql<number>`count(*)::int`
      })
      .from(publications)
      .where(inArray(publications.organizationId, orgIds))
      .groupBy(publications.organizationId);

    const countMap = new Map<string, number>();
    for (const item of pubCounts) {
      countMap.set(item.organizationId, Number(item.count));
    }

    return rows.map((row) => ({
      id: row.org.id,
      slug: row.org.slug,
      name: row.org.name,
      role: row.role,
      publicationCount: countMap.get(row.org.id) ?? 0,
      createdAt: row.org.createdAt,
      updatedAt: row.org.updatedAt
    }));
  }

  public async getOrganizationForActor(
    actor: AuthenticatedActor,
    organizationId: string
  ): Promise<OrganizationDetail> {
    const orgId = parseUuid(organizationId, "organization ID");
    const grant = await authorizeOrganizationRole(
      this.db,
      actor,
      orgId,
      "editor"
    );

    const [org] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org) {
      throw new PublishingError("NOT_FOUND", "Organization not found.", 404);
    }

    const memberRows = await this.db
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        role: organizationMemberships.role,
        createdAt: organizationMemberships.createdAt
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(organizationMemberships.userId, users.id))
      .where(eq(organizationMemberships.organizationId, orgId))
      .orderBy(organizationMemberships.createdAt);

    const pubRows = await this.db
      .select()
      .from(publications)
      .where(eq(publications.organizationId, orgId))
      .orderBy(desc(publications.createdAt));

    return {
      organization: {
        id: org.id,
        slug: org.slug,
        name: org.name,
        createdAt: org.createdAt,
        updatedAt: org.updatedAt
      },
      role: grant.role,
      members: memberRows,
      publications: pubRows.map((pub) => ({
        id: pub.id,
        organizationId: pub.organizationId,
        slug: pub.slug,
        name: pub.name,
        description: pub.description,
        createdAt: pub.createdAt,
        updatedAt: pub.updatedAt
      }))
    };
  }

  public async updateOrganization(
    actor: AuthenticatedActor,
    organizationId: string,
    rawInput: { name?: string; slug?: string; ipAddress?: string }
  ): Promise<OrganizationDetail["organization"]> {
    const orgId = parseUuid(organizationId, "organization ID");
    await authorizeOrganizationRole(this.db, actor, orgId, "admin");
    const input = parseInput(updateOrganizationInputSchema, rawInput);

    if (input.slug !== undefined) {
      const [conflict] = await this.db
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(eq(organizations.slug, input.slug), ne(organizations.id, orgId))
        )
        .limit(1);

      if (conflict) {
        throw new PublishingError(
          "CONFLICT",
          "An organization with this slug already exists.",
          409
        );
      }
    }

    const now = new Date();
    try {
      const updated = await this.db.transaction(async (tx) => {
        const [org] = await tx
          .update(organizations)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.slug !== undefined ? { slug: input.slug } : {}),
            updatedAt: now
          })
          .where(eq(organizations.id, orgId))
          .returning();

        if (!org) {
          throw new PublishingError("NOT_FOUND", "Organization not found.", 404);
        }

        await tx.insert(auditLogs).values({
          actorUserId: actor.id,
          scopeType: "organization",
          scopeId: org.id,
          action: "organization.updated",
          metadata: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.slug !== undefined ? { slug: input.slug } : {})
          },
          ipAddress: rawInput.ipAddress ?? null
        });

        return org;
      });

      this.logger.info("publishing.organization.updated", {
        organizationId: updated.id,
        actorUserId: actor.id
      });

      return updated;
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        throw new PublishingError(
          "CONFLICT",
          "An organization with this slug already exists.",
          409
        );
      }
      throw err;
    }
  }

  public async upsertOrganizationMember(
    actor: AuthenticatedActor,
    organizationId: string,
    rawInput: { email: string; role: OrganizationRole; ipAddress?: string }
  ): Promise<OrganizationMemberView> {
    const orgId = parseUuid(organizationId, "organization ID");
    await authorizeOrganizationRole(this.db, actor, orgId, "owner");
    const input = parseInput(upsertOrganizationMemberInputSchema, rawInput);
    const now = new Date();

    return await this.db.transaction(async (tx) => {
      let [targetUser] = await tx
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (!targetUser) {
        const [createdUser] = await tx
          .insert(users)
          .values({
            email: input.email,
            instanceRole: "user"
          })
          .returning();

        if (!createdUser) {
          throw new Error("Failed to provision user record.");
        }
        targetUser = createdUser;
      }

      const [existingMembership] = await tx
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, orgId),
            eq(organizationMemberships.userId, targetUser.id)
          )
        )
        .limit(1);

      if (
        existingMembership &&
        existingMembership.role === "owner" &&
        input.role !== "owner"
      ) {
        const owners = await tx
          .select({ id: organizationMemberships.id })
          .from(organizationMemberships)
          .where(
            and(
              eq(organizationMemberships.organizationId, orgId),
              eq(organizationMemberships.role, "owner")
            )
          );

        if (owners.length <= 1) {
          throw new PublishingError(
            "INVALID_STATE_TRANSITION",
            "Cannot demote the sole owner of an organization.",
            422
          );
        }
      }

      let memberRecord;
      if (existingMembership) {
        const [updated] = await tx
          .update(organizationMemberships)
          .set({
            role: input.role,
            updatedAt: now
          })
          .where(eq(organizationMemberships.id, existingMembership.id))
          .returning();
        memberRecord = updated;
      } else {
        const [inserted] = await tx
          .insert(organizationMemberships)
          .values({
            organizationId: orgId,
            userId: targetUser.id,
            role: input.role
          })
          .returning();
        memberRecord = inserted;
      }

      if (!memberRecord) {
        throw new Error("Failed to persist organization membership.");
      }

      await tx.insert(auditLogs).values({
        actorUserId: actor.id,
        scopeType: "organization",
        scopeId: orgId,
        action: "organization.member.upserted",
        metadata: {
          targetUserId: targetUser.id,
          role: input.role
        },
        ipAddress: rawInput.ipAddress ?? null
      });

      return {
        userId: targetUser.id,
        email: targetUser.email,
        displayName: targetUser.displayName,
        role: memberRecord.role,
        createdAt: memberRecord.createdAt
      };
    });
  }

  public async removeOrganizationMember(
    actor: AuthenticatedActor,
    organizationId: string,
    targetUserId: string,
    ipAddress?: string
  ): Promise<void> {
    const orgId = parseUuid(organizationId, "organization ID");
    const targetId = parseUuid(targetUserId, "user ID");
    await authorizeOrganizationRole(this.db, actor, orgId, "owner");

    await this.db.transaction(async (tx) => {
      const [existingMembership] = await tx
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, orgId),
            eq(organizationMemberships.userId, targetId)
          )
        )
        .limit(1);

      if (!existingMembership) {
        throw new PublishingError(
          "NOT_FOUND",
          "Organization member not found.",
          404
        );
      }

      if (existingMembership.role === "owner") {
        const owners = await tx
          .select({ id: organizationMemberships.id })
          .from(organizationMemberships)
          .where(
            and(
              eq(organizationMemberships.organizationId, orgId),
              eq(organizationMemberships.role, "owner")
            )
          );

        if (owners.length <= 1) {
          throw new PublishingError(
            "INVALID_STATE_TRANSITION",
            "Cannot remove the sole owner of an organization.",
            422
          );
        }
      }

      await tx
        .delete(organizationMemberships)
        .where(eq(organizationMemberships.id, existingMembership.id));

      await tx.insert(auditLogs).values({
        actorUserId: actor.id,
        scopeType: "organization",
        scopeId: orgId,
        action: "organization.member.removed",
        metadata: {
          targetUserId: targetId
        },
        ipAddress: ipAddress ?? null
      });
    });
  }

  public async createPublication(
    actor: AuthenticatedActor,
    rawInput: {
      organizationId: string;
      name: string;
      slug: string;
      description?: string | null;
      ipAddress?: string;
    }
  ): Promise<PublicationSummary> {
    const input = parseInput(createPublicationInputSchema, rawInput);
    await authorizeOrganizationRole(
      this.db,
      actor,
      input.organizationId,
      "admin"
    );

    const [org] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1);

    if (!org) {
      throw new PublishingError("NOT_FOUND", "Organization not found.", 404);
    }

    const [existingPub] = await this.db
      .select({ id: publications.id })
      .from(publications)
      .where(eq(publications.slug, input.slug))
      .limit(1);

    if (existingPub) {
      throw new PublishingError(
        "CONFLICT",
        "A publication with this slug already exists.",
        409
      );
    }

    const description = normalizeOptionalText(input.description) ?? null;

    try {
      const created = await this.db.transaction(async (tx) => {
        const [pub] = await tx
          .insert(publications)
          .values({
            organizationId: org.id,
            name: input.name,
            slug: input.slug,
            description
          })
          .returning();

        if (!pub) {
          throw new Error("Failed to create publication record.");
        }

        await tx.insert(publicationMemberships).values({
          publicationId: pub.id,
          userId: actor.id,
          role: "admin"
        });

        await tx.insert(auditLogs).values({
          actorUserId: actor.id,
          scopeType: "publication",
          scopeId: pub.id,
          action: "publication.created",
          metadata: {
            organizationId: org.id,
            slug: pub.slug,
            name: pub.name
          },
          ipAddress: rawInput.ipAddress ?? null
        });

        return pub;
      });

      this.logger.info("publishing.publication.created", {
        publicationId: created.id,
        organizationId: org.id,
        actorUserId: actor.id
      });

      return {
        id: created.id,
        organizationId: org.id,
        organizationName: org.name,
        organizationSlug: org.slug,
        slug: created.slug,
        name: created.name,
        description: created.description,
        effectiveRole: "admin",
        createdAt: created.createdAt,
        updatedAt: created.updatedAt
      };
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        throw new PublishingError(
          "CONFLICT",
          "A publication with this slug already exists.",
          409
        );
      }
      throw err;
    }
  }

  public async listUserPublications(
    actor: AuthenticatedActor,
    organizationId?: string
  ): Promise<PublicationSummary[]> {
    let scopedOrgId: string | undefined;
    if (organizationId !== undefined) {
      scopedOrgId = parseUuid(organizationId, "organization ID");
      await authorizeOrganizationRole(this.db, actor, scopedOrgId, "editor");
    }

    const directPubRows = await this.db
      .select({
        pub: publications,
        org: organizations,
        role: publicationMemberships.role
      })
      .from(publicationMemberships)
      .innerJoin(
        publications,
        eq(publicationMemberships.publicationId, publications.id)
      )
      .innerJoin(
        organizations,
        eq(publications.organizationId, organizations.id)
      )
      .where(
        scopedOrgId
          ? and(
              eq(publicationMemberships.userId, actor.id),
              eq(publications.organizationId, scopedOrgId)
            )
          : eq(publicationMemberships.userId, actor.id)
      );

    const orgMembershipRows = await this.db
      .select({
        organizationId: organizationMemberships.organizationId,
        role: organizationMemberships.role
      })
      .from(organizationMemberships)
      .where(
        scopedOrgId
          ? and(
              eq(organizationMemberships.userId, actor.id),
              eq(organizationMemberships.organizationId, scopedOrgId)
            )
          : eq(organizationMemberships.userId, actor.id)
      );

    const adminOrgIds = orgMembershipRows
      .filter((row) => row.role === "owner" || row.role === "admin")
      .map((row) => row.organizationId);

    const orgPubRows =
      adminOrgIds.length > 0
        ? await this.db
            .select({
              pub: publications,
              org: organizations
            })
            .from(publications)
            .innerJoin(
              organizations,
              eq(publications.organizationId, organizations.id)
            )
            .where(inArray(publications.organizationId, adminOrgIds))
        : [];

    const resultMap = new Map<string, PublicationSummary>();

    for (const row of directPubRows) {
      resultMap.set(row.pub.id, {
        id: row.pub.id,
        organizationId: row.org.id,
        organizationName: row.org.name,
        organizationSlug: row.org.slug,
        slug: row.pub.slug,
        name: row.pub.name,
        description: row.pub.description,
        effectiveRole: row.role,
        createdAt: row.pub.createdAt,
        updatedAt: row.pub.updatedAt
      });
    }

    for (const row of orgPubRows) {
      resultMap.set(row.pub.id, {
        id: row.pub.id,
        organizationId: row.org.id,
        organizationName: row.org.name,
        organizationSlug: row.org.slug,
        slug: row.pub.slug,
        name: row.pub.name,
        description: row.pub.description,
        effectiveRole: "admin",
        createdAt: row.pub.createdAt,
        updatedAt: row.pub.updatedAt
      });
    }

    return Array.from(resultMap.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  public async getPublicationForActor(
    actor: AuthenticatedActor,
    publicationId: string
  ): Promise<PublicationDetail> {
    const pubId = parseUuid(publicationId, "publication ID");
    const grant = await authorizePublicationRole(
      this.db,
      actor,
      pubId,
      "author"
    );

    const [row] = await this.db
      .select({
        pub: publications,
        org: organizations
      })
      .from(publications)
      .innerJoin(
        organizations,
        eq(publications.organizationId, organizations.id)
      )
      .where(eq(publications.id, pubId))
      .limit(1);

    if (!row) {
      throw new PublishingError("NOT_FOUND", "Publication not found.", 404);
    }

    const members = await this.db
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        role: publicationMemberships.role,
        createdAt: publicationMemberships.createdAt
      })
      .from(publicationMemberships)
      .innerJoin(users, eq(publicationMemberships.userId, users.id))
      .where(eq(publicationMemberships.publicationId, pubId))
      .orderBy(publicationMemberships.createdAt);

    return {
      publication: {
        id: row.pub.id,
        organizationId: row.pub.organizationId,
        slug: row.pub.slug,
        name: row.pub.name,
        description: row.pub.description,
        createdAt: row.pub.createdAt,
        updatedAt: row.pub.updatedAt
      },
      organization: {
        id: row.org.id,
        slug: row.org.slug,
        name: row.org.name
      },
      effectiveRole: grant.effectiveRole,
      members
    };
  }

  public async updatePublication(
    actor: AuthenticatedActor,
    publicationId: string,
    rawInput: {
      name?: string;
      slug?: string;
      description?: string | null;
      ipAddress?: string;
    }
  ): Promise<OrganizationPublicationItem> {
    const pubId = parseUuid(publicationId, "publication ID");
    await authorizePublicationRole(this.db, actor, pubId, "admin");
    const input = parseInput(updatePublicationInputSchema, rawInput);

    if (input.slug !== undefined) {
      const [conflict] = await this.db
        .select({ id: publications.id })
        .from(publications)
        .where(
          and(eq(publications.slug, input.slug), ne(publications.id, pubId))
        )
        .limit(1);

      if (conflict) {
        throw new PublishingError(
          "CONFLICT",
          "A publication with this slug already exists.",
          409
        );
      }
    }

    const normalizedDescription = normalizeOptionalText(input.description);
    const now = new Date();

    try {
      const updated = await this.db.transaction(async (tx) => {
        const [pub] = await tx
          .update(publications)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.slug !== undefined ? { slug: input.slug } : {}),
            ...(normalizedDescription !== undefined
              ? { description: normalizedDescription }
              : {}),
            updatedAt: now
          })
          .where(eq(publications.id, pubId))
          .returning();

        if (!pub) {
          throw new PublishingError("NOT_FOUND", "Publication not found.", 404);
        }

        await tx.insert(auditLogs).values({
          actorUserId: actor.id,
          scopeType: "publication",
          scopeId: pub.id,
          action: "publication.updated",
          metadata: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.slug !== undefined ? { slug: input.slug } : {})
          },
          ipAddress: rawInput.ipAddress ?? null
        });

        return pub;
      });

      this.logger.info("publishing.publication.updated", {
        publicationId: updated.id,
        actorUserId: actor.id
      });

      return updated;
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        throw new PublishingError(
          "CONFLICT",
          "A publication with this slug already exists.",
          409
        );
      }
      throw err;
    }
  }

  public async upsertPublicationMember(
    actor: AuthenticatedActor,
    publicationId: string,
    rawInput: { email: string; role: PublicationRole; ipAddress?: string }
  ): Promise<PublicationMemberView> {
    const pubId = parseUuid(publicationId, "publication ID");
    await authorizePublicationRole(this.db, actor, pubId, "admin");
    const input = parseInput(upsertPublicationMemberInputSchema, rawInput);
    const now = new Date();

    return await this.db.transaction(async (tx) => {
      let [targetUser] = await tx
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (!targetUser) {
        const [createdUser] = await tx
          .insert(users)
          .values({
            email: input.email,
            instanceRole: "user"
          })
          .returning();

        if (!createdUser) {
          throw new Error("Failed to provision user record.");
        }
        targetUser = createdUser;
      }

      const [existingMembership] = await tx
        .select()
        .from(publicationMemberships)
        .where(
          and(
            eq(publicationMemberships.publicationId, pubId),
            eq(publicationMemberships.userId, targetUser.id)
          )
        )
        .limit(1);

      let memberRecord;
      if (existingMembership) {
        const [updated] = await tx
          .update(publicationMemberships)
          .set({
            role: input.role,
            updatedAt: now
          })
          .where(eq(publicationMemberships.id, existingMembership.id))
          .returning();
        memberRecord = updated;
      } else {
        const [inserted] = await tx
          .insert(publicationMemberships)
          .values({
            publicationId: pubId,
            userId: targetUser.id,
            role: input.role
          })
          .returning();
        memberRecord = inserted;
      }

      if (!memberRecord) {
        throw new Error("Failed to persist publication membership.");
      }

      await tx.insert(auditLogs).values({
        actorUserId: actor.id,
        scopeType: "publication",
        scopeId: pubId,
        action: "publication.member.upserted",
        metadata: {
          targetUserId: targetUser.id,
          role: input.role
        },
        ipAddress: rawInput.ipAddress ?? null
      });

      return {
        userId: targetUser.id,
        email: targetUser.email,
        displayName: targetUser.displayName,
        role: memberRecord.role,
        createdAt: memberRecord.createdAt
      };
    });
  }

  public async removePublicationMember(
    actor: AuthenticatedActor,
    publicationId: string,
    targetUserId: string,
    ipAddress?: string
  ): Promise<void> {
    const pubId = parseUuid(publicationId, "publication ID");
    const targetId = parseUuid(targetUserId, "user ID");
    await authorizePublicationRole(this.db, actor, pubId, "admin");

    await this.db.transaction(async (tx) => {
      const [existingMembership] = await tx
        .select()
        .from(publicationMemberships)
        .where(
          and(
            eq(publicationMemberships.publicationId, pubId),
            eq(publicationMemberships.userId, targetId)
          )
        )
        .limit(1);

      if (!existingMembership) {
        throw new PublishingError(
          "NOT_FOUND",
          "Publication member not found.",
          404
        );
      }

      await tx
        .delete(publicationMemberships)
        .where(eq(publicationMemberships.id, existingMembership.id));

      await tx.insert(auditLogs).values({
        actorUserId: actor.id,
        scopeType: "publication",
        scopeId: pubId,
        action: "publication.member.removed",
        metadata: {
          targetUserId: targetId
        },
        ipAddress: ipAddress ?? null
      });
    });
  }

  public async createArticle(
    actor: AuthenticatedActor,
    publicationId: string,
    rawInput: {
      title: string;
      slug?: string;
      subtitle?: string | null;
      excerpt?: string | null;
      visibility?: ArticleVisibility;
      body?: unknown;
      ipAddress?: string;
    }
  ): Promise<EditorialArticleDetail> {
    const pubId = parseUuid(publicationId, "publication ID");
    await authorizePublicationRole(this.db, actor, pubId, "author");
    const input = parseInput(createArticleInputSchema, rawInput);

    const slug = input.slug ?? slugifyText(input.title);
    const validatedBody = validateArticleDocument(
      input.body ?? createEmptyArticleDocument()
    );

    const [conflict] = await this.db
      .select({ id: articles.id })
      .from(articles)
      .where(and(eq(articles.publicationId, pubId), eq(articles.slug, slug)))
      .limit(1);

    if (conflict) {
      throw new PublishingError(
        "CONFLICT",
        "An article with this slug already exists in this publication.",
        409
      );
    }

    const subtitle = normalizeOptionalText(input.subtitle) ?? null;
    const excerpt = normalizeOptionalText(input.excerpt) ?? null;

    try {
      const created = await this.db.transaction(async (tx) => {
        const [article] = await tx
          .insert(articles)
          .values({
            publicationId: pubId,
            authorUserId: actor.id,
            slug,
            title: input.title,
            subtitle,
            excerpt,
            body: validatedBody as unknown as Record<string, unknown>,
            status: "draft",
            visibility: input.visibility
          })
          .returning();

        if (!article) {
          throw new Error("Failed to create article record.");
        }

        await tx.insert(auditLogs).values({
          actorUserId: actor.id,
          scopeType: "publication",
          scopeId: pubId,
          action: "article.created",
          metadata: {
            articleId: article.id,
            slug: article.slug,
            visibility: article.visibility
          },
          ipAddress: rawInput.ipAddress ?? null
        });

        return article;
      });

      const [authorRow] = await this.db
        .select({ email: users.email, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, actor.id))
        .limit(1);

      this.logger.info("publishing.article.created", {
        publicationId: pubId,
        articleId: created.id,
        actorUserId: actor.id
      });

      return {
        ...formatEditorialSummary(created, {
          email: authorRow?.email ?? actor.email,
          displayName: authorRow?.displayName ?? null
        }),
        body: validatedBody,
        html: renderArticleDocumentToHtml(validatedBody)
      };
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        throw new PublishingError(
          "CONFLICT",
          "An article with this slug already exists in this publication.",
          409
        );
      }
      throw err;
    }
  }

  public async listEditorialArticles(
    actor: AuthenticatedActor,
    publicationId: string,
    filters?: { status?: ArticleStatus }
  ): Promise<EditorialArticleSummary[]> {
    const pubId = parseUuid(publicationId, "publication ID");
    await authorizePublicationRole(this.db, actor, pubId, "author");

    const whereClause =
      filters?.status !== undefined
        ? and(
            eq(articles.publicationId, pubId),
            eq(articles.status, filters.status)
          )
        : eq(articles.publicationId, pubId);

    const rows = await this.db
      .select({
        article: articles,
        authorEmail: users.email,
        authorDisplayName: users.displayName
      })
      .from(articles)
      .innerJoin(users, eq(articles.authorUserId, users.id))
      .where(whereClause)
      .orderBy(desc(articles.updatedAt), desc(articles.createdAt));

    return rows.map((row) =>
      formatEditorialSummary(row.article, {
        email: row.authorEmail,
        displayName: row.authorDisplayName
      })
    );
  }

  public async getEditorialArticle(
    actor: AuthenticatedActor,
    publicationId: string,
    articleId: string
  ): Promise<EditorialArticleDetail> {
    const pubId = parseUuid(publicationId, "publication ID");
    const artId = parseUuid(articleId, "article ID");
    await authorizePublicationRole(this.db, actor, pubId, "author");

    const [row] = await this.db
      .select({
        article: articles,
        authorEmail: users.email,
        authorDisplayName: users.displayName
      })
      .from(articles)
      .innerJoin(users, eq(articles.authorUserId, users.id))
      .where(and(eq(articles.id, artId), eq(articles.publicationId, pubId)))
      .limit(1);

    if (!row) {
      throw new PublishingError("NOT_FOUND", "Article not found.", 404);
    }

    const validatedBody = validateArticleDocument(row.article.body);

    return {
      ...formatEditorialSummary(row.article, {
        email: row.authorEmail,
        displayName: row.authorDisplayName
      }),
      body: validatedBody,
      html: renderArticleDocumentToHtml(validatedBody)
    };
  }

  public async updateArticle(
    actor: AuthenticatedActor,
    publicationId: string,
    articleId: string,
    rawInput: {
      title?: string;
      slug?: string;
      subtitle?: string | null;
      excerpt?: string | null;
      visibility?: ArticleVisibility;
      body?: unknown;
      ipAddress?: string;
    }
  ): Promise<EditorialArticleDetail> {
    const pubId = parseUuid(publicationId, "publication ID");
    const artId = parseUuid(articleId, "article ID");
    const grant = await authorizePublicationRole(
      this.db,
      actor,
      pubId,
      "author"
    );

    const [existing] = await this.db
      .select()
      .from(articles)
      .where(and(eq(articles.id, artId), eq(articles.publicationId, pubId)))
      .limit(1);

    if (!existing) {
      throw new PublishingError("NOT_FOUND", "Article not found.", 404);
    }

    if (
      grant.effectiveRole === "author" &&
      existing.authorUserId !== actor.id
    ) {
      throw new AuthError(
        "FORBIDDEN",
        "Authors may only edit their own articles.",
        403
      );
    }

    const input = parseInput(updateArticleInputSchema, rawInput);
    const validatedBody =
      input.body !== undefined
        ? validateArticleDocument(input.body)
        : validateArticleDocument(existing.body);

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const [conflict] = await this.db
        .select({ id: articles.id })
        .from(articles)
        .where(
          and(
            eq(articles.publicationId, pubId),
            eq(articles.slug, input.slug),
            ne(articles.id, artId)
          )
        )
        .limit(1);

      if (conflict) {
        throw new PublishingError(
          "CONFLICT",
          "An article with this slug already exists in this publication.",
          409
        );
      }
    }

    const subtitle = normalizeOptionalText(input.subtitle);
    const excerpt = normalizeOptionalText(input.excerpt);
    const now = new Date();

    try {
      const updated = await this.db.transaction(async (tx) => {
        const [article] = await tx
          .update(articles)
          .set({
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.slug !== undefined ? { slug: input.slug } : {}),
            ...(subtitle !== undefined ? { subtitle } : {}),
            ...(excerpt !== undefined ? { excerpt } : {}),
            ...(input.visibility !== undefined
              ? { visibility: input.visibility }
              : {}),
            ...(input.body !== undefined
              ? { body: validatedBody as unknown as Record<string, unknown> }
              : {}),
            updatedAt: now
          })
          .where(and(eq(articles.id, artId), eq(articles.publicationId, pubId)))
          .returning();

        if (!article) {
          throw new PublishingError("NOT_FOUND", "Article not found.", 404);
        }

        await tx.insert(auditLogs).values({
          actorUserId: actor.id,
          scopeType: "publication",
          scopeId: pubId,
          action: "article.updated",
          metadata: {
            articleId: article.id,
            slug: article.slug,
            visibility: article.visibility
          },
          ipAddress: rawInput.ipAddress ?? null
        });

        return article;
      });

      const [authorRow] = await this.db
        .select({ email: users.email, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, updated.authorUserId))
        .limit(1);

      this.logger.info("publishing.article.updated", {
        publicationId: pubId,
        articleId: updated.id,
        actorUserId: actor.id
      });

      return {
        ...formatEditorialSummary(updated, {
          email: authorRow?.email ?? actor.email,
          displayName: authorRow?.displayName ?? null
        }),
        body: validatedBody,
        html: renderArticleDocumentToHtml(validatedBody)
      };
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        throw new PublishingError(
          "CONFLICT",
          "An article with this slug already exists in this publication.",
          409
        );
      }
      throw err;
    }
  }

  public async publishArticle(
    actor: AuthenticatedActor,
    publicationId: string,
    articleId: string,
    ipAddress?: string
  ): Promise<EditorialArticleDetail> {
    const pubId = parseUuid(publicationId, "publication ID");
    const artId = parseUuid(articleId, "article ID");
    await authorizePublicationRole(this.db, actor, pubId, "editor");

    const [existing] = await this.db
      .select()
      .from(articles)
      .where(and(eq(articles.id, artId), eq(articles.publicationId, pubId)))
      .limit(1);

    if (!existing) {
      throw new PublishingError("NOT_FOUND", "Article not found.", 404);
    }

    if (existing.title.trim().length === 0) {
      throw new PublishingError(
        "VALIDATION_ERROR",
        "Article title must not be empty before publishing.",
        400
      );
    }

    const validatedBody = validateArticleDocument(existing.body);
    const now = new Date();

    const updated = await this.db.transaction(async (tx) => {
      const [article] = await tx
        .update(articles)
        .set({
          status: "published",
          publishedAt: existing.publishedAt ?? now,
          unpublishedAt: null,
          updatedAt: now
        })
        .where(and(eq(articles.id, artId), eq(articles.publicationId, pubId)))
        .returning();

      if (!article) {
        throw new PublishingError("NOT_FOUND", "Article not found.", 404);
      }

      await tx.insert(auditLogs).values({
        actorUserId: actor.id,
        scopeType: "publication",
        scopeId: pubId,
        action: "article.published",
        metadata: {
          articleId: article.id,
          slug: article.slug,
          visibility: article.visibility
        },
        ipAddress: ipAddress ?? null
      });

      return article;
    });

    const [authorRow] = await this.db
      .select({ email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, updated.authorUserId))
      .limit(1);

    this.logger.info("publishing.article.published", {
      publicationId: pubId,
      articleId: updated.id,
      actorUserId: actor.id
    });

    return {
      ...formatEditorialSummary(updated, {
        email: authorRow?.email ?? actor.email,
        displayName: authorRow?.displayName ?? null
      }),
      body: validatedBody,
      html: renderArticleDocumentToHtml(validatedBody)
    };
  }

  public async unpublishArticle(
    actor: AuthenticatedActor,
    publicationId: string,
    articleId: string,
    ipAddress?: string
  ): Promise<EditorialArticleDetail> {
    const pubId = parseUuid(publicationId, "publication ID");
    const artId = parseUuid(articleId, "article ID");
    await authorizePublicationRole(this.db, actor, pubId, "editor");

    const [existing] = await this.db
      .select()
      .from(articles)
      .where(and(eq(articles.id, artId), eq(articles.publicationId, pubId)))
      .limit(1);

    if (!existing) {
      throw new PublishingError("NOT_FOUND", "Article not found.", 404);
    }

    if (existing.status !== "published") {
      throw new PublishingError(
        "INVALID_STATE_TRANSITION",
        "Only published articles can be unpublished.",
        422
      );
    }

    const validatedBody = validateArticleDocument(existing.body);
    const now = new Date();

    const updated = await this.db.transaction(async (tx) => {
      const [article] = await tx
        .update(articles)
        .set({
          status: "unpublished",
          unpublishedAt: now,
          updatedAt: now
        })
        .where(and(eq(articles.id, artId), eq(articles.publicationId, pubId)))
        .returning();

      if (!article) {
        throw new PublishingError("NOT_FOUND", "Article not found.", 404);
      }

      await tx.insert(auditLogs).values({
        actorUserId: actor.id,
        scopeType: "publication",
        scopeId: pubId,
        action: "article.unpublished",
        metadata: {
          articleId: article.id,
          slug: article.slug
        },
        ipAddress: ipAddress ?? null
      });

      return article;
    });

    const [authorRow] = await this.db
      .select({ email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, updated.authorUserId))
      .limit(1);

    this.logger.info("publishing.article.unpublished", {
      publicationId: pubId,
      articleId: updated.id,
      actorUserId: actor.id
    });

    return {
      ...formatEditorialSummary(updated, {
        email: authorRow?.email ?? actor.email,
        displayName: authorRow?.displayName ?? null
      }),
      body: validatedBody,
      html: renderArticleDocumentToHtml(validatedBody)
    };
  }

  public async deleteArticle(
    actor: AuthenticatedActor,
    publicationId: string,
    articleId: string,
    ipAddress?: string
  ): Promise<void> {
    const pubId = parseUuid(publicationId, "publication ID");
    const artId = parseUuid(articleId, "article ID");
    const grant = await authorizePublicationRole(
      this.db,
      actor,
      pubId,
      "author"
    );

    const [existing] = await this.db
      .select()
      .from(articles)
      .where(and(eq(articles.id, artId), eq(articles.publicationId, pubId)))
      .limit(1);

    if (!existing) {
      throw new PublishingError("NOT_FOUND", "Article not found.", 404);
    }

    if (
      grant.effectiveRole === "author" &&
      (existing.authorUserId !== actor.id || existing.status !== "draft")
    ) {
      throw new AuthError(
        "FORBIDDEN",
        "Authors may only delete their own draft articles.",
        403
      );
    }

    await this.db.transaction(async (tx) => {
      await tx
        .delete(articles)
        .where(and(eq(articles.id, artId), eq(articles.publicationId, pubId)));

      await tx.insert(auditLogs).values({
        actorUserId: actor.id,
        scopeType: "publication",
        scopeId: pubId,
        action: "article.deleted",
        metadata: {
          articleId: existing.id,
          slug: existing.slug
        },
        ipAddress: ipAddress ?? null
      });
    });

    this.logger.info("publishing.article.deleted", {
      publicationId: pubId,
      articleId: existing.id,
      actorUserId: actor.id
    });
  }

  public async getPublicPublicationBySlug(
    publicationSlug: string
  ): Promise<PublicPublicationDetail> {
    const normalizedSlug = publicationSlug.trim().toLowerCase();
    if (!normalizedSlug || normalizedSlug.length > 120) {
      throw new PublishingError("NOT_FOUND", "Publication not found.", 404);
    }

    const [pub] = await this.db
      .select()
      .from(publications)
      .where(eq(publications.slug, normalizedSlug))
      .limit(1);

    if (!pub) {
      throw new PublishingError("NOT_FOUND", "Publication not found.", 404);
    }

    const rows = await this.db
      .select({
        article: articles,
        authorDisplayName: users.displayName,
        authorEmail: users.email
      })
      .from(articles)
      .innerJoin(users, eq(articles.authorUserId, users.id))
      .where(
        and(
          eq(articles.publicationId, pub.id),
          eq(articles.status, "published")
        )
      )
      .orderBy(desc(articles.publishedAt), desc(articles.createdAt));

    return {
      publication: {
        id: pub.id,
        slug: pub.slug,
        name: pub.name,
        description: pub.description,
        createdAt: pub.createdAt
      },
      articles: rows.map((row) => ({
        id: row.article.id,
        slug: row.article.slug,
        title: row.article.title,
        subtitle: row.article.subtitle,
        excerpt: row.article.excerpt,
        visibility: row.article.visibility,
        publishedAt: row.article.publishedAt,
        authorName: derivePublicAuthorName(
          row.authorDisplayName,
          row.authorEmail
        )
      }))
    };
  }

  public async getPublicArticleBySlug(
    publicationSlug: string,
    articleSlug: string,
    viewerUserId?: string | null
  ): Promise<PublicArticleDetail> {
    const normalizedPubSlug = publicationSlug.trim().toLowerCase();
    const normalizedArtSlug = articleSlug.trim().toLowerCase();

    if (
      !normalizedPubSlug ||
      normalizedPubSlug.length > 120 ||
      !normalizedArtSlug ||
      normalizedArtSlug.length > 120
    ) {
      throw new PublishingError("NOT_FOUND", "Article not found.", 404);
    }

    const [pub] = await this.db
      .select()
      .from(publications)
      .where(eq(publications.slug, normalizedPubSlug))
      .limit(1);

    if (!pub) {
      throw new PublishingError("NOT_FOUND", "Publication not found.", 404);
    }

    const [row] = await this.db
      .select({
        article: articles,
        authorDisplayName: users.displayName,
        authorEmail: users.email
      })
      .from(articles)
      .innerJoin(users, eq(articles.authorUserId, users.id))
      .where(
        and(
          eq(articles.publicationId, pub.id),
          eq(articles.slug, normalizedArtSlug),
          eq(articles.status, "published")
        )
      )
      .limit(1);

    if (!row) {
      throw new PublishingError("NOT_FOUND", "Article not found.", 404);
    }

    let isEntitled = row.article.visibility === "public";
    if (!isEntitled && viewerUserId) {
      isEntitled = await this.entitlementChecker.hasPublicationEntitlement({
        userId: viewerUserId,
        publicationId: pub.id
      });
    }

    const validatedDoc = validateArticleDocument(row.article.body);
    const stripped = stripRestrictedNodesForUnentitledReader(
      validatedDoc,
      row.article.visibility,
      isEntitled
    );
    const html = renderArticleDocumentToHtml(stripped.document);

    return {
      publication: {
        id: pub.id,
        slug: pub.slug,
        name: pub.name,
        description: pub.description
      },
      article: {
        id: row.article.id,
        slug: row.article.slug,
        title: row.article.title,
        subtitle: row.article.subtitle,
        excerpt: row.article.excerpt,
        visibility: row.article.visibility,
        publishedAt: row.article.publishedAt,
        authorName: derivePublicAuthorName(
          row.authorDisplayName,
          row.authorEmail
        ),
        html,
        isPaywalled: stripped.isPaywalled,
        isEntitled
      }
    };
  }
}
