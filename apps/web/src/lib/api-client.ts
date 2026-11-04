import { z } from "zod";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
        role: z.enum(["owner", "admin", "editor"])
      })
    ),
    publications: z.array(
      z.object({
        publicationId: z.string().uuid(),
        role: z.enum(["admin", "editor", "author"])
      })
    )
  }),
  csrfToken: z.string().min(1),
  expiresAt: z.string()
});

export type SessionPayload = z.infer<typeof sessionPayloadSchema>;

const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string()
  })
});

async function parseErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const data: unknown = await response.json();
    const parsed = apiErrorSchema.safeParse(data);
    if (parsed.success) {
      return parsed.data.error.message;
    }
  } catch {
    // Ignore parse error and return fallback
  }
  return fallback;
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
    const message = await parseErrorMessage(
      response,
      "Unable to send magic link. Please try again."
    );
    throw new Error(message);
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
  const response = await fetch(
    `${API_BASE_URL}/api/v1/auth/magic-link/verify`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({ token })
    }
  );

  if (!response.ok) {
    const message = await parseErrorMessage(
      response,
      "The sign-in link is invalid or has expired."
    );
    throw new Error(message);
  }

  const json: unknown = await response.json();
  return sessionPayloadSchema.parse(json);
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
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
    method: "POST",
    headers: {
      "X-CSRF-Token": csrfToken
    },
    credentials: "include"
  });

  if (!response.ok) {
    const message = await parseErrorMessage(
      response,
      "Failed to sign out cleanly."
    );
    throw new Error(message);
  }
}
