/**
 * Price-ingestion Cloudflare Workflow entrypoint (task 4.2, design D6) —
 * the thin `WorkflowEntrypoint` shell over the orchestration core in
 * ./ingestion-steps.
 *
 * This is the ONLY cloudflare-importing file of the workflow: the Node
 * vitest pool cannot resolve `cloudflare:workers` / `cloudflare:workflows`,
 * so the runtime classes are injected as deps and the entire step logic
 * (and its tests) stays in the import-free core module.
 *
 * Binding + export wiring (lead follow-up, task 4.2): wrangler.jsonc
 * carries the `workflows` entry (binding INGESTION_WORKFLOW, class
 * IngestionWorkflow), and src/index.ts must re-export the class — the
 * one-liner lives in src/workflows/index.ts. Runtime registration
 * requires the class reachable from the worker entry script.
 *
 * @module IngestionWorkflow
 */

import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import type { Env } from '../env';
import {
  runIngestionWorkflow,
  type IngestionWorkflowParams,
} from './ingestion-steps';

export class IngestionWorkflow extends WorkflowEntrypoint<
  Env,
  IngestionWorkflowParams
> {
  async run(
    event: WorkflowEvent<IngestionWorkflowParams>,
    step: WorkflowStep,
  ): Promise<unknown> {
    return runIngestionWorkflow(event.payload, {
      env: this.env,
      step,
      NonRetryableError,
    });
  }
}
