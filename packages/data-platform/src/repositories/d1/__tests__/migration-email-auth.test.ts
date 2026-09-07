/**
 * Migration 0014 (task 1.1, change email-password-auth, design D7) —
 * the anonymous-account purge and the real-identity schema. Proves,
 * against the real SQLite engine:
 *
 *   - the purge is the FIRST statement and deletes exactly the
 *     `@placeholder.local` rows — a real account survives verbatim;
 *   - the backfill leaves every surviving row with an empty (never
 *     authenticating) password envelope and no verification claim;
 *   - uniqueness is the lower(email) expression index, in SQL;
 *   - email_tokens carries the closed purpose CHECK and the cascading
 *     account FK.
 *
 * @module D1Migration0014Test
 */
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION_FILE = '0014_email_password_auth.sql';
const migrationsDir = path.resolve(process.cwd(), 'src/d1/migrations');

const migrationSql = readFileSync(path.join(migrationsDir, MIGRATION_FILE), 'utf8');

/** Chunks stripped of documentation comments — the executable SQL only. */
const statements = migrationSql
  .split('--> statement-breakpoint')
  .map((chunk) =>
    chunk
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .trim(),
  )
  .filter(Boolean);

describe('migration 0014 — statement inventory (design D7 order)', () => {
  it('purges the placeholder rows before anything else touches the table', () => {
    expect(statements[0]).toBe(
      "DELETE FROM `accounts` WHERE `email` LIKE '%@placeholder.local';",
    );
  });

  it('adds the two nullable identity columns and the fail-safe empty-hash backfill', () => {
    expect(statements).toContain('ALTER TABLE `accounts` ADD `password_hash` text;');
    expect(statements).toContain('ALTER TABLE `accounts` ADD `email_verified_at` text;');
    expect(statements).toContain(
      'UPDATE `accounts` SET `password_hash` = \'\' WHERE `password_hash` IS NULL;',
    );
  });

  it('creates the case-insensitive unique email index as a SQL-level guarantee', () => {
    expect(statements).toContain(
      'CREATE UNIQUE INDEX `accounts_email_lower_idx` ON `accounts` (lower("email"));',
    );
  });

  it('creates email_tokens hashed, purpose-checked, and cascade-bound to accounts', () => {
    const createTable = statements.find((s) => s.startsWith('CREATE TABLE `email_tokens`'));
    expect(createTable).toBeDefined();
    expect(createTable).toContain(`FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\`(\`id\`) ON UPDATE no action ON DELETE cascade`);
    expect(createTable).toContain(
      `CHECK("email_tokens"."purpose" IN ('verify_email', 'password_reset'))`,
    );
    expect(statements).toContain(
      'CREATE INDEX `email_tokens_token_hash_purpose_idx` ON `email_tokens` (`token_hash`,`purpose`);',
    );
    expect(statements).toContain(
      'CREATE INDEX `email_tokens_account_id_idx` ON `email_tokens` (`account_id`);',
    );
  });
});

describe('migration 0014 — applied over a populated pre-migration database', () => {
  // Simulates applying 0014 to a staging database that already ran
  // 0000–0013 and carries anonymous and (hypothetical) real accounts.
  const populated = new DatabaseSync(':memory:');
  const apply = (target: DatabaseSync, files: string[]): void => {
    for (const file of files) {
      for (const statement of readFileSync(path.join(migrationsDir, file), 'utf8')
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean)) {
        target.exec(statement);
      }
    }
  };

  const baseMigrations = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => f !== MIGRATION_FILE)
    .sort();

  apply(populated, baseMigrations);
  populated.exec(
    `INSERT INTO accounts (id, user_id, email) VALUES
       (1, 'anon-1', 'anon-1@placeholder.local'),
       (2, 'anon-2', 'anon-2@placeholder.local'),
       (3, 'real-1', 'Real.User@Example.INVALID')`,
  );

  apply(populated, [MIGRATION_FILE]);

  it('deletes exactly the placeholder rows — a real account survives verbatim', () => {
    const rows = populated
      .prepare('SELECT id, user_id, email FROM accounts ORDER BY id')
      .all() as { id: number; user_id: string; email: string }[];
    expect(rows).toEqual([{ id: 3, user_id: 'real-1', email: 'Real.User@Example.INVALID' }]);
  });

  it('leaves survivors with the empty-hash fail-safe state and no verification claim', () => {
    const row = populated
      .prepare('SELECT password_hash, email_verified_at FROM accounts WHERE id = 3')
      .get() as { password_hash: string; email_verified_at: string | null };
    expect(row.password_hash).toBe('');
    expect(row.email_verified_at).toBeNull();
  });

  it('enforces the lower(email) uniqueness in SQL — case variants collide', () => {
    expect(() =>
      populated.exec(
        `INSERT INTO accounts (id, user_id, email) VALUES (4, 'real-2', 'real.user@example.invalid')`,
      ),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('enforces the closed purpose CHECK on email_tokens', () => {
    expect(() =>
      populated.exec(
        `INSERT INTO email_tokens (account_id, token_hash, purpose, expires_at)
         VALUES (3, '${'a'.repeat(64)}', 'login', '2027-01-01T00:00:00.000Z')`,
      ),
    ).toThrow(/CHECK constraint failed/);

    expect(() =>
      populated.exec(
        `INSERT INTO email_tokens (account_id, token_hash, purpose, expires_at)
         VALUES (3, '${'b'.repeat(64)}', 'verify_email', '2027-01-01T00:00:00.000Z')`,
      ),
    ).not.toThrow();
  });
});
