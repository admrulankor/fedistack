import {
  type Database,
  organizationMemberships,
  publications,
  publicationMemberships
} from "@fedistack/database";
import { and, eq } from "drizzle-orm";
import { AuthError } from "./errors.js";

export type InstanceRole = "instance_admin" | "user";
export type OrganizationRole = "owner" | "admin" | "editor";
export type PublicationRole = "admin" | "editor" | "author";

const ORGANIZATION_ROLE_WEIGHT: Record<OrganizationRole, number> = {
  owner: 30,
  admin: 20,
  editor: 10
};

const PUBLICATION_ROLE_WEIGHT: Record<PublicationRole, number> = {
  admin: 30,
  editor: 20,
  author: 10
};

export interface AuthenticatedActor {
  id: string;
  email: string;
  instanceRole: InstanceRole;
}

export function hasOrganizationRole(
  actualRole: OrganizationRole,
  minimumRole: OrganizationRole
): boolean {
  return (
    ORGANIZATION_ROLE_WEIGHT[actualRole] >=
    ORGANIZATION_ROLE_WEIGHT[minimumRole]
  );
}

export function hasPublicationRole(
  actualRole: PublicationRole,
  minimumRole: PublicationRole
): boolean {
  return (
    PUBLICATION_ROLE_WEIGHT[actualRole] >= PUBLICATION_ROLE_WEIGHT[minimumRole]
  );
}

/**
 * Enforces that the authenticated actor holds the `instance_admin` role.
 */
export function authorizeInstanceAdmin(actor: AuthenticatedActor): void {
  if (actor.instanceRole !== "instance_admin") {
    throw new AuthError(
      "FORBIDDEN",
      "Instance administrator privileges are required for this operation.",
      403
    );
  }
}

/**
 * Enforces that the authenticated actor holds at least `minimumRole` within the
 * specified organization. Strictly isolates organization boundaries.
 */
export async function authorizeOrganizationRole(
  db: Database,
  actor: AuthenticatedActor,
  organizationId: string,
  minimumRole: OrganizationRole
): Promise<{ organizationId: string; role: OrganizationRole }> {
  const [membership] = await db
    .select({
      organizationId: organizationMemberships.organizationId,
      role: organizationMemberships.role
    })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, actor.id)
      )
    )
    .limit(1);

  if (!membership || !hasOrganizationRole(membership.role, minimumRole)) {
    throw new AuthError(
      "FORBIDDEN",
      "You do not have sufficient permissions for this organization.",
      403
    );
  }

  return membership;
}

/**
 * Enforces that the authenticated actor holds at least `minimumRole` within the
 * specified publication (either via direct publication membership or as an
 * `owner`/`admin` of the publication's parent organization).
 *
 * If `expectedOrganizationId` is provided, also verifies the publication belongs
 * to that organization to prevent cross-tenant parameter tampering.
 */
export async function authorizePublicationRole(
  db: Database,
  actor: AuthenticatedActor,
  publicationId: string,
  minimumRole: PublicationRole,
  expectedOrganizationId?: string
): Promise<{
  publicationId: string;
  organizationId: string;
  effectiveRole: PublicationRole;
}> {
  const [publication] = await db
    .select({
      id: publications.id,
      organizationId: publications.organizationId
    })
    .from(publications)
    .where(eq(publications.id, publicationId))
    .limit(1);

  if (
    !publication ||
    (expectedOrganizationId !== undefined &&
      publication.organizationId !== expectedOrganizationId)
  ) {
    throw new AuthError(
      "FORBIDDEN",
      "You do not have sufficient permissions for this publication.",
      403
    );
  }

  const [pubMembership] = await db
    .select({
      role: publicationMemberships.role
    })
    .from(publicationMemberships)
    .where(
      and(
        eq(publicationMemberships.publicationId, publication.id),
        eq(publicationMemberships.userId, actor.id)
      )
    )
    .limit(1);

  if (pubMembership && hasPublicationRole(pubMembership.role, minimumRole)) {
    return {
      publicationId: publication.id,
      organizationId: publication.organizationId,
      effectiveRole: pubMembership.role
    };
  }

  // Organization owners and admins hold administrative authority over their organization's publications
  const [orgMembership] = await db
    .select({
      role: organizationMemberships.role
    })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, publication.organizationId),
        eq(organizationMemberships.userId, actor.id)
      )
    )
    .limit(1);

  if (
    orgMembership &&
    (orgMembership.role === "owner" || orgMembership.role === "admin")
  ) {
    return {
      publicationId: publication.id,
      organizationId: publication.organizationId,
      effectiveRole: "admin"
    };
  }

  throw new AuthError(
    "FORBIDDEN",
    "You do not have sufficient permissions for this publication.",
    403
  );
}
