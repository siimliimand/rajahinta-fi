/**
 * Queue → Workflow handoff (task 4.2, design D6) — idempotent instance
 * creation over a structural workflow binding.
 *
 * The consumer hands each message to the IngestionWorkflow instance
 * whose id IS the message's dedupe key
 * (`price-ingestion-<merchantId>-<hour>`), so at-least-once Queue
 * delivery collapses onto one instance per scheduled run — the Workflows
 * counterpart of the BullMQ jobId dedupe.
 *
 * `Workflow.create` throws when the id already exists (it is not
 * idempotent), so the handoff is get-then-create with a confirm-on-race:
 * if create fails, a successful `get` proves a concurrent delivery won
 * and the instance owns the key (skip); a failed `get` rethrows the
 * create error (real API failure → the consumer releases the claim and
 * the message retries).
 *
 * Import-free of `cloudflare:workers` — tests pass fakes — the real
 * binding satisfies {@link WorkflowBindingLike} structurally.
 *
 * @module WorkflowHandoff
 */

/** Structural subset of the runtime Workflow binding class. */
export interface WorkflowBindingLike {
  /** Resolves when an instance with the id exists; rejects otherwise. */
  get(id: string): Promise<unknown>;
  /** Creates an instance; rejects when the id already exists. */
  create(options: { id: string; params: unknown }): Promise<unknown>;
}

/** Result of an idempotent handoff attempt. */
export interface WorkflowHandoffResult {
  /** True when THIS call created the instance; false when it existed. */
  readonly created: boolean;
  readonly instanceId: string;
}

/**
 * Ensure exactly one Workflow instance exists for `instanceId`.
 *
 * Never creates a duplicate: an existing instance (created by this
 * delivery, a concurrent one, or a pre-ack crash redelivery) is returned
 * as `{ created: false }` — the running instance owns the dedupe key.
 */
export async function ensureWorkflowInstance(
  workflow: WorkflowBindingLike,
  instanceId: string,
  params: unknown,
): Promise<WorkflowHandoffResult> {
  try {
    await workflow.get(instanceId);
    return { created: false, instanceId };
  } catch {
    // Absent (or a transient get failure) — create below re-validates
    // existence, so treating any get error as "absent" is safe.
  }

  try {
    await workflow.create({ id: instanceId, params });
    return { created: true, instanceId };
  } catch (err) {
    try {
      await workflow.get(instanceId);
      // Lost a create race — the concurrent delivery's instance owns
      // the key; skipping is the idempotent outcome.
      return { created: false, instanceId };
    } catch {
      // Instance truly absent — the create error is the real failure.
      throw err;
    }
  }
}
