/**
 * Idempotency version resolution — the version set that BOTH cache sides
 * (key derivation + lookup comparison, and the stored entry) must agree
 * on, shared by the calculator and basket POST routes.
 *
 * The bug this module fixes: the idempotency entry versions defaulted to
 * `result.metadata.datasetVersions`, whose composition is conditional —
 * the landed-cost service appends the active import-VAT version label
 * only when the calculation is import-bearing (offer country ≠
 * destination). The lookup side resolved its versions from `tax_rules`
 * (`findActiveVersionLabels`), whose CHECK-constrained `tax_type` can
 * never carry a VAT label — so an import-bearing result stored a
 * version set the lookup could never reproduce, and every
 * import-VAT-carrying calculation was a permanent cache miss (recomputed
 * and re-stored on every POST).
 *
 * The fix: the idempotency layer owns its version set. Tax labels come
 * from the same repository read as before; the import-VAT label is
 * resolved from the code-resolved dataset (`resolveImportVatVersion`)
 * for the SAME date rule the calculator applies (`input.transactionDate`
 * when present, else now) and appended UNCONDITIONALLY — domestic
 * results included — so both sides derive an identical set from the
 * input alone. A future VAT dataset bump changes the resolved label,
 * which rotates the cache key: the version-aware design intent holds.
 * The result's `metadata.datasetVersions` keeps its provenance
 * semantics (which figures carry which version) and is no longer read
 * by the cache.
 *
 * @module IdempotencyVersions
 */
import { resolveImportVatVersion } from '../../../../packages/core-domain/src/vat/import-vat.math';

/** The one method the version resolution needs from the tax repository. */
interface ActiveVersionLabelsSource {
  findActiveVersionLabels(): Promise<readonly string[]>;
}

/**
 * The idempotency version set for one request: the tax_rules-active
 * labels plus the import-VAT dataset version effective on the
 * calculation date. Sorted — a byte-stable key input (the DO sorts
 * again for the digest; the array identity here keeps test assertions
 * and logs deterministic).
 *
 * When no VAT version is effective on the date (defensive — the seeded
 * dataset's last version is open-ended today), the label is skipped:
 * resolution throws, the calculator rejects the same request, and the
 * both-sides rule stays symmetric.
 */
export async function resolveIdempotencyVersions(
  taxRepo: ActiveVersionLabelsSource,
  transactionDate?: string,
): Promise<string[]> {
  const versions = [...(await taxRepo.findActiveVersionLabels())];
  try {
    versions.push(
      resolveImportVatVersion(
        transactionDate !== undefined ? new Date(transactionDate) : new Date(),
      ).versionId,
    );
  } catch {
    // No effective VAT version on the date — the calculator will reject
    // this request too; the label stays absent on both sides alike.
  }
  return versions.sort();
}
