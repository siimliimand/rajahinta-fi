-- Task 1.2 (change hedge-dedup-confidence-meter, design D3, spec:
-- calculation-outcomes delta "Persisted empirical margins"): the
-- persisted empirical-margin ladder behind the display-only ± meter.
--
-- outcome_margins: one row per calibrated ladder cell — the p80
-- relative-error quantile the outcome aggregation step recomputes from
-- the stored calculation_outcomes each aggregation tick. The composite
-- primary key IS the idempotency guarantee: a cell is one row however
-- many times the step re-runs (delete-then-insert per run — a cell the
-- corpus no longer calibrates disappears with its reports, never a
-- stale margin). quantile is a fraction of the estimate (0.052 = ±5.2
-- %), sample_count the corpus behind it, as_of the run instant the
-- margin was computed for — the basis the UI must render beside the
-- margin. Rows exist only at or above the calibration's sample floor
-- (core-domain MARGIN_SAMPLE_FLOOR); a below-floor cell has no honest
-- quantile and is unrepresentable here, and an empty outcome corpus
-- persists no rows at all (no synthesized values).
CREATE TABLE `outcome_margins` (
	`dimension` text(16) NOT NULL,
	`cell_key` text(256) NOT NULL,
	`quantile` real NOT NULL,
	`sample_count` integer NOT NULL,
	`as_of` text NOT NULL,
	CONSTRAINT "outcome_margins_dimension_check" CHECK("outcome_margins"."dimension" IN ('category_carrier', 'category', 'global')),
	CONSTRAINT "outcome_margins_cell_key_check" CHECK("outcome_margins"."cell_key" <> ''),
	CONSTRAINT "outcome_margins_quantile_check" CHECK("outcome_margins"."quantile" >= 0),
	CONSTRAINT "outcome_margins_sample_count_check" CHECK("outcome_margins"."sample_count" > 0),
	PRIMARY KEY(`dimension`, `cell_key`)
);
