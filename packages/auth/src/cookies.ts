export interface SessionCookieOptions {
  cookieName: string;
  secure: boolean;
  sameSite?: "Lax" | "Strict";
  domain?: string;
  path?: string;
  maxAgeSeconds: number;
}

export function serializeSessionCookie(
  rawSessionToken: string,
  options: SessionCookieOptions
): string {
  const parts = [
    `${options.cookieName}=${encodeURIComponent(rawSessionToken)}`,
    `Path=${options.path ?? "/"}`,
    `HttpOnly`,
    `SameSite=${options.sameSite ?? "Lax"}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`
  ];

  if (options.secure) {
    parts.push("Secure");
  }

  if (options.domain && options.domain.trim().length > 0) {
    parts.push(`Domain=${options.domain.trim()}`);
  }

  return parts.join("; ");
}

export function serializeClearSessionCookie(
  options: Omit<SessionCookieOptions, "maxAgeSeconds">
): string {
  const parts = [
    `${options.cookieName}=`,
    `Path=${options.path ?? "/"}`,
    `HttpOnly`,
    `SameSite=${options.sameSite ?? "Lax"}`,
    `Max-Age=0`,
    `Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  ];

  if (options.secure) {
    parts.push("Secure");
  }

  if (options.domain && options.domain.trim().length > 0) {
    parts.push(`Domain=${options.domain.trim()}`);
  }

  return parts.join("; ");
}

export function parseCookieHeader(
  cookieHeader: string | undefined | null
): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  const result: Record<string, string> = {};
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) {
      continue;
    }
    const key = pair.slice(0, eqIdx).trim();
    const rawVal = pair.slice(eqIdx + 1).trim();
    if (key.length > 0) {
      try {
        result[key] = decodeURIComponent(rawVal);
      } catch {
        result[key] = rawVal;
      }
    }
  }
  return result;
}
