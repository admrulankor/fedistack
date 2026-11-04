import crypto from "node:crypto";

export const DEFAULT_TOKEN_BYTE_LENGTH = 32;

/**
 * Generates a cryptographically random URL-safe base64 token.
 */
export function generateSecureToken(
  byteLength: number = DEFAULT_TOKEN_BYTE_LENGTH
): string {
  if (byteLength < 16) {
    throw new Error("Token entropy must be at least 16 bytes.");
  }
  return crypto.randomBytes(byteLength).toString("base64url");
}

/**
 * Computes the SHA-256 hex digest of a raw token.
 * Raw tokens must never be persisted to the database or written to logs.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/**
 * Verifies a raw token against a stored SHA-256 hex digest in constant time.
 */
export function verifyTokenHashConstantTime(
  rawToken: string,
  expectedHashHex: string
): boolean {
  if (!rawToken || !expectedHashHex) {
    return false;
  }

  const actualHashHex = hashToken(rawToken);
  const actualBuf = Buffer.from(actualHashHex, "utf8");
  const expectedBuf = Buffer.from(expectedHashHex, "utf8");

  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}
