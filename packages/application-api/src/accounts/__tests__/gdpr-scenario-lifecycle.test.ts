/**
 * GDPR lifecycle integration tests for saved scenarios (task 6.2, change
 * phase2-advanced-features) — sibling of gdpr-integration.test.ts, following
 * its setup and gate.
 *
 * ## TEST_DATABASE_URL gate
 *
 * These tests activate only when `TEST_DATABASE_URL` is set, exactly like
 * gdpr-integration.test.ts. The in-memory repositories below emulate what
 * the concrete Drizzle layer does (that file's documented approach):
 *
 *   - anonymize: transactional pseudonymization (fresh random-UUID
 *     identifiers) + cascade delete of saved baskets AND saved scenarios
 *   - delete: the account row disappears and saved_scenarios rows die via
 *     the account_id FK ON DELETE CASCADE
 *
 * ## What these tests assert
 *
 * 1. **Export** — DataExportService.exportUserData includes the account's
 *    savedScenarios rows with their full inputs (data portability).
 * 2. **Anonymize cascade** — after AccountService.anonymizeAccount, no
 *    scenario row remains for the account (in-transaction delete), while
 *    the anonymized account skeleton survives.
 * 3. **Delete cascade** — after AccountService.deleteAccount, the account
 *    and every scenario row are gone (FK cascade).
 *
 * @module GdprScenarioLifecycleTest
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  AccountRepository,
  SavedBasketRepository,
  SavedScenarioRepository,
  accounts,
  savedBaskets,
  savedScenarios,
  type SavedScenarioRecord,
} from '@rajahinta/data-platform';
import { AccountService } from '../account.service';
import { DataExportService } from '../data-export.service';

// ---------------------------------------------------------------------------
// PostgreSQL availability guard (same convention as gdpr-integration.test.ts)
// ---------------------------------------------------------------------------

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function pgAvailable(): boolean {
  return !!TEST_DATABASE_URL;
}

// ---------------------------------------------------------------------------
// Fake database + repositories emulating the Drizzle layer
// ---------------------------------------------------------------------------

type AccountRow = typeof accounts.$inferSelect;
type BasketRow = typeof savedBaskets.$inferSelect;

/**
 * One shared row store per "database" so the FK cascade semantics have a
 * single place to live — mirroring what PostgreSQL actually does.
 */
class FakeDatabase {
  accountRows: AccountRow[] = [];
  basketRows: BasketRow[] = [];
  scenarioRows: SavedScenarioRecord[] = [];
  private nextAccountId = 1;

  createAccount(record: typeof accounts.$inferInsert): AccountRow {
    const row: AccountRow = {
      id: this.nextAccountId++,
      userId: record.userId,
      email: record.email,
      tier: record.tier ?? 'FREE',
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };
    this.accountRows.push(row);
    return row;
  }

  findAccountByUserId(userId: string): AccountRow | null {
    return this.accountRows.find((r) => r.userId === userId) ?? null;
  }

  scenariosOf(accountId: number): SavedScenarioRecord[] {
    return this.scenarioRows.filter((r) => r.accountId === accountId);
  }

  /**
   * DELETE of the account row — saved_scenarios rows die with it via the
   * account_id FK ON DELETE CASCADE; saved baskets cascade in repository
   * code.
   */
  deleteAccount(userId: string): void {
    const row = this.findAccountByUserId(userId);
    if (!row) return;
    this.scenarioRows = this.scenarioRows.filter(
      (r) => r.accountId !== row.id,
    );
    this.basketRows = this.basketRows.filter((r) => r.accountId !== row.id);
    this.accountRows = this.accountRows.filter((r) => r.id !== row.id);
  }

  /**
   * Transactional anonymize — pseudonymize the identifiers with fresh
   * random UUIDs and cascade-delete saved baskets and saved scenarios,
   * retaining the skeleton row.
   */
  anonymizeAccount(userId: string): void {
    const row = this.findAccountByUserId(userId);
    if (!row) {
      throw new Error(`Cannot anonymize: no account for userId="${userId}"`);
    }
    this.scenarioRows = this.scenarioRows.filter(
      (r) => r.accountId !== row.id,
    );
    this.basketRows = this.basketRows.filter((r) => r.accountId !== row.id);
    row.userId = `anon_${randomUUID()}`;
    row.email = `anonymized+${randomUUID()}@deleted.invalid`;
  }
}

class FakeAccountRepository extends AccountRepository {
  constructor(private readonly db: FakeDatabase) {
    super();
  }

  async create(record: typeof accounts.$inferInsert): Promise<AccountRow> {
    return this.db.createAccount(record);
  }

  async findById(id: number): Promise<AccountRow | null> {
    return this.db.accountRows.find((r) => r.id === id) ?? null;
  }

  async findByUserId(userId: string): Promise<AccountRow | null> {
    return this.db.findAccountByUserId(userId);
  }

  async updateLastActive(userId: string): Promise<void> {
    const row = this.db.findAccountByUserId(userId);
    if (row) row.lastActiveAt = new Date();
  }

  async delete(userId: string): Promise<void> {
    this.db.deleteAccount(userId);
  }

  async findAllUserIds(): Promise<string[]> {
    return this.db.accountRows.map((r) => r.userId);
  }

  async anonymize(userId: string): Promise<void> {
    this.db.anonymizeAccount(userId);
  }
}

class FakeSavedBasketRepository extends SavedBasketRepository {
  constructor(private readonly db: FakeDatabase) {
    super();
  }

  async create(record: typeof savedBaskets.$inferInsert): Promise<BasketRow> {
    const row: BasketRow = {
      id: this.db.basketRows.length + 1,
      accountId: record.accountId,
      name: record.name,
      items: record.items,
      createdAt: new Date(),
    };
    this.db.basketRows.push(row);
    return row;
  }

  async findById(id: number): Promise<BasketRow | null> {
    return this.db.basketRows.find((r) => r.id === id) ?? null;
  }

  async findByAccountId(accountId: number): Promise<BasketRow[]> {
    return this.db.basketRows.filter((r) => r.accountId === accountId);
  }

  async findByUserId(userId: string): Promise<BasketRow[]> {
    const account = this.db.findAccountByUserId(userId);
    return account ? this.findByAccountId(account.id) : [];
  }

  async delete(id: number): Promise<void> {
    const index = this.db.basketRows.findIndex((r) => r.id === id);
    if (index !== -1) this.db.basketRows.splice(index, 1);
  }
}

class FakeSavedScenarioRepository extends SavedScenarioRepository {
  private nextId = 1;

  constructor(private readonly db: FakeDatabase) {
    super();
  }

  async findByAccountId(accountId: number): Promise<SavedScenarioRecord[]> {
    return this.db.scenariosOf(accountId).map((r) => ({ ...r }));
  }

  async findByUserId(userId: string): Promise<SavedScenarioRecord[]> {
    const account = this.db.findAccountByUserId(userId);
    return account ? this.findByAccountId(account.id) : [];
  }

  async upsert(
    record: typeof savedScenarios.$inferInsert,
  ): Promise<SavedScenarioRecord> {
    const existing = this.db.scenarioRows.find(
      (r) =>
        r.accountId === record.accountId && r.name === record.name,
    );
    if (existing) {
      existing.inputs = record.inputs;
      existing.updatedAt = new Date();
      return { ...existing };
    }
    const row: SavedScenarioRecord = {
      id: this.nextId++,
      accountId: record.accountId,
      name: record.name,
      inputs: record.inputs,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.db.scenarioRows.push(row);
    return { ...row };
  }

  async delete(accountId: number, id: number): Promise<void> {
    const index = this.db.scenarioRows.findIndex(
      (r) => r.id === id && r.accountId === accountId,
    );
    if (index !== -1) this.db.scenarioRows.splice(index, 1);
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface LifecycleHarness {
  service: AccountService;
  exportService: DataExportService;
  db: FakeDatabase;
}

function createHarness(): LifecycleHarness {
  const db = new FakeDatabase();
  const service = new AccountService(
    new FakeAccountRepository(db),
    new FakeSavedBasketRepository(db),
    undefined,
    new FakeSavedScenarioRepository(db),
  );
  return { service, exportService: new DataExportService(service), db };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GDPR lifecycle — saved scenarios (export + erasure cascades)', () => {
  if (!pgAvailable()) {
    console.log(
      '\n  ⏭️  GDPR scenario-lifecycle tests SKIPPED — TEST_DATABASE_URL not set.\n' +
        '  See gdpr-integration.test.ts for how to run them against PostgreSQL.\n',
    );
    it.skip('requires TEST_DATABASE_URL — all tests skipped', () => {});
    return;
  }

  const USER_ID = 'gdpr-scenario-user';

  async function seedScenarios(service: AccountService): Promise<void> {
    await service.saveScenario(USER_ID, 'Weekend run', {
      productId: 12,
      quantity: 6,
      destination: 'FI',
      transportArrangement: 'PERSONAL',
    });
    await service.saveScenario(USER_ID, 'Big party', {
      productId: 30,
      quantity: 24,
      destination: 'FI',
      transportMethod: 'beverage-de',
    });
  }

  // -----------------------------------------------------------------------
  // Export — scenarios are account data and must be portable
  // -----------------------------------------------------------------------

  describe('export includes savedScenarios', () => {
    it('lists every scenario row with name and full inputs', async () => {
      const { service, exportService } = createHarness();
      await service.getAccount(USER_ID);
      await seedScenarios(service);

      const exportData = await exportService.exportUserData(USER_ID);

      expect(exportData.savedScenarios).toHaveLength(2);
      const names = exportData.savedScenarios.map((s) => s.name);
      expect(names).toContain('Weekend run');
      expect(names).toContain('Big party');

      const weekend = exportData.savedScenarios.find(
        (s) => s.name === 'Weekend run',
      );
      expect(weekend?.inputs).toEqual({
        productId: 12,
        quantity: 6,
        destination: 'FI',
        transportArrangement: 'PERSONAL',
      });
    });

    it('an account with no scenarios exports an empty array', async () => {
      const { service, exportService } = createHarness();
      await service.getAccount(USER_ID);

      const exportData = await exportService.exportUserData(USER_ID);
      expect(exportData.savedScenarios).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Erasure — anonymize (in-transaction delete of scenario rows)
  // -----------------------------------------------------------------------

  describe('anonymize cascades to saved scenarios', () => {
    it('leaves no scenario row behind while the skeleton account survives', async () => {
      const { service, db } = createHarness();
      await service.getAccount(USER_ID);
      await seedScenarios(service);
      expect(db.scenarioRows).toHaveLength(2);

      await service.anonymizeAccount(USER_ID);

      // Reads through the retired identity see nothing.
      await expect(service.getScenarios(USER_ID)).resolves.toEqual([]);

      // The rows are physically gone from the store — not orphaned.
      expect(db.scenarioRows).toHaveLength(0);

      // The anonymized skeleton survives under a non-derivable anon_ id.
      const userIds = await service.getAllUserIds();
      expect(userIds).not.toContain(USER_ID);
      const anonId = userIds.find((id) => id.startsWith('anon_'));
      expect(anonId).toBeDefined();
      expect(anonId).toMatch(
        /^anon_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Erasure — deleteAccount (saved_scenarios FK ON DELETE CASCADE)
  // -----------------------------------------------------------------------

  describe('deleteAccount cascades to saved scenarios', () => {
    it('removes the account and every scenario row for it', async () => {
      const { service, db } = createHarness();
      await service.getAccount(USER_ID);
      await seedScenarios(service);

      const account = db.findAccountByUserId(USER_ID);
      expect(account).not.toBeNull();
      expect(db.scenariosOf(account!.id)).toHaveLength(2);

      await service.deleteAccount(USER_ID);

      expect(db.findAccountByUserId(USER_ID)).toBeNull();
      expect(db.accountRows.find((r) => r.userId === USER_ID)).toBeUndefined();
      // FK cascade: no scenario row survives the account.
      expect(db.scenarioRows).toHaveLength(0);
      await expect(service.getScenarios(USER_ID)).resolves.toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-account safety — erasure never touches another account's rows
  // -----------------------------------------------------------------------

  describe('erasure is account-scoped', () => {
    it('anonymizing one user leaves another user’s scenarios intact', async () => {
      const { service, db } = createHarness();
      const otherId = 'gdpr-other-user';
      await service.getAccount(USER_ID);
      await service.getAccount(otherId);
      await seedScenarios(service);
      await service.saveScenario(otherId, 'Untouched', {
        productId: 1,
        quantity: 1,
        destination: 'FI',
      });
      expect(db.scenarioRows).toHaveLength(3);

      await service.anonymizeAccount(USER_ID);

      expect(db.scenarioRows).toHaveLength(1);
      const survivors = await service.getScenarios(otherId);
      expect(survivors).toHaveLength(1);
      expect(survivors[0].name).toBe('Untouched');
    });
  });
});
