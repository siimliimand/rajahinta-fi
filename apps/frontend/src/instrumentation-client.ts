/**
 * Next.js client-instrumentation hook — runs once per browser session,
 * before hydration. Sole job: trigger the env-gated Faro bootstrap, which
 * is a complete no-op without NEXT_PUBLIC_FARO_URL (see lib/telemetry).
 */

import { initFaroTelemetry } from './lib/telemetry/faro-init';

initFaroTelemetry();
