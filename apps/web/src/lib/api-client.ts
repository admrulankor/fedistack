import { z } from "zod";
import { articleDocumentSchema } from "./article-document";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const organizationRoleSchema = z.enum(["owner", "admin", "editor"]);
export const publicationRoleSchema = z.enum(["admin", "editor", "author"]);
export const articleStatusSchema = z.enum([
  "draft",
  "published",
  "unpublished"
]);
export const articleVisibilitySchema = z.enum(["public", "members_only"]);

export type OrganizationRole = z.infer<typeof organizationRoleSchema>;
export type PublicationRole = z.infer<typeof publicationRoleSchema>;
export type ArticleStatus = z.infer<typeof articleStatusSchema>;
export type ArticleVisibility = z.infer<typeof articleVisibilitySchema>;

export const sessionPayloadSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string().nullable(),
    instanceRole: z.enum(["instance_admin", "user"]),
    emailVerifiedAt: z.string().nullable()
  }),
  scopes: z.object({
    organizations: z.array(
      z.object({
        organizationId: z.string().uuid(),
        role: organizationRoleSchema
      })
    ),
    publications: z.array(
      z.object({
        publicationId: z.string().uuid(),
        role: publicationRoleSchema
      })
    )
  }),
  csrfToken: z.string().min(1),
  expiresAt: z.string()
});

export type SessionPayload = z.infer<typeof sessionPayloadSchema>;

export const organizationSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  role: organizationRoleSchema,
  publicationCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const organizationMemberSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  role: organizationRoleSchema,
  createdAt: z.string()
});

export const organizationPublicationItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const organizationDetailSchema = z.object({
  organization: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
  }),
  role: organizationRoleSchema,
  members: z.array(organizationMemberSchema),
  publications: z.array(organizationPublicationItemSchema)
});

export type OrganizationDetail = z.infer<typeof organizationDetailSchema>;

export const publicationSummarySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  organizationName: z.string(),
  organizationSlug: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  effectiveRole: publicationRoleSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});

export type PublicationSummary = z.infer<typeof publicationSummarySchema>;

export const publicationMemberSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  role: publicationRoleSchema,
  createdAt: z.string()
});

export const publicationDetailSchema = z.object({
  publication: organizationPublicationItemSchema,
  organization: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string()
  }),
  effectiveRole: publicationRoleSchema,
  members: z.array(publicationMemberSchema)
});

export type PublicationDetail = z.infer<typeof publicationDetailSchema>;

export const editorialArticleSummarySchema = z.object({
  id: z.string().uuid(),
  publicationId: z.string().uuid(),
  authorUserId: z.string().uuid(),
  authorEmail: z.string().email(),
  authorDisplayName: z.string().nullable(),
  slug: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  excerpt: z.string().nullable(),
  status: articleStatusSchema,
  visibility: articleVisibilitySchema,
  publishedAt: z.string().nullable(),
  unpublishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type EditorialArticleSummary = z.infer<
  typeof editorialArticleSummarySchema
>;

export const editorialArticleDetailSchema = editorialArticleSummarySchema.extend({
  body: articleDocumentSchema,
  html: z.string()
});

export type EditorialArticleDetail = z.infer<
  typeof editorialArticleDetailSchema
>;

export const publicPublicationDetailSchema = z.object({
  publication: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    createdAt: z.string()
  }),
  articles: z.array(
    z.object({
      id: z.string().uuid(),
      slug: z.string(),
      title: z.string(),
      subtitle: z.string().nullable(),
      excerpt: z.string().nullable(),
      visibility: articleVisibilitySchema,
      publishedAt: z.string().nullable(),
      authorName: z.string()
    })
  )
});

export type PublicPublicationDetail = z.infer<
  typeof publicPublicationDetailSchema
>;

export const publicArticleDetailSchema = z.object({
  publication: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable()
  }),
  article: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    subtitle: z.string().nullable(),
    excerpt: z.string().nullable(),
    visibility: articleVisibilitySchema,
    publishedAt: z.string().nullable(),
    authorName: z.string(),
    html: z.string(),
    isPaywalled: z.boolean(),
    isEntitled: z.boolean()
  })
});

export type PublicArticleDetail = z.infer<typeof publicArticleDetailSchema>;

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(message: string, status: number, code = "API_ERROR") {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string()
  })
});

async function parseErrorResponse(
  response: Response,
  fallback: string
): Promise<ApiClientError> {
  try {
    const data: unknown = await response.json();
    const parsed = apiErrorSchema.safeParse(data);
    if (parsed.success) {
      return new ApiClientError(
        parsed.data.error.message,
        response.status,
        parsed.data.error.code
      );
    }
  } catch {
    // Ignore parse error and return fallback
  }
  return new ApiClientError(fallback, response.status);
}

async function requestJson<T>(
  path: string,
  schema: z.ZodType<T>,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    csrfToken?: string;
    body?: unknown;
    fallbackError?: string;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.csrfToken) {
    headers["X-CSRF-Token"] = options.csrfToken;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    credentials: "include",
    cache: "no-store",
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {})
  });

  if (!response.ok) {
    throw await parseErrorResponse(
      response,
      options.fallbackError ?? "Request failed."
    );
  }

  const json: unknown = await response.json();
  return schema.parse(json);
}

export async function requestMagicLinkApi(
  email: string
): Promise<{ message: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/auth/magic-link/request`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({ email })
    }
  );

  if (!response.ok) {
    throw await parseErrorResponse(
      response,
      "Unable to send magic link. Please try again."
    );
  }

  const body = (await response.json()) as { message?: string };
  return {
    message:
      body.message ??
      "If the email address is valid, a sign-in link has been dispatched."
  };
}

export async function verifyMagicLinkApi(
  token: string
): Promise<SessionPayload> {
  return requestJson("/api/v1/auth/magic-link/verify", sessionPayloadSchema, {
    method: "POST",
    body: { token },
    fallbackError: "The sign-in link is invalid or has expired."
  });
}

export async function fetchCurrentSessionApi(): Promise<SessionPayload | null> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/session`, {
    method: "GET",
    credentials: "include",
    cache: "no-store"
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Failed to load authentication session.");
  }

  const json: unknown = await response.json();
  return sessionPayloadSchema.parse(json);
}

export async function logoutSessionApi(csrfToken: string): Promise<void> {
  await requestJson("/api/v1/auth/logout", z.object({ ok: z.boolean() }), {
    method: "POST",
    csrfToken,
    fallbackError: "Failed to sign out cleanly."
  });
}

export async function listOrganizationsApi(): Promise<OrganizationSummary[]> {
  const data = await requestJson(
    "/api/v1/organizations",
    z.object({ organizations: z.array(organizationSummarySchema) }),
    { fallbackError: "Failed to load organizations." }
  );
  return data.organizations;
}

export async function createOrganizationApi(
  csrfToken: string,
  input: { name: string; slug: string }
): Promise<OrganizationSummary> {
  const data = await requestJson(
    "/api/v1/organizations",
    z.object({ organization: organizationSummarySchema }),
    {
      method: "POST",
      csrfToken,
      body: input,
      fallbackError: "Failed to create organization."
    }
  );
  return data.organization;
}

export async function getOrganizationDetailApi(
  organizationId: string
): Promise<OrganizationDetail> {
  return requestJson(
    `/api/v1/organizations/${encodeURIComponent(organizationId)}`,
    organizationDetailSchema,
    { fallbackError: "Failed to load organization details." }
  );
}

export async function updateOrganizationApi(
  csrfToken: string,
  organizationId: string,
  input: { name?: string; slug?: string }
): Promise<void> {
  await requestJson(
    `/api/v1/organizations/${encodeURIComponent(organizationId)}`,
    z.object({ organization: z.unknown() }),
    {
      method: "PATCH",
      csrfToken,
      body: input,
      fallbackError: "Failed to update organization."
    }
  );
}

export async function upsertOrganizationMemberApi(
  csrfToken: string,
  organizationId: string,
  input: { email: string; role: OrganizationRole }
): Promise<void> {
  await requestJson(
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/members`,
    z.object({ member: organizationMemberSchema }),
    {
      method: "POST",
      csrfToken,
      body: input,
      fallbackError: "Failed to add or update organization member."
    }
  );
}

export async function removeOrganizationMemberApi(
  csrfToken: string,
  organizationId: string,
  userId: string
): Promise<void> {
  await requestJson(
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
    z.object({ ok: z.boolean() }),
    {
      method: "DELETE",
      csrfToken,
      fallbackError: "Failed to remove organization member."
    }
  );
}

export async function listPublicationsApi(
  organizationId?: string
): Promise<PublicationSummary[]> {
  const query = organizationId
    ? `?organizationId=${encodeURIComponent(organizationId)}`
    : "";
  const data = await requestJson(
    `/api/v1/publications${query}`,
    z.object({ publications: z.array(publicationSummarySchema) }),
    { fallbackError: "Failed to load publications." }
  );
  return data.publications;
}

export async function createPublicationApi(
  csrfToken: string,
  input: {
    organizationId: string;
    name: string;
    slug: string;
    description?: string | null;
  }
): Promise<PublicationSummary> {
  const data = await requestJson(
    "/api/v1/publications",
    z.object({ publication: publicationSummarySchema }),
    {
      method: "POST",
      csrfToken,
      body: input,
      fallbackError: "Failed to create publication."
    }
  );
  return data.publication;
}

export async function getPublicationDetailApi(
  publicationId: string
): Promise<PublicationDetail> {
  return requestJson(
    `/api/v1/publications/${encodeURIComponent(publicationId)}`,
    publicationDetailSchema,
    { fallbackError: "Failed to load publication details." }
  );
}

export async function updatePublicationApi(
  csrfToken: string,
  publicationId: string,
  input: { name?: string; slug?: string; description?: string | null }
): Promise<void> {
  await requestJson(
    `/api/v1/publications/${encodeURIComponent(publicationId)}`,
    z.object({ publication: organizationPublicationItemSchema }),
    {
      method: "PATCH",
      csrfToken,
      body: input,
      fallbackError: "Failed to update publication."
    }
  );
}

export async function upsertPublicationMemberApi(
  csrfToken: string,
  publicationId: string,
  input: { email: string; role: PublicationRole }
): Promise<void> {
  await requestJson(
    `/api/v1/publications/${encodeURIComponent(publicationId)}/members`,
    z.object({ member: publicationMemberSchema }),
    {
      method: "POST",
      csrfToken,
      body: input,
      fallbackError: "Failed to add or update publication member."
    }
  );
}

export async function removePublicationMemberApi(
  csrfToken: string,
  publicationId: string,
  userId: string
): Promise<void> {
  await requestJson(
    `/api/v1/publications/${encodeURIComponent(publicationId)}/members/${encodeURIComponent(userId)}`,
    z.object({ ok: z.boolean() }),
    {
      method: "DELETE",
      csrfToken,
      fallbackError: "Failed to remove publication member."
    }
  );
}

export async function listEditorialArticlesApi(
  publicationId: string,
  status?: ArticleStatus
): Promise<EditorialArticleSummary[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await requestJson(
    `/api/v1/publications/${encodeURIComponent(publicationId)}/articles${query}`,
    z.object({ articles: z.array(editorialArticleSummarySchema) }),
    { fallbackError: "Failed to load articles." }
  );
  return data.articles;
}

export async function createEditorialArticleApi(
  csrfToken: string,
  publicationId: string,
  input: {
    title: string;
    slug?: string;
    subtitle?: string | null;
    excerpt?: string | null;
    visibility?: ArticleVisibility;
    body?: unknown;
  }
): Promise<EditorialArticleDetail> {
  const data = await requestJson(
    `/api/v1/publications/${encodeURIComponent(publicationId)}/articles`,
    z.object({ article: editorialArticleDetailSchema }),
    {
      method: "POST",
      csrfToken,
      body: input,
      fallbackError: "Failed to create article."
    }
  );
  return data.article;
}

export async function getEditorialArticleApi(
  publicationId: string,
  articleId: string
): Promise<EditorialArticleDetail> {
  const data = await requestJson(
    `/api/v1/publications/${encodeURIComponent(publicationId)}/articles/${encodeURIComponent(articleId)}`,
    z.object({ article: editorialArticleDetailSchema }),
    { fallbackError: "Failed to load article." }
  );
  return data.article;
}

export async function updateEditorialArticleApi(
  csrfToken: string,
  publicationId: string,
  articleId: string,
  input: {
    title?: string;
    slug?: string;
    subtitle?: string | null;
    excerpt?: string | null;
    visibility?: ArticleVisibility;
    body?: unknown;
  }
): Promise<EditorialArticleDetail> {
  const data = await requestJson(
    `/api/v1/publications/${encodeURIComponent(publicationId)}/articles/${encodeURIComponent(articleId)}`,
    z.object({ article: editorialArticleDetailSchema }),
    {
      method: "PATCH",
      csrfToken,
      body: input,
      fallbackError: "Failed to save article."
    }
  );
  return data.article;
}

export async function publishEditorialArticleApi(
  csrfToken: string,
  publicationId: string,
  articleId: string
): Promise<EditorialArticleDetail> {
  const data = await requestJson(
    `/api/v1/publications/${encodeURIComponent(publicationId)}/articles/${encodeURIComponent(articleId)}/publish`,
    z.object({ article: editorialArticleDetailSchema }),
    {
      method: "POST",
      csrfToken,
      fallbackError: "Failed to publish article."
    }
  );
  return data.article;
}

export async function unpublishEditorialArticleApi(
  csrfToken: string,
  publicationId: string,
  articleId: string
): Promise<EditorialArticleDetail> {
  const data = await requestJson(
    `/api/v1/publications/${encodeURIComponent(publicationId)}/articles/${encodeURIComponent(articleId)}/unpublish`,
    z.object({ article: editorialArticleDetailSchema }),
    {
      method: "POST",
      csrfToken,
      fallbackError: "Failed to unpublish article."
    }
  );
  return data.article;
}

export async function deleteEditorialArticleApi(
  csrfToken: string,
  publicationId: string,
  articleId: string
): Promise<void> {
  await requestJson(
    `/api/v1/publications/${encodeURIComponent(publicationId)}/articles/${encodeURIComponent(articleId)}`,
    z.object({ ok: z.boolean() }),
    {
      method: "DELETE",
      csrfToken,
      fallbackError: "Failed to delete article."
    }
  );
}

export async function fetchPublicPublicationApi(
  publicationSlug: string
): Promise<PublicPublicationDetail> {
  return requestJson(
    `/api/v1/public/publications/${encodeURIComponent(publicationSlug)}`,
    publicPublicationDetailSchema,
    { fallbackError: "Publication not found." }
  );
}

export async function fetchPublicArticleApi(
  publicationSlug: string,
  articleSlug: string
): Promise<PublicArticleDetail> {
  return requestJson(
    `/api/v1/public/publications/${encodeURIComponent(publicationSlug)}/articles/${encodeURIComponent(articleSlug)}`,
    publicArticleDetailSchema,
    { fallbackError: "Article not found." }
  );
}
