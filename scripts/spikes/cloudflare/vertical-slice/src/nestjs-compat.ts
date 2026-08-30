/**
 * G3 vertical slice spike — @nestjs/common compatibility shim.
 *
 * core-domain's engine classes carry NestJS decorators but are always
 * constructed manually (no Nest container exists in a Worker). The shim
 * replaces the @nestjs/common barrel — whose re-exports would drag
 * stream/util/url, rxjs, class-validator, and class-transformer into the
 * bundle — with pure no-op decorators providing the same exported names.
 *
 * Wired via wrangler.jsonc `alias: { "@nestjs/common": … }`.
 * The domain logic this spike executes is untouched; only DI metadata
 * side-effects are dropped. Real finding for the G3 report: porting
 * NestJS-decorated packages to Workers needs either this shim or
 * `nodejs_compat` + the optional Nest peers installed.
 *
 * @module G3SpikeNestShim
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

/** Logging facade — silent in the spike (structured logging is task 3.1). */
export class Logger {
  constructor(_context?: string) {}
  log(): void {}
  error(): void {}
  warn(): void {}
  debug(): void {}
  verbose(): void {}
}
