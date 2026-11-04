export const REDACTED_VALUE = "[REDACTED]";

const SENSITIVE_KEY_PATTERN =
  /^(raw_?token|token|magic_?link(_?token|_?url)?|session_?token|session_?id|csrf_?token|password|secret|authorization|cookie|set-cookie)$/i;

const TOKEN_QUERY_PARAM_PATTERN = /([?&](?:token|session|csrf)=)[^&\s#]+/gi;

export function redactString(input: string): string {
  return input.replace(TOKEN_QUERY_PARAM_PATTERN, `$1${REDACTED_VALUE}`);
}

export function redactSensitiveData(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = REDACTED_VALUE;
      } else {
        result[key] = redactSensitiveData(entryValue);
      }
    }
    return result;
  }

  return value;
}

export interface LogEntry {
  level: "info" | "warn" | "error";
  event: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export interface StructuredLogger {
  info(event: string, context?: Record<string, unknown>): void;
  warn(event: string, context?: Record<string, unknown>): void;
  error(event: string, context?: Record<string, unknown>): void;
}

export function createStructuredLogger(
  sink: (serializedJson: string) => void = (line) => console.log(line)
): StructuredLogger {
  const write = (
    level: LogEntry["level"],
    event: string,
    context?: Record<string, unknown>
  ) => {
    const entry: LogEntry = {
      level,
      event: redactString(event),
      timestamp: new Date().toISOString(),
      ...(context
        ? {
            context: redactSensitiveData(context) as Record<string, unknown>
          }
        : {})
    };
    sink(JSON.stringify(entry));
  };

  return {
    info: (event, context) => write("info", event, context),
    warn: (event, context) => write("warn", event, context),
    error: (event, context) => write("error", event, context)
  };
}
