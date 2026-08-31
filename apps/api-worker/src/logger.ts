/**
 * Structured logging for Workers Logs (design D8) — replaces
 * pino-to-stdout (apps/backend/src/main.ts).
 *
 * Passing a plain object to a console method is what Workers Logs parses
 * into queryable fields; the request-ID middleware stamps every line with
 * `requestId` so requests can be correlated the way the pino bootstrap
 * did. The same redaction posture applies: log lines are built from safe
 * fields only (method, path without query, route pattern, status,
 * duration) — callers must not widen them.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Log fields; `message` is the line's text (Workers Logs convention). */
export type LogFields = { message: string } & Record<string, unknown>;

export interface Logger {
  debug(fields: LogFields): void;
  info(fields: LogFields): void;
  warn(fields: LogFields): void;
  error(fields: LogFields): void;
}

export function createLogger(minLevel: string | undefined): Logger {
  const threshold =
    LEVEL_ORDER[minLevel as LogLevel] ?? LEVEL_ORDER.info;

  const emit = (level: LogLevel, fields: LogFields): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    // Object first-arg: Workers Logs serializes it to structured JSON and
    // keeps the console method's level. In Node (vitest) this prints the
    // object — testable by spying on console.
    console[level]({ level, ...fields });
  };

  return {
    debug: (fields) => emit('debug', fields),
    info: (fields) => emit('info', fields),
    warn: (fields) => emit('warn', fields),
    error: (fields) => emit('error', fields),
  };
}
