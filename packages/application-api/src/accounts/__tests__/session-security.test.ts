/**
 * Session security tests (task 2.5, change technical-assessment-remediation;
 * mvp-testing "Session security coverage").
 *
 * Proves, through the real SessionTokenService / SessionAuthGuard /
 * SessionController / AccountController over in-memory repositories
 * (golden-dataset convention — plain classes, no vi.fn()):
 *
 *   - issuance: server-generated identity, httpOnly cookie, hash-only at rest
 *   - forged / guessed / tampered / expired / revoked tokens are denied
 *   - the retired x-user-id header never authenticates (alone or with a
 *     valid token)
 *   - cross-account access is denied: a token reads exactly its own
 *     account's export, baskets, and scenarios — never another account's
 *   - rotation is atomic from the caller's perspective: after rotate
 *     resolves, the old token is dead and the successor authenticates the
 *     same account; a rotated token never mints a successor; two
 *     concurrent rotations of one token produce exactly one successor
 *
 * @module SessionSecurityTest
 */

import { randomBytes, createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import { SessionTokenService } from '../session-token.service';
import { SESSION_COOKIE_NAME } from '../session-cookie';
import {
  createSessionHarness,
  issueSessionViaController,
  requestWithSessionCookie,
  requestWithRawCookieHeader,
  executionContext,
  responseDouble,
  type SessionHarness,
  type HarnessRequest,
} from './session-test-harness';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run the real guard against a request; returns the attached identity. */
async function authenticate(
  harness: SessionHarness,
  request: HarnessRequest,
): Promise<{ user: NonNullable<HarnessRequest['user']>; token: string }> {
  await harness.guard.canActivate(executionContext(request));
  if (!request.user || !request.sessionToken) {
    throw new Error('guard did not attach user/sessionToken');
  }
  return { user: request.user, token: request.sessionToken };
}

/** Assert the guard denies a request with the InvalidSession 401. */
async function expectDenied(
  harness: SessionHarness,
  request: HarnessRequest,
): Promise<void> {
  await expect(harness.guard.canActivate(executionContext(request))).rejects
    .toMatchObject({
      status: 401,
      response: expect.objectContaining({ error: 'InvalidSession' }),
    });
}

/** A plausible-looking but never-issued opaque token. */
function guessedToken(): string {
  return randomBytes(32).toString('base64url');
}

// ---------------------------------------------------------------------------
// Issuance — server-side identity, httpOnly cookie, hash-only at rest
// ---------------------------------------------------------------------------

describe('Session issuance', () => {
  it('issues a server-generated identity with an httpOnly SameSite cookie', async () => {
    const harness = createSessionHarness();
    const { token, userId, cookie } = await issueSessionViaController(harness);

    // Identity is a server-generated UUID, never client-chosen.
    expect(userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    // Cookie hygiene: httpOnly, SameSite=Lax, correct name.
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    // The opaque token never appears in the response body.
    const body = await harness.sessionController.issue(responseDouble().res);
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it('stores only the SHA-256 hash — the raw token is never persisted', async () => {
    const harness = createSessionHarness();
    const { token } = await issueSessionViaController(harness);

    expect(harness.sessionRows.rows).toHaveLength(1);
    const row = harness.sessionRows.rows[0]!;
    expect(row.tokenHash).toBe(SessionTokenService.hashToken(token));
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(harness.sessionRows.rows)).not.toContain(token);
  });

  it('authenticates its own cookie via the parsed jar and the raw Cookie header', async () => {
    const harness = createSessionHarness();
    const { token, userId } = await issueSessionViaController(harness);

    const viaJar = await authenticate(harness, requestWithSessionCookie(token));
    expect(viaJar.user.userId).toBe(userId);
    expect(viaJar.token).toBe(token);

    const viaHeader = await authenticate(
      harness,
      requestWithRawCookieHeader(token),
    );
    expect(viaHeader.user.userId).toBe(userId);
  });

  it('derives the account from the token record, not from any client claim', async () => {
    const harness = createSessionHarness();
    const { token } = await issueSessionViaController(harness);
    const accountRow = harness.accountRows.rows[0]!;

    // A client asserts a different identity in every plausible place —
    // none of it influences the derived account.
    const { user } = await authenticate(
      harness,
      requestWithRawCookieHeader(token, {
        'x-account-id': String(accountRow.id + 999),
        'x-user': 'someone-else',
        'x-email': 'attacker@example.invalid',
      }),
    );
    expect(user.accountId).toBe(accountRow.id);
    expect(user.userId).toBe(accountRow.userId);
  });
});

// ---------------------------------------------------------------------------
// Forge / guess / expiry / revocation denials
// ---------------------------------------------------------------------------

describe('forged and guessed tokens are denied', () => {
  it('rejects never-issued tokens with indistinguishable 401s', async () => {
    const harness = createSessionHarness();
    await issueSessionViaController(harness); // an account exists

    for (const token of [guessedToken(), guessedToken(), guessedToken()]) {
      await expectDenied(harness, requestWithSessionCookie(token));
    }
  });

  it('rejects a tampered variant of a real token', async () => {
    const harness = createSessionHarness();
    const { token } = await issueSessionViaController(harness);

    // Single-character mutation of a valid token — must not authenticate.
    const last = token.slice(-1);
    const mutated =
      token.slice(0, -1) + (last === 'A' ? 'B' : 'A');
    await expectDenied(harness, requestWithSessionCookie(mutated));

    // Truncation and prefix-extension are denied too.
    await expectDenied(harness, requestWithSessionCookie(token.slice(0, -4)));
    await expectDenied(harness, requestWithSessionCookie(`x${token}`));
  });

  it('rejects a hash-collision-shaped forgery (raw digest presented as token)', async () => {
    const harness = createSessionHarness();
    const { token } = await issueSessionViaController(harness);
    // Presenting the stored hash itself is just another unknown token —
    // lookup hashes the presented value again.
    const digest = createHash('sha256').update(token).digest('hex');
    await expectDenied(harness, requestWithSessionCookie(digest));
  });
});

describe('expired and revoked tokens are denied', () => {
  it('rejects an expired session', async () => {
    const harness = createSessionHarness();
    const { token } = await issueSessionViaController(harness);

    // Age the session past its expiry window (issue uses the default TTL).
    const row = harness.sessionRows.rows[0]!;
    row.expiresAt = new Date(Date.now() - 1_000);

    await expectDenied(harness, requestWithSessionCookie(token));
  });

  it('rejects a revoked session (logout)', async () => {
    const harness = createSessionHarness();
    const { token } = await issueSessionViaController(harness);

    const { res, cookies } = responseDouble();
    const result = await harness.sessionController.revoke(
      { sessionToken: token },
      res,
    );
    expect(result).toEqual({ revoked: true });
    // Cookie cleared: Max-Age=0 + epoch expiry.
    expect(cookies().some((c) => c.includes('Max-Age=0'))).toBe(true);

    await expectDenied(harness, requestWithSessionCookie(token));
  });

  it('treats a missing or empty cookie as unauthenticated (SessionRequired)', async () => {
    const harness = createSessionHarness();

    for (const request of [
      requestWithSessionCookie(undefined),
      requestWithSessionCookie(''),
      { headers: {}, cookies: {} } satisfies HarnessRequest,
    ]) {
      await expect(
        harness.guard.canActivate(executionContext(request)),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ error: 'SessionRequired' }),
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Legacy x-user-id header — rejected outright
// ---------------------------------------------------------------------------

describe('legacy x-user-id header is rejected', () => {
  it('a header alone authenticates nothing (401, no compat mode)', async () => {
    const harness = createSessionHarness();
    const victim = await issueSessionViaController(harness);

    const request = requestWithSessionCookie(undefined, {
      'x-user-id': victim.userId,
    });
    await expect(harness.guard.canActivate(executionContext(request))).rejects
      .toMatchObject({
        status: 401,
        response: expect.objectContaining({
          error: 'LegacyUserIdHeaderRejected',
        }),
      });
  });

  it('a valid session PLUS the header is still rejected outright', async () => {
    const harness = createSessionHarness();
    const own = await issueSessionViaController(harness);
    const other = await issueSessionViaController(harness);

    // Valid own token + another account's identifier via the legacy
    // header: the impersonation vector must stay dead even for
    // authenticated callers.
    const request = requestWithSessionCookie(own.token, {
      'x-user-id': other.userId,
    });
    await expect(harness.guard.canActivate(executionContext(request))).rejects
      .toMatchObject({
        status: 401,
        response: expect.objectContaining({
          error: 'LegacyUserIdHeaderRejected',
        }),
      });
  });

  it('an empty header value is treated as absent and does not break token auth', async () => {
    const harness = createSessionHarness();
    const { token, userId } = await issueSessionViaController(harness);

    const { user } = await authenticate(
      harness,
      requestWithSessionCookie(token, { 'x-user-id': '   ' }),
    );
    expect(user.userId).toBe(userId);
  });
});

// ---------------------------------------------------------------------------
// Cross-account access denied (GDPR export + scenarios paths)
// ---------------------------------------------------------------------------

describe('cross-account access is denied', () => {
  type TwoAccounts = {
    harness: SessionHarness;
    tokenA: string;
    tokenB: string;
    userIdA: string;
    userIdB: string;
  };

  async function twoAccountsWithData(): Promise<TwoAccounts> {
    const harness = createSessionHarness();
    const a = await issueSessionViaController(harness);
    const b = await issueSessionViaController(harness);

    const rowA = harness.accountRows.rows.find((r) => r.userId === a.userId)!;
    const rowB = harness.accountRows.rows.find((r) => r.userId === b.userId)!;

    await harness.basketRows.create({
      accountId: rowA.id,
      name: 'A-secret-basket',
      items: [{ productId: 1, productName: 'A-beer', quantity: 6 }],
    });
    await harness.basketRows.create({
      accountId: rowB.id,
      name: 'B-secret-basket',
      items: [{ productId: 2, productName: 'B-wine', quantity: 3 }],
    });
    await harness.scenarioRows.upsert({
      accountId: rowA.id,
      name: 'A-secret-scenario',
      inputs: { productId: 1, quantity: 6, destination: 'FI' },
    });
    await harness.scenarioRows.upsert({
      accountId: rowB.id,
      name: 'B-secret-scenario',
      inputs: { productId: 2, quantity: 3, destination: 'FI' },
    });

    return {
      harness,
      tokenA: a.token,
      tokenB: b.token,
      userIdA: a.userId,
      userIdB: b.userId,
    };
  }

  it("a token reads exactly its own export — never the other account's data", async () => {
    const { harness, tokenA, userIdB } = await twoAccountsWithData();
    const { user } = await authenticate(harness, requestWithSessionCookie(tokenA));

    const exportA = await harness.accountController.exportData(user);
    const serialized = JSON.stringify(exportA);

    expect(exportA.userId).toBe(user.userId);
    expect(serialized).toContain('A-secret-basket');
    expect(serialized).toContain('A-secret-scenario');
    // B's identifiers and data are absent from A's export.
    expect(serialized).not.toContain('B-secret-basket');
    expect(serialized).not.toContain('B-secret-scenario');
    expect(serialized).not.toContain(userIdB);
    expect(exportA.savedBaskets).toHaveLength(1);
  });

  it("a token lists exactly its own baskets and scenarios", async () => {
    const { harness, tokenA } = await twoAccountsWithData();
    const { user } = await authenticate(harness, requestWithSessionCookie(tokenA));

    const baskets = await harness.accountController.listBaskets(user);
    const scenarios = await harness.accountController.listScenarios(user);

    expect(baskets.map((b) => b.name)).toEqual(['A-secret-basket']);
    expect(scenarios.map((s) => s.name)).toEqual(['A-secret-scenario']);
  });

  it("deleting the other account's scenario is a 404, never a cross-account delete", async () => {
    const { harness, tokenA } = await twoAccountsWithData();
    const { user } = await authenticate(harness, requestWithSessionCookie(tokenA));
    const bScenario = harness.scenarioRows.rows.find(
      (r) => r.name === 'B-secret-scenario',
    )!;

    await expect(
      harness.accountController.deleteScenario(bScenario.id, user),
    ).rejects.toBeInstanceOf(NotFoundException);

    // B's scenario survives A's attempt.
    expect(harness.scenarioRows.rows).toContain(bScenario);
  });

  it('an impersonation attempt via the legacy header never reaches the data layer', async () => {
    const { harness, tokenA, userIdB } = await twoAccountsWithData();

    // A's valid token + B's identity via the retired header — the guard
    // rejects the request outright, so no controller path can execute
    // with B's identity.
    const request = requestWithSessionCookie(tokenA, { 'x-user-id': userIdB });
    await expect(harness.guard.canActivate(executionContext(request))).rejects
      .toBeInstanceOf(UnauthorizedException);
    expect(request.user).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Rotation — atomic invalidation of the old token
// ---------------------------------------------------------------------------

describe('token rotation', () => {
  it('old token dies immediately, the successor authenticates the same account', async () => {
    const harness = createSessionHarness();
    const { token, userId } = await issueSessionViaController(harness);

    const { res, cookies } = responseDouble();
    const request = requestWithSessionCookie(token);
    const { user } = await authenticate(harness, request);
    const body = await harness.sessionController.rotate(user, request, res);

    // Same account, new cookie issued for the successor token.
    expect(body.userId).toBe(userId);
    const newCookie = cookies().find((c) =>startsWithSessionCookie(c));
    expect(newCookie).toBeDefined();
    expect(newCookie).toContain('HttpOnly');
    const newToken = newCookie!.slice(`${SESSION_COOKIE_NAME}=`.length).split(';')[0]!;

    // Atomic switch, observed in the same tick after rotate resolves:
    // never both valid, never neither valid.
    await expectDenied(harness, requestWithSessionCookie(token));
    const viaNew = await authenticate(harness, requestWithSessionCookie(newToken));
    expect(viaNew.user.userId).toBe(userId);
  });

  it('links the successor to the revoked predecessor (audit chain)', async () => {
    const harness = createSessionHarness();
    const { token } = await issueSessionViaController(harness);
    const predecessor = harness.sessionRows.rows[0]!;

    const issued = await harness.sessionTokens.rotateSessionToken(token);
    expect(issued).not.toBeNull();

    const successor = harness.sessionRows.rows.find(
      (r) => r.id === issued!.session.id,
    )!;
    expect(successor.rotatedFromId).toBe(predecessor.id);
    expect(predecessor.revokedAt).not.toBeNull();
    expect(successor.revokedAt).toBeNull();
  });

  it('a rotated token never mints a successor', async () => {
    const harness = createSessionHarness();
    const { token } = await issueSessionViaController(harness);

    const first = await harness.sessionTokens.rotateSessionToken(token);
    expect(first).not.toBeNull();

    // The now-dead token cannot rotate again — and neither can a guess.
    await expect(harness.sessionTokens.rotateSessionToken(token)).resolves.toBeNull();
    await expect(harness.sessionTokens.rotateSessionToken(guessedToken())).resolves.toBeNull();
  });

  it('two concurrent rotations of one token produce exactly one successor', async () => {
    const harness = createSessionHarness();
    const { token, userId } = await issueSessionViaController(harness);

    const results = await Promise.all([
      harness.sessionTokens.rotateSessionToken(token),
      harness.sessionTokens.rotateSessionToken(token),
    ]);

    const successors = results.filter((r) => r !== null);
    expect(successors).toHaveLength(1);

    // Exactly one live credential afterwards: the winner's token works,
    // the loser never existed, and the original is dead.
    const winner = successors[0]!;
    expect(harness.sessionRows.rows.filter((r) => r.revokedAt === null)).toHaveLength(1);
    const viaWinner = await authenticate(harness, requestWithSessionCookie(winner.token));
    expect(viaWinner.user.userId).toBe(userId);
    await expectDenied(harness, requestWithSessionCookie(token));
  });

  it('the session survives an email upgrade (links to the row, not the email)', async () => {
    const harness = createSessionHarness();
    const { token } = await issueSessionViaController(harness);

    // Anonymous-upgrade write (task 2.4) lands on the account row; the
    // SAME session token keeps authenticating and now reports verified.
    const row = harness.accountRows.rows[0]!;
    row.email = 'verified@example.invalid';

    const { user } = await authenticate(harness, requestWithSessionCookie(token));
    expect(user.userId).toBe(row.userId);
    expect(user.verified).toBe(true);
  });
});

/** String.startsWith helper kept inline for readability above. */
function startsWithSessionCookie(cookie: string): boolean {
  return cookie.startsWith(`${SESSION_COOKIE_NAME}=`);
}
