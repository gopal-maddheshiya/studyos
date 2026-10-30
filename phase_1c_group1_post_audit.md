# Phase 1C Group 1 — Post-Implementation Audit

## 1. Verdict

**PASS WITH REQUIRED FIXES**

The core architectural models, routes, state machines, and evidence engines mandated by Phase 1C Group 1 have been implemented, and both frontend and backend production builds compile with zero errors. However, an adversarial code audit reveals critical race conditions, database transaction omissions, unvalidated Mongoose subdocument types, raw database error leakage, a timezone calculation discrepancy, and mock-based unit tests that do not exercise actual database concurrency. These issues must be addressed before final production sign-off.

---

## 2. Executive Summary

A comprehensive read-only adversarial audit of the Phase 1C Group 1 codebase was conducted across:
- **`MASTER_SPECIFICATION.md`**
- **`phase_1c_group1_implementation_plan.md`**
- **`phase_1c_group1_implementation_report.md`**
- All relevant source files in `server/src/` and `client/src/`.

### Key Audit Findings:
1. **Refresh Token Concurrency (P0):** The `/api/v1/auth/refresh` rotation logic uses `findOne()` followed by `session.save()`, which is vulnerable to a TOCTOU race condition where concurrent requests with the same refresh token can cause the token family lineage to branch into multiple active successors.
2. **Transaction Boundaries (P1):** Multi-document operations in `/api/v1/revisions/:id/submit` (updating completed revision, creating mistakes, updating topic evidence, creating next revision schedule) are executed sequentially without MongoDB transaction boundaries (`session.withTransaction()`).
3. **Raw Error Information Leakage (P1):** The centralized `errorHandler.ts` middleware reflects raw `err.message` and numeric MongoDB driver error codes (e.g., MongoServerError 11000 duplicate keys and Mongoose CastErrors) directly to clients in HTTP responses, leaking database internals and collection names.
4. **Civil Midnight Timezone Bug (P1):** In `calculateCivilMidnight`, calendar components $(y, m, d)$ extracted in the target timezone are passed into `Date.UTC(y, m, d, 0, 0, 0, 0)`, which produces 00:00:00 UTC rather than local midnight. In `Asia/Kolkata` (UTC+5:30), this produces 05:30 AM local time instead of midnight.
5. **Runtime Mongoose Validation (P1):** In `RevisionSchedule.ts`, `challengeQuestions` and `evaluations` are typed as `[Schema.Types.Mixed] as any`. Compile-time TypeScript discriminated unions provide zero runtime schema validation in MongoDB.
6. **Diagnostic Submissions Validation (P2):** `POST /revisions/:id/submit` validates only `Array.isArray(answers)`. Unknown question IDs, duplicate question IDs, and malformed answer types are not rejected with HTTP 400.
7. **Test Suite Depth (P1):** The 38 tests in `group1Hardening.test.ts` pass, but tests for rotation, grace replay, family compromise, nested authorization, and concurrency test isolated JavaScript objects and boolean comparisons rather than executing HTTP requests against Express and MongoDB.

---

## 3. Critical Findings

### Finding 1: `CRIT-AUTH-01` — Non-Atomic Refresh Rotation / Token Branching Race Condition
- **Severity:** P0
- **File:** `server/src/routes/auth.routes.ts`
- **Approximate Lines:** Lines 187–251
- **Concrete Issue:** Rotation is not executed as an atomic compare-and-swap or within a transaction. The code queries `session = await RefreshSession.findOne(...)`, checks `if (!session.revokedAt)`, creates `successorSession`, and then calls `await session.save()`.
- **Why It Matters:** If two concurrent `/refresh` requests arrive with the same active refresh token (e.g., from two parallel browser tabs or a race condition), both find `revokedAt === null`. Both proceed to create distinct successor sessions and update `session.replacedBySessionId`. This branches the refresh token family into two concurrently valid active tokens, violating the core single-lineage invariant.
- **Evidence:**
  ```typescript
  // server/src/routes/auth.routes.ts:187-251
  const session = await RefreshSession.findOne({ tokenHash: incomingHash });
  ...
  if (!session.revokedAt) {
    ...
    const successorSession = await RefreshSession.create({
      userId: user._id,
      tokenHash: newTokenHash,
      familyId: session.familyId,
      ...
    });

    session.revokedAt = now;
    session.revocationReason = 'ROTATED';
    session.replacedBySessionId = successorSession._id;
    await session.save();
  ```
- **Required Fix:** Execute the rotation atomically using `RefreshSession.findOneAndUpdate({ _id: session._id, revokedAt: null }, { $set: { revokedAt: now, revocationReason: 'ROTATED', replacedBySessionId: placeholderOrSuccessorId } })` or execute lines 187–251 within a MongoDB multi-document transaction with isolation.

---

### Finding 2: `CRIT-ERR-01` — Raw Database and Driver Errors Leaked to HTTP Clients
- **Severity:** P1
- **File:** `server/src/middlewares/errorHandler.ts`
- **Approximate Lines:** Lines 9–23
- **Concrete Issue:** The centralized error handler reflects `err.message` and numeric MongoDB driver error codes (e.g., code `11000`) directly to clients.
- **Why It Matters:** Leaks MongoDB collection names, index names, duplicate key values, internal file paths, and database schema internals. A client causing a duplicate key or malformed ObjectId receives database diagnostic information.
- **Evidence:**
  ```typescript
  // server/src/middlewares/errorHandler.ts:9-23
  export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
    const status = err.statusCode || err.status || 500;
    const code = err.code || 'INTERNAL_SERVER_ERROR';
    const message = err.message || 'An unexpected error occurred.';

    console.error(`[StudyOS API Error] ${req.method} ${req.originalUrl}:`, err);

    res.status(status).json({
      success: false,
      error: {
        code,
        message,
        details: err.details || null,
        timestamp: new Date().toISOString(),
      },
    });
  }
  ```
  When MongoDB throws a duplicate key error (code 11000):
  `err.code` is `11000` (a numeric driver code, not an HTTP status code).
  `err.message` is `E11000 duplicate key error collection: studyos.users index: email_1 dup key: { email: "..." }`.
  The client receives HTTP 500 containing internal database names.
- **Required Fix:** Sanitize errors:
  1. Map `err.code === 11000` to HTTP 409 `DUPLICATE_RESOURCE` with a sanitized message.
  2. Map `err.name === 'CastError'` to HTTP 400 `INVALID_RESOURCE_ID`.
  3. Map `err.name === 'ValidationError'` to HTTP 400 `VALIDATION_ERROR`.
  4. In production (`NODE_ENV === 'production'`), never return unhandled `err.message` on 500 errors.

---

### Finding 3: `CRIT-REV-01` — Multi-Document Revision Submission Lacks Atomic Transaction Boundary
- **Severity:** P1
- **File:** `server/src/routes/revision.routes.ts`
- **Approximate Lines:** Lines 123–253
- **Concrete Issue:** Revision submission marks the current revision `COMPLETED` on line 123, then sequentially updates mistakes, topic evidence, and creates the next revision schedule without a MongoDB transaction (`session.withTransaction()`).
- **Why It Matters:** If the server process crashes or an error occurs during `Mistake.insertMany` or `RevisionSchedule.create`, the revision has already been updated to `COMPLETED`. Because `COMPLETED` is terminal, the user cannot resubmit, and no subsequent revision schedule will ever be created. The topic is permanently orphaned from the spaced repetition schedule.
- **Evidence:**
  ```typescript
  // server/src/routes/revision.routes.ts:123-252
  const revision = await RevisionSchedule.findOneAndUpdate(
    { _id: revisionId, userId, status: { $in: ['PENDING', 'OVERDUE'] } },
    { $set: { status: 'COMPLETED', completedAt: new Date() } },
    { new: true }
  );
  ...
  await Mistake.insertMany(...);
  ...
  await topic.save();
  ...
  nextRevision = await RevisionSchedule.create({ ... });
  ```
- **Required Fix:** Enclose lines 123–252 inside a `mongoose.startSession()` transaction block (`session.withTransaction(...)`) so that state across `RevisionSchedule`, `Topic`, and `Mistake` transitions atomically.

---

### Finding 4: `CRIT-TIME-01` — `calculateCivilMidnight` Produces UTC Midnight Instead of Local Midnight
- **Severity:** P1
- **File:** `server/src/services/revisionEngine.ts`
- **Approximate Lines:** Lines 24–46
- **Concrete Issue:** Calendar date parts `y, m, d` extracted in the target timezone are passed into `Date.UTC(y, m, d, 0, 0, 0, 0)`.
- **Why It Matters:** `Date.UTC(y, m, d, 0, 0, 0, 0)` creates a UTC timestamp at 00:00:00Z. In `Asia/Kolkata` (UTC+05:30), 00:00:00 UTC is 05:30:00 AM local time. This causes revision schedules to be offset by 5.5 hours, meaning a review scheduled for "tomorrow" will not become due until 5:30 AM local time instead of local midnight. In negative offset timezones (e.g. `America/New_York`, UTC-5), 00:00:00 UTC corresponds to 7:00 PM on the previous day.
- **Evidence:**
  ```typescript
  // server/src/services/revisionEngine.ts:39
  // Create target date at local civil midnight using UTC representation with timezone offset
  const targetLocal = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
  return targetLocal;
  ```
- **Required Fix:** Compute the local timezone offset for the target calendar date and subtract/add it, or format a local ISO timestamp string with timezone offset (e.g. `2026-10-04T00:00:00+05:30`) and parse with `new Date(...)`.

---

### Finding 5: `CRIT-VAL-01` — `Schema.Types.Mixed` Disables Runtime Validation for Diagnostic Subdocuments
- **Severity:** P1
- **File:** `server/src/models/RevisionSchedule.ts`
- **Approximate Lines:** Lines 36–37
- **Concrete Issue:** Subdocuments in `RevisionSchedule` are declared as `[Schema.Types.Mixed] as any`.
- **Why It Matters:** TypeScript interfaces (`IRevisionChallengeQuestion`, `StoredDiagnosticEvaluation`) are compile-time only. In MongoDB, Mongoose applies zero schema validation or sanitization to `Schema.Types.Mixed` fields, allowing arbitrary, unbounded, or malformed data to be persisted.
- **Evidence:**
  ```typescript
  // server/src/models/RevisionSchedule.ts:36-37
  challengeQuestions: [Schema.Types.Mixed] as any,
  evaluations: [Schema.Types.Mixed] as any,
  ```
- **Required Fix:** Define explicit Mongoose schemas for questions and evaluations with typed fields (`questionId`, `type`, `prompt`, `isCorrect`, `timeSpentSeconds`).

---

### Finding 6: `CRIT-TEST-01` — Hardening Test Suite Relies on In-Memory Mocks Rather Than Actual Routes and Database
- **Severity:** P1
- **File:** `server/src/tests/group1Hardening.test.ts`
- **Approximate Lines:** Lines 134–200, 340–406, 490–520
- **Concrete Issue:** The 38 tests in `group1Hardening.test.ts` do not invoke the actual Express router or connect to MongoDB. They evaluate local JavaScript mock objects (e.g. `const isAuthorized = foreignSubject.userId === authenticatedUserId; assert.strictEqual(isAuthorized, false)`).
- **Why It Matters:** The 38/38 passing test report provides a false sense of security. The TOCTOU rotation race condition, missing transactions, and timezone offset calculation errors are not exercised by tests that mock away the runtime environment.
- **Evidence:**
  ```typescript
  // server/src/tests/group1Hardening.test.ts:340-346
  const authenticatedUserId = 'user_alice';
  const foreignSubject = {
    _id: 'sub_123',
    userId: 'user_bob', // Belongs to Bob!
  };
  const isAuthorized = foreignSubject.userId === authenticatedUserId;
  assert.strictEqual(isAuthorized, false, 'Must reject foreign subject');
  ```
- **Required Fix:** Supplement unit tests with integration tests using `supertest` executing real HTTP requests against an in-memory MongoDB instance (`mongodb-memory-server`) or test database.

---

### Finding 7: `CRIT-VAL-02` — Missing Runtime Validation of Question IDs and Diagnostic Payload in `POST /revisions/:id/submit`
- **Severity:** P2
- **File:** `server/src/routes/revision.routes.ts`
- **Approximate Lines:** Lines 113–121
- **Concrete Issue:** The endpoint checks only `if (!Array.isArray(answers))`. It does not verify that submitted question IDs match the challenge questions, does not reject unknown question IDs, and does not reject duplicate question IDs.
- **Why It Matters:** An attacker or malformed client can submit an empty array `[]` (which marks all questions incorrect and schedules a retry), submit duplicate question IDs, or submit arbitrary payloads without receiving HTTP 400.
- **Evidence:**
  ```typescript
  // server/src/routes/revision.routes.ts:113-121
  const { answers, recallConfidence, notes } = req.body;

  if (!Array.isArray(answers)) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Diagnostic answers array is required.' },
    });
  }
  ```
- **Required Fix:** Validate that:
  1. `answers.length === revision.challengeQuestions.length`
  2. Every `questionId` in `answers` exists in `revision.challengeQuestions`
  3. No duplicate `questionId` exists in `answers`
  4. Each answer conforms to the expected discriminated union structure.

---

### Finding 8: `CRIT-AUTH-02` — `sameSite: 'lax'` Used for `refreshToken` Cookie Instead of Planned `'strict'`
- **Severity:** P2
- **File:** `server/src/routes/auth.routes.ts`
- **Approximate Lines:** Lines 43, 62
- **Concrete Issue:** In `setAuthCookies` and `clearAuthCookies`, `sameSite: 'lax'` is configured for `refreshToken`.
- **Why It Matters:** The approved implementation plan and `group1Hardening.test.ts` specified `sameSite: 'strict'` for refresh tokens to isolate them from any third-party context.
- **Evidence:**
  ```typescript
  // server/src/routes/auth.routes.ts:43
  res.cookie('refreshToken', rawRefreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  ```
- **Required Fix:** Change `sameSite: 'lax'` to `sameSite: 'strict'` for `refreshToken`.

---

### Finding 9: `CRIT-AUTH-03` — Non-Atomic `graceReplayCount` Incrementation
- **Severity:** P2
- **File:** `server/src/routes/auth.routes.ts`
- **Approximate Lines:** Lines 285–290
- **Concrete Issue:** `session.graceReplayCount += 1; await session.save();` performs a non-atomic read-modify-write.
- **Why It Matters:** Concurrent requests during the grace window can race on reading and incrementing `graceReplayCount`, potentially exceeding the 2-replay limit before family compromise triggers.
- **Evidence:**
  ```typescript
  // server/src/routes/auth.routes.ts:285-289
  session.graceReplayCount += 1;
  await session.save();

  if (session.graceReplayCount > 2) {
  ```
- **Required Fix:** Use `RefreshSession.findOneAndUpdate({ _id: session._id }, { $inc: { graceReplayCount: 1 } }, { new: true })`.

---

## 4. Refresh Token Audit

| Verification Item | Specification Requirement | Actual Implementation Status | Finding / Evidence |
| :--- | :--- | :--- | :--- |
| **Token Generation** | 256-bit cryptographically secure random token | **PASS** | `crypto.randomBytes(32).toString('hex')` ([`auth.routes.ts:15`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts#L15)) |
| **Token Hashing** | SHA-256 deterministic hash; plaintext never persisted | **PASS** | `crypto.createHash('sha256').update(token).digest('hex')` ([`auth.routes.ts:19`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts#L19)) |
| **Family Lineage** | UUIDv4 `familyId` preserved across rotation | **PASS** | Preserved from parent session ([`auth.routes.ts:240`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts#L240)) |
| **`replacedBySessionId`** | Links predecessor to direct successor | **PASS** | Set upon rotation ([`auth.routes.ts:249`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts#L249)) |
| **Rotation Atomicity** | Atomic transition preventing branching | **FAIL (P0)** | `findOne` followed by `create` + `save` allows parallel branch ([`auth.routes.ts:187-251`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts#L187-L251)) |
| **Transport Medium** | Strictly HTTP-only cookie; reject `req.body.refreshToken` | **PASS** | Checks `req.cookies?.refreshToken`, body token ignored ([`auth.routes.ts:172-184`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts#L172-L184)) |
| **Cookie Attributes** | `httpOnly: true`, `path: '/api/v1/auth'`, `secure: prod` | **PASS WITH FIX (P2)** | Correct attributes except `sameSite: 'lax'` instead of `'strict'` ([`auth.routes.ts:43`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts#L43)) |
| **Configurable Grace** | `AUTH_REFRESH_GRACE_SECONDS` (default 15s) | **PASS** | Defined in `env.ts` and evaluated dynamically ([`auth.routes.ts:267`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts#L267)) |
| **Grace Successor Check**| Successor must be valid and non-revoked | **PASS** | Verifies `successor && !successor.revokedAt` ([`auth.routes.ts:273`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts#L273)) |
| **Grace Replay Cap** | Maximum 2 replays per window | **PASS WITH FIX (P2)** | Enforced, but increment is not atomic `$inc` ([`auth.routes.ts:285`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts#L285)) |
| **Successor Branching** | Old token MUST NEVER create new refresh token | **PASS** | Only issues fresh `accessToken`; never creates new `RefreshSession` ([`auth.routes.ts:314-329`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts#L314-L329)) |
| **Reuse Outside Grace** | Full token family revocation | **PASS** | Revokes all family sessions with `FAMILY_COMPROMISE_DETECTED` ([`auth.routes.ts:333`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts#L333)) |
| **Decoupled TTL** | TTL on `archiveCleanupAt` (+60d) | **PASS** | TTL index on `archiveCleanupAt` with `expireAfterSeconds: 0` ([`RefreshSession.ts:50`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/models/RefreshSession.ts#L50)) |
| **Single-Session Logout**| Revokes only the active token with reason `LOGOUT` | **PASS** | Targets only presented `tokenHash` ([`auth.routes.ts:377-380`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts#L377-L380)) |

---

## 5. Origin / CSRF Audit

| Verification Item | Specification Requirement | Actual Implementation Status | Finding / Evidence |
| :--- | :--- | :--- | :--- |
| **Exact Origin Matching** | Exact set membership, no regex or substring | **PASS** | Uses `allowedOrigins.has(requestOrigin)` on a `Set<string>` ([`originValidation.ts:46`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/middlewares/originValidation.ts#L46)) |
| **Missing Origin Policy** | Must reject missing Origin/Referer on mutations | **PASS** | Returns HTTP 403 `MISSING_ORIGIN_HEADER` ([`originValidation.ts:34-42`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/middlewares/originValidation.ts#L34-L42)) |
| **Referer Fallback** | Origin extraction from URL when Origin header omitted | **PASS** | Uses `new URL(referer).origin` ([`originValidation.ts:27`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/middlewares/originValidation.ts#L27)) |
| **Safe HTTP Methods** | `GET`, `HEAD`, `OPTIONS` bypass origin check | **PASS** | Checks `['GET', 'HEAD', 'OPTIONS'].includes(req.method)` ([`originValidation.ts:17`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/middlewares/originValidation.ts#L17)) |
| **Protected Endpoints** | Applied to `/register`, `/login`, `/refresh`, `/logout` | **PASS** | Applied explicitly to all 4 mutation endpoints in `auth.routes.ts` |
| **Development Support** | Explicit localhost / 127.0.0.1 ports (5173, 5174) | **PASS** | Gated on `env.NODE_ENV !== 'production'` ([`originValidation.ts:6-11`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/middlewares/originValidation.ts#L6-L11)) |

---

## 6. Authorization Audit

| Endpoint | Referenced Parent / Child IDs | Implemented Authorization Control | Verdict |
| :--- | :--- | :--- | :--- |
| `POST /topics` | `subjectId`, `parentTopicId` | Verifies `Subject.findOne({ _id: subjectId, userId })` and `Topic.findOne({ _id: parentTopicId, userId, subjectId })` | **PASS** |
| `GET /topics/:id/lab` | `req.params.id` | Scoped to `Topic.findOne({ _id: topicId, userId })` | **PASS** |
| `PUT /topics/:id/lab` | `req.params.id` | Verifies `Topic.findOne({ _id: topicId, userId })` before upserting; prevents orphaned labs | **PASS** |
| `POST /sessions/start` | `topicId`, `timetableBlockId` | Verifies `Topic.findOne({ _id: topicId, userId })` and `ScheduledStudyBlock.findOne({ _id: timetableBlockId, userId })` | **PASS** |
| `POST /sessions/:id/heartbeat` | `req.params.id` | Scoped to `StudySession.findOne({ _id: sessionId, userId })` | **PASS** |
| `POST /sessions/:id/finish` | `req.params.id` | Scoped to `StudySession.findOne({ _id: sessionId, userId })` | **PASS** |
| `POST /mistakes` | `topicId` | Verifies `Topic.findOne({ _id: topicId, userId })` | **PASS** |
| `POST /mistakes/:id/drill` | `req.params.id` | Scoped to `Mistake.findOne({ _id: mistakeId, userId })` | **PASS** |
| `PUT /timetable/routines/:dayOfWeek` | `blocks[].targetSubjectId` | Verifies all unique subject IDs exist and belong to user via `Subject.countDocuments` | **PASS** |
| `PATCH /timetable/blocks/:id` | `req.params.id`, `activeFocusMinutes` | Scoped to `ScheduledStudyBlock.findOneAndUpdate({ _id: blockId, userId })`; strips focus minutes | **PASS** |
| `GET /revisions/:id/diagnostic` | `req.params.id` | Scoped to `RevisionSchedule.findOne({ _id: revisionId, userId })` | **PASS** |
| `POST /revisions/:id/submit` | `req.params.id` | Scoped to `RevisionSchedule.findOneAndUpdate({ _id: revisionId, userId, ... })` | **PASS** |

---

## 7. Revision State Machine Audit

| Invariant | Specification Rule | Implementation Status | Evidence / Analysis |
| :--- | :--- | :--- | :--- |
| **Interval Sequence** | 1 (Day 2) $\to$ 2 (Day 4) $\to$ 3 (Day 7) $\to$ Maintenance | **PASS** | Implemented in `Rule247RevisionEngine` switch block ([`revisionEngine.ts:96-119`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/services/revisionEngine.ts#L96-L119)) |
| **Failure Non-Advancement**| Failure MUST NOT advance interval index | **PASS** | `nextIntervalIndex = currentIntervalIndex` strictly preserved ([`revisionEngine.ts:82`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/services/revisionEngine.ts#L82)) |
| **Failure Contraction** | Next revision scheduled for tomorrow (+1 day) | **PASS** | `nextIntervalDays = 1` ([`revisionEngine.ts:83`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/services/revisionEngine.ts#L83)) |
| **Stability Halving** | $S_{\text{new}} = \max(1.0, S_{\text{prev}} \times 0.5)$ | **PASS** | `Math.max(1.0, Math.round(currentStabilityDays * 0.5 * 10) / 10)` ([`revisionEngine.ts:78`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/services/revisionEngine.ts#L78)) |
| **Cycle Count Increment** | Increments by 1 only when completing interval 3 | **PASS** | Increments on case 3/default; 0 on cases 0, 1, 2, and failure ([`revisionEngine.ts:87, 100, 105, 110, 117`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/services/revisionEngine.ts#L87)) |
| **Excluded Speculative Rule** | "Two consecutive failures reset interval" excluded | **PASS** | Verified absent from engine; strictly follows Master Spec |
| **Civil Midnight Timezone** | Local civil midnight normalization | **FAIL (P1)** | Produces 00:00:00 UTC instead of local timezone midnight ([`revisionEngine.ts:39`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/services/revisionEngine.ts#L39)) |
| **Unique Active Schedule** | Partial unique index on `{ userId: 1, topicId: 1 }` | **PASS** | Verified on `revisionschedules` collection ([`RevisionSchedule.ts:45-51`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/models/RevisionSchedule.ts#L45-L51)) |
| **Duplicate Submission** | Returns 409 `REVISION_ALREADY_COMPLETED` | **PASS** | Conditional atomic CAS returns 409 on re-submission ([`revision.routes.ts:138-148`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/revision.routes.ts#L138-L148)) |

---

## 8. ARD / Evidence Audit

| Checkpoint | Requirement | Status | Audit Assessment |
| :--- | :--- | :--- | :--- |
| **Question Count** | Exactly 3 challenge questions assembled | **PASS** | Generates 1 conceptual, 1 debugging (from Mistake Bank if available), 1 complexity ([`revisionDiagnosticService.ts:55-121`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/services/revisionDiagnosticService.ts#L55-L121)) |
| **Answer Key Isolation** | Secrets never delivered in public payload | **PASS** | `sanitizeDiagnosticChallenge` projects only public fields; answer keys, fix IDs, and explanations are stripped ([`revisionDiagnosticService.ts:25-40`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/services/revisionDiagnosticService.ts#L25-L40)) |
| **Scoring Authority** | Server-authoritative; ignores client scores | **PASS** | Scoring is evaluated solely by `evaluateDiagnosticSubmission`; client-provided metrics are disregarded |
| **Deterministic Integer Pass**| `correctCount >= 2` out of 3 is a pass | **PASS** | `const isPassing = correctCount >= 2;` integer threshold strictly enforced ([`revisionDiagnosticService.ts:359`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/services/revisionDiagnosticService.ts#L359)) |
| **Mistake Vault Ingestion** | Incorrect answers create Mistake entries | **PASS** | Automatically constructs `Mistake` drafts with origin `REVISION`, root cause, and one-line rule ([`revisionDiagnosticService.ts:192, 219, 251, 277, 305, 337`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/services/revisionDiagnosticService.ts#L192)) |
| **Payload Validation** | Reject unknown/duplicate question IDs | **FAIL (P2)** | `POST /:id/submit` does not validate question ID uniqueness or presence before evaluation |

---

## 9. Runtime Validation Audit

- **TypeScript Discriminated Unions:**
  Defined in [`server/src/types/diagnostic.ts`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/types/diagnostic.ts):
  - `DiagnosticAnswerSubmission` (discriminated on `type`)
  - `StoredDiagnosticEvaluation` (discriminated on `type`)
  - `IRevisionChallengeQuestion` (discriminated on `type`)
- **Mongoose Runtime Schema:**
  In [`server/src/models/RevisionSchedule.ts:36-37`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/models/RevisionSchedule.ts#L36-L37):
  ```typescript
  challengeQuestions: [Schema.Types.Mixed] as any,
  evaluations: [Schema.Types.Mixed] as any,
  ```
- **Audit Finding (`CRIT-VAL-01`):** Mongoose does not enforce any runtime structure on `[Schema.Types.Mixed]`. If a malformed object or untrusted payload is assigned, Mongoose saves it directly into MongoDB without validation. An explicit subdocument schema is required to guarantee database data integrity.

---

## 10. Transaction / Concurrency Audit

- **Single-Document Concurrency:**
  Revision completion uses `findOneAndUpdate` with `{ status: { $in: ['PENDING', 'OVERDUE'] } }`, which is atomic at the single-document level. Concurrent submissions for the same revision ID cannot both transition the revision.
- **Multi-Document Consistency:**
  `POST /api/v1/revisions/:id/submit` performs:
  1. `RevisionSchedule.findOneAndUpdate` (status $\to$ `COMPLETED`)
  2. `Mistake.insertMany`
  3. `Topic.save`
  4. `RevisionSchedule.create` (next schedule)
- **Audit Finding (`CRIT-REV-01`):** These 4 operations are executed without a MongoDB multi-document transaction. If the server crashes or an unhandled error occurs during topic update or next schedule creation, the database is left in a corrupted state where the topic has no active or pending revision schedule.
- **Refresh Session Concurrency (`CRIT-AUTH-01`):**
  In `POST /api/v1/auth/refresh`, reading an active session via `findOne` and writing the successor via `RefreshSession.create` followed by `session.save()` is subject to a race condition where parallel refresh requests create two distinct successor sessions.

---

## 11. Error Handling Audit

- **Audit Search for Error Leaks:**
  Inspected [`server/src/middlewares/errorHandler.ts`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/middlewares/errorHandler.ts).
- **Audit Finding (`CRIT-ERR-01`):**
  The centralized error middleware does not differentiate between operational application errors and internal MongoDB / driver exceptions.
  1. **MongoDB Duplicate Key Errors (code 11000):** Returned as status 500 or 11000 with `err.message` exposing collection and index names.
  2. **Mongoose CastErrors:** Malformed ObjectId strings result in `Cast to ObjectId failed for value "..." at path "_id" for model "..."` exposed to the client.
  3. **Production Stack / Message Sanitization:** In `NODE_ENV === 'production'`, 500 errors still return `err.message`.

---

## 12. Test Quality Audit

- **Suite Overview:** `server/src/tests/group1Hardening.test.ts` contains 38 tests, and `securityHardening.test.ts` contains 19 tests (57 total).
- **Critical Assessment:**
  1. **Unit vs. Integration:** The tests in `group1Hardening.test.ts` do not make HTTP requests to the Express server, nor do they interact with a live MongoDB instance.
  2. **Mocking Away System Logic:**
     - Refresh rotation is tested by creating a mock JavaScript object and assigning `oldSession.isRevoked = true`.
     - Authorization checks are tested by comparing two string variables (`'user_bob' === 'user_alice'`).
     - Concurrency is tested with an in-memory JavaScript string variable `let documentState = 'PENDING'`.
  3. **Gaps in Automated Coverage:**
     - No test executes actual parallel HTTP requests against `/auth/refresh` to verify that token branching is prevented under database concurrency.
     - No test verifies error responses when invalid ObjectIds or duplicate keys are passed.
     - No test verifies the timezone offset calculation in `calculateCivilMidnight` for positive and negative UTC offsets.

---

## 13. Scope Audit

- **Features Inspected for Scope Creep:**
  - Exams / Proctored Mock Engine: **NONE** (not implemented)
  - Projects / Portfolio System: **NONE** (not implemented)
  - Competitive Programming Scraper: **NONE** (not implemented)
  - Notifications / Telegram / Web Push: **NONE** (not implemented)
  - Redis / BullMQ Task Queues: **NONE** (not implemented)
  - SEO / CDN / Prerendering: **NONE** (not implemented)
  - UI Redesign: **NONE** (UI alignment was strictly limited to rendering ARD challenge cards in `RevisionModal.tsx`)
- **Conclusion:** Scope discipline was strictly maintained. No out-of-scope features from Group 2 or beyond were introduced.

---

## 14. What Is Correct

1. **Authentication Architecture:**
   - Refresh tokens are generated using 256 bits of cryptographically secure randomness.
   - Plaintext refresh tokens are never persisted in the database; tokens are stored exclusively as SHA-256 hashes.
   - Refresh transport is cookie-only; `req.body.refreshToken` is rejected.
   - Token family lineage (`familyId`) and successor relationships are properly structured in the schema.
   - Physical TTL cleanup is decoupled from expiration via `archiveCleanupAt` (+60 days).
2. **Origin Protection:**
   - Exact set matching on `Origin` / `Referer` headers prevents CSRF and origin forgery.
   - `GET`, `HEAD`, and `OPTIONS` requests pass through safely without origin requirements.
3. **Authorization Hardening:**
   - Pre-flight ownership checks are implemented across all mutated resources (`POST /topics`, `POST /sessions/start`, `POST /mistakes`, `PUT /topics/:id/lab`, `PUT /timetable/routines/:dayOfWeek`).
   - `activeFocusMinutes` and `actualMinutesLogged` are stripped from client block updates, preventing focus time tampering.
4. **Evidence Engine (ARD):**
   - Self-reported Easy/Medium/Hard checkboxes are removed.
   - Server-authoritative deterministic scoring across 6 typologies is fully implemented.
   - Sanitization completely removes answer keys, fix IDs, and explanations from the client payload.
   - Deterministic integer pass rule (`correctCount >= 2`) avoids floating-point precision issues.
   - Incorrect answers are automatically routed to the Mistake Vault.
5. **Revision State Machine:**
   - Failure contracts interval to tomorrow (+1 day).
   - Failure preserves interval index (never advances on failure).
   - Stability slashes by 50% ($S \times 0.5$, minimum 1.0 bound).

---

## 15. Required Fixes Before Phase 1C Approval

1. **Atomic Refresh Token Rotation (`CRIT-AUTH-01`):**
   Refactor `/api/v1/auth/refresh` to use an atomic `findOneAndUpdate({ _id: session._id, revokedAt: null }, ...)` or a MongoDB transaction to prevent parallel refresh requests from branching the token family.
2. **Multi-Document Revision Transaction (`CRIT-REV-01`):**
   Wrap the revision completion, mistake creation, topic evidence update, and next schedule creation in a MongoDB transaction session with rollback handling.
3. **Civil Midnight Timezone Fix (`CRIT-TIME-01`):**
   Update `calculateCivilMidnight` to compute the exact UTC timestamp corresponding to local midnight in the specified timezone, rather than calling `Date.UTC()` which produces 00:00:00 UTC.
4. **Sanitize Centralized Error Handler (`CRIT-ERR-01`):**
   Update `errorHandler.ts` to intercept MongoServerError code 11000 (duplicate key), CastError, and ValidationError, returning clean HTTP status codes and sanitized messages without leaking raw database strings.
5. **Define Mongoose Subdocument Schemas for Diagnostic Arrays (`CRIT-VAL-01`):**
   Replace `[Schema.Types.Mixed]` in `RevisionSchedule.ts` with explicit subdocument schemas.
6. **Validate Diagnostic Submission Payload (`CRIT-VAL-02`):**
   In `POST /revisions/:id/submit`, validate that `answers` contains exactly the expected question IDs matching the challenge, reject duplicate IDs, and validate answer fields before processing.
7. **Set Refresh Cookie SameSite to `'strict'` (`CRIT-AUTH-02`):**
   Change `sameSite: 'lax'` to `sameSite: 'strict'` for the `refreshToken` cookie in `setAuthCookies` and `clearAuthCookies`.
8. **Atomic Grace Replay Increment (`CRIT-AUTH-03`):**
   Use `$inc: { graceReplayCount: 1 }` in `RefreshSession.findOneAndUpdate` rather than an in-memory increment and save.

---

## 16. Recommended Tests To Add

1. **Integration Concurrency Test for Refresh Rotation:**
   Send two simultaneous HTTP requests to `/api/v1/auth/refresh` with the same valid refresh token cookie. Assert that exactly one succeeds with a new rotated token and the other receives an HTTP 401 or handled grace response; verify that only one active successor session exists in the database.
2. **Integration Test for Nested Resource Ownership:**
   Make HTTP requests as User A referencing User B's `subjectId`, `parentTopicId`, `topicId`, and `scheduledBlockId`. Verify that the server returns HTTP 404 in every case.
3. **Integration Test for Revision Submission Atomicity:**
   Simulate a failure in `RevisionSchedule.create` during revision submission. Assert that the entire transaction aborts and the revision remains `PENDING`.
4. **Timezone Boundary Test:**
   Execute `calculateCivilMidnight` with positive (`Asia/Kolkata`, UTC+5:30) and negative (`America/New_York`, UTC-5) timezones. Assert that the returned Date, when formatted in that timezone, has hour=0, minute=0, second=0.
5. **Raw Error Leakage Test:**
   Trigger a duplicate key error and a malformed ObjectId error via HTTP. Assert that the HTTP response does not contain `collection:`, `dup key:`, or Mongoose `Cast to ObjectId` strings.

---

## 17. Final Gate

**Status:** **GATED — PROCEED ONLY AFTER REQUIRED FIXES**

The Phase 1C Group 1 implementation establishes the required architectural models, algorithms, and evidence systems. However, because P0/P1 issues remain in concurrency atomicity, transaction safety, error sanitization, and timezone calculation, Group 1 must undergo a targeted hardening pass to resolve the 8 items listed in Section 15 before Phase 1C is considered approved and ready for Group 2.
