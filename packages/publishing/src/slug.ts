import { z } from "zod";

export const RESERVED_SLUGS = new Set([
  "api",
  "auth",
  "login",
  "logout",
  "verify",
  "dashboard",
  "admin",
  "settings",
  "p",
  "new",
  "edit",
  "public",
  "static"
]);

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Slug must be at least 2 characters long.")
  .max(80, "Slug must be at most 80 characters long.")
  .regex(
    SLUG_PATTERN,
    "Slug may contain only lowercase letters, numbers, and single internal hyphens."
  )
  .refine((val) => !RESERVED_SLUGS.has(val), {
    message: "This slug is reserved by Fedistack."
  });

/**
 * Normalizes arbitrary text into a valid Fedistack URL slug.
 */
export function slugifyText(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

  if (normalized.length < 2) {
    return "post";
  }

  if (RESERVED_SLUGS.has(normalized)) {
    const suffixed = `${normalized.slice(0, 74)}-post`;
    return suffixed;
  }

  return normalized;
}
