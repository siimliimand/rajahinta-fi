/**
 * Worker entry — binds the Hono app to the Workers fetch handler
 * (migrate-to-cloudflare task 5.3). The app is constructed per request
 * against the request-scoped environment; a single route keeps that cheap.
 *
 * @module index
 */

import { createEmailWorkerApp } from './app';
import type { WorkerEnv } from './env';

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return createEmailWorkerApp({ env }).fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;
