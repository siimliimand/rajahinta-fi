-- Task 1.2 (change calendar-event-automation): the source-watcher's
-- review-queue storage.
--
-- calendar_event_candidates: one row per watcher-observed announcement
-- (a source-feed item) awaiting operator review. Candidates are ops
-- data, never public: the ops console lists the PENDING rows, and an
-- ACCEPTED row becomes a calendar_events row through the operator's
-- form — a candidate never publishes itself.
--
-- url is UNIQUE — the structural half of dedup. The pure layer's insert
-- decision (core-domain's decideCandidateInsert) compares the exact
-- string, and this column makes the same rule hold at rest: a re-seen
-- announcement can never re-enter the queue, even through a raw-SQL
-- path. REJECTED rows are retained on purpose — a rejected URL must
-- keep deduplicating, which is why the table has no delete path.
--
-- The status CHECK carries the closed review vocabulary
-- (PENDING | ACCEPTED | REJECTED): ACCEPTED and REJECTED are terminal
-- decisions, the same machine the pure state machine enforces — a
-- decided row is unrepresentable as undecided again. The repository-
-- layer validator (repositories/calendar-candidate-validator.ts)
-- restates the same contract with errors naming the valid values; the
-- CHECK is the last-line guarantee for raw SQL paths.
--
-- draft_fi / draft_en are NULLable by design (unlike calendar_events'
-- NOT NULL locale texts): candidates are internal review rows, and the
-- watcher may extract no text at all. The drafts pre-fill the accept
-- form; the operator's text, validated through the calendar-event
-- contract, is what an event is made of.
--
-- calendar_event_candidates_queue_idx serves the ops review queue's
-- one read as a single indexed query: filter the leading status column
-- (PENDING), order by published_at, url as the deterministic tiebreak.
--
-- Additive migration: no existing table is touched; rollback is a
-- revert deploy (the table is inert to existing flows).
CREATE TABLE `calendar_event_candidates` (
	`id` integer PRIMARY KEY NOT NULL,
	`source` text(64) NOT NULL,
	`url` text(512) NOT NULL,
	`title` text(512) NOT NULL,
	`published_at` text(10) NOT NULL,
	`status` text(16) NOT NULL,
	`draft_fi` text,
	`draft_en` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `calendar_event_candidates_status_check` CHECK(`calendar_event_candidates`.`status` IN ('PENDING', 'ACCEPTED', 'REJECTED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_candidates_url_unique` ON `calendar_event_candidates` (`url`);
--> statement-breakpoint
CREATE INDEX `calendar_event_candidates_queue_idx` ON `calendar_event_candidates` (`status`,`published_at`,`url`);
