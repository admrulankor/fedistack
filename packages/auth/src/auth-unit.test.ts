import { describe, expect, it } from "vitest";
import {
  createStructuredLogger,
  generateSecureToken,
  hashToken,
  parseCookieHeader,
  REDACTED_VALUE,
  serializeClearSessionCookie,
  serializeSessionCookie,
  SlidingWindowRateLimiter,
  verifyTokenHashConstantTime
} from "./index.js";

describe("packages/auth unit suite", () => {
  describe("crypto token utilities", () => {
    it("generates high-entropy URL-safe tokens and hashes them deterministically", () => {
      const tokenA = generateSecureToken(32);
      const tokenB = generateSecureToken(32);

      expect(tokenA.length).toBeGreaterThanOrEqual(42);
      expect(tokenA).not.toEqual(tokenB);

      const hashA1 = hashToken(tokenA);
      const hashA2 = hashToken(tokenA);
      expect(hashA1).toHaveLength(64);
      expect(hashA1).toEqual(hashA2);
      expect(hashA1).not.toEqual(tokenA);

      expect(verifyTokenHashConstantTime(tokenA, hashA1)).toBe(true);
      expect(verifyTokenHashConstantTime(tokenB, hashA1)).toBe(false);
      expect(verifyTokenHashConstantTime("", hashA1)).toBe(false);
    });

    it("rejects insufficient entropy byte lengths", () => {
      expect(() => generateSecureToken(8)).toThrow(
        /entropy must be at least 16 bytes/i
      );
    });
  });

  describe("structured logger secret redaction", () => {
    it("never logs raw tokens, magic links, session IDs, CSRF tokens, or passwords", () => {
      const lines: string[] = [];
      const logger = createStructuredLogger((jsonLine) => lines.push(jsonLine));

      const rawMagicToken = "secret_magic_token_value_1234567890";
      const rawSessionToken = "secret_session_token_value_0987654321";
      const rawCsrfToken = "secret_csrf_token_value_abcdef";

      logger.info(
        `Dispatching https://pub.example.com/auth/verify?token=${rawMagicToken}`,
        {
          email: "reader@example.com",
          token: rawMagicToken,
          rawToken: rawMagicToken,
          magicLinkUrl: `https://pub.example.com/auth/verify?token=${rawMagicToken}`,
          sessionToken: rawSessionToken,
          sessionId: rawSessionToken,
          csrfToken: rawCsrfToken,
          password: "super-secret-password",
          nested: {
            cookie: `fedistack_session=${rawSessionToken}`,
            authorization: `Bearer ${rawSessionToken}`
          }
        }
      );

      expect(lines).toHaveLength(1);
      const serialized = lines[0]!;
      expect(serialized).not.toContain(rawMagicToken);
      expect(serialized).not.toContain(rawSessionToken);
      expect(serialized).not.toContain(rawCsrfToken);
      expect(serialized).not.toContain("super-secret-password");

      const parsed = JSON.parse(serialized) as {
        event: string;
        context: Record<string, unknown>;
      };
      expect(parsed.event).toContain(`token=${REDACTED_VALUE}`);
      expect(parsed.context.email).toBe("reader@example.com");
      expect(parsed.context.token).toBe(REDACTED_VALUE);
      expect(parsed.context.sessionToken).toBe(REDACTED_VALUE);
      expect(parsed.context.csrfToken).toBe(REDACTED_VALUE);
    });
  });

  describe("session cookies", () => {
    it("serializes HttpOnly, SameSite, and Secure attributes accurately", () => {
      const cookie = serializeSessionCookie("raw_session_token_123", {
        cookieName: "fedistack_session",
        secure: true,
        sameSite: "Lax",
        domain: "example.com",
        maxAgeSeconds: 3600
      });

      expect(cookie).toContain("fedistack_session=raw_session_token_123");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Domain=example.com");
      expect(cookie).toContain("Max-Age=3600");

      const parsed = parseCookieHeader(
        `other=1; fedistack_session=raw_session_token_123`
      );
      expect(parsed.fedistack_session).toBe("raw_session_token_123");

      const cleared = serializeClearSessionCookie({
        cookieName: "fedistack_session",
        secure: true
      });
      expect(cleared).toContain("fedistack_session=");
      expect(cleared).toContain("Max-Age=0");
    });
  });

  describe("sliding window rate limiter", () => {
    it("blocks requests exceeding maxRequests within windowMs and recovers after window expires", () => {
      const limiter = new SlidingWindowRateLimiter({
        windowMs: 60_000,
        maxRequests: 3
      });

      const t0 = 1_700_000_000_000;
      expect(limiter.consume("ip:1.2.3.4", t0).allowed).toBe(true);
      expect(limiter.consume("ip:1.2.3.4", t0 + 1000).allowed).toBe(true);
      expect(limiter.consume("ip:1.2.3.4", t0 + 2000).allowed).toBe(true);

      const blocked = limiter.consume("ip:1.2.3.4", t0 + 3000);
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

      // Independent keys are unaffected
      expect(limiter.consume("ip:5.6.7.8", t0 + 3000).allowed).toBe(true);

      // After window elapses, requests are allowed again
      const recovered = limiter.consume("ip:1.2.3.4", t0 + 61_000);
      expect(recovered.allowed).toBe(true);
    });
  });
});
