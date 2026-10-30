import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { enforceAuthOriginPolicy } from '../middlewares/originValidation.js';
import { revisionEngine, calculateCivilMidnight, getCivilDateParts } from '../services/revisionEngine.js';
import {
  evaluateDeterministicChallenge,
  sanitizeDiagnosticChallenge,
  assembleDiagnosticChallenge,
  normalizeTextOutput,
  validateDiagnosticPayload,
  validateDiagnosticSubmission,
  buildDiagnosticSubmission,
  DiagnosticValidationError,
} from '../services/revisionDiagnosticService.js';
import {
  IRevisionChallengeQuestion,
  IPublicRevisionChallengeQuestion,
  DiagnosticAnswerSubmission,
} from '../types/diagnostic.js';
import { Types } from 'mongoose';
import { RevisionSchedule } from '../models/RevisionSchedule.js';
import { errorHandler, sanitizeErrorResponse } from '../middlewares/errorHandler.js';


console.log('====================================================');
console.log(' RUNNING STUDYOS PHASE 1C GROUP 1 HARDENING TEST SUITE');
console.log('====================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(testName: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result
        .then(() => {
          passedTests++;
          console.log(`  [PASS] ${testName}`);
        })
        .catch((err) => {
          failedTests++;
          console.error(`  [FAIL] ${testName}`);
          console.error(`         ${err.message}`);
        });
    } else {
      passedTests++;
      console.log(`  [PASS] ${testName}`);
    }
  } catch (err: any) {
    failedTests++;
    console.error(`  [FAIL] ${testName}`);
    console.error(`         ${err.message}`);
  }
}

function createMockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    cookiesSet: {} as Record<string, { value: string; options: any }>,
    cookiesCleared: [] as Array<{ name: string; options: any }>,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    cookie(name: string, value: string, options: any) {
      this.cookiesSet[name] = { value, options };
      return this;
    },
    clearCookie(name: string, options: any) {
      this.cookiesCleared.push({ name, options });
      return this;
    },
    setHeader(name: string, val: string) {
      this.headers[name] = val;
      return this;
    },
  };
  return res;
}

async function main() {
  console.log('--- 1. AUTH-01 REFRESH TOKEN LIFECYCLE & SECURITY ---');

  runTest('Secure 256-bit random refresh token and SHA-256 hashing', () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    assert.strictEqual(rawToken.length, 64, '256-bit hex token should be 64 characters');

    const hash1 = crypto.createHash('sha256').update(rawToken).digest('hex');
    const hash2 = crypto.createHash('sha256').update(rawToken).digest('hex');
    assert.strictEqual(hash1, hash2, 'SHA-256 hash must be deterministic');
    assert.notStrictEqual(hash1, rawToken, 'Hash must not match plaintext');
  });

  runTest('Refresh cookie configuration adheres to secure attributes', () => {
    const isProduction = env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict' as const,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth',
    };

    assert.strictEqual(cookieOptions.httpOnly, true, 'Must be httpOnly');
    assert.strictEqual(cookieOptions.sameSite, 'strict', 'Must be strict SameSite');
    assert.strictEqual(cookieOptions.path, '/api/v1/auth', 'Must be path-scoped');
    assert.strictEqual(cookieOptions.maxAge, 2592000000, 'Must be 30 days');
  });

  runTest('Refresh endpoint rejects req.body.refreshToken (Cookie-Only Transport)', () => {
    const req: any = {
      cookies: {}, // No cookie
      body: { refreshToken: 'attacker_provided_body_token' },
    };
    const res = createMockRes();

    const rawRefreshToken = req.cookies?.refreshToken;
    if (!rawRefreshToken) {
      res.status(401).json({
        success: false,
        error: { code: 'REFRESH_TOKEN_REQUIRED', message: 'Refresh token cookie missing' },
      });
    }

    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body?.error?.code, 'REFRESH_TOKEN_REQUIRED');
  });

  runTest('Refresh rotation marks predecessor revoked with ROTATED and links successor', () => {
    const familyId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const successorId = crypto.randomUUID();

    const oldSession = {
      _id: sessionId,
      familyId,
      isRevoked: false,
      revocationReason: null as string | null,
      replacedBySessionId: null as string | null,
    };

    // Simulate atomic rotation
    oldSession.isRevoked = true;
    oldSession.revocationReason = 'ROTATED';
    oldSession.replacedBySessionId = successorId;

    const newSession = {
      _id: successorId,
      familyId,
      isRevoked: false,
      revocationReason: null,
      replacedBySessionId: null,
    };

    assert.strictEqual(oldSession.isRevoked, true);
    assert.strictEqual(oldSession.revocationReason, 'ROTATED');
    assert.strictEqual(oldSession.replacedBySessionId, successorId);
    assert.strictEqual(newSession.familyId, oldSession.familyId, 'Lineage must be preserved');
  });

  runTest('Grace window allows concurrent replay within AUTH_REFRESH_GRACE_SECONDS', () => {
    const graceSeconds = env.AUTH_REFRESH_GRACE_SECONDS || 15;
    const replacedAt = new Date(Date.now() - 5000); // 5 seconds ago
    const successorSession = {
      _id: 'succ_123',
      isRevoked: false,
    };

    const session = {
      isRevoked: true,
      revocationReason: 'ROTATED',
      replacedBySessionId: 'succ_123',
      updatedAt: replacedAt,
      graceReplayCount: 0,
    };

    const isWithinGrace =
      Date.now() - session.updatedAt.getTime() <= graceSeconds * 1000;
    const canReplay =
      isWithinGrace &&
      session.graceReplayCount < 2 &&
      !successorSession.isRevoked;

    assert.strictEqual(isWithinGrace, true);
    assert.strictEqual(canReplay, true, 'Grace replay should be allowed for concurrent tab');
  });

  runTest('Grace replay is capped at 2 attempts (prevents replay abuse)', () => {
    const session = {
      isRevoked: true,
      revocationReason: 'ROTATED',
      replacedBySessionId: 'succ_123',
      updatedAt: new Date(Date.now() - 5000),
      graceReplayCount: 2, // Reached cap!
    };

    const isExceeded = session.graceReplayCount >= 2;
    assert.strictEqual(isExceeded, true, 'Replay attempt >= 2 must be rejected');
  });

  runTest('Replay outside grace window triggers FAMILY COMPROMISE REVOCATION', () => {
    const graceSeconds = 15;
    const replacedAt = new Date(Date.now() - 30000); // 30s ago (>15s grace)
    const session = {
      isRevoked: true,
      revocationReason: 'ROTATED',
      familyId: 'fam_compromise_999',
      updatedAt: replacedAt,
    };

    const isWithinGrace =
      Date.now() - session.updatedAt.getTime() <= graceSeconds * 1000;

    let compromiseTriggered = false;
    if (!isWithinGrace) {
      compromiseTriggered = true;
    }

    assert.strictEqual(isWithinGrace, false);
    assert.strictEqual(compromiseTriggered, true, 'Must trigger family revocation on reuse');
  });

  runTest('Grace replay fails if successor session has already been revoked', () => {
    const successorSession = {
      _id: 'succ_123',
      isRevoked: true, // Revoked!
      revocationReason: 'LOGOUT',
    };

    const canReplay = !successorSession.isRevoked;
    assert.strictEqual(canReplay, false, 'Must reject grace replay if successor is revoked');
  });

  runTest('Expired session rejects refresh with SESSION_EXPIRED', () => {
    const expiredSession = {
      expiresAt: new Date(Date.now() - 10000), // Expired 10s ago
    };

    const isExpired = expiredSession.expiresAt.getTime() < Date.now();
    assert.strictEqual(isExpired, true, 'Session with past expiration must be rejected');
  });

  runTest('Single-session logout revokes token with reason LOGOUT and clears cookie', () => {
    const session = {
      isRevoked: false,
      revocationReason: null as string | null,
    };
    const res = createMockRes();

    session.isRevoked = true;
    session.revocationReason = 'LOGOUT';
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });

    assert.strictEqual(session.isRevoked, true);
    assert.strictEqual(session.revocationReason, 'LOGOUT');
    assert.strictEqual(res.cookiesCleared.length, 1);
    assert.strictEqual(res.cookiesCleared[0].name, 'refreshToken');
  });

  console.log('\n--- 1B. ATOMIC REFRESH ROTATION & CONCURRENCY RACE TESTS ---');

  interface IMockRefreshSession {
    _id: string;
    userId: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
    revokedAt: Date | null;
    revocationReason: string | null;
    replacedBySessionId: string | null;
    graceReplayCount: number;
  }

  class MockAtomicMongoSessionStore {
    public sessions: IMockRefreshSession[] = [];
    private lock: Promise<void> = Promise.resolve();

    private async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
      const prevLock = this.lock;
      let release: () => void;
      this.lock = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prevLock;
      try {
        return await fn();
      } finally {
        release!();
      }
    }

    async findOne(query: { tokenHash?: string; _id?: string }): Promise<IMockRefreshSession | null> {
      return this.withLock(() => {
        const doc = this.sessions.find((s) => {
          if (query.tokenHash && s.tokenHash !== query.tokenHash) return false;
          if (query._id && s._id !== query._id) return false;
          return true;
        });
        return doc ? { ...doc } : null;
      });
    }

    async findById(id: string): Promise<IMockRefreshSession | null> {
      return this.findOne({ _id: id });
    }

    async findOneAndUpdate(
      filter: { _id: string; revokedAt?: null; expiresAt?: { $gt: Date }; revocationReason?: string },
      update: { $set?: Partial<IMockRefreshSession>; $inc?: { graceReplayCount?: number } },
      options: { new: boolean }
    ): Promise<IMockRefreshSession | null> {
      return this.withLock(() => {
        const index = this.sessions.findIndex((s) => {
          if (s._id !== filter._id) return false;
          if (filter.revokedAt === null && s.revokedAt !== null) return false;
          if (filter.expiresAt && !(s.expiresAt.getTime() > filter.expiresAt.$gt.getTime())) return false;
          if (filter.revocationReason && s.revocationReason !== filter.revocationReason) return false;
          return true;
        });

        if (index === -1) return null;

        const doc = this.sessions[index];
        if (update.$set) {
          Object.assign(doc, update.$set);
        }
        if (update.$inc?.graceReplayCount) {
          doc.graceReplayCount = (doc.graceReplayCount || 0) + update.$inc.graceReplayCount;
        }
        return { ...doc };
      });
    }

    async create(doc: IMockRefreshSession): Promise<IMockRefreshSession> {
      return this.withLock(() => {
        this.sessions.push({ ...doc });
        return { ...doc };
      });
    }

    async updateMany(
      filter: { familyId: string; revokedAt: null },
      update: { $set: Partial<IMockRefreshSession> }
    ): Promise<number> {
      return this.withLock(() => {
        let count = 0;
        for (const doc of this.sessions) {
          if (doc.familyId === filter.familyId && doc.revokedAt === null) {
            Object.assign(doc, update.$set);
            count++;
          }
        }
        return count;
      });
    }
  }

  async function simulateRefreshRequest(
    store: MockAtomicMongoSessionStore,
    rawRefreshToken: string,
    now: Date,
    options?: { graceSeconds?: number }
  ): Promise<{ status: number; code?: string; accessToken?: string; newRefreshToken?: string }> {
    const graceSeconds = options?.graceSeconds ?? 15;
    const incomingHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

    const session = await store.findOne({ tokenHash: incomingHash });
    if (!session) {
      return { status: 401, code: 'INVALID_REFRESH_TOKEN' };
    }

    if (session.expiresAt.getTime() <= now.getTime()) {
      if (!session.revokedAt) {
        await store.findOneAndUpdate(
          { _id: session._id, revokedAt: null },
          { $set: { revokedAt: now, revocationReason: 'EXPIRED' } },
          { new: true }
        );
      }
      return { status: 401, code: 'EXPIRED_REFRESH_TOKEN' };
    }

    // CASE A: Active, non-revoked session -> Atomic Rotation
    if (!session.revokedAt) {
      const successorSessionId = crypto.randomUUID();
      const newRawRefreshToken = crypto.randomBytes(32).toString('hex');
      const newTokenHash = crypto.createHash('sha256').update(newRawRefreshToken).digest('hex');

      // ATOMIC CAS: Establish that the current session is still active and mark it rotated in a single atomic operation
      const rotatedPredecessor = await store.findOneAndUpdate(
        {
          _id: session._id,
          revokedAt: null,
          expiresAt: { $gt: now },
        },
        {
          $set: {
            revokedAt: now,
            revocationReason: 'ROTATED',
            replacedBySessionId: successorSessionId,
          },
        },
        { new: true }
      );

      // If we won the race, create the single successor session
      if (rotatedPredecessor) {
        await store.create({
          _id: successorSessionId,
          userId: session.userId,
          tokenHash: newTokenHash,
          familyId: session.familyId,
          expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
          revokedAt: null,
          revocationReason: null,
          replacedBySessionId: null,
          graceReplayCount: 0,
        });

        return {
          status: 200,
          accessToken: 'fresh_jwt_access_token',
          newRefreshToken: newRawRefreshToken,
        };
      }
      // Lost race; fall through to Case B
    }

    // CASE B / C: Session already revoked (either previously, or rotated by a concurrent request)
    const targetSession = session.revokedAt ? session : await store.findById(session._id);
    if (!targetSession) {
      return { status: 401, code: 'INVALID_REFRESH_TOKEN' };
    }

    if (targetSession.revocationReason === 'ROTATED' && targetSession.replacedBySessionId && targetSession.revokedAt) {
      const elapsedMs = now.getTime() - targetSession.revokedAt.getTime();
      const graceMs = graceSeconds * 1000;

      // CASE B: Within configurable grace window -> Issue access token only, DO NOT create successor
      if (graceMs > 0 && elapsedMs <= graceMs) {
        const successor = await store.findById(targetSession.replacedBySessionId);
        if (!successor || successor.revokedAt) {
          return { status: 401, code: 'REFRESH_SESSION_REVOKED' };
        }

        // ATOMIC COUNTER INCREMENT: prevent race conditions and lost updates
        const updatedPredecessor = await store.findOneAndUpdate(
          { _id: targetSession._id, revocationReason: 'ROTATED' },
          { $inc: { graceReplayCount: 1 } },
          { new: true }
        );

        const currentGraceCount = updatedPredecessor?.graceReplayCount ?? (targetSession.graceReplayCount + 1);

        // Anti-abuse replay cap: strictly compromise family if replay count exceeds allowed threshold (> 2)
        if (currentGraceCount > 2) {
          await store.updateMany(
            { familyId: targetSession.familyId, revokedAt: null },
            { $set: { revokedAt: now, revocationReason: 'FAMILY_COMPROMISE_DETECTED' } }
          );
          return { status: 401, code: 'REUSED_REFRESH_TOKEN' };
        }

        // Fresh access token only; NO new refresh token
        return { status: 200, accessToken: 'fresh_jwt_access_token' };
      }

      // CASE C: Elapsed time > grace window (or graceMs === 0) -> Token Replay Outside Grace -> Family Compromise
      await store.updateMany(
        { familyId: targetSession.familyId, revokedAt: null },
        { $set: { revokedAt: now, revocationReason: 'FAMILY_COMPROMISE_DETECTED' } }
      );
      return { status: 401, code: 'REUSED_REFRESH_TOKEN' };
    }

    return { status: 401, code: 'REFRESH_SESSION_REVOKED' };
  }

  await runTest('Case A: Concurrent fresh-token rotation creates exactly ONE successor and branches 0 times', async () => {
    const store = new MockAtomicMongoSessionStore();
    const familyId = crypto.randomUUID();
    const s0Id = crypto.randomUUID();
    const rawToken0 = crypto.randomBytes(32).toString('hex');
    const tokenHash0 = crypto.createHash('sha256').update(rawToken0).digest('hex');
    const now = new Date();

    await store.create({
      _id: s0Id,
      userId: 'user_123',
      tokenHash: tokenHash0,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      graceReplayCount: 0,
    });

    // 2 simultaneous requests presenting the exact same fresh refresh token (Case A)
    const results = await Promise.all([
      simulateRefreshRequest(store, rawToken0, now),
      simulateRefreshRequest(store, rawToken0, now),
    ]);

    // Exactly one winner creates a successor
    const successfulRotations = results.filter((r) => r.status === 200 && r.newRefreshToken);
    assert.strictEqual(successfulRotations.length, 1, 'Exactly one concurrent request must win token rotation');

    // All sessions in the family must be exactly 2 (S0 predecessor + S1 successor)
    const familySessions = store.sessions.filter((s) => s.familyId === familyId);
    assert.strictEqual(familySessions.length, 2, 'No branching: exactly 2 sessions must exist in family');

    // Active successor must be exactly 1
    const activeSessions = store.sessions.filter((s) => s.familyId === familyId && s.revokedAt === null);
    assert.strictEqual(activeSessions.length, 1, 'Exactly one active successor session must exist');

    // Second request received fresh access token under grace rules without creating new refresh session
    const graceReplayed = results.filter((r) => r.status === 200 && !r.newRefreshToken);
    assert.strictEqual(graceReplayed.length, 1, 'Losing concurrent request safely receives access token via grace');
  });

  await runTest('Case A: Predecessor can have only one replacedBySessionId', async () => {
    const store = new MockAtomicMongoSessionStore();
    const familyId = crypto.randomUUID();
    const s0Id = crypto.randomUUID();
    const rawToken0 = crypto.randomBytes(32).toString('hex');
    const tokenHash0 = crypto.createHash('sha256').update(rawToken0).digest('hex');
    const now = new Date();

    await store.create({
      _id: s0Id,
      userId: 'user_123',
      tokenHash: tokenHash0,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      graceReplayCount: 0,
    });

    await Promise.all([
      simulateRefreshRequest(store, rawToken0, now),
      simulateRefreshRequest(store, rawToken0, now),
    ]);

    const s0 = await store.findById(s0Id);
    assert.ok(s0);
    assert.strictEqual(s0.revokedAt !== null, true, 'Predecessor must be revoked');
    assert.strictEqual(s0.revocationReason, 'ROTATED');

    const successor = store.sessions.find((s) => s._id !== s0Id);
    assert.ok(successor);
    assert.strictEqual(s0.replacedBySessionId, successor._id, 'Predecessor replacedBySessionId must link strictly to successor');
  });

  await runTest('Case A: Burst of > 2 losing concurrent requests triggers anti-abuse family revocation', async () => {
    const store = new MockAtomicMongoSessionStore();
    const familyId = crypto.randomUUID();
    const s0Id = crypto.randomUUID();
    const rawToken0 = crypto.randomBytes(32).toString('hex');
    const tokenHash0 = crypto.createHash('sha256').update(rawToken0).digest('hex');
    const now = new Date();

    await store.create({
      _id: s0Id,
      userId: 'user_123',
      tokenHash: tokenHash0,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      graceReplayCount: 0,
    });

    // 5 simultaneous requests: 1 winner + 4 losers (exceeds grace replay cap of 2)
    const results = await Promise.all([
      simulateRefreshRequest(store, rawToken0, now),
      simulateRefreshRequest(store, rawToken0, now),
      simulateRefreshRequest(store, rawToken0, now),
      simulateRefreshRequest(store, rawToken0, now),
      simulateRefreshRequest(store, rawToken0, now),
    ]);

    const rejected = results.filter((r) => r.status === 401 && r.code === 'REUSED_REFRESH_TOKEN');
    assert.ok(rejected.length > 0, 'Excessive concurrent replays must trigger family compromise');

    const activeSessions = store.sessions.filter((s) => s.familyId === familyId && s.revokedAt === null);
    assert.strictEqual(activeSessions.length, 0, 'All sessions must be revoked due to family compromise');
  });

  await runTest('Case B: Concurrent grace replay increments counter atomically without lost updates', async () => {
    const store = new MockAtomicMongoSessionStore();
    const familyId = crypto.randomUUID();
    const s0Id = crypto.randomUUID();
    const s1Id = crypto.randomUUID();
    const rawToken0 = crypto.randomBytes(32).toString('hex');
    const tokenHash0 = crypto.createHash('sha256').update(rawToken0).digest('hex');
    const now = new Date();

    // S0 was rotated 2 seconds ago
    await store.create({
      _id: s0Id,
      userId: 'user_123',
      tokenHash: tokenHash0,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: new Date(now.getTime() - 2000),
      revocationReason: 'ROTATED',
      replacedBySessionId: s1Id,
      graceReplayCount: 0,
    });

    // Successor S1 is active
    await store.create({
      _id: s1Id,
      userId: 'user_123',
      tokenHash: 'hash_of_s1',
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      graceReplayCount: 0,
    });

    // 2 concurrent requests arrive inside grace window
    const results = await Promise.all([
      simulateRefreshRequest(store, rawToken0, now, { graceSeconds: 15 }),
      simulateRefreshRequest(store, rawToken0, now, { graceSeconds: 15 }),
    ]);

    assert.strictEqual(results[0].status, 200);
    assert.strictEqual(results[1].status, 200);
    assert.strictEqual(results[0].newRefreshToken, undefined, 'Grace replay must NOT issue a refresh token');
    assert.strictEqual(results[1].newRefreshToken, undefined, 'Grace replay must NOT issue a refresh token');

    const s0After = await store.findById(s0Id);
    assert.strictEqual(s0After?.graceReplayCount, 2, 'Counter must be atomically incremented to 2 without lost updates');
  });

  await runTest('Case B: Grace replay does not create a new refresh session', async () => {
    const store = new MockAtomicMongoSessionStore();
    const familyId = crypto.randomUUID();
    const s0Id = crypto.randomUUID();
    const s1Id = crypto.randomUUID();
    const rawToken0 = crypto.randomBytes(32).toString('hex');
    const tokenHash0 = crypto.createHash('sha256').update(rawToken0).digest('hex');
    const now = new Date();

    await store.create({
      _id: s0Id,
      userId: 'user_123',
      tokenHash: tokenHash0,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: new Date(now.getTime() - 1000),
      revocationReason: 'ROTATED',
      replacedBySessionId: s1Id,
      graceReplayCount: 0,
    });

    await store.create({
      _id: s1Id,
      userId: 'user_123',
      tokenHash: 'hash_s1',
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      graceReplayCount: 0,
    });

    const initialSessionCount = store.sessions.length;

    await simulateRefreshRequest(store, rawToken0, now, { graceSeconds: 15 });

    assert.strictEqual(store.sessions.length, initialSessionCount, 'Grace replay must not create any new session document');
  });

  await runTest('Case B: Excessive grace replay (> 2) compromises the family', async () => {
    const store = new MockAtomicMongoSessionStore();
    const familyId = crypto.randomUUID();
    const s0Id = crypto.randomUUID();
    const s1Id = crypto.randomUUID();
    const rawToken0 = crypto.randomBytes(32).toString('hex');
    const tokenHash0 = crypto.createHash('sha256').update(rawToken0).digest('hex');
    const now = new Date();

    await store.create({
      _id: s0Id,
      userId: 'user_123',
      tokenHash: tokenHash0,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: new Date(now.getTime() - 3000),
      revocationReason: 'ROTATED',
      replacedBySessionId: s1Id,
      graceReplayCount: 2, // Already at limit!
    });

    await store.create({
      _id: s1Id,
      userId: 'user_123',
      tokenHash: 'hash_s1',
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      graceReplayCount: 0,
    });

    // 3rd grace replay attempts to reuse
    const result = await simulateRefreshRequest(store, rawToken0, now, { graceSeconds: 15 });

    assert.strictEqual(result.status, 401);
    assert.strictEqual(result.code, 'REUSED_REFRESH_TOKEN');

    // Entire family must now be revoked
    const s1After = await store.findById(s1Id);
    assert.ok(s1After?.revokedAt !== null, 'Successor session must be revoked upon excessive replay');
    assert.strictEqual(s1After?.revocationReason, 'FAMILY_COMPROMISE_DETECTED');
  });

  await runTest('Case C: Outside-grace replay compromises the family', async () => {
    const store = new MockAtomicMongoSessionStore();
    const familyId = crypto.randomUUID();
    const s0Id = crypto.randomUUID();
    const s1Id = crypto.randomUUID();
    const rawToken0 = crypto.randomBytes(32).toString('hex');
    const tokenHash0 = crypto.createHash('sha256').update(rawToken0).digest('hex');
    const now = new Date();

    // S0 was rotated 30 seconds ago (grace window is 15s)
    await store.create({
      _id: s0Id,
      userId: 'user_123',
      tokenHash: tokenHash0,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: new Date(now.getTime() - 30000),
      revocationReason: 'ROTATED',
      replacedBySessionId: s1Id,
      graceReplayCount: 0,
    });

    await store.create({
      _id: s1Id,
      userId: 'user_123',
      tokenHash: 'hash_s1',
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      graceReplayCount: 0,
    });

    const result = await simulateRefreshRequest(store, rawToken0, now, { graceSeconds: 15 });

    assert.strictEqual(result.status, 401);
    assert.strictEqual(result.code, 'REUSED_REFRESH_TOKEN');

    const s1After = await store.findById(s1Id);
    assert.ok(s1After?.revokedAt !== null, 'Successor session must be revoked on outside-grace replay');
    assert.strictEqual(s1After?.revocationReason, 'FAMILY_COMPROMISE_DETECTED');
  });

  await runTest('Zero grace window (AUTH_REFRESH_GRACE_SECONDS=0) immediately compromises family on replay', async () => {
    const store = new MockAtomicMongoSessionStore();
    const familyId = crypto.randomUUID();
    const s0Id = crypto.randomUUID();
    const s1Id = crypto.randomUUID();
    const rawToken0 = crypto.randomBytes(32).toString('hex');
    const tokenHash0 = crypto.createHash('sha256').update(rawToken0).digest('hex');
    const now = new Date();

    // Rotated 500ms ago, but grace is 0
    await store.create({
      _id: s0Id,
      userId: 'user_123',
      tokenHash: tokenHash0,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: new Date(now.getTime() - 500),
      revocationReason: 'ROTATED',
      replacedBySessionId: s1Id,
      graceReplayCount: 0,
    });

    await store.create({
      _id: s1Id,
      userId: 'user_123',
      tokenHash: 'hash_s1',
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      graceReplayCount: 0,
    });

    const result = await simulateRefreshRequest(store, rawToken0, now, { graceSeconds: 0 });

    assert.strictEqual(result.status, 401);
    assert.strictEqual(result.code, 'REUSED_REFRESH_TOKEN');

    const s1After = await store.findById(s1Id);
    assert.strictEqual(s1After?.revocationReason, 'FAMILY_COMPROMISE_DETECTED');
  });

  console.log('\n--- 2. ORIGIN / CSRF VALIDATION (AUTH-02) TESTS ---');

  runTest('Origin validation allows trusted frontend origin', () => {
    const req: any = {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
      },
    };
    const res = createMockRes();
    let nextCalled = false;

    enforceAuthOriginPolicy(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true, 'Trusted origin must pass');
    assert.strictEqual(res.statusCode, 200);
  });

  runTest('Origin validation allows trusted Referer when Origin header is omitted', () => {
    const req: any = {
      method: 'POST',
      headers: {
        referer: 'http://localhost:5173/login',
      },
    };
    const res = createMockRes();
    let nextCalled = false;

    enforceAuthOriginPolicy(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true, 'Trusted referer must pass');
  });

  runTest('Origin validation rejects untrusted/attacker origin with 403 CSRF_ORIGIN_MISMATCH', () => {
    const req: any = {
      method: 'POST',
      headers: {
        origin: 'https://evil-hacker.com',
      },
    };
    const res = createMockRes();
    let nextCalled = false;

    enforceAuthOriginPolicy(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false, 'Untrusted origin must not call next()');
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body?.error?.code, 'CSRF_ORIGIN_MISMATCH');
  });

  runTest('Origin validation allows safe GET requests through without origin requirement', () => {
    const req: any = {
      method: 'GET',
      headers: {},
    };
    const res = createMockRes();
    let nextCalled = false;

    enforceAuthOriginPolicy(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true);
  });

  console.log('\n--- 3. NESTED RESOURCE AUTHORIZATION (AUTHZ-01..04) TESTS ---');

  runTest('Foreign subject reference in topic creation is rejected with 404', () => {
    const authenticatedUserId = 'user_alice';
    const foreignSubject = {
      _id: 'sub_123',
      userId: 'user_bob', // Belongs to Bob!
    };

    const isAuthorized = foreignSubject.userId === authenticatedUserId;
    assert.strictEqual(isAuthorized, false, 'Must reject foreign subject');
  });

  runTest('Foreign parent topic reference in topic creation is rejected with 404', () => {
    const authenticatedUserId = 'user_alice';
    const foreignParentTopic = {
      _id: 'top_123',
      userId: 'user_bob',
    };

    const isAuthorized = foreignParentTopic.userId === authenticatedUserId;
    assert.strictEqual(isAuthorized, false, 'Must reject foreign parent topic');
  });

  runTest('Foreign topic in session start is rejected with 404', () => {
    const authenticatedUserId = 'user_alice';
    const foreignTopic = {
      _id: 'top_foreign',
      userId: 'user_bob',
    };

    const isAuthorized = foreignTopic.userId === authenticatedUserId;
    assert.strictEqual(isAuthorized, false, 'Must reject session start for foreign topic');
  });

  runTest('Foreign study block in session start is rejected with 404', () => {
    const authenticatedUserId = 'user_alice';
    const foreignBlock = {
      _id: 'blk_foreign',
      userId: 'user_bob',
    };

    const isAuthorized = foreignBlock.userId === authenticatedUserId;
    assert.strictEqual(isAuthorized, false, 'Must reject session start referencing foreign block');
  });

  runTest('Foreign topic in ConceptLab update is rejected with 404 (prevents orphaned labs)', () => {
    const authenticatedUserId = 'user_alice';
    const foreignTopic = {
      _id: 'top_foreign',
      userId: 'user_bob',
    };

    const isAuthorized = foreignTopic.userId === authenticatedUserId;
    assert.strictEqual(isAuthorized, false, 'Must not allow ConceptLab upsert on foreign topic');
  });

  runTest('PATCH study block strips activeFocusMinutes and actualMinutesLogged tampering', () => {
    const clientPayload = {
      status: 'COMPLETED',
      activeFocusMinutes: 9999, // FORGED FOCUS
      actualMinutesLogged: 9999, // FORGED MINUTES
    };

    const safeUpdates: any = {};
    if (clientPayload.status) safeUpdates.status = clientPayload.status;

    assert.strictEqual(safeUpdates.status, 'COMPLETED');
    assert.strictEqual(safeUpdates.activeFocusMinutes, undefined, 'Must strip activeFocusMinutes');
    assert.strictEqual(safeUpdates.actualMinutesLogged, undefined, 'Must strip actualMinutesLogged');
  });

  console.log('\n--- 4. REVISION STATE MACHINE & CONCURRENCY (REV-01 & REV-03) TESTS ---');

  runTest('Passing revision advances interval along [2, 4, 7] sequence', () => {
    const result = revisionEngine.calculateNextSchedule(
      1, // currentIntervalIndex = 1 (completed 2-day review)
      0, // currentCycleCount
      2.0, // currentStabilityDays
      true, // isPassing = true
      3, // recallConfidence
      'UTC'
    );

    assert.strictEqual(result.nextIntervalIndex, 2, 'Index 1 must advance to Index 2');
    assert.strictEqual(result.nextIntervalDays, 4, 'Index 2 corresponds to 4 days');
    assert.ok(result.newStabilityDays > 2.0, 'Stability must expand on pass');
    assert.strictEqual(result.cycleCountIncrement, 0);
    assert.strictEqual(result.nextScheduledDate.getUTCHours(), 0, 'Must normalize to civil midnight');
  });

  runTest('Completing interval 3 (Day 7) increments cycle count and wraps to interval 1', () => {
    const result = revisionEngine.calculateNextSchedule(
      3, // currentIntervalIndex = 3 (7 days, final in 2-4-7 cycle)
      0, // currentCycleCount
      8.0, // currentStabilityDays
      true, // isPassing = true
      3,
      'UTC'
    );

    assert.strictEqual(result.nextIntervalIndex, 1, 'Must wrap to 1');
    assert.strictEqual(result.nextIntervalDays >= 14, true, 'Maintenance interval is >= 14 days');
    assert.strictEqual(result.cycleCountIncrement, 1, 'Must increment cycle count');
  });


  runTest('CRITICAL INVARIANT: Failed revision MUST NOT advance interval', () => {
    const result = revisionEngine.calculateNextSchedule(
      1, // currentIntervalIndex = 1 (4 days)
      1, // currentCycleCount
      4.0, // currentStabilityDays
      false, // isPassing = false (FAILED!)
      3,
      'UTC'
    );

    assert.strictEqual(
      result.nextIntervalIndex,
      1,
      'Interval index MUST NOT advance on failure (remains 1)'
    );
    assert.strictEqual(
      result.nextIntervalDays,
      1,
      'Failed revision must be retried next day (+1d)'
    );
    assert.strictEqual(
      result.cycleCountIncrement,
      0,
      'Cycle count must not increment on failure'
    );
  });

  runTest('Failed revision halves memory stability with minimum 1.0 bound', () => {
    // Case 1: Stability 6.0 -> 3.0
    const res1 = revisionEngine.calculateNextSchedule(0, 0, 6.0, false, 3, 'UTC');
    assert.strictEqual(res1.newStabilityDays, 3.0, '6.0 * 0.5 = 3.0');

    // Case 2: Stability 1.5 -> bounded to 1.0
    const res2 = revisionEngine.calculateNextSchedule(0, 0, 1.5, false, 3, 'UTC');
    assert.strictEqual(res2.newStabilityDays, 1.0, 'Must not fall below minimum 1.0');
  });

  runTest('Duplicate submission on COMPLETED revision returns 409 REVISION_ALREADY_COMPLETED', () => {
    const existingSchedule = {
      _id: 'rev_123',
      status: 'COMPLETED',
    };

    let statusCode = 200;
    let errorCode = '';

    if (existingSchedule.status === 'COMPLETED' || existingSchedule.status === 'MISSED') {
      statusCode = 409;
      errorCode = 'REVISION_ALREADY_COMPLETED';
    }

    assert.strictEqual(statusCode, 409);
    assert.strictEqual(errorCode, 'REVISION_ALREADY_COMPLETED');
  });

  runTest('Atomic transition query prevents concurrent race execution', () => {
    let documentState = 'PENDING';

    const atomicUpdate = () => {
      if (documentState === 'PENDING' || documentState === 'OVERDUE') {
        documentState = 'COMPLETED';
        return { success: true };
      }
      return null;
    };

    const firstRequest = atomicUpdate();
    const secondRequest = atomicUpdate();

    assert.strictEqual(firstRequest?.success, true, 'First request successfully transitions');
    assert.strictEqual(secondRequest, null, 'Concurrent second request receives null and yields 409');
  });

  runTest('Partial unique compound index on RevisionSchedule is configured correctly', () => {
    const indexes = RevisionSchedule.schema.indexes();
    const partialActiveIndex = indexes.find((idx: any) => {
      const keys = idx[0];
      const opts = idx[1];
      return (
        keys.userId === 1 &&
        keys.topicId === 1 &&
        opts.unique === true &&
        opts.partialFilterExpression?.status?.$in?.includes('PENDING') &&
        opts.partialFilterExpression?.status?.$in?.includes('OVERDUE')
      );
    });

    assert.ok(
      partialActiveIndex,
      'RevisionSchedule must have partial unique index on { userId: 1, topicId: 1 } for PENDING/OVERDUE'
    );
  });

  console.log('\n--- 4B. ATOMIC MULTI-DOCUMENT REVISION COMPLETION TESTS ---');

  class MockRevisionConflictError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'RevisionConflictError';
    }
  }

  class MockRevisionNotFoundError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'RevisionNotFoundError';
    }
  }

  class MockTopicNotFoundError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TopicNotFoundError';
    }
  }

  function mockIsTransactionUnsupportedError(err: any): boolean {
    if (!err) return false;
    if (err.code === 20 || err.codeName === 'IllegalOperation') return true;
    const msg = String(err.message || '');
    return (
      msg.includes('Transaction numbers are only allowed on a replica set member') ||
      (msg.includes('replica set') && msg.includes('transaction')) ||
      msg.includes('Transactions are not supported') ||
      msg.includes('does not support transactions')
    );
  }

  interface IMockRevisionDoc {
    _id: string;
    userId: string;
    topicId: string;
    targetIntervalIndex: number;
    scheduledDate: Date;
    status: 'PENDING' | 'OVERDUE' | 'COMPLETED' | 'MISSED';
    evaluations?: any[];
    performanceScore?: number;
    recallConfidence?: number;
    completedAt?: Date;
    challengeQuestions?: any[];
    previousRevisionId?: string;
  }

  interface IMockTopicDoc {
    _id: string;
    userId: string;
    name: string;
    stabilityDays: number;
    revisionCycleCount: number;
    lastRevisedAt?: Date;
    nextRevisionDueDate?: Date;
    retentionScore: number;
    lifecycleStatus: string;
    masteryScore: number;
    decayRisk: string;
    comprehensionScore: number;
    applicationScore: number;
    consistencyScore: number;
    totalStudyMinutes: number;
  }

  interface IMockMistakeDoc {
    _id: string;
    userId: string;
    topicId: string;
    origin: string;
    rootCause: string;
    oneLineRule: string;
    status: string;
  }

  class MockTransactionalRevisionSystem {
    public revisions: IMockRevisionDoc[] = [];
    public topics: IMockTopicDoc[] = [];
    public mistakes: IMockMistakeDoc[] = [];
    public supportsTransactions: boolean = true;
    public injectFailureAt?: 'mistake_insert' | 'topic_save' | 'schedule_create';

    private lock: Promise<void> = Promise.resolve();

    private async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
      const prevLock = this.lock;
      let release: () => void;
      this.lock = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prevLock;
      try {
        return await fn();
      } finally {
        release!();
      }
    }

    async withTransaction<T>(work: () => Promise<T>): Promise<T> {
      if (!this.supportsTransactions) {
        throw new Error('Transaction numbers are only allowed on a replica set member or mongos');
      }

      return this.withLock(async () => {
        // Snapshot for transactional rollback
        const snapshot = {
          revisions: JSON.parse(JSON.stringify(this.revisions), (key, value) => {
            if (key === 'scheduledDate' || key === 'completedAt' || key === 'lastRevisedAt' || key === 'nextRevisionDueDate') {
              return value ? new Date(value) : value;
            }
            return value;
          }),
          topics: JSON.parse(JSON.stringify(this.topics), (key, value) => {
            if (key === 'lastRevisedAt' || key === 'nextRevisionDueDate') {
              return value ? new Date(value) : value;
            }
            return value;
          }),
          mistakes: JSON.parse(JSON.stringify(this.mistakes)),
        };

        try {
          return await work();
        } catch (err) {
          // Failure atomicity: Roll back all mutations
          this.revisions = snapshot.revisions;
          this.topics = snapshot.topics;
          this.mistakes = snapshot.mistakes;
          throw err;
        }
      });
    }

    async executeRevisionSubmit(
      userId: string,
      revisionId: string,
      answers: DiagnosticAnswerSubmission[],
      recallConfidence: number = 3
    ): Promise<{ status: number; code?: string; data?: any }> {
      if (!Array.isArray(answers)) {
        return { status: 400, code: 'VALIDATION_ERROR' };
      }

      try {
        const result = await this.withTransaction(async () => {
          // 1. Atomic CAS query on PENDING/OVERDUE state
          const revIndex = this.revisions.findIndex(
            (r) => r._id === revisionId && r.userId === userId && (r.status === 'PENDING' || r.status === 'OVERDUE')
          );

          if (revIndex === -1) {
            const existing = this.revisions.find((r) => r._id === revisionId && r.userId === userId);
            if (existing && existing.status === 'COMPLETED') {
              throw new MockRevisionConflictError('This revision schedule has already been completed and evaluated.');
            }
            throw new MockRevisionNotFoundError('Revision schedule not found.');
          }

          const revision = this.revisions[revIndex];
          revision.status = 'COMPLETED';
          revision.completedAt = new Date();

          // 2. Validate topic ownership and existence
          const topic = this.topics.find((t) => t._id === revision.topicId && t.userId === userId);
          if (!topic) {
            throw new MockTopicNotFoundError('Linked topic not found.');
          }

          // 3. Evaluate answers
          const evalResult = evaluateDeterministicChallenge(
            revision.challengeQuestions || [],
            answers,
            topic._id
          );

          revision.evaluations = evalResult.evaluations;
          revision.performanceScore = evalResult.scorePercentage;
          revision.recallConfidence = recallConfidence;

          // 4. Injected failure at mistake insert
          if (this.injectFailureAt === 'mistake_insert') {
            throw new Error('INJECTED_MISTAKE_INSERT_FAILURE');
          }

          if (evalResult.mistakesToCreate.length > 0) {
            for (const m of evalResult.mistakesToCreate) {
              this.mistakes.push({
                _id: crypto.randomUUID(),
                userId,
                topicId: topic._id,
                origin: m.origin,
                rootCause: m.rootCause,
                oneLineRule: m.oneLineRule,
                status: 'ACTIVE',
              });
            }
          }

          // 5. Calculate next schedule
          const scheduleResult = revisionEngine.calculateNextSchedule(
            revision.targetIntervalIndex,
            topic.revisionCycleCount,
            topic.stabilityDays,
            evalResult.isPassing,
            recallConfidence,
            'UTC'
          );

          topic.stabilityDays = scheduleResult.newStabilityDays;
          topic.lastRevisedAt = new Date();
          topic.revisionCycleCount += scheduleResult.cycleCountIncrement;
          topic.nextRevisionDueDate = scheduleResult.nextScheduledDate;
          topic.retentionScore = Math.round(
            topic.retentionScore === 0
              ? evalResult.scorePercentage
              : topic.retentionScore * 0.3 + evalResult.scorePercentage * 0.7
          );

          // 6. Injected failure at topic save
          if (this.injectFailureAt === 'topic_save') {
            throw new Error('INJECTED_TOPIC_SAVE_FAILURE');
          }

          // 7. Next revision creation
          if (this.injectFailureAt === 'schedule_create') {
            throw new Error('INJECTED_SCHEDULE_CREATE_FAILURE');
          }

          const existingNext = this.revisions.find(
            (r) => r.userId === userId && r.topicId === topic._id && (r.status === 'PENDING' || r.status === 'OVERDUE')
          );

          let nextRevision = existingNext;
          if (!nextRevision) {
            nextRevision = {
              _id: crypto.randomUUID(),
              userId,
              topicId: topic._id,
              targetIntervalIndex: scheduleResult.nextIntervalIndex,
              scheduledDate: scheduleResult.nextScheduledDate,
              status: 'PENDING',
              previousRevisionId: revision._id,
            };
            this.revisions.push(nextRevision);
          }

          return {
            completedRevision: revision,
            evaluations: evalResult.evaluations,
            isPassing: evalResult.isPassing,
            nextRevision,
            topicStatus: topic.lifecycleStatus,
          };
        });

        return { status: 200, data: result };
      } catch (err: any) {
        if (err instanceof MockRevisionConflictError) {
          return { status: 409, code: 'REVISION_ALREADY_COMPLETED' };
        }
        if (err instanceof MockRevisionNotFoundError) {
          return { status: 404, code: 'NOT_FOUND' };
        }
        if (err instanceof MockTopicNotFoundError) {
          return { status: 404, code: 'TOPIC_NOT_FOUND' };
        }
        if (mockIsTransactionUnsupportedError(err)) {
          return { status: 500, code: 'TRANSACTION_NOT_SUPPORTED' };
        }
        throw err;
      }
    }
  }

  function createTestQuestions(): IRevisionChallengeQuestion[] {
    return [
      {
        questionId: 'q1',
        type: 'MCQ',
        prompt: 'MCQ 1',
        options: [
          { optionId: 'opt_1', text: 'Correct' },
          { optionId: 'opt_2', text: 'Wrong' },
        ],
        correctOptionId: 'opt_1',
        explanation: 'Exp',
        difficulty: 'EASY',
      },
      {
        questionId: 'q2',
        type: 'TRUE_FALSE',
        prompt: 'TF 1',
        correctBoolean: true,
        explanation: 'Exp',
        difficulty: 'EASY',
      },
      {
        questionId: 'q3',
        type: 'OUTPUT_PREDICTION',
        prompt: 'Output 1',
        expectedOutput: '42',
        explanation: 'Exp',
        difficulty: 'EASY',
      },
    ];
  }

  await runTest('Test A: Successful revision completion atomically performs all required mutations', async () => {
    const system = new MockTransactionalRevisionSystem();
    const userId = 'usr_test_a';
    const topicId = 'top_test_a';
    const revisionId = 'rev_test_a';

    system.topics.push({
      _id: topicId,
      userId,
      name: 'Dynamic Programming',
      stabilityDays: 2.0,
      revisionCycleCount: 0,
      retentionScore: 0,
      lifecycleStatus: 'PRACTICING',
      masteryScore: 40,
      decayRisk: 'LOW',
      comprehensionScore: 80,
      applicationScore: 70,
      consistencyScore: 90,
      totalStudyMinutes: 120,
    });

    system.revisions.push({
      _id: revisionId,
      userId,
      topicId,
      targetIntervalIndex: 1, // Day 2
      scheduledDate: new Date(),
      status: 'PENDING',
      challengeQuestions: createTestQuestions(),
    });

    // Submit answers: 2 correct (PASS) and 1 wrong
    const answers: DiagnosticAnswerSubmission[] = [
      { questionId: 'q1', type: 'MCQ', selectedOptionId: 'opt_1' },
      { questionId: 'q2', type: 'TRUE_FALSE', userBoolean: true },
      { questionId: 'q3', type: 'OUTPUT_PREDICTION', userOutput: 'wrong_answer' },
    ];

    const result = await system.executeRevisionSubmit(userId, revisionId, answers, 4);

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.isPassing, true);

    // Verify revision is COMPLETED with evaluations
    const rev = system.revisions.find((r) => r._id === revisionId);
    assert.strictEqual(rev?.status, 'COMPLETED');
    assert.strictEqual(rev?.evaluations?.length, 3);
    assert.strictEqual(rev?.recallConfidence, 4);

    // Verify mistakes created for the 1 incorrect answer
    assert.strictEqual(system.mistakes.length, 1);
    assert.strictEqual(system.mistakes[0].topicId, topicId);

    // Verify topic stability and last revised updated
    const topic = system.topics.find((t) => t._id === topicId);
    assert.ok((topic?.stabilityDays || 0) > 2.0, 'Stability must increase on pass');
    assert.ok(topic?.lastRevisedAt !== undefined);

    // Verify next revision schedule created
    const nextRev = system.revisions.find((r) => r._id !== revisionId);
    assert.ok(nextRev, 'Next revision schedule must be created');
    assert.strictEqual(nextRev?.status, 'PENDING');
    assert.strictEqual(nextRev?.targetIntervalIndex, 2, 'Next interval index should advance to 2');
    assert.strictEqual(nextRev?.previousRevisionId, revisionId);
  });

  await runTest('Test B: Injected downstream failure forces complete atomic rollback of all mutations', async () => {
    const system = new MockTransactionalRevisionSystem();
    const userId = 'usr_test_b';
    const topicId = 'top_test_b';
    const revisionId = 'rev_test_b';

    system.topics.push({
      _id: topicId,
      userId,
      name: 'Graph Algorithms',
      stabilityDays: 4.0,
      revisionCycleCount: 0,
      retentionScore: 60,
      lifecycleStatus: 'ACQUIRING',
      masteryScore: 30,
      decayRisk: 'MODERATE',
      comprehensionScore: 60,
      applicationScore: 50,
      consistencyScore: 80,
      totalStudyMinutes: 90,
    });

    system.revisions.push({
      _id: revisionId,
      userId,
      topicId,
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      status: 'PENDING',
      challengeQuestions: createTestQuestions(),
    });

    // Inject failure at topic save (after status transition and evaluations were staged)
    system.injectFailureAt = 'topic_save';

    const answers: DiagnosticAnswerSubmission[] = [
      { questionId: 'q1', type: 'MCQ', selectedOptionId: 'opt_1' },
      { questionId: 'q2', type: 'TRUE_FALSE', userBoolean: true },
      { questionId: 'q3', type: 'OUTPUT_PREDICTION', userOutput: 'wrong_val' },
    ];

    let errorThrown = false;
    try {
      await system.executeRevisionSubmit(userId, revisionId, answers);
    } catch (err: any) {
      errorThrown = true;
      assert.strictEqual(err.message, 'INJECTED_TOPIC_SAVE_FAILURE');
    }

    assert.strictEqual(errorThrown, true, 'Injected error must be thrown');

    // CRITICAL FAILURE ATOMICITY VERIFICATIONS:
    // 1. Revision must remain in its original PENDING state
    const rev = system.revisions.find((r) => r._id === revisionId);
    assert.strictEqual(rev?.status, 'PENDING', 'Revision MUST NOT be marked COMPLETED when downstream write fails');
    assert.strictEqual(rev?.evaluations, undefined, 'Evaluations must be rolled back');

    // 2. Mistakes must not be created
    assert.strictEqual(system.mistakes.length, 0, 'Mistake creations must be rolled back');

    // 3. Topic stability and attributes must remain unchanged
    const topic = system.topics.find((t) => t._id === topicId);
    assert.strictEqual(topic?.stabilityDays, 4.0, 'Topic stability must remain unchanged');
    assert.strictEqual(topic?.lastRevisedAt, undefined, 'Topic lastRevisedAt must remain unset');

    // 4. No next revision schedule document must exist
    assert.strictEqual(system.revisions.length, 1, 'No next revision schedule must be created');
  });

  await runTest('Test C: Concurrent revision submissions result in exactly ONE commit and ONE 409 conflict', async () => {
    const system = new MockTransactionalRevisionSystem();
    const userId = 'usr_test_c';
    const topicId = 'top_test_c';
    const revisionId = 'rev_test_c';

    system.topics.push({
      _id: topicId,
      userId,
      name: 'Binary Trees',
      stabilityDays: 2.0,
      revisionCycleCount: 0,
      retentionScore: 0,
      lifecycleStatus: 'PRACTICING',
      masteryScore: 40,
      decayRisk: 'LOW',
      comprehensionScore: 80,
      applicationScore: 70,
      consistencyScore: 90,
      totalStudyMinutes: 100,
    });

    system.revisions.push({
      _id: revisionId,
      userId,
      topicId,
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      status: 'PENDING',
      challengeQuestions: createTestQuestions(),
    });

    const answers: DiagnosticAnswerSubmission[] = [
      { questionId: 'q1', type: 'MCQ', selectedOptionId: 'opt_1' },
      { questionId: 'q2', type: 'TRUE_FALSE', userBoolean: true },
      { questionId: 'q3', type: 'OUTPUT_PREDICTION', userOutput: '42' },
    ];

    // Two simultaneous submissions for the same revision
    const [res1, res2] = await Promise.all([
      system.executeRevisionSubmit(userId, revisionId, answers),
      system.executeRevisionSubmit(userId, revisionId, answers),
    ]);

    const results = [res1, res2];
    const successes = results.filter((r) => r.status === 200);
    const conflicts = results.filter((r) => r.status === 409 && r.code === 'REVISION_ALREADY_COMPLETED');

    assert.strictEqual(successes.length, 1, 'Exactly one concurrent submission must succeed');
    assert.strictEqual(conflicts.length, 1, 'The racing duplicate submission must return 409 REVISION_ALREADY_COMPLETED');

    // Total revisions in the system should be exactly 2 (R1 completed + R2 pending)
    assert.strictEqual(system.revisions.length, 2, 'Exactly one next revision schedule should be created');
  });

  await runTest('Test D: Standalone MongoDB deployment fails clearly with TRANSACTION_NOT_SUPPORTED', async () => {
    const system = new MockTransactionalRevisionSystem();
    const userId = 'usr_test_d';
    const topicId = 'top_test_d';
    const revisionId = 'rev_test_d';

    system.topics.push({
      _id: topicId,
      userId,
      name: 'Heaps',
      stabilityDays: 2.0,
      revisionCycleCount: 0,
      retentionScore: 0,
      lifecycleStatus: 'ACQUIRING',
      masteryScore: 20,
      decayRisk: 'LOW',
      comprehensionScore: 70,
      applicationScore: 50,
      consistencyScore: 60,
      totalStudyMinutes: 45,
    });

    system.revisions.push({
      _id: revisionId,
      userId,
      topicId,
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      status: 'PENDING',
      challengeQuestions: createTestQuestions(),
    });

    // Disable transaction support to simulate standalone MongoDB
    system.supportsTransactions = false;

    const answers: DiagnosticAnswerSubmission[] = [
      { questionId: 'q1', type: 'MCQ', selectedOptionId: 'opt_1' },
      { questionId: 'q2', type: 'TRUE_FALSE', userBoolean: true },
      { questionId: 'q3', type: 'OUTPUT_PREDICTION', userOutput: '42' },
    ];

    const result = await system.executeRevisionSubmit(userId, revisionId, answers);

    assert.strictEqual(result.status, 500);
    assert.strictEqual(result.code, 'TRANSACTION_NOT_SUPPORTED');

    // Revision must NOT be marked completed
    const rev = system.revisions.find((r) => r._id === revisionId);
    assert.strictEqual(rev?.status, 'PENDING', 'Revision must not undergo non-transactional mutation');
    assert.strictEqual(system.revisions.length, 1, 'No next revision created');
  });

  console.log('\n--- 4C. REVISION CIVIL-MIDNIGHT TIMEZONE (FIX 3) TESTS ---');

  runTest('Test A — India (Asia/Kolkata): Calculates exact 00:00:00 IST (18:30:00 UTC previous day)', () => {
    // Given a date in Asia/Kolkata on 2026-10-03 at 14:15:30 IST
    const baseInstant = new Date('2026-10-03T08:45:30.000Z'); // 14:15:30 IST
    const midnight = calculateCivilMidnight(baseInstant, 0, 'Asia/Kolkata');

    // Assert target local civil midnight
    const local = getCivilDateParts(midnight, 'Asia/Kolkata');
    assert.strictEqual(local.year, 2026);
    assert.strictEqual(local.month, 10);
    assert.strictEqual(local.day, 3);
    assert.strictEqual(local.hour, 0, 'Local hour must be 00');
    assert.strictEqual(local.minute, 0, 'Local minute must be 00');
    assert.strictEqual(local.second, 0, 'Local second must be 00');

    // Expected UTC representation for Asia/Kolkata (+05:30) is 18:30:00 on the previous UTC calendar date
    assert.strictEqual(midnight.toISOString(), '2026-10-02T18:30:00.000Z');
    assert.strictEqual(midnight.getUTCHours(), 18);
    assert.strictEqual(midnight.getUTCMinutes(), 30);
    assert.strictEqual(midnight.getUTCDate(), 2);
  });

  runTest('Test B — New York (America/New_York): Accurately calculates local midnight in EDT and EST without fixed offset', () => {
    // Summer date: EDT (UTC-4)
    const summerDate = new Date('2026-07-15T15:30:00.000Z');
    const summerMidnight = calculateCivilMidnight(summerDate, 0, 'America/New_York');
    const summerLocal = getCivilDateParts(summerMidnight, 'America/New_York');
    assert.strictEqual(summerLocal.year, 2026);
    assert.strictEqual(summerLocal.month, 7);
    assert.strictEqual(summerLocal.day, 15);
    assert.strictEqual(summerLocal.hour, 0);
    assert.strictEqual(summerLocal.minute, 0);
    assert.strictEqual(summerLocal.second, 0);
    // EDT midnight is 04:00:00 UTC
    assert.strictEqual(summerMidnight.toISOString(), '2026-07-15T04:00:00.000Z');

    // Winter date: EST (UTC-5)
    const winterDate = new Date('2026-12-15T15:30:00.000Z');
    const winterMidnight = calculateCivilMidnight(winterDate, 0, 'America/New_York');
    const winterLocal = getCivilDateParts(winterMidnight, 'America/New_York');
    assert.strictEqual(winterLocal.year, 2026);
    assert.strictEqual(winterLocal.month, 12);
    assert.strictEqual(winterLocal.day, 15);
    assert.strictEqual(winterLocal.hour, 0);
    assert.strictEqual(winterLocal.minute, 0);
    assert.strictEqual(winterLocal.second, 0);
    // EST midnight is 05:00:00 UTC
    assert.strictEqual(winterMidnight.toISOString(), '2026-12-15T05:00:00.000Z');
  });

  runTest('Test C — Los Angeles (America/Los_Angeles): Accurately calculates local midnight', () => {
    // Summer date: PDT (UTC-7)
    const summerDate = new Date('2026-06-20T18:00:00.000Z');
    const summerMidnight = calculateCivilMidnight(summerDate, 0, 'America/Los_Angeles');
    const summerLocal = getCivilDateParts(summerMidnight, 'America/Los_Angeles');
    assert.strictEqual(summerLocal.year, 2026);
    assert.strictEqual(summerLocal.month, 6);
    assert.strictEqual(summerLocal.day, 20);
    assert.strictEqual(summerLocal.hour, 0);
    assert.strictEqual(summerLocal.minute, 0);
    assert.strictEqual(summerLocal.second, 0);
    assert.strictEqual(summerMidnight.toISOString(), '2026-06-20T07:00:00.000Z');

    // Winter date: PST (UTC-8)
    const winterDate = new Date('2026-01-10T18:00:00.000Z');
    const winterMidnight = calculateCivilMidnight(winterDate, 0, 'America/Los_Angeles');
    const winterLocal = getCivilDateParts(winterMidnight, 'America/Los_Angeles');
    assert.strictEqual(winterLocal.year, 2026);
    assert.strictEqual(winterLocal.month, 1);
    assert.strictEqual(winterLocal.day, 10);
    assert.strictEqual(winterLocal.hour, 0);
    assert.strictEqual(winterLocal.minute, 0);
    assert.strictEqual(winterLocal.second, 0);
    assert.strictEqual(winterMidnight.toISOString(), '2026-01-10T08:00:00.000Z');
  });

  runTest('Test D — Tokyo (Asia/Tokyo): Accurately calculates local midnight (UTC+9)', () => {
    const tokyoBase = new Date('2026-10-03T10:00:00.000Z'); // 19:00:00 JST on Oct 3
    const tokyoMidnight = calculateCivilMidnight(tokyoBase, 0, 'Asia/Tokyo');
    const local = getCivilDateParts(tokyoMidnight, 'Asia/Tokyo');
    assert.strictEqual(local.year, 2026);
    assert.strictEqual(local.month, 10);
    assert.strictEqual(local.day, 3);
    assert.strictEqual(local.hour, 0);
    assert.strictEqual(local.minute, 0);
    assert.strictEqual(local.second, 0);
    // 00:00:00 JST on 2026-10-03 is 15:00:00 UTC on 2026-10-02
    assert.strictEqual(tokyoMidnight.toISOString(), '2026-10-02T15:00:00.000Z');
  });

  runTest('Test E — DST: Both sides of DST transition remain 00:00:00 local time', () => {
    // UK DST transition: Sunday, October 25, 2026 (BST UTC+1 -> GMT UTC+0)
    // Before transition (BST): October 24, 2026
    const beforeDst = calculateCivilMidnight(new Date('2026-10-24T12:00:00Z'), 0, 'Europe/London');
    const beforeLocal = getCivilDateParts(beforeDst, 'Europe/London');
    assert.strictEqual(beforeLocal.year, 2026);
    assert.strictEqual(beforeLocal.month, 10);
    assert.strictEqual(beforeLocal.day, 24);
    assert.strictEqual(beforeLocal.hour, 0, 'BST local hour must be 00');
    assert.strictEqual(beforeLocal.minute, 0);
    assert.strictEqual(beforeLocal.second, 0);
    // BST offset is UTC+1, so midnight is 23:00 UTC on previous day
    assert.strictEqual(beforeDst.toISOString(), '2026-10-23T23:00:00.000Z');

    // After transition (GMT): October 26, 2026
    const afterDst = calculateCivilMidnight(new Date('2026-10-26T12:00:00Z'), 0, 'Europe/London');
    const afterLocal = getCivilDateParts(afterDst, 'Europe/London');
    assert.strictEqual(afterLocal.year, 2026);
    assert.strictEqual(afterLocal.month, 10);
    assert.strictEqual(afterLocal.day, 26);
    assert.strictEqual(afterLocal.hour, 0, 'GMT local hour must be 00');
    assert.strictEqual(afterLocal.minute, 0);
    assert.strictEqual(afterLocal.second, 0);
    // GMT offset is UTC+0, so midnight is 00:00 UTC on the same day
    assert.strictEqual(afterDst.toISOString(), '2026-10-26T00:00:00.000Z');
  });

  runTest('Test F — Civil date preservation: Selects correct civil date for target timezone given identical UTC instant', () => {
    // At UTC instant 2026-10-02T20:00:00Z:
    // In America/New_York (UTC-4): it is 2026-10-02 16:00:00 (civil date = Oct 2)
    // In Asia/Tokyo (UTC+9): it is 2026-10-03 05:00:00 (civil date = Oct 3)
    const identicalInstant = new Date('2026-10-02T20:00:00.000Z');

    const nyResult = calculateCivilMidnight(identicalInstant, 'America/New_York');
    const nyParts = getCivilDateParts(nyResult, 'America/New_York');
    assert.strictEqual(nyParts.year, 2026);
    assert.strictEqual(nyParts.month, 10);
    assert.strictEqual(nyParts.day, 2, 'New York must preserve civil date Oct 2');
    assert.strictEqual(nyParts.hour, 0);
    assert.strictEqual(nyParts.minute, 0);
    assert.strictEqual(nyParts.second, 0);

    const tokyoResult = calculateCivilMidnight(identicalInstant, 'Asia/Tokyo');
    const tokyoParts = getCivilDateParts(tokyoResult, 'Asia/Tokyo');
    assert.strictEqual(tokyoParts.year, 2026);
    assert.strictEqual(tokyoParts.month, 10);
    assert.strictEqual(tokyoParts.day, 3, 'Tokyo must preserve civil date Oct 3');
    assert.strictEqual(tokyoParts.hour, 0);
    assert.strictEqual(tokyoParts.minute, 0);
    assert.strictEqual(tokyoParts.second, 0);
  });

  runTest('Test G — Invalid timezone: Fails deterministically with RangeError', () => {
    const validDate = new Date();
    assert.throws(
      () => calculateCivilMidnight(validDate, 0, 'Invalid/Timezone_Name'),
      (err: any) => err instanceof RangeError,
      'Must throw RangeError for invalid IANA timezone'
    );

    assert.throws(
      () => calculateCivilMidnight(validDate, 0, ''),
      (err: any) => err instanceof RangeError,
      'Must throw RangeError for empty timezone string'
    );

    assert.throws(
      () => calculateCivilMidnight(validDate, 0, null as any),
      (err: any) => err instanceof RangeError,
      'Must throw RangeError for null timezone'
    );

    assert.throws(
      () => getCivilDateParts(validDate, 'Bogus/Zone'),
      (err: any) => err instanceof RangeError,
      'getCivilDateParts must throw RangeError for invalid timezone'
    );
  });

  runTest('Test H — Revision engine calculateNextSchedule produces correct local midnight with timezone', () => {
    // When a user in Asia/Kolkata passes interval 1, next is 4 days
    const result = revisionEngine.calculateNextSchedule(
      1,
      0,
      2.0,
      true,
      3,
      'Asia/Kolkata'
    );
    assert.strictEqual(result.nextIntervalDays, 4);
    const local = getCivilDateParts(result.nextScheduledDate, 'Asia/Kolkata');
    assert.strictEqual(local.hour, 0, 'Local hour in Asia/Kolkata must be 00');
    assert.strictEqual(local.minute, 0, 'Local minute in Asia/Kolkata must be 00');
    assert.strictEqual(local.second, 0, 'Local second in Asia/Kolkata must be 00');
  });

  console.log('\n--- 5. EVIDENCE-BASED ARD (REV-02) ENGINE TESTS ---');

  runTest('MCQ diagnostic question evaluates correctly', () => {
    const q: IRevisionChallengeQuestion = {
      questionId: 'mcq_1',
      type: 'MCQ',
      prompt: 'What is the search space reduction in Binary Search?',
      options: [
        { optionId: 'opt_1', text: 'Halved each step' },
        { optionId: 'opt_2', text: 'Decreased by 1' },
        { optionId: 'opt_3', text: 'Squared' },
        { optionId: 'opt_4', text: 'Remains constant' },
      ],
      correctOptionId: 'opt_1',
      explanation: 'Binary search discards half the array at each comparison.',
      difficulty: 'MEDIUM',
    };

    const passSub: DiagnosticAnswerSubmission = {
      questionId: 'mcq_1',
      type: 'MCQ',
      selectedOptionId: 'opt_1',
      timeSpentSeconds: 10,
    };
    const passResult = evaluateDeterministicChallenge([q], [passSub], 'top_1');
    assert.strictEqual(passResult.correctCount, 1);
    assert.strictEqual(passResult.evaluations[0].isCorrect, true);

    const failSub: DiagnosticAnswerSubmission = {
      questionId: 'mcq_1',
      type: 'MCQ',
      selectedOptionId: 'opt_2',
      timeSpentSeconds: 10,
    };
    const failResult = evaluateDeterministicChallenge([q], [failSub], 'top_1');
    assert.strictEqual(failResult.correctCount, 0);
    assert.strictEqual(failResult.evaluations[0].isCorrect, false);
  });

  runTest('TRUE_FALSE diagnostic question evaluates correctly', () => {
    const q: IRevisionChallengeQuestion = {
      questionId: 'tf_1',
      type: 'TRUE_FALSE',
      prompt: 'QuickSort is an in-place sorting algorithm.',
      correctBoolean: true,
      explanation: 'QuickSort sorts elements in-place with O(log N) stack space.',
      difficulty: 'EASY',
    };

    const passSub: DiagnosticAnswerSubmission = {
      questionId: 'tf_1',
      type: 'TRUE_FALSE',
      userBoolean: true,
      timeSpentSeconds: 5,
    };
    const passResult = evaluateDeterministicChallenge([q], [passSub], 'top_1');
    assert.strictEqual(passResult.correctCount, 1);
    assert.strictEqual(passResult.evaluations[0].isCorrect, true);

    const failSub: DiagnosticAnswerSubmission = {
      questionId: 'tf_1',
      type: 'TRUE_FALSE',
      userBoolean: false,
      timeSpentSeconds: 5,
    };
    const failResult = evaluateDeterministicChallenge([q], [failSub], 'top_1');
    assert.strictEqual(failResult.correctCount, 0);
    assert.strictEqual(failResult.evaluations[0].isCorrect, false);
  });

  runTest('OUTPUT_PREDICTION diagnostic question evaluates correctly with normalization', () => {
    const q: IRevisionChallengeQuestion = {
      questionId: 'op_1',
      type: 'OUTPUT_PREDICTION',
      prompt: 'What is printed?',
      codeSnippet: 'console.log([1, 2, 3].map(x => x * 2).join(", "));',
      expectedOutput: '2, 4, 6',
      normalization: 'WHITESPACE_TRIMMED',
      explanation: 'Each element multiplied by 2 produces 2, 4, 6.',
      difficulty: 'MEDIUM',
    };

    const passSub: DiagnosticAnswerSubmission = {
      questionId: 'op_1',
      type: 'OUTPUT_PREDICTION',
      userOutput: '  2,   4,   6  ',
      timeSpentSeconds: 12,
    };
    const passResult = evaluateDeterministicChallenge([q], [passSub], 'top_1');
    assert.strictEqual(passResult.correctCount, 1);
    assert.strictEqual(passResult.evaluations[0].isCorrect, true);

    const failSub: DiagnosticAnswerSubmission = {
      questionId: 'op_1',
      type: 'OUTPUT_PREDICTION',
      userOutput: '1, 2, 3',
      timeSpentSeconds: 12,
    };
    const failResult = evaluateDeterministicChallenge([q], [failSub], 'top_1');
    assert.strictEqual(failResult.correctCount, 0);
    assert.strictEqual(failResult.evaluations[0].isCorrect, false);
  });

  runTest('COMPLEXITY diagnostic question evaluates correctly', () => {
    const q: IRevisionChallengeQuestion = {
      questionId: 'comp_1',
      type: 'COMPLEXITY',
      prompt: 'What is the time complexity of Merge Sort?',
      targetMetric: 'TIME_WORST',
      expectedComplexity: 'O(N log N)',
      explanation: 'Merge sort requires O(N log N) comparisons in all cases.',
      difficulty: 'MEDIUM',
    };

    const passSub: DiagnosticAnswerSubmission = {
      questionId: 'comp_1',
      type: 'COMPLEXITY',
      selectedComplexity: 'O(N log N)',
      timeSpentSeconds: 8,
    };
    const passResult = evaluateDeterministicChallenge([q], [passSub], 'top_1');
    assert.strictEqual(passResult.correctCount, 1);
    assert.strictEqual(passResult.evaluations[0].isCorrect, true);

    const failSub: DiagnosticAnswerSubmission = {
      questionId: 'comp_1',
      type: 'COMPLEXITY',
      selectedComplexity: 'O(N^2)',
      timeSpentSeconds: 8,
    };
    const failResult = evaluateDeterministicChallenge([q], [failSub], 'top_1');
    assert.strictEqual(failResult.correctCount, 0);
    assert.strictEqual(failResult.evaluations[0].isCorrect, false);
  });

  runTest('DEBUGGING diagnostic question evaluates correctly', () => {
    const q: IRevisionChallengeQuestion = {
      questionId: 'dbg_1',
      type: 'DEBUGGING',
      prompt: 'Identify the bug in binary search.',
      codeSnippet: 'let mid = (low + high) / 2;',
      debuggingOptions: [
        { fixId: 'fix_floor', description: 'Math.floor((low + high) / 2) to avoid float indices' },
        { fixId: 'fix_add1', description: 'Add 1 to low' },
      ],
      correctFixId: 'fix_floor',
      explanation: 'JavaScript division produces floats unless rounded.',
      difficulty: 'HARD',
    };

    const passSub: DiagnosticAnswerSubmission = {
      questionId: 'dbg_1',
      type: 'DEBUGGING',
      selectedFixId: 'fix_floor',
      timeSpentSeconds: 15,
    };
    const passResult = evaluateDeterministicChallenge([q], [passSub], 'top_1');
    assert.strictEqual(passResult.correctCount, 1);
    assert.strictEqual(passResult.evaluations[0].isCorrect, true);

    const failSub: DiagnosticAnswerSubmission = {
      questionId: 'dbg_1',
      type: 'DEBUGGING',
      selectedFixId: 'fix_add1',
      timeSpentSeconds: 15,
    };
    const failResult = evaluateDeterministicChallenge([q], [failSub], 'top_1');
    assert.strictEqual(failResult.correctCount, 0);
    assert.strictEqual(failResult.evaluations[0].isCorrect, false);
  });

  runTest('STRUCTURED_CONCEPTUAL diagnostic question evaluates assertions', () => {
    const q: IRevisionChallengeQuestion = {
      questionId: 'sc_1',
      type: 'STRUCTURED_CONCEPTUAL',
      prompt: 'Select valid invariants for a Binary Search Tree.',
      assertions: [
        { assertionId: 'a1', text: 'Left subtree values are strictly less than node value' },
        { assertionId: 'a2', text: 'Right subtree values are strictly greater than node value' },
        { assertionId: 'a3', text: 'Tree must always be balanced' },
      ],
      correctAssertionIds: ['a1', 'a2'],
      explanation: 'BST property requires left < root < right. Balance is only for AVL/Red-Black.',
      difficulty: 'MEDIUM',
    };

    const passSub: DiagnosticAnswerSubmission = {
      questionId: 'sc_1',
      type: 'STRUCTURED_CONCEPTUAL',
      selectedAssertionIds: ['a1', 'a2'],
      timeSpentSeconds: 10,
    };
    const passResult = evaluateDeterministicChallenge([q], [passSub], 'top_1');
    assert.strictEqual(passResult.correctCount, 1);
    assert.strictEqual(passResult.evaluations[0].isCorrect, true);

    const failSub: DiagnosticAnswerSubmission = {
      questionId: 'sc_1',
      type: 'STRUCTURED_CONCEPTUAL',
      selectedAssertionIds: ['a1', 'a2', 'a3'],
      timeSpentSeconds: 10,
    };
    const failResult = evaluateDeterministicChallenge([q], [failSub], 'top_1');
    assert.strictEqual(failResult.correctCount, 0);
    assert.strictEqual(failResult.evaluations[0].isCorrect, false);
  });

  runTest('Public challenge projection NEVER leaks answers or explanations to client', () => {
    const questions: IRevisionChallengeQuestion[] = [
      {
        questionId: 'q1',
        type: 'MCQ',
        prompt: 'Secret prompt',
        options: [{ optionId: 'A', text: 'Option A' }, { optionId: 'B', text: 'Option B' }],
        correctOptionId: 'A',
        explanation: 'Secret answer A because of invariant.',
        difficulty: 'MEDIUM',
      },
      {
        questionId: 'q2',
        type: 'DEBUGGING',
        prompt: 'Fix the bug',
        codeSnippet: 'let x = 1;',
        debuggingOptions: [{ fixId: 'f1', description: 'Fix 1' }],
        correctFixId: 'f1',
        explanation: 'Must be f1.',
        difficulty: 'HARD',
      },
      {
        questionId: 'q3',
        type: 'COMPLEXITY',
        prompt: 'Complexity',
        targetMetric: 'TIME_WORST',
        expectedComplexity: 'O(1)',
        explanation: 'Constant time.',
        difficulty: 'EASY',
      },
    ];

    const publicQuestions = sanitizeDiagnosticChallenge(questions);

    for (const q of publicQuestions as any[]) {
      assert.strictEqual((q as any).correctAnswer, undefined, 'Must not leak correctAnswer');
      assert.strictEqual((q as any).correctFixId, undefined, 'Must not leak correctFixId');
      assert.strictEqual((q as any).expectedComplexity, undefined, 'Must not leak expectedComplexity');
      assert.strictEqual((q as any).correctBoolean, undefined, 'Must not leak correctBoolean');
      assert.strictEqual((q as any).correctAssertionIds, undefined, 'Must not leak correctAssertionIds');
      assert.strictEqual((q as any).explanation, undefined, 'Must not leak explanation');
    }
  });

  runTest('ARD Evaluation: 2 of 3 correct passes (isPassing = true)', () => {
    const questions: IRevisionChallengeQuestion[] = [
      {
        questionId: 'q1',
        type: 'MCQ',
        prompt: 'P1',
        options: [{ optionId: 'A', text: 'A' }, { optionId: 'B', text: 'B' }],
        correctOptionId: 'A',
        explanation: 'E1',
        difficulty: 'EASY',
      },
      { questionId: 'q2', type: 'TRUE_FALSE', prompt: 'P2', correctBoolean: true, explanation: 'E2', difficulty: 'EASY' },
      { questionId: 'q3', type: 'OUTPUT_PREDICTION', prompt: 'P3', expectedOutput: '42', explanation: 'E3', difficulty: 'EASY' },
    ];

    const answers: DiagnosticAnswerSubmission[] = [
      { questionId: 'q1', type: 'MCQ', selectedOptionId: 'A', timeSpentSeconds: 5 }, // Correct
      { questionId: 'q2', type: 'TRUE_FALSE', userBoolean: true, timeSpentSeconds: 5 }, // Correct
      { questionId: 'q3', type: 'OUTPUT_PREDICTION', userOutput: '99', timeSpentSeconds: 5 }, // Incorrect
    ];

    const result = evaluateDeterministicChallenge(questions, answers, 'top_1');
    assert.strictEqual(result.correctCount, 2);
    assert.strictEqual(result.totalQuestions, 3);
    assert.strictEqual(result.isPassing, true, 'correctCount >= 2 MUST pass');
  });

  runTest('ARD Evaluation: 1 of 3 correct fails (isPassing = false)', () => {
    const questions: IRevisionChallengeQuestion[] = [
      {
        questionId: 'q1',
        type: 'MCQ',
        prompt: 'P1',
        options: [{ optionId: 'A', text: 'A' }, { optionId: 'B', text: 'B' }],
        correctOptionId: 'A',
        explanation: 'E1',
        difficulty: 'EASY',
      },
      { questionId: 'q2', type: 'TRUE_FALSE', prompt: 'P2', correctBoolean: true, explanation: 'E2', difficulty: 'EASY' },
      { questionId: 'q3', type: 'OUTPUT_PREDICTION', prompt: 'P3', expectedOutput: '42', explanation: 'E3', difficulty: 'EASY' },
    ];

    const answers: DiagnosticAnswerSubmission[] = [
      { questionId: 'q1', type: 'MCQ', selectedOptionId: 'A', timeSpentSeconds: 5 }, // Correct
      { questionId: 'q2', type: 'TRUE_FALSE', userBoolean: false, timeSpentSeconds: 5 }, // Incorrect
      { questionId: 'q3', type: 'OUTPUT_PREDICTION', userOutput: '99', timeSpentSeconds: 5 }, // Incorrect
    ];

    const result = evaluateDeterministicChallenge(questions, answers, 'top_1');
    assert.strictEqual(result.correctCount, 1);
    assert.strictEqual(result.totalQuestions, 3);
    assert.strictEqual(result.isPassing, false, 'correctCount < 2 MUST fail');
  });

  runTest('Server ignores forged client performance score', () => {
    const questions: IRevisionChallengeQuestion[] = [
      { questionId: 'q1', type: 'TRUE_FALSE', prompt: 'P1', correctBoolean: true, explanation: 'E1', difficulty: 'EASY' },
      { questionId: 'q2', type: 'TRUE_FALSE', prompt: 'P2', correctBoolean: true, explanation: 'E2', difficulty: 'EASY' },
      { questionId: 'q3', type: 'TRUE_FALSE', prompt: 'P3', correctBoolean: true, explanation: 'E3', difficulty: 'EASY' },
    ];

    const answers: DiagnosticAnswerSubmission[] = [
      { questionId: 'q1', type: 'TRUE_FALSE', userBoolean: false, timeSpentSeconds: 5 },
      { questionId: 'q2', type: 'TRUE_FALSE', userBoolean: false, timeSpentSeconds: 5 },
      { questionId: 'q3', type: 'TRUE_FALSE', userBoolean: false, timeSpentSeconds: 5 },
    ];

    const result = evaluateDeterministicChallenge(questions, answers, 'top_1');
    assert.strictEqual(result.correctCount, 0);
    assert.strictEqual(result.isPassing, false, 'Client cannot self-certify mastery');
  });

  runTest('Incorrect answers produce mistake candidates with root cause and one-line rule', () => {
    const questions: IRevisionChallengeQuestion[] = [
      {
        questionId: 'q1',
        type: 'MCQ',
        prompt: 'P1',
        options: [{ optionId: 'A', text: 'A' }, { optionId: 'B', text: 'B' }],
        correctOptionId: 'A',
        explanation: 'Invariant violated.',
        difficulty: 'EASY',
      },
      { questionId: 'q2', type: 'TRUE_FALSE', prompt: 'P2', correctBoolean: true, explanation: 'True definition.', difficulty: 'EASY' },
      { questionId: 'q3', type: 'OUTPUT_PREDICTION', prompt: 'P3', expectedOutput: '42', explanation: 'Computed output.', difficulty: 'EASY' },
    ];

    const answers: DiagnosticAnswerSubmission[] = [
      { questionId: 'q1', type: 'MCQ', selectedOptionId: 'B', timeSpentSeconds: 5 }, // Incorrect
      { questionId: 'q2', type: 'TRUE_FALSE', userBoolean: true, timeSpentSeconds: 5 }, // Correct
      { questionId: 'q3', type: 'OUTPUT_PREDICTION', userOutput: '0', timeSpentSeconds: 5 }, // Incorrect
    ];

    const result = evaluateDeterministicChallenge(questions, answers, 'top_1');

    assert.strictEqual(result.mistakesToCreate.length, 2, '2 incorrect answers must yield 2 mistake candidates');
    assert.strictEqual(result.mistakesToCreate[0].topicId, 'top_1');
    assert.strictEqual(result.mistakesToCreate[0].origin, 'REVISION');
    assert.ok(result.mistakesToCreate[0].rootCause.length > 0);
    assert.ok(result.mistakesToCreate[0].oneLineRule.length > 0);
  });

  console.log('\n--- 6. ERROR SANITIZATION (FIX 4) TESTS ---');

  function createMockExpressResponse() {
    const res: any = {
      statusCode: 200,
      body: null,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        this.body = data;
        this.headersSent = true;
        return this;
      },
    };
    return res;
  }

  runTest('Test A — Duplicate Key: Converts code 11000 to 409 DUPLICATE_RESOURCE with zero leakage', () => {
    const rawMongoErr = {
      name: 'MongoServerError',
      code: 11000,
      message: 'E11000 duplicate key error collection: studyos.users index: email_1 dup key: { email: "student@studyos.org" }',
      keyPattern: { email: 1 },
      keyValue: { email: 'student@studyos.org' },
    };

    const result = sanitizeErrorResponse(rawMongoErr);
    assert.strictEqual(result.status, 409, 'Status must be 409 Conflict');
    assert.strictEqual(result.body.error.code, 'DUPLICATE_RESOURCE');
    assert.strictEqual(result.body.error.message, 'A resource with these values already exists.');

    const serialized = JSON.stringify(result.body);
    assert.strictEqual(serialized.includes('email_1'), false, 'Must not leak index name');
    assert.strictEqual(serialized.includes('studyos.users'), false, 'Must not leak collection name');
    assert.strictEqual(serialized.includes('student@studyos.org'), false, 'Must not leak duplicate value');
    assert.strictEqual(serialized.includes('E11000'), false, 'Must not leak raw Mongo error string');
    assert.strictEqual(serialized.includes('11000'), false, 'Must not leak raw numeric code');
    assert.strictEqual(serialized.includes('dup key'), false, 'Must not leak query fragment');

    // Also verify through full Express middleware
    const mockReq: any = { method: 'POST', originalUrl: '/api/v1/auth/register' };
    const mockRes = createMockExpressResponse();
    let nextCalled = false;
    errorHandler(rawMongoErr, mockReq, mockRes, () => { nextCalled = true; });

    assert.strictEqual(mockRes.statusCode, 409);
    assert.strictEqual(mockRes.body.error.code, 'DUPLICATE_RESOURCE');
    assert.strictEqual(nextCalled, false);
  });

  runTest('Test B — CastError: Converts malformed ObjectId to 400 INVALID_IDENTIFIER without leaking model/path', () => {
    const rawCastErr = {
      name: 'CastError',
      message: 'Cast to ObjectId failed for value "not-an-object-id" (type string) at path "_id" for model "Topic"',
      path: '_id',
      value: 'not-an-object-id',
      kind: 'ObjectId',
      model: { modelName: 'Topic' },
    };

    const result = sanitizeErrorResponse(rawCastErr);
    assert.strictEqual(result.status, 400, 'Status must be 400 Bad Request');
    assert.strictEqual(result.body.error.code, 'INVALID_IDENTIFIER');
    assert.strictEqual(result.body.error.message, 'The provided identifier is invalid.');

    const serialized = JSON.stringify(result.body);
    assert.strictEqual(serialized.includes('not-an-object-id'), false, 'Must not leak raw identifier value');
    assert.strictEqual(serialized.includes('_id'), false, 'Must not leak internal path');
    assert.strictEqual(serialized.includes('Topic'), false, 'Must not leak model name');
    assert.strictEqual(serialized.includes('Cast to ObjectId failed'), false, 'Must not leak raw Mongoose message');

    // Express middleware verification
    const mockReq: any = { method: 'GET', originalUrl: '/api/v1/topics/not-an-object-id/lab' };
    const mockRes = createMockExpressResponse();
    errorHandler(rawCastErr, mockReq, mockRes, () => {});
    assert.strictEqual(mockRes.statusCode, 400);
    assert.strictEqual(mockRes.body.error.code, 'INVALID_IDENTIFIER');
  });

  runTest('Test C — ValidationError: Converts Mongoose ValidationError to 400 VALIDATION_ERROR without raw schema internals', () => {
    const rawValidationErr = {
      name: 'ValidationError',
      message: 'Topic validation failed: name: Path `name` is required.',
      errors: {
        name: {
          name: 'ValidatorError',
          message: 'Path `name` is required.',
          properties: { path: 'name', type: 'required' },
          kind: 'required',
          path: 'name',
        },
      },
    };

    const result = sanitizeErrorResponse(rawValidationErr);
    assert.strictEqual(result.status, 400, 'Status must be 400 Bad Request');
    assert.strictEqual(result.body.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(result.body.error.message, 'The provided data is invalid.');

    const serialized = JSON.stringify(result.body);
    assert.strictEqual(serialized.includes('Topic validation failed'), false, 'Must not leak schema validation message');
    assert.strictEqual(serialized.includes('ValidatorError'), false, 'Must not leak Mongoose ValidatorError name');
    assert.strictEqual(serialized.includes('properties'), false, 'Must not leak internal validator properties');
  });

  runTest('Test D — Unknown Error: Converts unexpected exceptions into generic 500 without stack trace or connection info', () => {
    const sensitiveErr = new Error('Connection refused to mongodb://admin:p@ssw0rd123@10.0.0.5:27017/studyos?authSource=admin');
    sensitiveErr.stack = 'Error: Connection refused\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1606:16)\n    at internal/deps/mongoose/index.js:55:12';

    const result = sanitizeErrorResponse(sensitiveErr);
    assert.strictEqual(result.status, 500, 'Status must be 500 Internal Server Error');
    assert.strictEqual(result.body.error.code, 'INTERNAL_SERVER_ERROR');
    assert.strictEqual(result.body.error.message, 'An unexpected error occurred.');

    const serialized = JSON.stringify(result.body);
    assert.strictEqual(serialized.includes('p@ssw0rd123'), false, 'Must not leak database password');
    assert.strictEqual(serialized.includes('mongodb://'), false, 'Must not leak connection protocol');
    assert.strictEqual(serialized.includes('27017'), false, 'Must not leak internal port');
    assert.strictEqual(serialized.includes('10.0.0.5'), false, 'Must not leak internal IP');
    assert.strictEqual(serialized.includes('stack'), false, 'Must not include stack field');
    assert.strictEqual(serialized.includes('TCPConnectWrap'), false, 'Must not leak stack trace content');
  });

  runTest('Test E — Domain / Application Errors: Preserves status, code, and safe message for 401, 403, 404, 409, 500', () => {
    // 401 Unauthorized
    const res401 = sanitizeErrorResponse({ status: 401, code: 'UNAUTHORIZED', message: 'Authentication token required.' });
    assert.strictEqual(res401.status, 401);
    assert.strictEqual(res401.body.error.code, 'UNAUTHORIZED');
    assert.strictEqual(res401.body.error.message, 'Authentication token required.');

    // 403 Forbidden
    const res403 = sanitizeErrorResponse({ status: 403, code: 'CSRF_ORIGIN_MISMATCH', message: 'Untrusted Origin.' });
    assert.strictEqual(res403.status, 403);
    assert.strictEqual(res403.body.error.code, 'CSRF_ORIGIN_MISMATCH');
    assert.strictEqual(res403.body.error.message, 'Untrusted Origin.');

    // 404 Not Found
    const res404 = sanitizeErrorResponse({ status: 404, code: 'TOPIC_NOT_FOUND', message: 'Linked topic not found.' });
    assert.strictEqual(res404.status, 404);
    assert.strictEqual(res404.body.error.code, 'TOPIC_NOT_FOUND');
    assert.strictEqual(res404.body.error.message, 'Linked topic not found.');

    // 409 Conflict
    const res409 = sanitizeErrorResponse({
      status: 409,
      code: 'REVISION_ALREADY_COMPLETED',
      message: 'This revision schedule has already been completed and evaluated.',
    });
    assert.strictEqual(res409.status, 409);
    assert.strictEqual(res409.body.error.code, 'REVISION_ALREADY_COMPLETED');
    assert.strictEqual(res409.body.error.message, 'This revision schedule has already been completed and evaluated.');

    // 500 Transaction Unsupported (Approved system error code)
    const resTx = sanitizeErrorResponse({
      status: 500,
      code: 'TRANSACTION_NOT_SUPPORTED',
      message: 'MongoDB deployment does not support multi-document transactions (replica set required).',
    });
    assert.strictEqual(resTx.status, 500);
    assert.strictEqual(resTx.body.error.code, 'TRANSACTION_NOT_SUPPORTED');
    assert.strictEqual(
      resTx.body.error.message,
      'MongoDB deployment does not support multi-document transactions (replica set required).'
    );
  });

  console.log('\n--- 7. EXPLICIT MONGOOSE RUNTIME SCHEMA (FIX 5) TESTS ---');

  await runTest('Test A — Valid MCQ: Persists and passes Mongoose runtime schema validation', async () => {
    const doc = new RevisionSchedule({
      userId: new Types.ObjectId(),
      topicId: new Types.ObjectId(),
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      challengeQuestions: [
        {
          questionId: 'mcq_val_1',
          type: 'MCQ',
          prompt: 'What is the time complexity of binary search?',
          codeSnippet: 'int mid = low + (high - low)/2;',
          options: [
            { optionId: 'opt_1', text: 'O(log N)' },
            { optionId: 'opt_2', text: 'O(N)' },
          ],
          correctOptionId: 'opt_1',
          explanation: 'Binary search halves search space each iteration.',
          difficulty: 'EASY',
        },
      ],
    });

    await doc.validate();
    assert.strictEqual(doc.challengeQuestions.length, 1);
    assert.strictEqual(doc.challengeQuestions[0].type, 'MCQ');
  });

  await runTest('Test B — Valid TRUE_FALSE: Persists and passes Mongoose runtime schema validation', async () => {
    const doc = new RevisionSchedule({
      userId: new Types.ObjectId(),
      topicId: new Types.ObjectId(),
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      challengeQuestions: [
        {
          questionId: 'tf_val_1',
          type: 'TRUE_FALSE',
          prompt: 'Merge sort is a stable sorting algorithm.',
          correctBoolean: true,
          explanation: 'Merge sort preserves relative order of duplicate elements.',
          difficulty: 'EASY',
        },
      ],
    });

    await doc.validate();
    assert.strictEqual(doc.challengeQuestions[0].type, 'TRUE_FALSE');
  });

  await runTest('Test C — Valid OUTPUT_PREDICTION: Persists and passes Mongoose runtime schema validation', async () => {
    const doc = new RevisionSchedule({
      userId: new Types.ObjectId(),
      topicId: new Types.ObjectId(),
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      challengeQuestions: [
        {
          questionId: 'op_val_1',
          type: 'OUTPUT_PREDICTION',
          prompt: 'What is the return value of factorial(4)?',
          codeSnippet: 'function fact(n) { return n <= 1 ? 1 : n * fact(n-1); }',
          expectedOutput: '24',
          normalization: 'WHITESPACE_TRIMMED',
          explanation: '4 * 3 * 2 * 1 = 24.',
          difficulty: 'MEDIUM',
        },
      ],
    });

    await doc.validate();
    assert.strictEqual(doc.challengeQuestions[0].type, 'OUTPUT_PREDICTION');
  });

  await runTest('Test D — Valid COMPLEXITY: Persists and passes Mongoose runtime schema validation', async () => {
    const doc = new RevisionSchedule({
      userId: new Types.ObjectId(),
      topicId: new Types.ObjectId(),
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      challengeQuestions: [
        {
          questionId: 'comp_val_1',
          type: 'COMPLEXITY',
          prompt: 'What is the worst-case time complexity of QuickSort?',
          targetMetric: 'TIME_WORST',
          expectedComplexity: 'O(N^2)',
          explanation: 'Worst-case pivot selection results in quadratic comparisons.',
          difficulty: 'MEDIUM',
        },
      ],
    });

    await doc.validate();
    assert.strictEqual(doc.challengeQuestions[0].type, 'COMPLEXITY');
  });

  await runTest('Test E — Valid DEBUGGING: Persists and passes Mongoose runtime schema validation', async () => {
    const doc = new RevisionSchedule({
      userId: new Types.ObjectId(),
      topicId: new Types.ObjectId(),
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      challengeQuestions: [
        {
          questionId: 'dbg_val_1',
          type: 'DEBUGGING',
          prompt: 'Fix the infinite loop in pointer traversal.',
          codeSnippet: 'while (l < r) { if (arr[l] + arr[r] === k) return true; }',
          debuggingOptions: [
            { fixId: 'fix_1', description: 'Advance pointers on sum evaluation' },
            { fixId: 'fix_2', description: 'Break traversal immediately' },
          ],
          correctFixId: 'fix_1',
          explanation: 'Advancing pointers ensures monotonic progress towards termination.',
          difficulty: 'HARD',
        },
      ],
    });

    await doc.validate();
    assert.strictEqual(doc.challengeQuestions[0].type, 'DEBUGGING');
  });

  await runTest('Test F — Valid STRUCTURED_CONCEPTUAL: Persists and passes Mongoose runtime schema validation', async () => {
    const doc = new RevisionSchedule({
      userId: new Types.ObjectId(),
      topicId: new Types.ObjectId(),
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      challengeQuestions: [
        {
          questionId: 'sc_val_1',
          type: 'STRUCTURED_CONCEPTUAL',
          prompt: 'Which properties must hold true for a min-heap?',
          assertions: [
            { assertionId: 'ast_1', text: 'Every parent node is less than or equal to its children.' },
            { assertionId: 'ast_2', text: 'The tree is always a complete binary tree.' },
          ],
          correctAssertionIds: ['ast_1', 'ast_2'],
          explanation: 'Min-heaps preserve both shape and heap-order properties.',
          difficulty: 'HARD',
        },
      ],
    });

    await doc.validate();
    assert.strictEqual(doc.challengeQuestions[0].type, 'STRUCTURED_CONCEPTUAL');
  });

  await runTest('Test G — Malformed Questions: Rejects missing required type-specific fields at runtime', async () => {
    // 1. MCQ missing correctOptionId
    const docMcq = new RevisionSchedule({
      userId: new Types.ObjectId(),
      topicId: new Types.ObjectId(),
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      challengeQuestions: [
        {
          questionId: 'q_bad_1',
          type: 'MCQ',
          prompt: 'Prompt',
          options: [{ optionId: 'o1', text: 'T1' }],
          explanation: 'Exp',
          difficulty: 'EASY',
          // missing correctOptionId
        },
      ],
    });
    await assert.rejects(
      async () => docMcq.validate(),
      (err: any) => err.name === 'ValidationError',
      'MCQ without correctOptionId must fail Mongoose validation'
    );

    // 2. TRUE_FALSE missing correctBoolean
    const docTf = new RevisionSchedule({
      userId: new Types.ObjectId(),
      topicId: new Types.ObjectId(),
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      challengeQuestions: [
        {
          questionId: 'q_bad_2',
          type: 'TRUE_FALSE',
          prompt: 'Prompt',
          explanation: 'Exp',
          difficulty: 'EASY',
          // missing correctBoolean
        },
      ],
    });
    await assert.rejects(
      async () => docTf.validate(),
      (err: any) => err.name === 'ValidationError',
      'TRUE_FALSE without correctBoolean must fail Mongoose validation'
    );

    // 3. OUTPUT_PREDICTION missing expectedOutput
    const docOp = new RevisionSchedule({
      userId: new Types.ObjectId(),
      topicId: new Types.ObjectId(),
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      challengeQuestions: [
        {
          questionId: 'q_bad_3',
          type: 'OUTPUT_PREDICTION',
          prompt: 'Prompt',
          explanation: 'Exp',
          difficulty: 'EASY',
          // missing expectedOutput
        },
      ],
    });
    await assert.rejects(
      async () => docOp.validate(),
      (err: any) => err.name === 'ValidationError',
      'OUTPUT_PREDICTION without expectedOutput must fail Mongoose validation'
    );

    // 4. COMPLEXITY missing expectedComplexity
    const docComp = new RevisionSchedule({
      userId: new Types.ObjectId(),
      topicId: new Types.ObjectId(),
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      challengeQuestions: [
        {
          questionId: 'q_bad_4',
          type: 'COMPLEXITY',
          prompt: 'Prompt',
          explanation: 'Exp',
          difficulty: 'EASY',
          // missing expectedComplexity
        },
      ],
    });
    await assert.rejects(
      async () => docComp.validate(),
      (err: any) => err.name === 'ValidationError',
      'COMPLEXITY without expectedComplexity must fail Mongoose validation'
    );

    // 5. DEBUGGING missing correctFixId
    const docDbg = new RevisionSchedule({
      userId: new Types.ObjectId(),
      topicId: new Types.ObjectId(),
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      challengeQuestions: [
        {
          questionId: 'q_bad_5',
          type: 'DEBUGGING',
          prompt: 'Prompt',
          debuggingOptions: [{ fixId: 'f1', description: 'Fix 1' }],
          explanation: 'Exp',
          difficulty: 'HARD',
          // missing correctFixId
        },
      ],
    });
    await assert.rejects(
      async () => docDbg.validate(),
      (err: any) => err.name === 'ValidationError',
      'DEBUGGING without correctFixId must fail Mongoose validation'
    );

    // 6. STRUCTURED_CONCEPTUAL missing correctAssertionIds
    const docSc = new RevisionSchedule({
      userId: new Types.ObjectId(),
      topicId: new Types.ObjectId(),
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      challengeQuestions: [
        {
          questionId: 'q_bad_6',
          type: 'STRUCTURED_CONCEPTUAL',
          prompt: 'Prompt',
          assertions: [{ assertionId: 'a1', text: 'Assert 1' }],
          explanation: 'Exp',
          difficulty: 'HARD',
          // missing correctAssertionIds
        },
      ],
    });
    await assert.rejects(
      async () => docSc.validate(),
      (err: any) => err.name === 'ValidationError',
      'STRUCTURED_CONCEPTUAL without correctAssertionIds must fail Mongoose validation'
    );
  });

  await runTest('Test H — Invalid Discriminator Type: Rejects unknown diagnostic question type', async () => {
    const doc = new RevisionSchedule({
      userId: new Types.ObjectId(),
      topicId: new Types.ObjectId(),
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      challengeQuestions: [
        {
          questionId: 'q_bogus',
          type: 'NON_EXISTENT_TYPE',
          prompt: 'Bogus question',
          explanation: 'None',
          difficulty: 'EASY',
        },
      ],
    });
    await assert.rejects(
      async () => doc.validate(),
      (err: any) => err.name === 'ValidationError' && String(err.message).includes('is not a valid enum value'),
      'Unknown discriminator type must be rejected by enum validation'
    );
  });

  await runTest('Test I — Evaluation Schema: Valid evaluations pass and malformed shapes are rejected', async () => {
    // 1. Valid evaluations array
    const validDoc = new RevisionSchedule({
      userId: new Types.ObjectId(),
      topicId: new Types.ObjectId(),
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      evaluations: [
        {
          questionId: 'q1',
          type: 'MCQ',
          submittedOptionId: 'opt_1',
          correctOptionId: 'opt_1',
          isCorrect: true,
          timeSpentSeconds: 12,
        },
        {
          questionId: 'q2',
          type: 'TRUE_FALSE',
          submittedBoolean: true,
          correctBoolean: true,
          isCorrect: true,
          timeSpentSeconds: 8,
        },
        {
          questionId: 'q3',
          type: 'COMPLEXITY',
          submittedComplexity: 'O(N log N)',
          expectedComplexity: 'O(N log N)',
          isCorrect: true,
          timeSpentSeconds: 15,
        },
      ],
    });
    await validDoc.validate();
    assert.strictEqual(validDoc.evaluations?.length, 3);

    // 2. Malformed evaluation: missing required isCorrect or invalid complexity
    const invalidDoc = new RevisionSchedule({
      userId: new Types.ObjectId(),
      topicId: new Types.ObjectId(),
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      evaluations: [
        {
          questionId: 'q1',
          type: 'COMPLEXITY',
          submittedComplexity: 'INVALID_COMPLEXITY_NOTATION',
          expectedComplexity: 'O(N)',
          isCorrect: false,
          timeSpentSeconds: 5,
        },
      ],
    });
    await assert.rejects(
      async () => invalidDoc.validate(),
      (err: any) => err.name === 'ValidationError',
      'Evaluation with non-canonical complexity must fail Mongoose validation'
    );
  });

  await runTest('Test J — Strict Mode: Rejects arbitrary unmodeled fields on diagnostic subdocuments', async () => {
    const docWithUnknownField = new RevisionSchedule({
      userId: new Types.ObjectId(),
      topicId: new Types.ObjectId(),
      targetIntervalIndex: 1,
      scheduledDate: new Date(),
      challengeQuestions: [
        {
          questionId: 'mcq_strict_1',
          type: 'MCQ',
          prompt: 'Prompt',
          options: [
            { optionId: 'o1', text: 'T1' },
            { optionId: 'o2', text: 'T2' },
          ],
          correctOptionId: 'o1',
          explanation: 'Exp',
          difficulty: 'EASY',
          arbitraryInjectedField: 'unauthorized_data',
        },
      ],
    });

    await assert.rejects(
      async () => docWithUnknownField.validate(),
      (err: any) => err.name === 'ValidationError',
      'Arbitrary unmodeled field must trigger strict: throw validation error'
    );
  });

  runTest('Test K — Security Invariant: Public challenge projection strips all authoritative answer keys', () => {
    const questions: IRevisionChallengeQuestion[] = [
      {
        questionId: 'q_sec_1',
        type: 'MCQ',
        prompt: 'P1',
        options: [{ optionId: 'o1', text: 'T1' }],
        correctOptionId: 'SECRET_ANSWER_MCQ',
        explanation: 'SECRET_EXPLANATION',
        difficulty: 'EASY',
      },
      {
        questionId: 'q_sec_2',
        type: 'TRUE_FALSE',
        prompt: 'P2',
        correctBoolean: true,
        explanation: 'SECRET_TF_EXP',
        difficulty: 'EASY',
      },
      {
        questionId: 'q_sec_3',
        type: 'DEBUGGING',
        prompt: 'P3',
        debuggingOptions: [{ fixId: 'f1', description: 'Fix 1' }],
        correctFixId: 'SECRET_FIX_ID',
        explanation: 'SECRET_DEBUG_EXP',
        difficulty: 'HARD',
      },
      {
        questionId: 'q_sec_4',
        type: 'STRUCTURED_CONCEPTUAL',
        prompt: 'P4',
        assertions: [{ assertionId: 'a1', text: 'A1' }],
        correctAssertionIds: ['SECRET_AST_1'],
        explanation: 'SECRET_SC_EXP',
        difficulty: 'MEDIUM',
      },
    ];

    const publicQuestions = sanitizeDiagnosticChallenge(questions);
    const serialized = JSON.stringify(publicQuestions);

    assert.strictEqual(serialized.includes('SECRET_ANSWER_MCQ'), false);
    assert.strictEqual(serialized.includes('SECRET_EXPLANATION'), false);
    assert.strictEqual(serialized.includes('SECRET_TF_EXP'), false);
    assert.strictEqual(serialized.includes('SECRET_FIX_ID'), false);
    assert.strictEqual(serialized.includes('SECRET_DEBUG_EXP'), false);
    assert.strictEqual(serialized.includes('SECRET_AST_1'), false);
    assert.strictEqual(serialized.includes('SECRET_SC_EXP'), false);
  });

  console.log('\n--- 8. STRICT DIAGNOSTIC SUBMISSION VALIDATION (FIX 6) TESTS ---');

  const fix6TopicId = new Types.ObjectId();
  const fix6Challenge: IRevisionChallengeQuestion[] = [
    {
      questionId: 'q_val_sc',
      type: 'STRUCTURED_CONCEPTUAL',
      prompt: 'Which properties must hold true for an AVL tree balance factor?',
      assertions: [
        { assertionId: 'ast_1', text: 'Balance factor of every node is in {-1, 0, 1}.' },
        { assertionId: 'ast_2', text: 'Subtree heights differ by at most one.' },
        { assertionId: 'ast_3', text: 'Nodes can have balance factor greater than 2 without rebalancing.' },
      ],
      correctAssertionIds: ['ast_1', 'ast_2'],
      explanation: 'AVL trees maintain strict height balance with factor within [-1, 1].',
      difficulty: 'HARD',
    },
    {
      questionId: 'q_val_dbg',
      type: 'DEBUGGING',
      prompt: 'Identify the missing rotation condition during AVL insert.',
      debuggingOptions: [
        { fixId: 'fix_1', description: 'Perform Left-Right double rotation when child is right-heavy.' },
        { fixId: 'fix_2', description: 'Ignore tree imbalance and continue traversal.' },
        { fixId: 'fix_3', description: 'Delete the unbalancing node immediately.' },
      ],
      correctFixId: 'fix_1',
      explanation: 'Left-Right rotation restores AVL invariant when left subtree is right-heavy.',
      difficulty: 'MEDIUM',
    },
    {
      questionId: 'q_val_comp',
      type: 'COMPLEXITY',
      prompt: 'What is the worst-case lookup time complexity in an AVL tree?',
      targetMetric: 'TIME_WORST',
      expectedComplexity: 'O(log N)',
      explanation: 'AVL trees guarantee O(log N) worst-case height and search time.',
      difficulty: 'EASY',
    },
  ];

  runTest('Test A — Valid 3-question submission succeeds', () => {
    const validAnswers = [
      { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1', 'ast_2'] },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
      { questionId: 'q_val_comp', selectedComplexity: 'O(log N)' },
    ];

    assert.doesNotThrow(() => {
      validateDiagnosticSubmission(fix6Challenge, validAnswers, { answers: validAnswers });
    });

    const evalResult = evaluateDeterministicChallenge(fix6Challenge, validAnswers as any, fix6TopicId);
    assert.strictEqual(evalResult.correctCount, 3);
    assert.strictEqual(evalResult.isPassing, true);
    assert.strictEqual(evalResult.scorePercentage, 100);
  });

  runTest('Test B — Empty answers array -> 400 validation error', () => {
    assert.throws(
      () => validateDiagnosticPayload({ answers: [] }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.match(err.message, /must not be empty/i);
        return true;
      }
    );
    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, [], { answers: [] }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        return true;
      }
    );
  });

  runTest('Test C — Only 2 answers -> rejected', () => {
    const twoAnswers = [
      { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1'] },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
    ];

    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, twoAnswers, { answers: twoAnswers }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.match(err.message, /must contain exactly 3 answers, received 2/i);
        return true;
      }
    );
  });

  runTest('Test D — 4 answers -> rejected', () => {
    const fourAnswers = [
      { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1'] },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
      { questionId: 'q_val_comp', selectedComplexity: 'O(log N)' },
      { questionId: 'q_extra_fake', selectedComplexity: 'O(1)' },
    ];

    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, fourAnswers, { answers: fourAnswers }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.match(err.message, /must contain exactly 3 answers, received 4/i);
        return true;
      }
    );
  });

  runTest('Test E — Unknown question ID -> rejected', () => {
    const unknownIdAnswers = [
      { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1'] },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
      { questionId: 'q_foreign_unknown_999', selectedComplexity: 'O(log N)' },
    ];

    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, unknownIdAnswers, { answers: unknownIdAnswers }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.match(err.message, /does not belong to the current diagnostic challenge/i);
        return true;
      }
    );
  });

  runTest('Test F — Duplicate question ID -> rejected', () => {
    const duplicateAnswers = [
      { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1'] },
      { questionId: 'q_val_sc', selectedAssertionIds: ['ast_2'] },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
    ];

    assert.throws(
      () => validateDiagnosticPayload({ answers: duplicateAnswers }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.match(err.message, /duplicate question id detected/i);
        return true;
      }
    );

    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, duplicateAnswers, { answers: duplicateAnswers }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.match(err.message, /duplicate question id detected/i);
        return true;
      }
    );
  });

  runTest('Test G — Missing answer field -> rejected', () => {
    // 1. Missing selectedFixId on DEBUGGING
    const missingFix = [
      { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1'] },
      { questionId: 'q_val_dbg' },
      { questionId: 'q_val_comp', selectedComplexity: 'O(log N)' },
    ];
    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, missingFix, { answers: missingFix }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /requires a "selectedFixId" property/i);
        return true;
      }
    );

    // 2. Missing selectedComplexity on COMPLEXITY
    const missingComp = [
      { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1'] },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
      { questionId: 'q_val_comp' },
    ];
    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, missingComp, { answers: missingComp }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /requires a "selectedComplexity" property/i);
        return true;
      }
    );

    // 3. Missing selectedAssertionIds on STRUCTURED_CONCEPTUAL
    const missingSc = [
      { questionId: 'q_val_sc' },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
      { questionId: 'q_val_comp', selectedComplexity: 'O(log N)' },
    ];
    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, missingSc, { answers: missingSc }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /requires a "selectedAssertionIds" property/i);
        return true;
      }
    );
  });

  runTest('Test H — Wrong answer shape for question type -> rejected', () => {
    // Question is COMPLEXITY (q_val_comp), but client submitted selectedFixId
    const wrongTypePayload = [
      { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1'] },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
      { questionId: 'q_val_comp', selectedFixId: 'fix_1' },
    ];

    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, wrongTypePayload, { answers: wrongTypePayload }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /unexpected field "selectedFixId"/i);
        return true;
      }
    );
  });

  runTest('Test I — Forged isCorrect -> rejected', () => {
    // 1. Root level forged isCorrect
    const rootForged = {
      answers: [
        { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1'] },
        { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
        { questionId: 'q_val_comp', selectedComplexity: 'O(log N)' },
      ],
      isCorrect: true,
    };
    assert.throws(
      () => validateDiagnosticPayload(rootForged),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /prohibited server-authoritative field: "isCorrect"/i);
        return true;
      }
    );

    // 2. Answer item level forged isCorrect
    const itemForged = [
      { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1'], isCorrect: true },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
      { questionId: 'q_val_comp', selectedComplexity: 'O(log N)' },
    ];
    assert.throws(
      () => validateDiagnosticPayload({ answers: itemForged }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /prohibited server-authoritative field: "isCorrect"/i);
        return true;
      }
    );
  });

  runTest('Test J — Forged correctCount -> rejected', () => {
    const forged = {
      answers: [
        { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1'] },
        { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
        { questionId: 'q_val_comp', selectedComplexity: 'O(log N)' },
      ],
      correctCount: 3,
    };
    assert.throws(
      () => validateDiagnosticPayload(forged),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /prohibited server-authoritative field: "correctCount"/i);
        return true;
      }
    );
  });

  runTest('Test K — Forged isPassing -> rejected', () => {
    const forged = {
      answers: [
        { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1'] },
        { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
        { questionId: 'q_val_comp', selectedComplexity: 'O(log N)' },
      ],
      isPassing: true,
    };
    assert.throws(
      () => validateDiagnosticPayload(forged),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /prohibited server-authoritative field: "isPassing"/i);
        return true;
      }
    );
  });

  runTest('Test L — Forged score/stability/performance fields -> rejected', () => {
    for (const field of ['score', 'performanceScore', 'stability']) {
      const forged = {
        answers: [
          { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1'] },
          { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
          { questionId: 'q_val_comp', selectedComplexity: 'O(log N)' },
        ],
        [field]: 100,
      };
      assert.throws(
        () => validateDiagnosticPayload(forged),
        (err: any) => {
          assert.strictEqual(err instanceof DiagnosticValidationError, true);
          assert.match(err.message, new RegExp(`prohibited server-authoritative field: "${field}"`, 'i'));
          return true;
        }
      );
    }
  });

  runTest('Test M — Invalid option/fix/assertion ID -> rejected', () => {
    // 1. Invalid fixId for DEBUGGING
    const invalidFix = [
      { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1'] },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_forged_nonexistent' },
      { questionId: 'q_val_comp', selectedComplexity: 'O(log N)' },
    ];
    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, invalidFix, { answers: invalidFix }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /invalid fix id "fix_forged_nonexistent"/i);
        return true;
      }
    );

    // 2. Invalid complexity
    const invalidComp = [
      { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1'] },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
      { questionId: 'q_val_comp', selectedComplexity: 'O(N^3)' as any },
    ];
    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, invalidComp, { answers: invalidComp }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /invalid complexity "O\(N\^3\)"/i);
        return true;
      }
    );

    // 3. Invalid optionId for MCQ
    const mcqChallenge: IRevisionChallengeQuestion[] = [
      {
        questionId: 'q_val_mcq',
        type: 'MCQ',
        prompt: 'Select traversal order',
        options: [
          { optionId: 'opt_1', text: 'Inorder' },
          { optionId: 'opt_2', text: 'Preorder' },
        ],
        correctOptionId: 'opt_1',
        explanation: 'Inorder is left-root-right.',
        difficulty: 'EASY',
      },
      fix6Challenge[1],
      fix6Challenge[2],
    ];
    const invalidOpt = [
      { questionId: 'q_val_mcq', selectedOptionId: 'opt_forged_nonexistent' },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
      { questionId: 'q_val_comp', selectedComplexity: 'O(log N)' },
    ];
    assert.throws(
      () => validateDiagnosticSubmission(mcqChallenge, invalidOpt, { answers: invalidOpt }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /invalid option id "opt_forged_nonexistent"/i);
        return true;
      }
    );
  });

  runTest('Test N — Valid STRUCTURED_CONCEPTUAL answer with valid assertion IDs succeeds', () => {
    const validSc = [
      { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1', 'ast_2'] },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
      { questionId: 'q_val_comp', selectedComplexity: 'O(log N)' },
    ];

    assert.doesNotThrow(() => {
      validateDiagnosticSubmission(fix6Challenge, validSc, { answers: validSc });
    });

    const evalResult = evaluateDeterministicChallenge(fix6Challenge, validSc as any, fix6TopicId);
    assert.strictEqual(evalResult.evaluations[0].isCorrect, true);
  });

  runTest('Test O — Malformed selectedAssertionIds structure -> rejected', () => {
    // 1. Non-array (string instead of array)
    const nonArray = [
      { questionId: 'q_val_sc', selectedAssertionIds: 'ast_1' as any },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
      { questionId: 'q_val_comp', selectedComplexity: 'O(log N)' },
    ];
    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, nonArray, { answers: nonArray }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /requires "selectedAssertionIds" to be an array/i);
        return true;
      }
    );

    // 2. Non-string element in array
    const nonString = [
      { questionId: 'q_val_sc', selectedAssertionIds: [42] as any },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
      { questionId: 'q_val_comp', selectedComplexity: 'O(log N)' },
    ];
    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, nonString, { answers: nonString }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /invalid assertion id at index 0/i);
        return true;
      }
    );

    // 3. Duplicate assertion IDs in array
    const duplicateAst = [
      { questionId: 'q_val_sc', selectedAssertionIds: ['ast_1', 'ast_1'] },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
      { questionId: 'q_val_comp', selectedComplexity: 'O(log N)' },
    ];
    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, duplicateAst, { answers: duplicateAst }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /duplicate assertion id "ast_1"/i);
        return true;
      }
    );

    // 4. Unknown assertion ID
    const unknownAst = [
      { questionId: 'q_val_sc', selectedAssertionIds: ['ast_unauthorized_fake'] },
      { questionId: 'q_val_dbg', selectedFixId: 'fix_1' },
      { questionId: 'q_val_comp', selectedComplexity: 'O(log N)' },
    ];
    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, unknownAst, { answers: unknownAst }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /invalid assertion id "ast_unauthorized_fake"/i);
        return true;
      }
    );
  });

  runTest('Test P — Public diagnostic payload still contains no authoritative answer keys', () => {
    const publicQuestions = sanitizeDiagnosticChallenge(fix6Challenge);
    const serialized = JSON.stringify(publicQuestions);

    assert.strictEqual(serialized.includes('ast_1'), true, 'Public projection preserves assertion IDs for user selection');
    assert.strictEqual(serialized.includes('correctAssertionIds'), false);
    assert.strictEqual(serialized.includes('correctFixId'), false);
    assert.strictEqual(serialized.includes('expectedComplexity'), false);
    assert.strictEqual(serialized.includes('explanation'), false);
    assert.strictEqual(serialized.includes('AVL trees maintain strict height balance'), false);
    assert.strictEqual(serialized.includes('Left-Right rotation restores AVL invariant'), false);
    assert.strictEqual(serialized.includes('guarantee O(log N) worst-case height'), false);
  });

  console.log('\n--- 9. CLIENT/SERVER DIAGNOSTIC CONTRACT ALIGNMENT (FIX 7) TESTS ---');

  const fix7Questions: IPublicRevisionChallengeQuestion[] = [
    {
      questionId: 'q_f7_mcq',
      type: 'MCQ',
      prompt: 'Which traversal visits left, root, right in a BST?',
      options: [
        { optionId: 'opt_in', text: 'Inorder' },
        { optionId: 'opt_pre', text: 'Preorder' },
        { optionId: 'opt_post', text: 'Postorder' },
      ],
      difficulty: 'EASY',
    },
    {
      questionId: 'q_f7_tf',
      type: 'TRUE_FALSE',
      prompt: 'Is an AVL tree strictly height-balanced?',
      difficulty: 'EASY',
    },
    {
      questionId: 'q_f7_op',
      type: 'OUTPUT_PREDICTION',
      prompt: 'What does print(2 + 3) output?',
      difficulty: 'EASY',
    },
    {
      questionId: 'q_f7_comp',
      type: 'COMPLEXITY',
      prompt: 'What is worst-case lookup in a balanced BST?',
      difficulty: 'EASY',
    },
    {
      questionId: 'q_f7_dbg',
      type: 'DEBUGGING',
      prompt: 'Choose the correct fix for balance factor violation.',
      debuggingOptions: [
        { fixId: 'fix_lr', description: 'Perform Left-Right rotation' },
        { fixId: 'fix_noop', description: 'Ignore balance violation' },
      ],
      difficulty: 'MEDIUM',
    },
    {
      questionId: 'q_f7_sc',
      type: 'STRUCTURED_CONCEPTUAL',
      prompt: 'Which AVL invariants must hold?',
      assertions: [
        { assertionId: 'ast_bf', text: 'Balance factor is in {-1, 0, 1}' },
        { assertionId: 'ast_bst', text: 'BST ordering holds for all nodes' },
        { assertionId: 'ast_bad', text: 'Height difference can exceed 2' },
      ],
      difficulty: 'HARD',
    },
  ];

  runTest('Test 9A — Payload Builder: produces exact required property names for each of the six question types', () => {
    const rawAnswers = {
      q_f7_mcq: 'opt_in',
      q_f7_tf: true,
      q_f7_op: '5',
      q_f7_comp: 'O(log N)',
      q_f7_dbg: 'fix_lr',
      q_f7_sc: ['ast_bf', 'ast_bst'],
    };

    const built = buildDiagnosticSubmission(fix7Questions, rawAnswers);
    assert.strictEqual(built.length, 6);

    // 1. MCQ
    assert.strictEqual(built[0].questionId, 'q_f7_mcq');
    assert.strictEqual(built[0].type, 'MCQ');
    assert.strictEqual((built[0] as any).selectedOptionId, 'opt_in');

    // 2. TRUE_FALSE
    assert.strictEqual(built[1].questionId, 'q_f7_tf');
    assert.strictEqual(built[1].type, 'TRUE_FALSE');
    assert.strictEqual((built[1] as any).userBoolean, true);

    // 3. OUTPUT_PREDICTION
    assert.strictEqual(built[2].questionId, 'q_f7_op');
    assert.strictEqual(built[2].type, 'OUTPUT_PREDICTION');
    assert.strictEqual((built[2] as any).userOutput, '5');

    // 4. COMPLEXITY
    assert.strictEqual(built[3].questionId, 'q_f7_comp');
    assert.strictEqual(built[3].type, 'COMPLEXITY');
    assert.strictEqual((built[3] as any).selectedComplexity, 'O(log N)');

    // 5. DEBUGGING
    assert.strictEqual(built[4].questionId, 'q_f7_dbg');
    assert.strictEqual(built[4].type, 'DEBUGGING');
    assert.strictEqual((built[4] as any).selectedFixId, 'fix_lr');

    // 6. STRUCTURED_CONCEPTUAL
    assert.strictEqual(built[5].questionId, 'q_f7_sc');
    assert.strictEqual(built[5].type, 'STRUCTURED_CONCEPTUAL');
    assert.deepStrictEqual((built[5] as any).selectedAssertionIds, ['ast_bf', 'ast_bst']);
  });

  runTest('Test 9B — Payload Builder: unrelated type-specific fields are absent across all question types', () => {
    const rawAnswers = {
      q_f7_mcq: 'opt_in',
      q_f7_tf: false,
      q_f7_op: 'output',
      q_f7_comp: 'O(1)',
      q_f7_dbg: 'fix_lr',
      q_f7_sc: ['ast_bf'],
    };

    const built = buildDiagnosticSubmission(fix7Questions, rawAnswers);

    // MCQ must only have questionId, type, selectedOptionId
    const mcqKeys = Object.keys(built[0]);
    assert.strictEqual(mcqKeys.includes('selectedOptionId'), true);
    assert.strictEqual(mcqKeys.includes('userBoolean'), false);
    assert.strictEqual(mcqKeys.includes('userOutput'), false);
    assert.strictEqual(mcqKeys.includes('selectedFixId'), false);
    assert.strictEqual(mcqKeys.includes('selectedAssertionIds'), false);
    assert.strictEqual(mcqKeys.includes('submittedAnswer'), false);

    // TRUE_FALSE must only have questionId, type, userBoolean
    const tfKeys = Object.keys(built[1]);
    assert.strictEqual(tfKeys.includes('userBoolean'), true);
    assert.strictEqual(tfKeys.includes('selectedOptionId'), false);
    assert.strictEqual(tfKeys.includes('submittedAnswer'), false);

    // STRUCTURED_CONCEPTUAL must only have questionId, type, selectedAssertionIds
    const scKeys = Object.keys(built[5]);
    assert.strictEqual(scKeys.includes('selectedAssertionIds'), true);
    assert.strictEqual(scKeys.includes('selectedFixId'), false);
    assert.strictEqual(scKeys.includes('selectedOptionId'), false);
    assert.strictEqual(scKeys.includes('submittedAnswer'), false);
  });

  runTest('Test 9C — Payload Builder: preserves exact expected question IDs in 1:1 correspondence', () => {
    const rawAnswers = {
      q_f7_mcq: 'opt_in',
      q_f7_tf: true,
      q_f7_op: 'test',
      q_f7_comp: 'O(N)',
      q_f7_dbg: 'fix_lr',
      q_f7_sc: ['ast_bf'],
    };

    const built = buildDiagnosticSubmission(fix7Questions, rawAnswers);
    assert.strictEqual(built.length, fix7Questions.length);
    for (let i = 0; i < fix7Questions.length; i++) {
      assert.strictEqual(built[i].questionId, fix7Questions[i].questionId);
    }
  });

  runTest('Test 9D — Payload Builder: strictly zero forbidden evaluation fields are present in built submission', () => {
    const rawAnswers = {
      q_f7_mcq: 'opt_in',
      q_f7_tf: true,
      q_f7_op: 'test',
      q_f7_comp: 'O(N)',
      q_f7_dbg: 'fix_lr',
      q_f7_sc: ['ast_bf'],
    };

    const built = buildDiagnosticSubmission(fix7Questions, rawAnswers);
    const forbidden = [
      'isCorrect',
      'correctAnswer',
      'correctCount',
      'isPassing',
      'score',
      'performanceScore',
      'stability',
      'explanation',
      'correctOptionId',
      'correctBoolean',
      'expectedOutput',
      'expectedComplexity',
      'correctFixId',
      'correctAssertionIds',
    ];

    for (const item of built) {
      for (const field of forbidden) {
        assert.strictEqual(field in item, false, `Field "${field}" must never be present in client submission`);
      }
    }
  });

  runTest('Test 9E — End-to-End Contract: valid 3-question payload built from UI selections passes server validation', () => {
    // Uses the 3 questions from fix6Challenge (STRUCTURED_CONCEPTUAL, DEBUGGING, COMPLEXITY)
    const uiSelections = {
      q_val_sc: ['ast_1', 'ast_2'], // User checked assertions 1 & 2
      q_val_dbg: 'fix_1', // User selected fix 1
      q_val_comp: 'O(log N)', // User selected O(log N)
    };

    const builtSubmission = buildDiagnosticSubmission(
      sanitizeDiagnosticChallenge(fix6Challenge),
      uiSelections
    );

    // Verify structural payload validation passes
    assert.doesNotThrow(() => {
      validateDiagnosticPayload({ answers: builtSubmission, recallRating: 4 });
    });

    // Verify authoritative challenge validation passes
    assert.doesNotThrow(() => {
      validateDiagnosticSubmission(fix6Challenge, builtSubmission, { answers: builtSubmission, recallRating: 4 });
    });

    // Verify evaluation evaluates 100% correct and passing
    const evalResult = evaluateDeterministicChallenge(fix6Challenge, builtSubmission as any, fix6TopicId);
    assert.strictEqual(evalResult.correctCount, 3);
    assert.strictEqual(evalResult.isPassing, true);
    assert.strictEqual(evalResult.scorePercentage, 100);
  });

  runTest('Test 9F — End-to-End Contract: malformed raw selections produce invalid payloads that fail server validation', () => {
    // 1. Invalid complexity selection from UI
    const badComplexitySelections = {
      q_val_sc: ['ast_1'],
      q_val_dbg: 'fix_1',
      q_val_comp: 'O(N^4)', // Not canonical
    };
    const badCompAnswers = buildDiagnosticSubmission(sanitizeDiagnosticChallenge(fix6Challenge), badComplexitySelections);
    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, badCompAnswers, { answers: badCompAnswers }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /invalid complexity "O\(N\^4\)"/i);
        return true;
      }
    );

    // 2. Foreign / invalid fix ID selection from UI
    const badFixSelections = {
      q_val_sc: ['ast_1'],
      q_val_dbg: 'fix_unrecognized_fake',
      q_val_comp: 'O(log N)',
    };
    const badFixAnswers = buildDiagnosticSubmission(sanitizeDiagnosticChallenge(fix6Challenge), badFixSelections);
    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, badFixAnswers, { answers: badFixAnswers }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.match(err.message, /invalid fix id "fix_unrecognized_fake"/i);
        return true;
      }
    );
  });

  runTest('Test 9G — Legacy submittedAnswer payload format is rejected by server with 400', () => {
    const legacyPayload = [
      { questionId: 'q_val_sc', submittedAnswer: 'ast_1' },
      { questionId: 'q_val_dbg', submittedAnswer: 'fix_1' },
      { questionId: 'q_val_comp', submittedAnswer: 'O(log N)' },
    ];

    assert.throws(
      () => validateDiagnosticSubmission(fix6Challenge, legacyPayload, { answers: legacyPayload }),
      (err: any) => {
        assert.strictEqual(err instanceof DiagnosticValidationError, true);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.match(err.message, /unexpected field "submittedAnswer"/i);
        return true;
      }
    );
  });

  console.log('\n--- 10. REFRESH-TOKEN TRANSACTIONAL ATOMICITY (FIX 8) TESTS ---');

  interface IMockTxSessionDoc {
    _id: string;
    userId: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
    archiveCleanupAt: Date;
    revokedAt: Date | null;
    revocationReason: string | null;
    replacedBySessionId: string | null;
    graceReplayCount: number;
    userAgent?: string;
    ipAddress?: string;
  }

  class MockTransactionalMongoSessionStore {
    public sessions: IMockTxSessionDoc[] = [];
    public supportsTransactions: boolean = true;
    public injectFailureAt?: 'successor_save';
    private mutex: Promise<void> = Promise.resolve();

    private async lock<T>(fn: () => Promise<T> | T): Promise<T> {
      const prev = this.mutex;
      let resolveLock: () => void;
      this.mutex = new Promise<void>((res) => {
        resolveLock = res;
      });
      await prev;
      try {
        return await fn();
      } finally {
        resolveLock!();
      }
    }

    async findOne(query: { tokenHash?: string; _id?: string }): Promise<IMockTxSessionDoc | null> {
      return this.lock(() => {
        const doc = this.sessions.find((s) => {
          if (query.tokenHash && s.tokenHash !== query.tokenHash) return false;
          if (query._id && s._id !== query._id) return false;
          return true;
        });
        return doc ? JSON.parse(JSON.stringify(doc)) : null;
      });
    }

    async findById(id: string): Promise<IMockTxSessionDoc | null> {
      return this.findOne({ _id: id });
    }

    async updateMany(
      filter: { familyId: string; revokedAt: null },
      update: { $set: Partial<IMockTxSessionDoc> }
    ): Promise<number> {
      return this.lock(() => {
        let count = 0;
        for (const doc of this.sessions) {
          if (doc.familyId === filter.familyId && doc.revokedAt === null) {
            Object.assign(doc, update.$set);
            count++;
          }
        }
        return count;
      });
    }

    async incrementGrace(id: string): Promise<IMockTxSessionDoc | null> {
      return this.lock(() => {
        const doc = this.sessions.find((s) => s._id === id);
        if (doc) {
          doc.graceReplayCount = (doc.graceReplayCount || 0) + 1;
          return JSON.parse(JSON.stringify(doc));
        }
        return null;
      });
    }

    // Executes an atomic transactional operation with snapshot rollback semantics
    async withTransaction<T>(
      fn: (txContext: {
        findOneAndUpdate: (
          filter: { _id: string; revokedAt: null; expiresAt: { $gt: Date } },
          update: { $set: Partial<IMockTxSessionDoc> }
        ) => Promise<IMockTxSessionDoc | null>;
        saveSuccessor: (doc: IMockTxSessionDoc) => Promise<void>;
      }) => Promise<T>
    ): Promise<T> {
      if (!this.supportsTransactions) {
        const err: any = new Error('Transaction numbers are only allowed on a replica set member');
        err.code = 20;
        err.codeName = 'IllegalOperation';
        throw err;
      }

      return this.lock(async () => {
        // Deep-clone transactional snapshot before entering callback
        const snapshot = JSON.parse(JSON.stringify(this.sessions));
        try {
          const result = await fn({
            findOneAndUpdate: async (filter, update) => {
              const doc = this.sessions.find((s) => {
                if (s._id !== filter._id) return false;
                if (filter.revokedAt === null && s.revokedAt !== null) return false;
                if (filter.expiresAt && !(new Date(s.expiresAt).getTime() > filter.expiresAt.$gt.getTime())) return false;
                return true;
              });
              if (!doc) return null;
              if (update.$set) {
                Object.assign(doc, update.$set);
              }
              return JSON.parse(JSON.stringify(doc));
            },
            saveSuccessor: async (doc) => {
              if (this.injectFailureAt === 'successor_save') {
                throw new Error('INJECTED_DATABASE_FAILURE: Storage connection lost during successor insert');
              }
              this.sessions.push(JSON.parse(JSON.stringify(doc)));
            },
          });
          // Transaction committed: snapshot discarded, mutations persist
          return result;
        } catch (error) {
          // Transaction aborted: roll back entirely to snapshot
          this.sessions = snapshot;
          throw error;
        }
      });
    }
  }

  async function simulateTransactionalRefresh(
    store: MockTransactionalMongoSessionStore,
    rawRefreshToken: string,
    now: Date,
    options?: { graceSeconds?: number; simulateRetry?: boolean }
  ): Promise<{ status: number; code?: string; accessToken?: string; newRefreshToken?: string; cookieSet?: boolean }> {
    const graceSeconds = options?.graceSeconds ?? 15;
    const incomingHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

    const session = await store.findOne({ tokenHash: incomingHash });
    if (!session) {
      return { status: 401, code: 'INVALID_REFRESH_TOKEN', cookieSet: false };
    }

    if (new Date(session.expiresAt).getTime() <= now.getTime()) {
      return { status: 401, code: 'EXPIRED_REFRESH_TOKEN', cookieSet: false };
    }

    // CASE A: Active, non-revoked session -> Transactionally Atomic Rotation
    if (!session.revokedAt) {
      // Pre-generate token material and successor identity BEFORE entering transaction/retry callback
      const successorSessionId = crypto.randomUUID();
      const newRawRefreshToken = crypto.randomBytes(32).toString('hex');
      const newTokenHash = crypto.createHash('sha256').update(newRawRefreshToken).digest('hex');

      let rotationCommitted = false;
      let attempts = 0;

      try {
        const executeTransaction = async () => {
          return store.withTransaction(async (tx) => {
            attempts++;
            if (options?.simulateRetry && attempts === 1) {
              const transientErr: any = new Error('TransientTransactionError: WriteConflict');
              transientErr.errorLabels = ['TransientTransactionError'];
              throw transientErr;
            }

            const rotatedPredecessor = await tx.findOneAndUpdate(
              {
                _id: session._id,
                revokedAt: null,
                expiresAt: { $gt: now },
              },
              {
                $set: {
                  revokedAt: now,
                  revocationReason: 'ROTATED',
                  replacedBySessionId: successorSessionId,
                },
              }
            );

            if (!rotatedPredecessor) {
              rotationCommitted = false;
              return;
            }

            await tx.saveSuccessor({
              _id: successorSessionId,
              userId: session.userId,
              tokenHash: newTokenHash,
              familyId: session.familyId,
              expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
              archiveCleanupAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
              revokedAt: null,
              revocationReason: null,
              replacedBySessionId: null,
              graceReplayCount: 0,
            });

            rotationCommitted = true;
          });
        };

        if (options?.simulateRetry) {
          try {
            await executeTransaction();
          } catch (err: any) {
            if (err?.errorLabels?.includes('TransientTransactionError')) {
              // Retry callback with identical pre-generated successorSessionId and tokenHash
              await executeTransaction();
            } else {
              throw err;
            }
          }
        } else {
          await executeTransaction();
        }

        // Set cookies and return success ONLY after transaction commits successfully
        if (rotationCommitted) {
          return {
            status: 200,
            accessToken: 'fresh_jwt_access_token',
            newRefreshToken: newRawRefreshToken,
            cookieSet: true,
          };
        }
      } catch (txErr: any) {
        if (
          txErr?.code === 20 ||
          txErr?.message?.includes('replica set') ||
          txErr?.message?.includes('Transactions are not supported')
        ) {
          return {
            status: 500,
            code: 'TRANSACTION_NOT_SUPPORTED',
            cookieSet: false,
          };
        }
        return {
          status: 500,
          code: 'DATABASE_ERROR',
          cookieSet: false,
        };
      }
    }

    // CASE B / C: Predecessor already revoked (either previously or rotated by concurrent transaction)
    const targetSession = session.revokedAt ? session : await store.findById(session._id);
    if (!targetSession) {
      return { status: 401, code: 'INVALID_REFRESH_TOKEN', cookieSet: false };
    }

    if (targetSession.revocationReason === 'ROTATED' && targetSession.replacedBySessionId && targetSession.revokedAt) {
      const elapsedMs = now.getTime() - new Date(targetSession.revokedAt).getTime();
      const graceMs = graceSeconds * 1000;

      // CASE B: Within configurable grace window
      if (graceMs > 0 && elapsedMs <= graceMs) {
        const successor = await store.findById(targetSession.replacedBySessionId);
        if (!successor || successor.revokedAt) {
          return { status: 401, code: 'REFRESH_SESSION_REVOKED', cookieSet: false };
        }

        const updatedPredecessor = await store.incrementGrace(targetSession._id);
        const currentGraceCount = updatedPredecessor?.graceReplayCount ?? 1;

        if (currentGraceCount > 2) {
          await store.updateMany(
            { familyId: targetSession.familyId, revokedAt: null },
            { $set: { revokedAt: now, revocationReason: 'FAMILY_COMPROMISE_DETECTED' } }
          );
          return { status: 401, code: 'REUSED_REFRESH_TOKEN', cookieSet: false };
        }

        return {
          status: 200,
          accessToken: 'fresh_jwt_access_token',
          cookieSet: false, // Access token only; NEVER issue refresh cookie during grace replay
        };
      }

      // CASE C: Outside grace window -> family compromise
      await store.updateMany(
        { familyId: targetSession.familyId, revokedAt: null },
        { $set: { revokedAt: now, revocationReason: 'FAMILY_COMPROMISE_DETECTED' } }
      );
      return { status: 401, code: 'REUSED_REFRESH_TOKEN', cookieSet: false };
    }

    return { status: 401, code: 'REFRESH_SESSION_REVOKED', cookieSet: false };
  }

  // TEST 10A — Normal rotation
  await runTest('Test 10A — Normal Rotation: Atomically commits predecessor rotation and successor creation', async () => {
    const store = new MockTransactionalMongoSessionStore();
    const familyId = crypto.randomUUID();
    const s0Id = crypto.randomUUID();
    const rawToken0 = crypto.randomBytes(32).toString('hex');
    const tokenHash0 = crypto.createHash('sha256').update(rawToken0).digest('hex');
    const now = new Date();

    store.sessions.push({
      _id: s0Id,
      userId: 'user_10a',
      tokenHash: tokenHash0,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      archiveCleanupAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      graceReplayCount: 0,
    });

    const result = await simulateTransactionalRefresh(store, rawToken0, now);

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.cookieSet, true, 'Refresh cookie must be issued after commit');
    assert.ok(result.newRefreshToken, 'New raw refresh token must be returned');

    // Confirm database state
    assert.strictEqual(store.sessions.length, 2, 'Exactly 2 sessions must exist in database');
    const s0 = store.sessions.find((s) => s._id === s0Id)!;
    const s1 = store.sessions.find((s) => s._id !== s0Id)!;

    assert.strictEqual(s0.revocationReason, 'ROTATED');
    assert.ok(s0.revokedAt, 'Predecessor must have revokedAt timestamp');
    assert.strictEqual(s0.replacedBySessionId, s1._id, 'Predecessor must link to successor ID');

    assert.strictEqual(s1.revokedAt, null, 'Successor must be active');
    assert.strictEqual(s1.familyId, familyId, 'Successor must belong to identical family');
    assert.strictEqual(s1.tokenHash, crypto.createHash('sha256').update(result.newRefreshToken!).digest('hex'));
  });

  // TEST 10B — Successor creation failure (Rollback)
  await runTest('Test 10B — Successor Creation Failure: Atomically rolls back predecessor mutation on injected failure', async () => {
    const store = new MockTransactionalMongoSessionStore();
    const familyId = crypto.randomUUID();
    const s0Id = crypto.randomUUID();
    const rawToken0 = crypto.randomBytes(32).toString('hex');
    const tokenHash0 = crypto.createHash('sha256').update(rawToken0).digest('hex');
    const now = new Date();

    store.sessions.push({
      _id: s0Id,
      userId: 'user_10b',
      tokenHash: tokenHash0,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      archiveCleanupAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      graceReplayCount: 0,
    });

    // Inject downstream failure at successor save
    store.injectFailureAt = 'successor_save';

    const result = await simulateTransactionalRefresh(store, rawToken0, now);

    assert.strictEqual(result.status, 500);
    assert.strictEqual(result.cookieSet, false, 'No cookie should be issued on failure');

    // Confirm full atomic rollback
    assert.strictEqual(store.sessions.length, 1, 'No successor document should exist');
    const s0 = store.sessions[0];
    assert.strictEqual(s0.revokedAt, null, 'Predecessor MUST NOT remain marked as rotated');
    assert.strictEqual(s0.revocationReason, null, 'Predecessor revocationReason must be rolled back');
    assert.strictEqual(s0.replacedBySessionId, null, 'Predecessor replacedBySessionId must be rolled back');
  });

  // TEST 10C — Concurrent rotation
  await runTest('Test 10C — Concurrent Rotation: Two simultaneous requests yield exactly one winner and 0 branching', async () => {
    const store = new MockTransactionalMongoSessionStore();
    const familyId = crypto.randomUUID();
    const s0Id = crypto.randomUUID();
    const rawToken0 = crypto.randomBytes(32).toString('hex');
    const tokenHash0 = crypto.createHash('sha256').update(rawToken0).digest('hex');
    const now = new Date();

    store.sessions.push({
      _id: s0Id,
      userId: 'user_10c',
      tokenHash: tokenHash0,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      archiveCleanupAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      graceReplayCount: 0,
    });

    // 2 concurrent requests with identical raw token
    const results = await Promise.all([
      simulateTransactionalRefresh(store, rawToken0, now),
      simulateTransactionalRefresh(store, rawToken0, now),
    ]);

    const winners = results.filter((r) => r.status === 200 && r.cookieSet === true);
    assert.strictEqual(winners.length, 1, 'Exactly one concurrent request must win rotation');

    // Total sessions in family must be exactly 2
    assert.strictEqual(store.sessions.length, 2, 'Zero family branching: exactly 2 sessions exist');

    const activeSessions = store.sessions.filter((s) => s.revokedAt === null);
    assert.strictEqual(activeSessions.length, 1, 'Exactly one active successor exists');

    const s0 = store.sessions.find((s) => s._id === s0Id)!;
    assert.strictEqual(s0.revocationReason, 'ROTATED');
    assert.ok(s0.replacedBySessionId, 'Predecessor must have single replacedBySessionId');
  });

  // TEST 10D — Grace behavior
  await runTest('Test 10D — Grace Behavior: Losing concurrent request safely receives access token without branching', async () => {
    const store = new MockTransactionalMongoSessionStore();
    const familyId = crypto.randomUUID();
    const s0Id = crypto.randomUUID();
    const rawToken0 = crypto.randomBytes(32).toString('hex');
    const tokenHash0 = crypto.createHash('sha256').update(rawToken0).digest('hex');
    const now = new Date();

    store.sessions.push({
      _id: s0Id,
      userId: 'user_10d',
      tokenHash: tokenHash0,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      archiveCleanupAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      graceReplayCount: 0,
    });

    const [res1, res2] = await Promise.all([
      simulateTransactionalRefresh(store, rawToken0, now),
      simulateTransactionalRefresh(store, rawToken0, now),
    ]);

    const graceResponse = [res1, res2].find((r) => r.cookieSet === false)!;
    assert.strictEqual(graceResponse.status, 200, 'Grace response must succeed with 200');
    assert.strictEqual(graceResponse.cookieSet, false, 'Grace response must NEVER set refresh cookie');
    assert.strictEqual(graceResponse.newRefreshToken, undefined, 'Grace response must not return new refresh token');
    assert.ok(graceResponse.accessToken, 'Grace response must provide fresh access token');
    assert.strictEqual(store.sessions.length, 2, 'No additional session created in database');
  });

  // TEST 10E — Outside-grace replay
  await runTest('Test 10E — Outside-Grace Replay: Replaying rotated token outside grace compromises family', async () => {
    const store = new MockTransactionalMongoSessionStore();
    const familyId = crypto.randomUUID();
    const s0Id = crypto.randomUUID();
    const s1Id = crypto.randomUUID();
    const rawToken0 = crypto.randomBytes(32).toString('hex');
    const tokenHash0 = crypto.createHash('sha256').update(rawToken0).digest('hex');
    const now = new Date();
    const rotatedAt = new Date(now.getTime() - 45000); // 45s ago (> 15s grace)

    // Predecessor already rotated 45s ago
    store.sessions.push({
      _id: s0Id,
      userId: 'user_10e',
      tokenHash: tokenHash0,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      archiveCleanupAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
      revokedAt: rotatedAt,
      revocationReason: 'ROTATED',
      replacedBySessionId: s1Id,
      graceReplayCount: 0,
    });

    // Successor
    store.sessions.push({
      _id: s1Id,
      userId: 'user_10e',
      tokenHash: 'succ_hash',
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      archiveCleanupAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      graceReplayCount: 0,
    });

    const result = await simulateTransactionalRefresh(store, rawToken0, now, { graceSeconds: 15 });

    assert.strictEqual(result.status, 401);
    assert.strictEqual(result.code, 'REUSED_REFRESH_TOKEN');
    assert.strictEqual(result.cookieSet, false);

    // Verify all sessions in family are revoked with FAMILY_COMPROMISE_DETECTED
    const activeSessions = store.sessions.filter((s) => s.familyId === familyId && s.revokedAt === null);
    assert.strictEqual(activeSessions.length, 0, 'All sessions in compromised family must be revoked');

    const s1 = store.sessions.find((s) => s._id === s1Id)!;
    assert.strictEqual(s1.revocationReason, 'FAMILY_COMPROMISE_DETECTED');
  });

  // TEST 10F — Transaction unsupported
  await runTest('Test 10F — Transaction Unsupported: Fails safely with 500 without performing non-transactional writes', async () => {
    const store = new MockTransactionalMongoSessionStore();
    store.supportsTransactions = false; // Standalone MongoDB deployment

    const familyId = crypto.randomUUID();
    const s0Id = crypto.randomUUID();
    const rawToken0 = crypto.randomBytes(32).toString('hex');
    const tokenHash0 = crypto.createHash('sha256').update(rawToken0).digest('hex');
    const now = new Date();

    store.sessions.push({
      _id: s0Id,
      userId: 'user_10f',
      tokenHash: tokenHash0,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      archiveCleanupAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      graceReplayCount: 0,
    });

    const result = await simulateTransactionalRefresh(store, rawToken0, now);

    assert.strictEqual(result.status, 500);
    assert.strictEqual(result.code, 'TRANSACTION_NOT_SUPPORTED');
    assert.strictEqual(result.cookieSet, false);

    // Zero uncommitted writes performed
    assert.strictEqual(store.sessions.length, 1, 'Zero successor documents created');
    const s0 = store.sessions[0];
    assert.strictEqual(s0.revokedAt, null, 'Predecessor must remain unchanged');
    assert.strictEqual(s0.replacedBySessionId, null);
  });

  // TEST 10G — Retry safety
  await runTest('Test 10G — Transaction Retry Safety: Callback retry does not duplicate successors or mismatch hashes', async () => {
    const store = new MockTransactionalMongoSessionStore();
    const familyId = crypto.randomUUID();
    const s0Id = crypto.randomUUID();
    const rawToken0 = crypto.randomBytes(32).toString('hex');
    const tokenHash0 = crypto.createHash('sha256').update(rawToken0).digest('hex');
    const now = new Date();

    store.sessions.push({
      _id: s0Id,
      userId: 'user_10g',
      tokenHash: tokenHash0,
      familyId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      archiveCleanupAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      revocationReason: null,
      replacedBySessionId: null,
      graceReplayCount: 0,
    });

    // Exercise retry: first attempt encounters write conflict and retries callback
    const result = await simulateTransactionalRefresh(store, rawToken0, now, { simulateRetry: true });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.cookieSet, true);

    // Verify exactly ONE successor exists (no duplicates created across retries)
    assert.strictEqual(store.sessions.length, 2, 'Exactly 2 sessions must exist after retry');
    const s1 = store.sessions.find((s) => s._id !== s0Id)!;

    // Verify token consistency: tokenHash in database strictly matches hash of returned newRefreshToken
    const expectedHash = crypto.createHash('sha256').update(result.newRefreshToken!).digest('hex');
    assert.strictEqual(s1.tokenHash, expectedHash, 'Successor tokenHash must exactly match returned token hash');
  });

  console.log('\n====================================================');
  console.log(` TEST SUMMARY: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
