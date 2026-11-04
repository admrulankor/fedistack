export type AuthErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_OR_EXPIRED_MAGIC_LINK"
  | "UNAUTHENTICATED"
  | "SESSION_EXPIRED_OR_REVOKED"
  | "CSRF_VALIDATION_FAILED"
  | "RATE_LIMIT_EXCEEDED"
  | "FORBIDDEN";

export class AuthError extends Error {
  public readonly code: AuthErrorCode;
  public readonly statusCode: number;

  constructor(code: AuthErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
