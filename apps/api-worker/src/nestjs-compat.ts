/**
 * @nestjs/common compatibility shim (design D1, G3 finding).
 *
 * core-domain's engine classes carry NestJS decorators but are always
 * constructed manually (no Nest container exists in a Worker). The shim
 * replaces the @nestjs/common barrel — whose re-exports would drag
 * stream/util/url, rxjs, class-validator, and class-transformer into the
 * bundle — with pure no-op decorators providing the same exported names.
 *
 * Wired via wrangler.jsonc `alias: { "@nestjs/common": … }`. The domain
 * logic is untouched; only DI metadata side-effects are dropped.
 * `nodejs_compat` + the optional Nest peers is the recorded fallback.
 */

export type Type<T> = new (...args: never[]) => T;
export type Provider = unknown;

export interface ModuleMetadata {
  imports?: unknown[];
  controllers?: unknown[];
  providers?: unknown[];
  exports?: unknown[];
}

export function Injectable(): ClassDecorator {
  return () => undefined;
}

export function Inject(_token?: unknown): ParameterDecorator {
  return () => undefined;
}

export function Optional(): ParameterDecorator {
  return () => undefined;
}

export function Global(): ClassDecorator {
  return () => undefined;
}

export function Module(_metadata?: ModuleMetadata): ClassDecorator {
  return () => undefined;
}

/**
 * Logging facade — core-domain services may inject it. Structured
 * logging lives in src/logger.ts; this shim stays silent like the
 * spike's, since domain code logs through its own ports.
 */
export class Logger {
  constructor(_context?: string) {}
  log(): void {}
  error(): void {}
  warn(): void {}
  debug(): void {}
  verbose(): void {}
}
