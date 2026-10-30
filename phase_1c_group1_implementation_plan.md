# PHASE 1C — GROUP 1 IMPLEMENTATION PLAN (FINAL REVISED GATE)
## P1 Critical Integrity Showstoppers: Authentication, Authorization, Revision State Machine & Evidence Engine

**Document Status:** Final Gate Plan — Awaiting Implementation Approval  
**Implementation Phase:** Phase 1C — Group 1  
**Target Milestone:** StudyOS Integrity & Evidence Baseline  
**Workspace:** `c:\Users\hp\OneDrive\Desktop\studyOS`  

---

## 1. Executive Summary & Document Control

This document represents the **final, authoritative pre-implementation blueprint** for resolving the five P1 Critical Integrity Showstoppers identified in Phase 1B:
1. **AUTH-01:** Token lifecycle failure (15m lockout, missing refresh tokens, lack of rotation and revocation).
2. **AUTHZ-01..04:** Nested cross-tenant resource injection and blind ConceptLab document creation.
3. **REV-01:** Spaced repetition failure progression inversion (advancing intervals despite failure).
4. **REV-03:** Unprotected revision submission allowing duplicate schedules and inflated metrics.
5. **REV-02:** Checkbox fallacy in revision completion (direct client-reported scores without verifiable recall).

This revision incorporates the **final pre-implementation gate corrections**:
- **Reworked Refresh Grace Mechanism:** Configurable grace window (`AUTH_REFRESH_GRACE_SECONDS`, default 15s) with strict security boundaries: old rotated tokens **never** create new successor sessions; successor session validity is verified; repeated grace presentation within window triggers family revocation; security audit logging is mandatory.
- **Discriminated Union Evaluation Storage:** Replaced loose string typing with type-safe discriminated union interfaces across all 6 question typologies (`MCQ`, `TRUE_FALSE`, `OUTPUT_PREDICTION`, `COMPLEXITY`, `DEBUGGING`, `STRUCTURED_CONCEPTUAL`).
- **Explicit CSRF / Origin Policy:** Formulated a zero-trust browser security policy requiring explicit `Origin`/`Referer` validation on all state-changing auth mutations (`POST /auth/refresh`, `/auth/logout`, `/auth/login`, `/auth/register`), rejecting requests with missing or unexpected origins.
- **Decoupled Session TTL & Audit Retention:** Replaced premature `expiresAt` TTL deletion with a dedicated `archiveCleanupAt` (+60 days) TTL index, separating synchronous authorization validity from physical database cleanup and preserving historical tokens for long-term replay detection.
- **Deterministic Integer Thresholds:** Grounded pass/fail evaluation strictly in integer logic (`correctCount >= 2` out of 3 questions), eliminating floating-point comparison hazards.
- **Pure Master Specification Alignment:** Stripped speculative unapproved rules (such as consecutive-failure interval resets); strictly implemented the Master Specification's failure contraction to Day 1, stability halving ($S \times 0.5$), and non-advancement of interval index.

**Scope Invariant:** No application code, dependencies, or database records have been modified. Implementation remains gated pending explicit approval.

---

## 2. Summary of Changes in Final Pre-Implementation Gate

| Technical Area | Previous Draft | Final Corrected Specification | Security & Reliability Rationale |
| :--- | :--- | :--- | :--- |
| **Refresh Grace Window** | Hardcoded 20s; vaguely described as "atomic"; unbounded replays allowed during window. | Configurable `AUTH_REFRESH_GRACE_SECONDS` (default 15s); **never branches refresh tokens**; verifies successor session validity; max 2 replays per window before family revocation; mandatory security audit log. | Eliminates ambiguity between concurrent tabs and token theft; prevents refresh token branching; bounds exposure window. |
| **Diagnostic Evaluation Typing** | `evaluations.userAnswer` typed as `string`. | **Type-safe discriminated union** across all 6 question typologies for client payload, server validation, DB storage, and scoring. | Eliminates runtime type errors; guarantees type-safe database persistence; rejects malformed answer structures. |
| **CSRF / Origin Policy** | Relied implicitly on SameSite=Lax without defining missing-origin behavior. | Explicit policy: `/auth/refresh` and `/auth/logout` **require** matching `Origin`/`Referer`. Missing or unexpected origins return `403 Forbidden`. | Guarantees no request path can bypass origin verification; proves why custom CSRF tokens are unnecessary. |
| **Session TTL & Replay Retention** | MongoDB TTL index directly on `expiresAt`. | Synchronous validation uses `expiresAt`; **TTL index placed on `archiveCleanupAt` (+60d)**. | Retains rotated/expired sessions for 30+ days post-expiration to guarantee persistent replay detection; decouples cleanup from auth logic. |
| **Pass/Fail Threshold** | Floating-point comparison (`score >= 67%`). | Strict integer logic: **`correctCount >= 2` out of 3 questions $\implies$ PASS**. | Prevents floating-point precision bugs ($2/3 \approx 66.6666\%$ vs $67\%$) from corrupting state transitions. |
| **Master Spec Fidelity** | Included speculative "2 consecutive failures reset to Interval 1". | Removed unapproved rule. Marked as **Proposed Product Extension Requiring Approval**. Core engine adheres strictly to Master Spec. | Preserves architectural discipline; does not silently alter core product specifications. |

---

## 3. AUTH-01: Refresh Token Lifecycle & Standalone Session Collection

### 3.1 Standalone `RefreshSession` Collection Schema

```typescript
// server/src/models/RefreshSession.ts
import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IRefreshSession extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;                  // SHA-256 hash of raw refresh token
  familyId: string;                   // UUID v4 identifying the session lineage
  replacedBySessionId?: Types.ObjectId; // Pointer to successor session issued during rotation
  graceReplayCount: number;           // Number of times presented during grace window
  expiresAt: Date;                    // 30 days active lifetime from creation
  archiveCleanupAt: Date;             // 60 days total retention (expiresAt + 30d) for replay detection
  revokedAt?: Date;                   // Timestamp of revocation (logout, rotation, or security purge)
  revocationReason?: 
    | 'ROTATED' 
    | 'LOGOUT' 
    | 'EXPIRED' 
    | 'FAMILY_COMPROMISE_DETECTED' 
    | 'USER_REVOKED_ALL';
  userAgent?: string;
  ipAddress?: string;
  createdAt: Date;
  updatedAt: Date;
}

const RefreshSessionSchema = new Schema<IRefreshSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    familyId: { type: String, required: true, index: true },
    replacedBySessionId: { type: Schema.Types.ObjectId, ref: 'RefreshSession', default: null },
    graceReplayCount: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: true },
    archiveCleanupAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date, default: null, index: true },
    revocationReason: { 
      type: String, 
      enum: ['ROTATED', 'LOGOUT', 'EXPIRED', 'FAMILY_COMPROMISE_DETECTED', 'USER_REVOKED_ALL'] 
    },
    userAgent: { type: String },
    ipAddress: { type: String },
  },
  { timestamps: true }
);

// Indexes
RefreshSessionSchema.index({ familyId: 1, revokedAt: 1 });
RefreshSessionSchema.index({ userId: 1, revokedAt: 1 });
// Physical cleanup happens strictly after the 60-day audit/replay window:
RefreshSessionSchema.index({ archiveCleanupAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshSession = mongoose.model<IRefreshSession>('RefreshSession', RefreshSessionSchema);
```

### 3.2 Decoupled TTL vs. Synchronous Authorization Validity

1. **Synchronous Authorization Validity:**
   - Every incoming refresh request evaluates:
     `currentSession.expiresAt > new Date()` AND `currentSession.revokedAt === null`.
   - Authorization decisions **never** depend on MongoDB background TTL threads.
2. **Replay Detection Window:**
   - Sessions are retained in MongoDB for **60 days** (`archiveCleanupAt = now + 60d`).
   - Even after a token reaches active expiration (30 days), its hash remains in the database for an additional 30 days. If an attacker attempts to replay an expired or old rotated token, the system still identifies its `familyId` and executes security actions.
3. **Physical Cleanup:**
   - MongoDB background TTL worker cleans up documents whose `archiveCleanupAt` is in the past. This is strictly a disk garbage collection mechanism.

### 3.3 Reworked Concurrent Refresh Grace Mechanism

#### Configuration:
```typescript
// server/src/config/env.ts
AUTH_REFRESH_GRACE_SECONDS: z.coerce.number().default(15), // Configurable; 0 disables grace window
```

#### Exact Rules & State Transitions:

```
[Incoming Token Hash: hash_T1]
               │
               ▼
[Lookup RefreshSession where tokenHash = hash_T1]
               │
       ┌───────┴───────┐
       ▼               ▼
[Session Found]   [Not Found] ──► [401 INVALID_REFRESH_TOKEN]
       │
       ├──────────────────────────────────────────────┐
       ▼                                              ▼
[revokedAt === null]                        [revokedAt !== null]
       │                                              │
       ▼                                              ▼
[Active Rotation]                           [Revocation Analysis]
  1. Verify expiresAt > now                   1. Check revocationReason === 'ROTATED'
  2. Transaction:                             2. Check elapsed = now - revokedAt
     - Create Session 2 (T2)                  3. Check elapsed <= AUTH_REFRESH_GRACE_SECONDS
     - Mark Session 1:                                │
       revokedAt = now                                ├──────────────────────────┐
       replacedBy = Session 2                         ▼                          ▼
       reason = 'ROTATED'                     [Within Grace Window]     [Outside Grace Window]
  3. Set Cookies (T2, Access)                         │                          │
  4. Return 200 OK                                    ▼                          ▼
                                             [Successor Active Check]   [REPLAY DETECTED]
                                             Inspect replacedBySession   1. Revoke ENTIRE familyId
                                                      │                  2. Clear Cookies
                                             ┌────────┴────────┐         3. Log SECURITY_ALERT
                                             ▼                 ▼         4. Return 401
                                         [Active]          [Revoked]        REUSED_REFRESH_TOKEN
                                             │                 │
                                             ▼                 ▼
                                    [Reissue Access]      [401 REFRESH_SESSION_REVOKED]
                                    1. Check replay count
                                       (if > 2 -> Revoke Family!)
                                    2. Reissue Access Cookie
                                    3. DO NOT CREATE NEW REFRESH TOKEN
                                    4. Log AUDIT_GRACE_INVOKED
                                    5. Return 200 OK
```

1. **No Refresh Token Branching Invariant:**
   - An old rotated token ($T_1$) **MUST NEVER** generate a new refresh token or create another session in the database.
   - The authoritative successor session ($T_2$) was already created during the primary rotation and remains the sole active session.
2. **Successor Session Validation:**
   - When $T_1$ arrives within the grace window, the server loads `replacedBySessionId` ($T_2$).
   - If $T_2$ has `revokedAt !== null` (e.g., user already logged out or family was compromised), the request is rejected immediately with HTTP 401 (`REFRESH_SESSION_REVOKED`). Zero tokens are issued.
3. **Repeated Grace Presentation (Anti-Abuse Cap):**
   - The server atomically increments `graceReplayCount` on `sess_1`.
   - If `graceReplayCount > 2` within the grace window:
     - The request is treated as an automated attack or broken client loop.
     - The entire `familyId` is revoked immediately (`revocationReason = 'FAMILY_COMPROMISE_DETECTED'`).
     - Both cookies are cleared.
     - HTTP 401 `REUSED_REFRESH_TOKEN` is returned.
4. **Response & Cookies During Grace Case:**
   - Server issues a fresh short-lived `accessToken` cookie (`path: '/'`, 15m).
   - Server **does not re-issue or mutate the refresh token cookie**, because Tab A already received and set the authoritative cookie for $T_2$.
5. **Security Audit Logging:**
   - Every invocation within the grace window logs a structured security event:
     ```json
     {
       "event": "AUTH_REFRESH_GRACE_INVOKED",
       "familyId": "fam_123",
       "predecessorSessionId": "sess_1",
       "successorSessionId": "sess_2",
       "elapsedMs": 184,
       "graceReplayCount": 1,
       "ip": "127.0.0.1",
       "userAgent": "Mozilla/5.0..."
     }
     ```
6. **Explicit Security Trade-Off:**
   - *With Grace Window Enabled (Default 15s):* Legitimate users opening two tabs concurrently or experiencing mobile network packet retries do not suffer sudden logouts. Trade-off: If an attacker intercepts $T_1$ and replays it within 15 seconds of the user rotating it, the attacker can obtain an access token valid for 15 minutes, but cannot prolong access or steal the refresh chain.
   - *With Grace Window Disabled (`AUTH_REFRESH_GRACE_SECONDS=0`):* Immediate zero-tolerance replay detection. Trade-off: High probability of false-positive logouts under normal multi-tab usage.

---

## 4. Explicit CSRF & Origin Verification Policy

### 4.1 Strict State-Changing Auth Request Matrix

| Endpoint | Method | Transport | Allowed Origin | Missing Origin/Referer Policy | Same-Origin / CORS Policy |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/v1/auth/refresh` | `POST` | `httpOnly` Cookie | `CLIENT_ORIGIN` (or whitelisted dev origins) | **HTTP 403 Forbidden** (`MISSING_ORIGIN_HEADER`) | Must pass Origin check; credentials included |
| `/api/v1/auth/logout` | `POST` | `httpOnly` Cookie | `CLIENT_ORIGIN` (or whitelisted dev origins) | **HTTP 403 Forbidden** (`MISSING_ORIGIN_HEADER`) | Must pass Origin check; credentials included |
| `/api/v1/auth/login` | `POST` | JSON Body | `CLIENT_ORIGIN` (or whitelisted dev origins) | **HTTP 403 Forbidden** if cookie present | Preflight required (`Content-Type: application/json`) |
| `/api/v1/auth/register` | `POST` | JSON Body | `CLIENT_ORIGIN` (or whitelisted dev origins) | **HTTP 403 Forbidden** if cookie present | Preflight required (`Content-Type: application/json`) |

### 4.2 Origin Verification Middleware Specification

```typescript
// server/src/middlewares/originValidation.ts
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

const ALLOWED_ORIGINS = new Set([
  env.CLIENT_ORIGIN,
  ...(env.NODE_ENV !== 'production' 
    ? ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'] 
    : [])
]);

export function enforceAuthOriginPolicy(req: Request, res: Response, next: NextFunction): void {
  // Only enforce on state-changing mutation requests
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  let requestOrigin: string | undefined = origin;

  if (!requestOrigin && referer) {
    try {
      requestOrigin = new URL(referer).origin;
    } catch {
      // Malformed referer
    }
  }

  if (!requestOrigin) {
    res.status(403).json({
      success: false,
      error: {
        code: 'MISSING_ORIGIN_HEADER',
        message: 'State-changing authentication requests require an explicit Origin or Referer header.',
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  if (!ALLOWED_ORIGINS.has(requestOrigin)) {
    res.status(403).json({
      success: false,
      error: {
        code: 'CSRF_ORIGIN_MISMATCH',
        message: `Cross-origin request from origin "${requestOrigin}" is forbidden.`,
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  next();
}
```

### 4.3 Why Custom CSRF Tokens Are Unnecessary Under This Architecture
Under this explicit contract, custom double-submit or synchronized Anti-CSRF tokens are redundant because:
1. **Cookie SameSite Isolation:** Both `accessToken` and `refreshToken` have `SameSite: 'lax'`, meaning browsers will structurally refuse to send them on cross-site POST requests.
2. **Mandatory Origin Enforcement:** Any request hitting `/auth/refresh` or `/auth/logout` without an approved Origin header is rejected with HTTP 403 before any authentication logic executes.
3. **CORS Preflight Guarantee:** Browser clients communicate via `Content-Type: application/json`, which mandates CORS preflight (`OPTIONS`), completely preventing HTML form POST bypasses.
4. **Cookie Path Scoping:** `refreshToken` is scoped strictly to `Path=/api/v1/auth`, preventing it from ever leaking to application resource routes.

---

## 5. AUTHZ-01..04: Nested Resource Ownership Hardening

Every database mutation that accepts a parent or related ID must explicitly verify that the resource exists and belongs to the authenticated user.

```typescript
// Explicit Pre-Flight Parent Ownership Checks
// 1. POST /api/v1/topics
const subject = await Subject.findOne({ _id: subjectId, userId: req.user.id });
if (!subject) throw new ResourceNotFoundError('SUBJECT_NOT_FOUND', 'Subject not found.');
if (parentTopicId) {
  const parent = await Topic.findOne({ _id: parentTopicId, userId: req.user.id, subjectId });
  if (!parent) throw new ResourceNotFoundError('PARENT_TOPIC_NOT_FOUND', 'Parent topic not found in this subject.');
}

// 2. POST /api/v1/sessions/start
const topic = await Topic.findOne({ _id: topicId, userId: req.user.id });
if (!topic) throw new ResourceNotFoundError('TOPIC_NOT_FOUND', 'Topic not found.');
if (timetableBlockId) {
  const block = await ScheduledStudyBlock.findOne({ _id: timetableBlockId, userId: req.user.id });
  if (!block) throw new ResourceNotFoundError('STUDY_BLOCK_NOT_FOUND', 'Scheduled study block not found.');
}

// 3. POST /api/v1/mistakes
const mistakeTopic = await Topic.findOne({ _id: topicId, userId: req.user.id });
if (!mistakeTopic) throw new ResourceNotFoundError('TOPIC_NOT_FOUND', 'Topic not found.');

// 4. PUT /api/v1/topics/:id/lab (No blind upserts!)
const labTopic = await Topic.findOne({ _id: req.params.id, userId: req.user.id });
if (!labTopic) throw new ResourceNotFoundError('TOPIC_NOT_FOUND', 'Topic not found.');
await ConceptLab.findOneAndUpdate({ topicId: labTopic._id, userId: req.user.id }, { $set: payload }, { new: true, upsert: true });

// 5. PATCH /api/v1/timetable/blocks/:id
// Client is strictly forbidden from manually setting activeFocusMinutes:
delete req.body.activeFocusMinutes;
delete req.body.actualMinutesLogged;
```

---

## 6. REV-01: 2-4-7 Spaced Revision Progression State Machine

### 6.1 Strict Master Specification Reconciliation

The Master Specification (Sections 10, 11, 12) governs all state transitions:
1. **The Spaced Intervals:**
   - **Interval 0:** Day 0 (Initial learning + quiz pass $\to$ promoted to `ASSESSED`).
   - **Interval 1:** $\text{Day 0} + 2 \text{ days}$.
   - **Interval 2:** $\text{Success 1} + 4 \text{ days}$.
   - **Interval 3:** $\text{Success 2} + 7 \text{ days}$.
   - **Interval 4+ (Maintenance):** $\text{Success 3} + 14 \text{ days}$, doubling up to max 30-60 days.
2. **Master Specification Failure Rule (Section 9 Flow 2 & Section 11):**
   - *"Upon failed review: Next revision contracted to Tomorrow (+1 day) instead of progressing to Day 4."*
   - Topic falls back to `LEARNING` (or `ASSESSED` with needs-revision flag).
   - Stability slashes by 50%: $S_{t,\text{new}} = \max(1.0, S_{t,\text{prev}} \times 0.5)$.
   - Interval cycle count increment $= 0$.
   - **CORE PRODUCT INVARIANT:** A failed revision **MUST NOT** advance the interval index!

### 6.2 Proposed Product Extensions Requiring Explicit Approval

> [!IMPORTANT]
> The following rule was flagged during architecture review and is **EXCLUDED** from core implementation until explicitly approved:
> - *Speculative Rule:* "If a topic fails 2 consecutive revisions at Interval 1, reset interval index with a priority flag."
> - **Status:** **EXCLUDED**. In this implementation, failure strictly follows the Master Specification: interval index remains unchanged, next review is scheduled for tomorrow (+1 day), and stability slashes by 50%.

### 6.3 Deterministic Integer Pass/Fail Rule

To eliminate floating-point precision vulnerabilities:
- The diagnostic test presents exactly **3 questions**.
- **`isPassing = correctCount >= 2`** (Strict integer evaluation: 2 or 3 correct $\implies$ PASS; 0 or 1 correct $\implies$ FAIL).
- `scorePercentage = Math.round((correctCount / 3) * 100)` is an output telemetry metric only.

```typescript
export function evaluateDiagnosticOutcome(correctCount: number, totalQuestions: number = 3): {
  isPassing: boolean;
  scorePercentage: number;
} {
  return {
    isPassing: correctCount >= 2,
    scorePercentage: Math.round((correctCount / totalQuestions) * 100),
  };
}
```

---

## 7. REV-02: Evidence-Based Active Retrieval Diagnostic (ARD) Engine

### 7.1 Discriminated Union Evaluation Types

```typescript
// server/src/types/diagnostic.ts

export type CanonicalComplexity = 
  | 'O(1)' 
  | 'O(log N)' 
  | 'O(N)' 
  | 'O(N log N)' 
  | 'O(N^2)' 
  | 'O(2^N)' 
  | 'O(N!)';

// 1. Client Submission Discriminated Union
export type DiagnosticAnswerSubmission =
  | { questionId: string; type: 'MCQ'; selectedOptionId: string; timeSpentSeconds: number }
  | { questionId: string; type: 'TRUE_FALSE'; userBoolean: boolean; timeSpentSeconds: number }
  | { questionId: string; type: 'OUTPUT_PREDICTION'; userOutput: string; timeSpentSeconds: number }
  | { questionId: string; type: 'COMPLEXITY'; selectedComplexity: CanonicalComplexity; timeSpentSeconds: number }
  | { questionId: string; type: 'DEBUGGING'; selectedFixId: string; timeSpentSeconds: number }
  | { questionId: string; type: 'STRUCTURED_CONCEPTUAL'; selectedAssertionIds: string[]; timeSpentSeconds: number };

// 2. Database Stored Evaluation Discriminated Union
export type StoredDiagnosticEvaluation =
  | {
      questionId: string;
      type: 'MCQ';
      submittedOptionId: string;
      correctOptionId: string;
      isCorrect: boolean;
      timeSpentSeconds: number;
    }
  | {
      questionId: string;
      type: 'TRUE_FALSE';
      submittedBoolean: boolean;
      correctBoolean: boolean;
      isCorrect: boolean;
      timeSpentSeconds: number;
    }
  | {
      questionId: string;
      type: 'OUTPUT_PREDICTION';
      submittedOutput: string;
      normalizedSubmittedOutput: string;
      expectedOutput: string;
      isCorrect: boolean;
      timeSpentSeconds: number;
    }
  | {
      questionId: string;
      type: 'COMPLEXITY';
      submittedComplexity: CanonicalComplexity;
      expectedComplexity: CanonicalComplexity;
      isCorrect: boolean;
      timeSpentSeconds: number;
    }
  | {
      questionId: string;
      type: 'DEBUGGING';
      submittedFixId: string;
      correctFixId: string;
      isCorrect: boolean;
      timeSpentSeconds: number;
    }
  | {
      questionId: string;
      type: 'STRUCTURED_CONCEPTUAL';
      submittedAssertionIds: string[];
      correctAssertionIds: string[];
      isCorrect: boolean;
      timeSpentSeconds: number;
    };
```

### 7.2 Typology Validation & Scoring Matrix

| Question Type | Client Payload Field | Server Validation Rule | Scoring Formulation | Client Never Receives |
| :--- | :--- | :--- | :--- | :--- |
| **`MCQ`** | `selectedOptionId: string` | Matches valid candidate option ID | `selectedOptionId === q.correctOptionId` | `correctOptionId`, `explanation` |
| **`TRUE_FALSE`** | `userBoolean: boolean` | `typeof userBoolean === 'boolean'` | `userBoolean === q.correctBoolean` | `correctBoolean`, `explanation` |
| **`OUTPUT_PREDICTION`**| `userOutput: string` | String length $\le 200$ | `normalize(userOutput) === normalize(q.expectedOutput)` | `expectedOutput`, `explanation` |
| **`COMPLEXITY`** | `selectedComplexity: string` | Exists in `CanonicalComplexity` enum | `selectedComplexity === q.expectedComplexity` | `expectedComplexity`, `explanation` |
| **`DEBUGGING`** | `selectedFixId: string` | Matches candidate fix ID | `selectedFixId === q.correctFixId` | `correctFixId`, `explanation` |
| **`STRUCTURED_CONCEPTUAL`** | `selectedAssertionIds: string[]` | Array of candidate assertion IDs | Set equality between submitted and correct assertion IDs | `correctAssertionIds`, `explanation` |

### 7.3 Mistake Vault Ingestion Invariant
Any question where `isCorrect === false` is automatically ingested into `Mistake` under `origin: 'REVISION'` with deterministic root-cause mapping:
- `DEBUGGING` $\to$ `EDGE_CASE_BLINDNESS`
- `COMPLEXITY` $\to$ `TIME_COMPLEXITY_EXCEEDED`
- `OUTPUT_PREDICTION` $\to$ `EXECUTION_SLIP`
- `STRUCTURED_CONCEPTUAL` / `MCQ` $\to$ `CONCEPTUAL_GAP`

---

## 8. REV-03: Repeated Submission & Concurrency Protection

### 8.1 Atomic State Transition & Conflict Rejection
```typescript
const revision = await RevisionSchedule.findOneAndUpdate(
  {
    _id: revisionId,
    userId: req.user.id,
    status: { $in: ['PENDING', 'OVERDUE'] },
  },
  {
    $set: {
      status: 'COMPLETED',
      completedAt: new Date(),
    },
  },
  { new: true, session }
);

if (!revision) {
  const existing = await RevisionSchedule.findOne({ _id: revisionId, userId: req.user.id });
  if (existing && existing.status === 'COMPLETED') {
    return res.status(409).json({
      success: false,
      error: {
        code: 'REVISION_ALREADY_COMPLETED',
        message: 'This revision schedule has already been completed and evaluated.',
      },
    });
  }
  return res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Revision schedule not found.' },
  });
}
```

### 8.2 Database Unique Constraint
```typescript
RevisionScheduleSchema.index(
  { userId: 1, topicId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['PENDING', 'OVERDUE'] } },
  }
);
```

---

## 9. Multi-Document Transaction & Consistency Strategy

### 9.1 Atomic Granularity Principles
1. **Single-Document Operations:**
   - Atomic by default in MongoDB via single-document operators (`findOneAndUpdate`, `$set`, `$inc`).
2. **Multi-Document Operations (Mandatory Transactions):**
   - **Revision Completion:** Updating `RevisionSchedule`, updating `Topic` evidence, creating next `RevisionSchedule`, and inserting `Mistake` documents.
   - **Quiz Submission:** Creating `QuizSubmission`, inserting `Mistake` documents, updating `Topic` evidence, and scheduling initial revision.

### 9.2 Strict Prerequisite: MongoDB Replica Set
- **Zero Silent Fallback:** The backend will **NOT** implement a silent non-transactional fallback in production that could allow partial updates to corrupt learning metrics.
- **Fail-Fast Error Handling:** If the database does not support multi-document transactions (e.g. standalone Mongo without replica set), the transaction wrapper throws an immediate, fatal `TRANSACTION_NOT_SUPPORTED` exception with instructions to start MongoDB with `--replSet rs0`.

---

## 10. Database Schema Changes Summary

### 10.1 `RefreshSession` Model (New)
- `userId`: `ObjectId` (indexed)
- `tokenHash`: `string` (unique index)
- `familyId`: `string` (indexed)
- `replacedBySessionId`: `ObjectId` (pointer to successor)
- `graceReplayCount`: `number` (anti-abuse counter)
- `expiresAt`: `Date` (30 days)
- `archiveCleanupAt`: `Date` (60 days TTL index)
- `revokedAt`: `Date` (null if active)
- `revocationReason`: `string` enum

### 10.2 `RevisionSchedule` Model Updates
- `previousRevisionId`: `ObjectId` (audit linkage to predecessor revision)
- `challengeQuestions`: `Schema.Types.Mixed` (embedded sanitized questions)
- `evaluations`: `[Schema.Types.Mixed]` (discriminated union evaluations)
- `recallConfidence`: `number` (1..5 metacognitive rating)
- Partial unique compound index: `{ userId: 1, topicId: 1 }` for `status: { $in: ['PENDING', 'OVERDUE'] }`.

---

## 11. Testing Strategy

All automated verification will be authored in:  
`server/src/tests/group1Hardening.test.ts`

### Detailed Test Suites:
1. **AUTH Suite:**
   - [ ] Login sets `accessToken` (cookie, 15m) and `refreshToken` (cookie, 30d, `Path=/api/v1/auth`).
   - [ ] Refresh endpoint reads cookie, ignores JSON body refresh token.
   - [ ] Refresh rotates token in `RefreshSession` and links `replacedBySessionId`.
   - [ ] Concurrent refresh within 15s grace returns active session without invalidating family.
   - [ ] Predecessor token replayed > 2 times within grace window triggers family revocation.
   - [ ] Predecessor token presented after 15s triggers `FAMILY_COMPROMISE_DETECTED` and purges family.
   - [ ] Successor session revoked $\to$ grace refresh fails with 401 `REFRESH_SESSION_REVOKED`.
   - [ ] Missing or foreign `Origin`/`Referer` header returns 403 Forbidden.
   - [ ] Logout revokes single session and clears cookies.
2. **AUTHZ Suite:**
   - [ ] User A creating topic under User B's subject gets 404 `SUBJECT_NOT_FOUND`.
   - [ ] User A starting session with User B's topic gets 404 `TOPIC_NOT_FOUND`.
   - [ ] User A starting session with User B's timetable block gets 404 `STUDY_BLOCK_NOT_FOUND`.
   - [ ] User A recording mistake on User B's topic gets 404 `TOPIC_NOT_FOUND`.
   - [ ] User A updating lab on User B's topic gets 404 `TOPIC_NOT_FOUND` (no orphan created).
   - [ ] Client attempting to set `activeFocusMinutes` on study block has field stripped.
3. **REV & EVID Suite:**
   - [ ] Diagnostic with 2/3 correct $\implies$ PASS (`isPassing: true`, advances to next interval).
   - [ ] Diagnostic with 1/3 correct $\implies$ FAIL (`isPassing: false`, stays at current interval, schedules tomorrow, stability halved).
   - [ ] Completed revision submitted again returns 409 `REVISION_ALREADY_COMPLETED`.
   - [ ] Diagnostic evaluations stored as type-safe discriminated objects in database.
   - [ ] Incorrect diagnostic questions auto-create `Mistake` entries with `origin: 'REVISION'`.

---

## 12. Exact Files Expected to Change

### Backend:
1. `server/src/models/RefreshSession.ts` (**New Model**)
2. `server/src/models/User.ts` (Clean up obsolete fields)
3. `server/src/models/RevisionSchedule.ts` (Add challenge questions, evaluations, partial unique index)
4. `server/src/types/diagnostic.ts` (**New Type Definitions**)
5. `server/src/middlewares/originValidation.ts` (**New Middleware**: strict auth origin policy)
6. `server/src/middlewares/auth.ts` (Updated cookie extraction, standardized 401 responses)
7. `server/src/routes/auth.routes.ts` (Cookie-only `/refresh`, `/logout`, token hashing, grace logic)
8. `server/src/routes/topic.routes.ts` (Subject/parent topic ownership checks; secure lab upsert)
9. `server/src/routes/session.routes.ts` (Topic/study block ownership checks)
10. `server/src/routes/mistake.routes.ts` (Topic ownership check)
11. `server/src/routes/timetable.routes.ts` (Subject ownership on routines; sanitize block patch)
12. `server/src/services/revisionEngine.ts` (Reconcile failure progression with Master Spec)
13. `server/src/services/revisionDiagnosticService.ts` (**New Service**: assembly & deterministic scoring)
14. `server/src/routes/revision.routes.ts` (Diagnostic endpoints, atomic state machine, 409 conflicts)
15. `server/src/tests/group1Hardening.test.ts` (**New Automated Test Suite**)

### Frontend:
1. `client/src/api/client.ts` (Auto-refresh interceptor; diagnostic challenge API calls)
2. `client/src/components/RevisionModal.tsx` (Diagnostic retrieval interface)

---

## 13. Implementation Order

```
[Step 1: Database Models & Schemas]
  - Create RefreshSession model with archiveCleanupAt TTL index
  - Update RevisionSchedule model with typed evaluations and partial unique index
            │
            ▼
[Step 2: Authentication Engine & Origin Middleware (AUTH-01)]
  - Implement originValidation middleware
  - Implement token generation, hashing, rotation, and configurable grace period
  - Implement cookie-only /auth/refresh and /auth/logout
  - Implement client fetch refresh interceptor
            │
            ▼
[Step 3: Nested Ownership Hardening (AUTHZ-01..04)]
  - Pre-flight ownership verification on topics, sessions, mistakes, routines
  - Eliminate blind upsert in ConceptLab
            │
            ▼
[Step 4: Revision Engine & Diagnostic Service (REV-01, REV-02, REV-03)]
  - Reconcile Rule247RevisionEngine failure rules with Master Spec
  - Build revisionDiagnosticService.ts with deterministic evaluators for all 6 types
  - Wire atomic conditional transition and 409 conflict detection in revision.routes.ts
            │
            ▼
[Step 5: Frontend RevisionModal Alignment]
  - Integrate diagnostic questions and answer submission in RevisionModal.tsx
            │
            ▼
[Step 6: Automated Test Verification]
  - Author and execute group1Hardening.test.ts to verify all scenarios
```

---

## 14. What Will NOT Be Changed in Group 1

- Exams, Projects, Competitive Programming.
- Telegram, Web Push, Notifications.
- Redis / BullMQ infrastructure.
- Zod middleware and pagination on remaining list endpoints (Group 2).
- Database indexes outside Group 1 models (Group 2).
- UI redesign or dark mode.

---

## Final Verification & Approval Request

This final revised implementation plan is submitted for your explicit review and approval.  
**No application code, packages, or database records have been modified.**  
Upon your approval, implementation of Group 1 will proceed strictly in accordance with Section 13.
