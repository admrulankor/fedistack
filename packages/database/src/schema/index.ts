import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const instanceRoleEnum = pgEnum("instance_role", [
  "instance_admin",
  "user"
]);

export const organizationRoleEnum = pgEnum("organization_role", [
  "owner",
  "admin",
  "editor"
]);

export const publicationRoleEnum = pgEnum("publication_role", [
  "admin",
  "editor",
  "author"
]);

export const auditScopeTypeEnum = pgEnum("audit_scope_type", [
  "instance",
  "organization",
  "publication"
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    instanceRole: instanceRoleEnum("instance_role").notNull().default("user"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [uniqueIndex("users_email_unique_idx").on(table.email)]
);

export const authMagicLinkTokens = pgTable(
  "auth_magic_link_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    requestIp: text("request_ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex("auth_magic_link_tokens_hash_unique_idx").on(table.tokenHash),
    index("auth_magic_link_tokens_email_idx").on(table.email)
  ]
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionTokenHash: text("session_token_hash").notNull(),
    csrfTokenHash: text("csrf_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_unique_idx").on(
      table.sessionTokenHash
    ),
    index("auth_sessions_user_id_idx").on(table.userId)
  ]
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [uniqueIndex("organizations_slug_unique_idx").on(table.slug)]
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: organizationRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex("organization_memberships_org_user_unique_idx").on(
      table.organizationId,
      table.userId
    ),
    index("organization_memberships_user_id_idx").on(table.userId)
  ]
);

export const publications = pgTable(
  "publications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex("publications_slug_unique_idx").on(table.slug),
    index("publications_organization_id_idx").on(table.organizationId)
  ]
);

export const publicationMemberships = pgTable(
  "publication_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: publicationRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex("publication_memberships_pub_user_unique_idx").on(
      table.publicationId,
      table.userId
    ),
    index("publication_memberships_user_id_idx").on(table.userId)
  ]
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    scopeType: auditScopeTypeEnum("scope_type").notNull(),
    scopeId: uuid("scope_id"),
    action: text("action").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index("audit_logs_scope_idx").on(table.scopeType, table.scopeId),
    index("audit_logs_actor_idx").on(table.actorUserId)
  ]
);

export type UserRecord = typeof users.$inferSelect;
export type NewUserRecord = typeof users.$inferInsert;
export type AuthMagicLinkTokenRecord = typeof authMagicLinkTokens.$inferSelect;
export type AuthSessionRecord = typeof authSessions.$inferSelect;
export type OrganizationRecord = typeof organizations.$inferSelect;
export type OrganizationMembershipRecord =
  typeof organizationMemberships.$inferSelect;
export type PublicationRecord = typeof publications.$inferSelect;
export type PublicationMembershipRecord =
  typeof publicationMemberships.$inferSelect;
export type AuditLogRecord = typeof auditLogs.$inferSelect;
