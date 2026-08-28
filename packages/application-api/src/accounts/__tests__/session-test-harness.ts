/**
 * Shared in-memory harness for session-security tests (task 2.5, change
 * technical-assessment-remediation).
 *
 * Plain-class fakes of the data-platform abstracts (golden-dataset
 * convention — no vi.fn()), mirroring the Drizzle contracts the real
 * services exercise:
 *
 *   - {@link InMemorySessionRows} mirrors DrizzleSessionRepository,
 *     including the rotate critical section (successor insert +
 *     predecessor revoke as one synchronous step, matching the
 *     single-transaction contract).
 *   - {@link InMemoryAccountRows} mirrors DrizzleAccountRepository
 *     row shape and generated-id semantics.
 *
 * Not a test file (vitest include matches *.test.ts only) — imported by
 * session-security.test.ts and the envelope-conformance suite.
 *
 * @module SessionTestHarness
 */

import {
  AccountRepository,
  SavedBasketRepository,
  SavedScenarioRepository,
  SessionRepository,
  accounts,
  savedBaskets,
  savedScenarios,
  sessions,
  type SessionRecord,
  type SavedScenarioRecord,
} from '@rajahinta/data-platform';
import type { ExecutionContext } from '@nestjs/common';
import { SessionTokenService } from '../session-token.service';
import { SessionAuthGuard } from '../session-auth.guard';
import { SessionController } from '../session.controller';
import { AccountService } from '../account.service';
import { DataExportService } from '../data-export.service';
import { AccountController } from '../account.controller';
import type { AuthenticatedAccount } from '../current-user.decorator';

// ---------------------------------------------------------------------------
// In-memory repository implementations
// ---------------------------------------------------------------------------

type AccountRow = typeof accounts.$inferSelect;

/** In-memory account rows — same contract as the scenarios-controller suite. */
export class InMemoryAccountRows extends AccountRepository {
  readonly rows: AccountRow[] = [];
  private nextId = 1;

  async create(record: typeof accounts.$inferInsert): Promise<AccountRow> {
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

  async setVerifiedEmail(_userId: string, _email: string): Promise<void> {}

  async delete(userId: string): Promise<void> {
    const index = this.rows.findIndex((r) => r.userId === userId);
    if (index !== -1) this.rows.splice(index, 1);
  }

  async findAllUserIds(): Promise<string[]> {
    return this.rows.map((r) => r.userId);
  }

  async anonymize(userId: string): Promise<void> {
    const row = await this.findByUserId(userId);
    if (row) row.userId = `anon_${row.id}`;
  }
}

/**
 * In-memory session rows. "Active" mirrors the SQL predicate exactly:
 * unrevoked AND expiresAt in the future. Rotation is one synchronous
 * critical section — the observable contract of the DB transaction.
 */
export class InMemorySessionRows extends SessionRepository {
  readonly rows: SessionRecord[] = [];
  private nextId = 1;

  async create(record: typeof sessions.$inferInsert): Promise<SessionRecord> {
    const row: SessionRecord = {
      id: this.nextId++,
      tokenHash: record.tokenHash,
      accountId: record.accountId,
      rotatedFromId: record.rotatedFromId ?? null,
      createdAt: new Date(),
      expiresAt: record.expiresAt,
      revokedAt: null,
    };
    this.rows.push(row);
    return row;
  }

  async findActiveByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const now = new Date();
    return (
      this.rows.find(
        (r) =>
          r.tokenHash === tokenHash && r.revokedAt === null && r.expiresAt > now,
      ) ?? null
    );
  }

  async rotate(
    tokenHash: string,
    newTokenHash: string,
    expiresAt: Date,
  ): Promise<SessionRecord | null> {
    // One synchronous critical section — no awaits between the active-row
    // check and the revoke — mirroring the single-transaction Drizzle
    // implementation (a read/write interleaving here would let two
    // concurrent rotations both succeed, which the DB row lock prevents).
    const now = new Date();
    const current = this.rows.find(
      (r) =>
        r.tokenHash === tokenHash && r.revokedAt === null && r.expiresAt > now,
    );
    if (!current) {
      return null;
    }
    const successor: SessionRecord = {
      id: this.nextId++,
      tokenHash: newTokenHash,
      accountId: current.accountId,
      rotatedFromId: current.id,
      createdAt: now,
      expiresAt,
      revokedAt: null,
    };
    this.rows.push(successor);
    current.revokedAt = now;
    return successor;
  }

  async revokeByTokenHash(tokenHash: string): Promise<boolean> {
    const row = await this.findActiveByTokenHash(tokenHash);
    if (!row) {
      return false;
    }
    row.revokedAt = new Date();
    return true;
  }

  async deleteExpiredBefore(cutoff: Date): Promise<number> {
    const doomed = this.rows.filter((r) => r.expiresAt < cutoff);
    for (const row of doomed) {
      this.rows.splice(this.rows.indexOf(row), 1);
    }
    return doomed.length;
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
    userId: string,
  ): Promise<(typeof savedBaskets.$inferSelect)[]> {
    // Join semantics: baskets come back only for a known account row.
    const account = this.accountRows.rows.find((r) => r.userId === userId);
    if (!account) return [];
    return this.findByAccountId(account.id);
  }

  async delete(id: number): Promise<void> {
    const index = this.rows.findIndex((r) => r.id === id);
    if (index !== -1) this.rows.splice(index, 1);
  }

  constructor(private readonly accountRows: InMemoryAccountRows) {
    super();
  }
}

/** Minimal scenario rows — account-scoped list for cross-account proofs. */
class InMemoryScenarioRows extends SavedScenarioRepository {
  readonly rows: SavedScenarioRecord[] = [];
  private nextId = 1;

  async findByAccountId(accountId: number): Promise<SavedScenarioRecord[]> {
    return this.rows.filter((r) => r.accountId === accountId);
  }

  async findByUserId(userId: string): Promise<SavedScenarioRecord[]> {
    const account = this.accountRows.rows.find((r) => r.userId === userId);
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

  constructor(private readonly accountRows: InMemoryAccountRows) {
    super();
  }
}

// ---------------------------------------------------------------------------
// Harness + request/response doubles
// ---------------------------------------------------------------------------

/** Everything the session tests construct, wired like AccountModule does. */
export interface SessionHarness {
  sessionTokens: SessionTokenService;
  guard: SessionAuthGuard;
  sessionController: SessionController;
  accountController: AccountController;
  accountService: AccountService;
  accountRows: InMemoryAccountRows;
  sessionRows: InMemorySessionRows;
  basketRows: InMemoryBasketRows;
  scenarioRows: InMemoryScenarioRows;
}

export function createSessionHarness(): SessionHarness {
  const accountRows = new InMemoryAccountRows();
  const basketRows = new InMemoryBasketRows(accountRows);
  const scenarioRows = new InMemoryScenarioRows(accountRows);
  const sessionRows = new InMemorySessionRows();
  const sessionTokens = new SessionTokenService(sessionRows, accountRows);
  const accountService = new AccountService(
    accountRows,
    basketRows,
    undefined,
    scenarioRows,
  );
  return {
    sessionTokens,
    guard: new SessionAuthGuard(sessionTokens),
    sessionController: new SessionController(sessionTokens, accountService),
    accountController: new AccountController(
      new DataExportService(accountService),
      accountService,
    ),
    accountService,
    accountRows,
    sessionRows,
    basketRows,
    scenarioRows,
  };
}

/** Mutable request object the guard attaches identity to. */
export interface HarnessRequest {
  headers: Record<string, string | string[] | undefined>;
  cookies: Record<string, string | undefined>;
  user?: AuthenticatedAccount;
  sessionToken?: string;
}

/** Cookie-jar-bearing request double. */
export function requestWithSessionCookie(
  token: string | undefined,
  headers: Record<string, string | string[] | undefined> = {},
): HarnessRequest {
  return {
    headers,
    cookies: token === undefined ? {} : { rajahinta_session: token },
  };
}

/** Raw-Cookie-header-only request double (fallback parsing path). */
export function requestWithRawCookieHeader(
  token: string | undefined,
  headers: Record<string, string | string[] | undefined> = {},
): HarnessRequest {
  return {
    headers: {
      ...headers,
      ...(token === undefined ? {} : { cookie: `rajahinta_session=${token}` }),
    },
    cookies: {},
  };
}

/** ExecutionContext double routing switchToHttp().getRequest() to `request`. */
export function executionContext(request: HarnessRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/** Response double capturing Set-Cookie writes (passthrough style). */
export function responseDouble(): {
  res: { header(name: string, value: string): unknown };
  cookies(): string[];
} {
  const set: string[] = [];
  return {
    res: {
      header: (name: string, value: string) => {
        if (name === 'Set-Cookie') set.push(value);
        return undefined;
      },
    },
    cookies: () => set,
  };
}

/**
 * Issue a real session for a fresh anonymous account through the
 * controller (server-generated identity, httpOnly cookie) and return the
 * raw token parsed from the Set-Cookie header.
 */
export async function issueSessionViaController(
  harness: SessionHarness,
): Promise<{ token: string; userId: string; cookie: string }> {
  const { res, cookies } = responseDouble();
  const body = await harness.sessionController.issue(res);
  const cookie = cookies().find((c) => c.startsWith('rajahinta_session='));
  if (!cookie) {
    throw new Error('session issue did not set the rajahinta_session cookie');
  }
  // Cookie value runs to the first attribute separator.
  const token = cookie
    .slice('rajahinta_session='.length)
    .split(';')[0]!;
  return { token, userId: body.userId, cookie };
}
