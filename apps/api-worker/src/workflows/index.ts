/**
 * Workflow module exports (task 4.2, design D6).
 *
 * The lead's one-liner for src/index.ts (the entry is owned by the
 * routes worker this wave, so it is NOT wired here):
 *
 *   export { IngestionWorkflow } from './workflows';
 *
 * Runtime registration also needs the wrangler.jsonc `workflows` entry —
 * already added (binding INGESTION_WORKFLOW, class_name IngestionWorkflow).
 *
 * @module Workflows
 */

export { IngestionWorkflow } from './ingestion.workflow';
export type { IngestionWorkflowParams } from './ingestion-steps';
