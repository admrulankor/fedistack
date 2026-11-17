export type PublishingErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "INVALID_STATE_TRANSITION";

export class PublishingError extends Error {
  public readonly code: PublishingErrorCode;
  public readonly statusCode: 400 | 403 | 404 | 409 | 422;

  constructor(
    code: PublishingErrorCode,
    message: string,
    statusCode: 400 | 403 | 404 | 409 | 422
  ) {
    super(message);
    this.name = "PublishingError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
