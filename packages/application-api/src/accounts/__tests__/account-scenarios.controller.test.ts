/**
 * Scenario CRUD round-trip tests for AccountController (task 6.2, change
 * phase2-advanced-features).
 *
 * Exercises the three scenario endpoints through the controller with a REAL
 * AccountService operating on in-memory repository implementations of the
 * data-platform abstracts (golden-dataset convention — plain classes, no
 * vi.fn()). The scenario store mirrors the Drizzle contract the service
 * relies on: upsert conflicts on the (account_id, name) unique constraint
 * and refreshes inputs + updatedAt while keeping the row identity, and
 * delete is scoped to the owning account.
 *
 * Also covers, at the metadata + guard-unit level (same convention as
 * historical-guard-regression.test.ts): the ADVANCED_FEATURES flag gate on
 * all three handlers (403 while off) and the SessionAuthGuard on the class
 * (token-derived identity, task 2.2).
 *
 * @module AccountScenariosControllerTest
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
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
import { AccountController } from '../account.controller';
import { SessionAuthGuard } from '../session-auth.guard';
import type { AuthenticatedAccount } from '../current-user.decorator';
import type { SaveScenarioRequest } from '../account.types';
import {
  FeatureFlagGuard,
  FeatureFlag,
  FEATURE_FLAG_KEY,
} from '../../feature-flags';
import { FeatureFlagService } from '../../feature-flags/feature-flag.service';

// ---------------------------------------------------------------------------
// In-memory repository implementations (plain classes — no vi.fn)
// ---------------------------------------------------------------------------

type AccountRow = typeof accounts.$inferSelect;

/**
 * In-memory account rows. Mirrors the DrizzleAccountRepository contract the
 * AccountService exercises: create-with-generated-id, lookup by external
 * userId, and a random-UUID anonymize that re-keys the row.
 */
class InMemoryAccountRows extends AccountRepository {
  readonly rows: AccountRow[] = [];
  private nextId = 1;

  async create(
    record: typeof accounts.$inferInsert,
  ): Promise<AccountRow> {
    const row: AccountRow = {
      id: this.nextId++,
      userId: record.userId,
      email: record.email,
      tier: record.tier ?? 'FREE',
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async findById(id: number): Promise<AccountRow | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findByUserId(userId: string): Promise<AccountRow | null> {
    return this.rows.find((r) => r.userId === userId) ?? null;
  }

  async updateLastActive(userId: string): Promise<void> {
    const row = await this.findByUserId(userId);
    if (row) row.lastActiveAt = new Date();
  }

  async delete(userId: string): Promise<void> {
    const index = this.rows.findIndex((r) => r.userId === userId);
    if (index !== -1) this.rows.splice(index, 1);
  }

  async findAllUserIds(): Promise<string[]> {
    return this.rows.map((r) => r.userId);
  }

  async anonymize(userId: string): Promise<void> {
    const row = await this.findByUserId(userId);
    if (!row) {
      throw new Error(`Cannot anonymize unknown userId="${userId}"`);
    }
    row.userId = `anon_${randomUUID()}`;
    row.email = `anonymized+${randomUUID()}@deleted.invalid`;
  }
}

/**
 * In-memory scenario rows. The upsert mirrors the Drizzle
 * onConflictDoUpdate on (account_id, name): an existing name keeps its id
 * and createdAt while inputs and updatedAt are refreshed.
 */
class InMemoryScenarioRows extends SavedScenarioRepository {
  readonly rows: SavedScenarioRecord[] = [];
  private nextId = 1;

  async findByAccountId(
    accountId: number,
  ): Promise<SavedScenarioRecord[]> {
    return this.rows.filter((r) => r.accountId === accountId);
  }

  async findByUserId(userId: string): Promise<SavedScenarioRecord[]> {
    // Join through the account rows exactly like the Drizzle innerJoin.
    const account = await this.accountRows.findByUserId(userId);
    if (!account) return [];
    return this.findByAccountId(account.id);
  }

  async upsert(
    record: typeof savedScenarios.$inferInsert,
  ): Promise<SavedScenarioRecord> {
    const existing = this.rows.find(
      (r) => r.accountId === record.accountId && r.name === record.name,
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
    this.rows.push(row);
    return { ...row };
  }

  async delete(accountId: number, id: number): Promise<void> {
    const index = this.rows.findIndex(
      (r) => r.id === id && r.accountId === accountId,
    );
    if (index !== -1) this.rows.splice(index, 1);
  }

  constructor(
    private readonly accountRows: InMemoryAccountRows,
    // Test hook — lets a fixture seed rows with controlled timestamps.
    seed?: SavedScenarioRecord[],
  ) {
    super();
    if (seed) {
      this.rows.push(...seed);
      this.nextId = seed.length + 1;
    }
  }
}

/** Minimal basket rows — present so AccountService takes the repository path. */
class InMemoryBasketRows extends SavedBasketRepository {
  readonly rows: (typeof savedBaskets.$inferSelect)[] = [];

  async create(
    record: typeof savedBaskets.$inferInsert,
  ): Promise<typeof savedBaskets.$inferSelect> {
    const row = {
      id: this.rows.length + 1,
      accountId: record.accountId,
      name: record.name,
      items: record.items,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async findById(
    id: number,
  ): Promise<(typeof savedBaskets.$inferSelect) | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findByAccountId(
    accountId: number,
  ): Promise<(typeof savedBaskets.$inferSelect)[]> {
    return this.rows.filter((r) => r.accountId === accountId);
  }

  async findByUserId(
    _userId: string,
  ): Promise<(typeof savedBaskets.$inferSelect)[]> {
    return [];
  }

  async delete(id: number): Promise<void> {
    const index = this.rows.findIndex((r) => r.id === id);
    if (index !== -1) this.rows.splice(index, 1);
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  controller: AccountController;
  accountRows: InMemoryAccountRows;
  scenarioRows: InMemoryScenarioRows;
}

function createHarness(seed?: SavedScenarioRecord[]): Harness {
  const accountRows = new InMemoryAccountRows();
  const scenarioRows = new InMemoryScenarioRows(accountRows, seed);
  const service = new AccountService(
    accountRows,
    new InMemoryBasketRows(),
    undefined,
    scenarioRows,
  );
  const controller = new AccountController(
    new DataExportService(service),
    service,
  );
  return { controller, accountRows, scenarioRows };
}

const USER_ID = 'scenario-user-1';
const OTHER_USER_ID = 'scenario-user-2';

/** AuthenticatedAccount the SessionAuthGuard would attach for a userId. */
function user(userId: string): AuthenticatedAccount {
  return { accountId: 1, userId, tier: 'FREE', verified: false };
}

const VALID_BODY: SaveScenarioRequest = {
  name: 'Weekend run',
  inputs: { productId: 12, quantity: 6, destination: 'FI' },
};

// ---------------------------------------------------------------------------
// Tests — CRUD round-trip
// ---------------------------------------------------------------------------

describe('AccountController scenarios — CRUD round-trip (repository path)', () => {
  it('list → save → list → upsert same name → delete → list round-trip', async () => {
    const { controller } = createHarness();

    // 1. Empty list for a fresh user.
    await expect(controller.listScenarios(user(USER_ID))).resolves.toEqual([]);

    // 2. First save inserts.
    const saved = await controller.saveScenario(VALID_BODY, user(USER_ID));
    expect(saved.name).toBe('Weekend run');
    expect(saved.inputs).toEqual(VALID_BODY.inputs);
    expect(saved.id).toBeGreaterThan(0);

    let list = await controller.listScenarios(user(USER_ID));
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Weekend run');

    // 3. Saving the same name upserts: inputs replaced, no duplicate row,
    //    identity (id, createdAt) preserved.
    const replacementInputs = {
      productId: 30,
      quantity: 24,
      destination: 'FI',
      transportArrangement: 'PERSONAL' as const,
    };
    const upserted = await controller.saveScenario(
      { name: 'Weekend run', inputs: replacementInputs },
      user(USER_ID),
    );

    list = await controller.listScenarios(user(USER_ID));
    expect(list).toHaveLength(1); // no duplicate
    expect(list[0].inputs).toEqual(replacementInputs); // inputs replaced
    expect(list[0].id).toBe(saved.id); // identity kept
    expect(upserted.id).toBe(saved.id);
    expect(list[0].updatedAt.getTime()).toBeGreaterThanOrEqual(
      list[0].createdAt.getTime(),
    );

    // 4. A different name inserts a second row.
    await controller.saveScenario(
      { name: 'Big party', inputs: VALID_BODY.inputs },
      user(USER_ID),
    );
    list = await controller.listScenarios(user(USER_ID));
    expect(list).toHaveLength(2);

    // 5. Delete removes exactly the targeted scenario.
    await controller.deleteScenario(saved.id, user(USER_ID));
    list = await controller.listScenarios(user(USER_ID));
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Big party');

    // 6. Final delete empties the list.
    await controller.deleteScenario(list[0].id, user(USER_ID));
    await expect(controller.listScenarios(user(USER_ID))).resolves.toEqual([]);
  });

  it('upsert refreshes updatedAt on a pre-existing row with a stale timestamp', async () => {
    // Seed a row with an old updatedAt, exactly like a scenario saved days
    // ago, then prove the controller save refreshes it.
    const seededDate = new Date('2026-01-01T00:00:00Z');
    const { controller, accountRows, scenarioRows } = createHarness([
      {
        id: 1,
        accountId: 1,
        name: 'Stale scenario',
        inputs: { productId: 1, quantity: 1, destination: 'FI' },
        createdAt: seededDate,
        updatedAt: seededDate,
      },
    ]);
    // Account row id 1 owns the seeded scenario.
    await accountRows.create({ userId: USER_ID, email: `${USER_ID}@placeholder.local`, tier: 'FREE' });
    expect(accountRows.rows[0].id).toBe(1);

    const result = await controller.saveScenario(
      { name: 'Stale scenario', inputs: { productId: 9, quantity: 2, destination: 'EE' } },
      user(USER_ID),
    );

    expect(result.id).toBe(1);
    expect(result.updatedAt.getTime()).toBeGreaterThan(seededDate.getTime());
    expect(scenarioRows.rows).toHaveLength(1);
  });

  it('keeps scenarios isolated between accounts', async () => {
    const { controller } = createHarness();

    await controller.saveScenario(VALID_BODY, user(USER_ID));
    await expect(controller.listScenarios(user(OTHER_USER_ID))).resolves.toEqual([]);

    // The other user saving the same name gets their own row.
    const other = await controller.saveScenario(VALID_BODY, user(OTHER_USER_ID));
    const mine = await controller.listScenarios(user(USER_ID));
    const theirs = await controller.listScenarios(user(OTHER_USER_ID));
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].id).not.toBe(mine[0].id);
    expect(other.id).toBe(theirs[0].id);
  });

  it('saving under a user without an account auto-creates the account', async () => {
    const { controller, accountRows } = createHarness();
    await controller.saveScenario(VALID_BODY, user('brand-new-user'));
    expect(
      accountRows.rows.find((r) => r.userId === 'brand-new-user'),
    ).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — delete scoping (404 for absent or foreign ids)
// ---------------------------------------------------------------------------

describe('AccountController scenarios — delete scoping', () => {
  it('throws NotFoundException for an absent scenario id', async () => {
    const { controller } = createHarness();
    await expect(controller.deleteScenario(999, user(USER_ID))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException with the ScenarioNotFound error shape', async () => {
    const { controller } = createHarness();
    try {
      await controller.deleteScenario(4242, user(USER_ID));
      expect.unreachable('Expected NotFoundException');
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).getResponse()).toMatchObject({
        statusCode: 404,
        error: 'ScenarioNotFound',
      });
    }
  });

  it('reports a foreign scenario id as not found — never deletes cross-account', async () => {
    const { controller } = createHarness();
    const saved = await controller.saveScenario(VALID_BODY, user(USER_ID));

    // OTHER_USER has no access to USER's scenario id.
    await expect(
      controller.deleteScenario(saved.id, user(OTHER_USER_ID)),
    ).rejects.toThrow(NotFoundException);

    // The row survives.
    const list = await controller.listScenarios(user(USER_ID));
    expect(list).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — request validation (400)
// ---------------------------------------------------------------------------

describe('AccountController scenarios — body validation', () => {
  const cases: Array<{ label: string; body: unknown }> = [
    { label: 'body is an array', body: [VALID_BODY] },
    { label: 'name missing', body: { inputs: VALID_BODY.inputs } },
    { label: 'name empty', body: { name: '', inputs: VALID_BODY.inputs } },
    { label: 'name whitespace', body: { name: '   ', inputs: VALID_BODY.inputs } },
    { label: 'inputs missing', body: { name: 'x' } },
    { label: 'inputs is an array', body: { name: 'x', inputs: [] } },
    {
      label: 'productId zero',
      body: { name: 'x', inputs: { productId: 0, quantity: 1, destination: 'FI' } },
    },
    {
      label: 'productId non-integer',
      body: { name: 'x', inputs: { productId: 1.5, quantity: 1, destination: 'FI' } },
    },
    {
      label: 'quantity zero',
      body: { name: 'x', inputs: { productId: 1, quantity: 0, destination: 'FI' } },
    },
    {
      label: 'quantity non-integer',
      body: { name: 'x', inputs: { productId: 1, quantity: 2.5, destination: 'FI' } },
    },
    {
      label: 'destination empty',
      body: { name: 'x', inputs: { productId: 1, quantity: 1, destination: '' } },
    },
    {
      label: 'transportMethod empty string when provided',
      body: {
        name: 'x',
        inputs: { productId: 1, quantity: 1, destination: 'FI', transportMethod: '  ' },
      },
    },
    {
      label: 'transportArrangement outside the union',
      body: {
        name: 'x',
        inputs: { productId: 1, quantity: 1, destination: 'FI', transportArrangement: 'COURIER_PIGEON' },
      },
    },
  ];

  for (const { label, body } of cases) {
    it(`rejects 400 when ${label}`, async () => {
      const { controller } = createHarness();
      await expect(
        controller.saveScenario(body as SaveScenarioRequest, user(USER_ID)),
      ).rejects.toThrow(BadRequestException);
    });
  }

  it('rejection carries the InvalidScenarioRequest error shape', async () => {
    const { controller } = createHarness();
    try {
      await controller.saveScenario({ name: '' } as SaveScenarioRequest, user(USER_ID));
      expect.unreachable('Expected BadRequestException');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        statusCode: 400,
        error: 'InvalidScenarioRequest',
      });
    }
  });

  it('accepts optional transport fields from the controlled vocabulary', async () => {
    const { controller } = createHarness();
    const result = await controller.saveScenario(
      {
        name: 'Carrier override',
        inputs: {
          productId: 5,
          quantity: 3,
          destination: 'FI',
          transportMethod: 'beverage-de',
          transportArrangement: 'INDEPENDENT_CARRIER',
        },
      },
      user(USER_ID),
    );
    expect(result.inputs.transportMethod).toBe('beverage-de');
    expect(result.inputs.transportArrangement).toBe('INDEPENDENT_CARRIER');
  });
});

// ---------------------------------------------------------------------------
// Tests — session authentication (task 2.2)
// ---------------------------------------------------------------------------

describe('AccountController scenarios — session authentication', () => {
  it('class carries SessionAuthGuard so identity is token-derived', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      AccountController,
    ) as unknown[];
    expect(guards).toContain(SessionAuthGuard);
  });
});

// ---------------------------------------------------------------------------
// Tests — ADVANCED_FEATURES flag gating (403 on all three handlers)
// ---------------------------------------------------------------------------

/** NestJS internal metadata key for guards applied via @UseGuards. */
const GUARDS_METADATA = '__guards__';

function contextForMethod<F>(handler: F, controller: object): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ headers: {}, cookies: {} }),
      getResponse: () => ({ header: () => undefined }),
    }),
    getArgs: () => [],
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

describe('AccountController scenarios — ADVANCED_FEATURES gating', () => {
  const reflector = new Reflector();
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.FF_ADVANCED_FEATURES;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const handlers = [
    ['listScenarios', AccountController.prototype.listScenarios],
    ['saveScenario', AccountController.prototype.saveScenario],
    ['deleteScenario', AccountController.prototype.deleteScenario],
  ] as const;

  it('all three handlers are flag-gated via @FeatureFlagDec(ADVANCED_FEATURES)', () => {
    for (const [, handler] of handlers) {
      const flag = reflector.getAllAndOverride<FeatureFlag>(FEATURE_FLAG_KEY, [
        handler,
        AccountController,
      ]);
      expect(flag).toBe(FeatureFlag.ADVANCED_FEATURES);
    }
  });

  it('all three handlers carry the FeatureFlagGuard', () => {
    for (const [, handler] of handlers) {
      const guards = reflector.getAllAndOverride<unknown[]>(GUARDS_METADATA, [
        handler,
        AccountController,
      ]);
      expect(guards).toContain(FeatureFlagGuard);
    }
  });

  it('FeatureFlagGuard rejects every handler with 403 while the flag is off (default)', () => {
    const guard = new FeatureFlagGuard(reflector, new FeatureFlagService());

    for (const [name, handler] of handlers) {
      const context = contextForMethod(handler, AccountController);
      expect(() => guard.canActivate(context), `${name} must be gated`).toThrow(
        ForbiddenException,
      );
    }
  });

  it('FeatureFlagGuard names the flag in the rejection', () => {
    const guard = new FeatureFlagGuard(reflector, new FeatureFlagService());
    const context = contextForMethod(
      AccountController.prototype.listScenarios,
      AccountController,
    );

    try {
      guard.canActivate(context);
      expect.unreachable('Expected ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).message).toMatch(/ADVANCED_FEATURES/);
    }
  });

  it('FeatureFlagGuard allows every handler once FF_ADVANCED_FEATURES=true', () => {
    process.env.FF_ADVANCED_FEATURES = 'true';
    const guard = new FeatureFlagGuard(reflector, new FeatureFlagService());

    for (const [, handler] of handlers) {
      const context = contextForMethod(handler, AccountController);
      expect(guard.canActivate(context)).toBe(true);
    }
  });

  it('the pre-existing basket endpoints stay ungated (regression guard)', () => {
    for (const handler of [
      AccountController.prototype.listBaskets,
      AccountController.prototype.getHistory,
    ]) {
      const flag = reflector.getAllAndOverride<FeatureFlag>(FEATURE_FLAG_KEY, [
        handler,
        AccountController,
      ]);
      expect(flag, 'basket/history handlers must not be flag-gated').toBeUndefined();
    }
  });
});
