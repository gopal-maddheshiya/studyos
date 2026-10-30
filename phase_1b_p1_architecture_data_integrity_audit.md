# Phase 1B — P1 Architecture & Data Integrity Audit Report

**Date:** October 3, 2026  
**Auditor:** Antigravity Architect  
**Scope:** Architecture, Data Integrity, Authorization, Validation, Engine Correctness, and Lifecycle Integrity of StudyOS  
**Status:** Audit Completed — Awaiting User Approval (No application code modified)

---

## 1. Executive Summary

Following the successful completion and verification of the Phase 1A P0 security fixes (removal of the development auth bypass, quiz answer leak remediation, study heartbeat temporal accounting, and AI prompt injection hardening), this Phase 1B Audit evaluated the entire StudyOS codebase against the `MASTER_SPECIFICATION.md` and the Phase 1 Architecture Audit.

While core P0 attack vectors have been closed, the current architecture contains significant **P1 structural vulnerabilities and mathematical integrity flaws** that directly threaten the core product proposition: *"Learning progress must be based on evidence, not manual checkboxes."*

### Key Critical Findings:
1. **Broken Token Lifecycle (P1 Critical)**: Access tokens expire in 15 minutes, but `/auth/refresh` does NOT exist, refresh tokens are never generated or rotated, and `/auth/logout` is missing. Users are abruptly locked out with no renewal path.
2. **Nested Ownership & Foreign Resource Injection (P1 Critical)**: Multiple endpoints accept foreign resource IDs (e.g. `subjectId` in `POST /topics`, `topicId` in `POST /sessions/start`, `topicId` in `POST /mistakes`) without verifying that the parent resource belongs to the authenticated user.
3. **Subjective Mastery Self-Reporting (P1 Critical)**: `POST /revisions/:id/submit` accepts client-provided `performanceScore` (0–100) and `recallRating` (1–5) without requiring any evidence or active testing, allowing users to manually check boxes to reach `MASTERED`.
4. **Broken 2-4-7 Interval Progression on Failure (P1 High)**: When a spaced revision fails, `targetIntervalIndex` is unconditionally incremented (`revision.targetIntervalIndex + 1`) in `revision.routes.ts`, advancing the interval despite the failed attempt.
5. **Dead Ebbinghaus Decay & Artificial Application Scoring (P1 High)**: Retention decay is dead code because `daysSinceLastRevision` is never passed by any route; meanwhile, passing any quiz adds an arbitrary `+15 applicationScore`, awarding full application mastery without practical problem-solving.
6. **India/UTC Midnight Boundary Timezone Bug (P1 High)**: `new Date().toISOString().split('T')[0]` derives the UTC calendar date rather than the user's localized civil day. A student in India (`Asia/Kolkata`, UTC+5:30) studying at 02:00 AM has blocks and sessions scheduled on yesterday's date.
7. **Complete Absence of Schema Validation (Zod) and Unbounded Queries (P1 High)**: Zero routes validate input via Zod; invalid ObjectIds crash Mongoose with 500 errors; and zero list endpoints use `.limit()`, risking catastrophic OOM spikes as collections grow.

---

## 2. Current Architecture Assessment

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Current Layered State                           │
├────────────────────────────────────────────────────────────────────────┤
│ 1. HTTP / Routing Layer:                                               │
│    - Express 4 routers directly executing Mongoose queries.            │
│    - Manual `if (!field)` checks; Zod absent from all route handlers.  │
│    - Stack traces / internal Mongo error codes leak via errorHandler.  │
├────────────────────────────────────────────────────────────────────────┤
│ 2. Service Layer:                                                      │
│    - Only 3 services exist: `aiQuizService`, `evidenceScoring`,        │
│      and `revisionEngine`.                                             │
│    - Missing Domain Services: `AuthService`, `TopicService`,           │
│      `SubjectService`, `SessionService`, `RevisionService`.            │
├────────────────────────────────────────────────────────────────────────┤
│ 3. Data & Storage Layer:                                               │
│    - Mongoose 8 on MongoDB.                                            │
│    - Lack of compound ownership indexes and case-insensitive collation.│
│    - Zero multi-document transactions across evidence updates.         │
│    - Complete absence of query pagination (`.limit()` count: 0).       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed P1 Findings by Domain

### DOMAIN 1: AUTHENTICATION (AUTH)

#### Finding AUTH-01: Absent Refresh Token Lifecycle & Premature Session Lockout
- **Current Behavior**: Access tokens are issued with a 15-minute expiration (`expiresIn: '15m'`). No refresh token is generated during register or login, `refreshTokenHash` is never populated, and the endpoint `POST /auth/refresh` does not exist.
- **Evidence/File**: [`server/src/routes/auth.routes.ts:38-49, 76-88`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts#L38-L49), [`server/src/models/User.ts:44`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/models/User.ts#L44)
- **Risk**: After exactly 15 minutes of user activity, any API request fails with `401 EXPIRED_TOKEN`. Because there is no refresh mechanism, the user is permanently kicked out to an unauthenticated state mid-study session.
- **Severity**: **P1 Critical**
- **Recommended Fix**: Implement dual-token JWT lifecycle. Generate cryptographically random refresh token, store Argon2 hash in `User.refreshTokenHash` with rotation upon use (`POST /auth/refresh`), set in strict `httpOnly`, `sameSite: 'lax'` cookie with 30-day lifetime.
- **Dependencies**: None.

---

#### Finding AUTH-02: Missing Logout & Inability to Invalidate Tokens
- **Current Behavior**: There is no `POST /auth/logout` endpoint in `auth.routes.ts`. There is no mechanism to clear cookies or revoke tokens.
- **Evidence/File**: [`server/src/routes/auth.routes.ts`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts)
- **Risk**: A user cannot terminate their session on shared computers. If an access token or cookie is compromised, it cannot be revoked prior to natural expiration.
- **Severity**: **P1 High**
- **Recommended Fix**: Add `POST /auth/logout` to clear `accessToken` and `refreshToken` cookies, clear `refreshTokenHash` in DB, and optionally maintain a Redis token revocation blocklist for active JWTs.
- **Dependencies**: AUTH-01.

---

#### Finding AUTH-03: Absence of Password Complexity Policy
- **Current Behavior**: `POST /auth/register` accepts any string as a password (e.g. `"1"` or `"a"`). There are no length checks, entropy requirements, or character class validations.
- **Evidence/File**: [`server/src/routes/auth.routes.ts:13-30`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts#L13-L30)
- **Risk**: Users can register with trivial passwords, making accounts vulnerable to offline brute force or dictionary attacks.
- **Severity**: **P1 Medium**
- **Recommended Fix**: Enforce Zod password schema requiring minimum 8 characters, at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.
- **Dependencies**: Input validation layer.

---

#### Finding AUTH-04: User Enumeration in Registration
- **Current Behavior**: If an email is already registered, `POST /auth/register` explicitly returns `409 Conflict` with `{ code: 'EMAIL_EXISTS', message: 'An account with this email already exists.' }`.
- **Evidence/File**: [`server/src/routes/auth.routes.ts:24-28`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/auth.routes.ts#L24-L28)
- **Risk**: Allows automated scanners to enumerate existing user email addresses.
- **Severity**: **P2**
- **Recommended Fix**: Apply strict registration rate limiting and return generic message or standardize registration flow with verification tokens.
- **Dependencies**: Rate limiting.

---

### DOMAIN 2: AUTHORIZATION & USER ISOLATION (AUTHORIZATION)

#### Finding AUTHZ-01: Nested Resource Ownership Bypass in Topic Creation
- **Current Behavior**: `POST /topics` accepts `subjectId` and `parentTopicId` from `req.body`. It creates the topic with `{ userId, subjectId, parentTopicId }` without verifying that `subjectId` or `parentTopicId` belongs to `req.user.id`.
- **Evidence/File**: [`server/src/routes/topic.routes.ts:16-36`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/topic.routes.ts#L16-L36)
- **Risk**: An attacker can inject topics into another user's subject hierarchy by passing a victim's `subjectId`.
- **Severity**: **P1 Critical**
- **Recommended Fix**: Validate parent ownership: `const subject = await Subject.findOne({ _id: subjectId, userId }); if (!subject) return 404;` and verify `parentTopicId` ownership before creation.
- **Dependencies**: Topic and Subject schemas.

---

#### Finding AUTHZ-02: Study Session Start Against Foreign Topics and Timetable Blocks
- **Current Behavior**: `POST /sessions/start` accepts `topicId` and `timetableBlockId` from `req.body`. It directly creates a `StudySession` with these IDs without verifying that the topic or timetable block belongs to `req.user.id`.
- **Evidence/File**: [`server/src/routes/session.routes.ts:37-58`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/session.routes.ts#L37-L58)
- **Risk**: A user can log study sessions against another user's topics or fulfill another user's scheduled study block.
- **Severity**: **P1 High**
- **Recommended Fix**: Verify `const topic = await Topic.findOne({ _id: topicId, userId }); if (!topic) return 404;` and verify `timetableBlockId` ownership if provided.
- **Dependencies**: None.

---

#### Finding AUTHZ-03: Foreign Topic Mistake Recording
- **Current Behavior**: `POST /mistakes` accepts `topicId` from `req.body` and creates a `Mistake` document without verifying that `topicId` is owned by `req.user.id`.
- **Evidence/File**: [`server/src/routes/mistake.routes.ts:42-73`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/mistake.routes.ts#L42-L73)
- **Risk**: An attacker can pollute mistake analytics of arbitrary topics across tenant boundaries.
- **Severity**: **P1 High**
- **Recommended Fix**: Verify `Topic.findOne({ _id: topicId, userId })` before creating the mistake record.
- **Dependencies**: None.

---

#### Finding AUTHZ-04: ConceptLab Upsert Injection with Arbitrary Topic IDs
- **Current Behavior**: `PUT /topics/:id/lab` executes `ConceptLab.findOneAndUpdate({ topicId: req.params.id, userId }, { $set: ... }, { new: true, upsert: true })`.
- **Evidence/File**: [`server/src/routes/topic.routes.ts:121-133`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/topic.routes.ts#L121-L133)
- **Risk**: Because `upsert: true` is enabled, passing an arbitrary or unowned `topicId` creates an orphaned `ConceptLab` record that references a non-existent or foreign topic.
- **Severity**: **P1 High**
- **Recommended Fix**: First query `Topic.findOne({ _id: req.params.id, userId })`. If not found, return 404. Then perform update without blind upsert.
- **Dependencies**: None.

---

### DOMAIN 3: INPUT VALIDATION (VALIDATION)

#### Finding VALID-01: Complete Absence of Schema Validation (Zod) in API Routes
- **Current Behavior**: None of the 10 Express route files use Zod or any declarative schema validator. All validation is ad-hoc (e.g. `if (!name) return res.status(400)`).
- **Evidence/File**: Grep confirmed 0 occurrences of `zod` across all files in `server/src/routes/`.
- **Risk**: Missing types, oversized payloads, unexpected injected properties, type coercion bugs, and unhandled runtime exceptions.
- **Severity**: **P1 High**
- **Recommended Fix**: Introduce a standardized `validateRequest({ body, query, params })` middleware powered by Zod schemas for every route.
- **Dependencies**: None.

---

#### Finding VALID-02: Unvalidated MongoDB ObjectIds Causing Unhandled CastErrors (HTTP 500)
- **Current Behavior**: Endpoints accepting route parameters (e.g. `GET /topics/:id/lab`, `POST /quizzes/:id/submit`, `POST /revisions/:id/submit`, `PUT /timetable/routines/:dayOfWeek`) pass raw strings directly into Mongoose queries.
- **Evidence/File**: [`server/src/routes/topic.routes.ts:64`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/topic.routes.ts#L64), [`server/src/routes/quiz.routes.ts:77`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/quiz.routes.ts#L77)
- **Risk**: If a client sends an invalid ObjectId (e.g. `GET /topics/123/lab`), Mongoose throws a `BSONError: Argument passed in must be a string of 12 bytes or a string of 24 hex characters`. Express catches this in `errorHandler.ts` and returns an internal `500 Server Error`, leaking internal database diagnostics instead of a clean `400 Bad Request`.
- **Severity**: **P1 High**
- **Recommended Fix**: Add a reusable Zod ObjectId validator (`z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId')`).
- **Dependencies**: VALID-01.

---

#### Finding VALID-03: Unbounded String and Array Payloads in ConceptLab and Mistakes
- **Current Behavior**: `PUT /topics/:id/lab` accepts unbounded `intuition`, `personalNotes`, and an arbitrary number of `codeSnippets` with unbounded code lengths.
- **Evidence/File**: [`server/src/routes/topic.routes.ts:119-130`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/topic.routes.ts#L119-L130)
- **Risk**: Users can post multi-megabyte payloads, exceeding MongoDB's 16MB document size limit or causing memory exhaustion.
- **Severity**: **P1 Medium**
- **Recommended Fix**: Limit `intuition` to 50,000 chars, `personalNotes` to 50,000 chars, `codeSnippets` to max 10 items of $\le 10,000$ chars each.
- **Dependencies**: VALID-01.

---

### DOMAIN 4: API PAGINATION & RESOURCE LIMITS (API LIMITS)

#### Finding LIMIT-01: Completely Unbounded Collection Queries in List Endpoints
- **Current Behavior**: Every single list endpoint executes `.find({ userId })` without a `.limit()` clause or pagination parameters:
  - `GET /subjects` loads all subjects and all topics.
  - `GET /revisions/due` loads all pending and overdue revisions.
  - `GET /mistakes` loads all mistakes matching filter.
  - `GET /timetable/routines` loads all routine blocks.
  - `GET /analytics/overview` loads all 5 collections simultaneously into memory.
- **Evidence/File**: [`server/src/routes/subject.routes.ts:15-16`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/subject.routes.ts#L15-L16), [`server/src/routes/mistake.routes.ts:20-22`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/mistake.routes.ts#L20-L22), [`server/src/routes/analytics.routes.ts:18-24`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/analytics.routes.ts#L18-L24)
- **Risk**: As a student's learning history grows over months (hundreds of mistakes, thousands of revisions and study sessions), list endpoints will consume hundreds of megabytes of RAM, spike latency, and trigger Node.js process OOM crashes.
- **Severity**: **P1 High**
- **Recommended Fix**: Implement standardized cursor or limit-offset pagination: `page = 1`, `limit = Math.min(Number(req.query.limit) || 20, 100)`. Return pagination metadata `{ total, page, totalPages, hasMore }`.
- **Dependencies**: None.

---

### DOMAIN 5: DATABASE SCHEMA & INDEX INTEGRITY (DATABASE)

#### Finding DB-01: Subject Name Case-Sensitivity Collision
- **Current Behavior**: `SubjectSchema` enforces `{ userId: 1, name: 1 }, { unique: true }`. However, `name` does not enforce lowercase normalization or case-insensitive collation.
- **Evidence/File**: [`server/src/models/Subject.ts:17, 26`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/models/Subject.ts#L17)
- **Risk**: A user can create duplicate subjects like `"Algorithms"` and `"algorithms"`, causing confusing UI states and splintered topic evidence.
- **Severity**: **P1 Medium**
- **Recommended Fix**: Add collation `{ locale: 'en', strength: 2 }` to the unique index or enforce lowercase slug indexing.
- **Dependencies**: None.

---

#### Finding DB-02: Missing Unique Constraints and Revision History in RevisionSchedule
- **Current Behavior**: `RevisionScheduleSchema` has an index on `{ userId: 1, scheduledDate: 1, status: 1 }`, but NO unique constraint preventing duplicate pending revision entries for the same topic.
- **Evidence/File**: [`server/src/models/RevisionSchedule.ts:35`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/models/RevisionSchedule.ts#L35)
- **Risk**: Repeated calls or parallel requests create duplicate pending schedules for interval 1, causing redundant revision prompts.
- **Severity**: **P1 High**
- **Recommended Fix**: Add partial unique index: `RevisionScheduleSchema.index({ userId: 1, topicId: 1, targetIntervalIndex: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'PENDING' } })`. Add `previousRevisionId` to maintain lineage.
- **Dependencies**: None.

---

#### Finding DB-03: Enum Mismatch Between TimetableRoutine and ScheduledStudyBlock
- **Current Behavior**: In `TimetableRoutine.ts`, `blockType` enum is `['STUDY', 'REVISION', 'PROJECT', 'CONTEST']`. In `ScheduledStudyBlock.ts`, `type` enum is `['LEARNING', 'REVISION', 'EXAM_PREP', 'PROJECT']`.
- **Evidence/File**: [`server/src/models/TimetableRoutine.ts:9, 29`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/models/TimetableRoutine.ts#L9), [`server/src/models/ScheduledStudyBlock.ts:3, 37`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/models/ScheduledStudyBlock.ts#L3)
- **Risk**: In `timetable.routes.ts:160`, when converting routine blocks to scheduled blocks, `'STUDY'` or `'CONTEST'` routine blocks fail Mongoose enum validation when saved to `ScheduledStudyBlock`, throwing schema errors.
- **Severity**: **P1 High**
- **Recommended Fix**: Unify study block type enums across both models according to `MASTER_SPECIFICATION.md`: `['LEARNING', 'REVISION', 'PRACTICE', 'PROJECT', 'CONTEST', 'EXAM_PREP']`.
- **Dependencies**: None.

---

### DOMAIN 6: REVISION ENGINE — 2-4-7 INTEGRITY (REVISION)

#### Finding REV-01: Failed Revision Advances Interval Index
- **Current Behavior**: In `revision.routes.ts:116`, the next revision is created with:
  `targetIntervalIndex: revision.targetIntervalIndex + 1`.
  Even when `score < 60` (failing score), `targetIntervalIndex` is advanced to the next cycle index!
- **Evidence/File**: [`server/src/routes/revision.routes.ts:113-119`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/revision.routes.ts#L113-L119), [`server/src/services/revisionEngine.ts:37-48`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/services/revisionEngine.ts#L37-L48)
- **Risk**: A student who completely fails revision 1 (getting 0%) has their next revision logged as revision 2 (+4 days) or revision 3 (+7 days), bypassing the requirement to master the interval before progressing.
- **Severity**: **P1 Critical**
- **Recommended Fix**: When `isPassing` is false:
  - Keep `targetIntervalIndex = 1` (reset back to Day 1 review).
  - Do NOT increment `revision.targetIntervalIndex`.
  - Schedule next review for tomorrow (+1 day).
- **Dependencies**: `revisionEngine.ts`.

---

#### Finding REV-02: Subjective Self-Reported Mastery Without Evidence Checkbox
- **Current Behavior**: `POST /revisions/:id/submit` takes `performanceScore` and `recallRating` directly from `req.body`. There is no link to a diagnostic recall quiz, flashcard evaluation, or problem solve.
- **Evidence/File**: [`server/src/routes/revision.routes.ts:45, 63`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/revision.routes.ts#L45)
- **Risk**: Directly violates the core specification: *"Learning progress must be based on evidence, not manual checkboxes."* Users can simply click 100% on a modal to bypass learning and forge mastery.
- **Severity**: **P1 Critical**
- **Recommended Fix**: Require an evidence submission: Revision completion must be backed by an active diagnostic recall quiz or verification challenge where the score is server-computed, or clearly demarcate the score as subjective recall rating with restricted weight.
- **Dependencies**: Evidence scoring model.

---

#### Finding REV-03: Repeated Submission of Completed Revision
- **Current Behavior**: `POST /revisions/:id/submit` does NOT verify `if (revision.status === 'COMPLETED')`.
- **Evidence/File**: [`server/src/routes/revision.routes.ts:47-53`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/revision.routes.ts#L47-L53)
- **Risk**: A user can submit the same revision ID 10 times in a loop, incrementing `topic.revisionCycleCount` by 10 and spawning 10 future revision records.
- **Severity**: **P1 High**
- **Recommended Fix**: Reject submissions on already completed revisions: `if (revision.status !== 'PENDING' && revision.status !== 'OVERDUE') return res.status(409).json({ error: { code: 'REVISION_ALREADY_COMPLETED' } });`.
- **Dependencies**: None.

---

### DOMAIN 7: EVIDENCE / MASTERY MODEL (EVIDENCE)

#### Finding EVID-01: Arbitrary +15 Application Score Boost from Quizzes
- **Current Behavior**: In `quiz.routes.ts:136-138`:
  ```ts
  if (scorePercentage >= 70) {
    topic.applicationScore = Math.min(100, topic.applicationScore + 15);
  }
  ```
- **Evidence/File**: [`server/src/routes/quiz.routes.ts:153-155`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/quiz.routes.ts#L153-L155)
- **Risk**: Quiz is a comprehension/recall tool. Giving +15 application points per quiz allows a student to reach 100% Application Score without ever building a project, writing runnable code, or solving a practical contest problem.
- **Severity**: **P1 High**
- **Recommended Fix**: Decouple application score from quizzes. Quizzes should contribute solely to `comprehensionScore` (and retention during revisions). `applicationScore` must be driven strictly by practical coding problems, contest submissions, and project milestones.
- **Dependencies**: Topic evidence model.

---

#### Finding EVID-02: Retention Decay is Dead Code
- **Current Behavior**: In `evidenceScoring.ts:38-42`, Ebbinghaus decay is guarded by `if (daysSinceLastRevision !== undefined && daysSinceLastRevision > 0 && metrics.stabilityDays > 0)`.
  However, zero routes in the entire application pass `daysSinceLastRevision` when calling `calculateTopicMastery`.
- **Evidence/File**: [`server/src/services/evidenceScoring.ts:38`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/services/evidenceScoring.ts#L38), [`server/src/routes/session.routes.ts:192`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/session.routes.ts#L192), [`server/src/routes/quiz.routes.ts:157`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/quiz.routes.ts#L157), [`server/src/routes/revision.routes.ts:94`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/revision.routes.ts#L94), [`server/src/routes/topic.routes.ts:89`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/topic.routes.ts#L89)
- **Risk**: Retention scores NEVER decay over time. A topic reviewed 6 months ago retains 100% retention forever unless manually revised and failed. `decayRisk` is never triggered.
- **Severity**: **P1 High**
- **Recommended Fix**: Compute `daysSinceLastRevision = topic.lastRevisedAt ? (now - topic.lastRevisedAt) / (1000 * 86400) : 0` and pass it to `calculateTopicMastery`.
- **Dependencies**: `evidenceScoring.ts`.

---

#### Finding EVID-03: Primitive Consistency Score Formula Permanently Maxes Out at 2 Hours
- **Current Behavior**: In `session.routes.ts:186`:
  `topic.consistencyScore = Math.min(100, Math.round((topic.totalStudyMinutes / 120) * 100));`
- **Evidence/File**: [`server/src/routes/session.routes.ts:186`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/session.routes.ts#L186)
- **Risk**: Once a user studies a topic for a cumulative total of 120 minutes, `consistencyScore` is permanently 100% for the rest of time. It fails to measure habit consistency, spacing across days, or study frequency.
- **Severity**: **P1 Medium**
- **Recommended Fix**: Calculate consistency score based on active study sessions over rolling 14-day window: $Consistency = \min(100, (\text{sessionsInLast14Days} / 5) \times 100)$.
- **Dependencies**: StudySession queries.

---

### DOMAIN 8: TIMEZONE & DATE INTEGRITY (TIMEZONE)

#### Finding TIME-01: India/UTC Midnight Boundary Desynchronization
- **Current Behavior**: In `timetable.routes.ts:106`:
  `const todayStr = (req.query.date as string) || new Date().toISOString().split('T')[0];`
  `new Date().toISOString()` returns the UTC date.
- **Evidence/File**: [`server/src/routes/timetable.routes.ts:106-108`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/timetable.routes.ts#L106-L108)
- **Risk**: When a user in `Asia/Kolkata` (UTC+5:30) accesses their timetable between 00:00 AM and 05:29 AM, `new Date().toISOString()` is still the previous day in UTC. For example, on Saturday Oct 4 at 02:00 AM IST, `todayStr` evaluates to `"2026-10-03"` (Friday). The user is served Friday's timetable and yesterday's study blocks.
- **Severity**: **P1 High**
- **Recommended Fix**: Use `Intl.DateTimeFormat` or a timezone utility with `req.user.timezone` (e.g. `'Asia/Kolkata'`) to format the local civil date:
  ```ts
  const userTz = req.user?.timezone || 'UTC';
  const localDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: userTz }).format(new Date());
  ```
- **Dependencies**: None.

---

### DOMAIN 9: BUSINESS LOGIC / ROUTE SEPARATION (BUSINESS LOGIC)

#### Finding ARCH-01: Direct Database and Scoring Logic Embedded Inside Route Handlers
- **Current Behavior**: Express route handlers directly instantiate Mongoose models, execute multi-collection queries, and compute mathematical moving averages inline.
- **Evidence/File**: Every route file in `server/src/routes/`.
- **Risk**: Violates Single Responsibility Principle. Prevents reusable unit testing of business logic, makes transaction management nearly impossible, and leads to duplicated code across routes.
- **Severity**: **P1 Medium**
- **Recommended Fix**: Refactor business logic into clean domain services:
  - `TopicService`
  - `StudySessionService`
  - `RevisionScheduleService`
  - `MistakeService`
  - `TimetableService`
  Routes should only handle HTTP validation, authentication extraction, calling the domain service, and returning structured HTTP responses.
- **Dependencies**: None.

---

### DOMAIN 10: ERROR HANDLING (ERROR HANDLING)

#### Finding ERR-01: Mongo Error Code and Diagnostic Leak in Global Error Handler
- **Current Behavior**: In `errorHandler.ts:9-11`:
  ```ts
  const status = err.statusCode || err.status || 500;
  const code = err.code || 'INTERNAL_SERVER_ERROR';
  const message = err.message || 'An unexpected error occurred.';
  ```
- **Evidence/File**: [`server/src/middlewares/errorHandler.ts:9-23`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/middlewares/errorHandler.ts#L9-L23)
- **Risk**: When MongoDB throws duplicate key errors (`code: 11000`) or validation errors, `status` defaults to 500 and `message` outputs raw database collection and index names (e.g. `E11000 duplicate key error collection: studyos.users index: email_1`).
- **Severity**: **P1 High**
- **Recommended Fix**: Handle specific database error instances in `errorHandler.ts`:
  - `err.code === 11000` $\rightarrow$ status `409 Conflict`, code `'RESOURCE_CONFLICT'`, sanitize message.
  - `err.name === 'CastError'` $\rightarrow$ status `400 Bad Request`, code `'INVALID_ID'`, sanitize message.
  - `err.name === 'ValidationError'` $\rightarrow$ status `400 Bad Request`, code `'VALIDATION_ERROR'`, format field errors.
- **Dependencies**: None.

---

### DOMAIN 11: TRANSACTION / CONCURRENCY RISKS (CONCURRENCY)

#### Finding CONC-01: Non-Transactional Multi-Document Updates in Quiz & Revision Submissions
- **Current Behavior**:
  - `POST /quizzes/:id/submit` creates a `QuizSubmission`, updates `Topic` mastery scores, creates multiple `Mistake` documents in a loop, and creates a `RevisionSchedule`.
  - `POST /revisions/:id/submit` updates `RevisionSchedule`, updates `Topic`, and creates the next `RevisionSchedule`.
  Neither operation runs inside a MongoDB session transaction (`startSession` / `withTransaction`).
- **Evidence/File**: [`server/src/routes/quiz.routes.ts:114-168`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/quiz.routes.ts#L114-L168), [`server/src/routes/revision.routes.ts:75-120`](file:///c:/Users/hp/OneDrive/Desktop/studyOS/server/src/routes/revision.routes.ts#L75-L120)
- **Risk**: If the server crashes midway or a document validation fails on step 3, partial database writes persist (e.g. revision marked completed, but next revision fails to create), resulting in permanently orphaned state and broken revision chains.
- **Severity**: **P1 High**
- **Recommended Fix**: Wrap multi-document evidence updates inside `mongoose.startSession()` and `session.withTransaction()`.
- **Dependencies**: MongoDB replica set / transaction support.

---

### DOMAIN 12: TESTING COVERAGE (TESTING)

#### Finding TEST-01: Severe Test Coverage Gaps Across Authorization, Timezones, and Lifecycle
- **Current Behavior**: The only existing test file is `server/src/tests/securityHardening.test.ts` (created in Phase 1A for P0 fixes).
- **Evidence/File**: Only 1 test file exists in `server/src/tests/`.
- **Risk**: There are ZERO automated tests covering:
  1. Cross-user authorization and nested ownership prevention.
  2. Input validation rejection (invalid ObjectIds, malformed bodies).
  3. Spaced revision failed attempt reset behavior.
  4. Timezone civil day calculation (India UTC+5:30 boundary).
  5. Multi-document transaction rollback on error.
- **Severity**: **P1 High**
- **Recommended Fix**: Develop a comprehensive integration test suite covering domain services and route authorization.
- **Dependencies**: None.

---

## 4. Summary Table of P1 Findings & Priorities

| ID | Domain | Finding | Severity | Recommended Fix Priority |
| :--- | :--- | :--- | :--- | :--- |
| **AUTH-01** | Auth | Missing Refresh Token Lifecycle & 15m Lockout | **P1 Critical** | Phase 1C — Group 1 |
| **AUTHZ-01** | Authz | Nested Ownership Bypass on Topic Creation | **P1 Critical** | Phase 1C — Group 1 |
| **REV-01** | Revision | Failed Revision Advances Interval Index | **P1 Critical** | Phase 1C — Group 1 |
| **REV-02** | Revision | Subjective Self-Reported Mastery Without Evidence | **P1 Critical** | Phase 1C — Group 1 |
| **AUTH-02** | Auth | Missing Logout Endpoint & Invalidation | **P1 High** | Phase 1C — Group 2 |
| **AUTHZ-02** | Authz | Foreign Topic Session Start Injection | **P1 High** | Phase 1C — Group 2 |
| **AUTHZ-03** | Authz | Foreign Topic Mistake Recording | **P1 High** | Phase 1C — Group 2 |
| **AUTHZ-04** | Authz | ConceptLab Upsert Injection | **P1 High** | Phase 1C — Group 2 |
| **VALID-01** | Validation | Complete Absence of Schema Validation (Zod) | **P1 High** | Phase 1C — Group 2 |
| **VALID-02** | Validation | Unvalidated ObjectIds Causing 500 Errors | **P1 High** | Phase 1C — Group 2 |
| **LIMIT-01** | Limits | Unbounded Collection Queries in All List Routes | **P1 High** | Phase 1C — Group 2 |
| **DB-02** | Database | Missing Unique Partial Constraint on Revisions | **P1 High** | Phase 1C — Group 2 |
| **DB-03** | Database | Enum Mismatch between Routine and ScheduledBlock | **P1 High** | Phase 1C — Group 2 |
| **REV-03** | Revision | Repeated Submission of Completed Revision | **P1 High** | Phase 1C — Group 2 |
| **EVID-01** | Evidence | Arbitrary +15 Application Score Boost from Quizzes | **P1 High** | Phase 1C — Group 2 |
| **EVID-02** | Evidence | Retention Decay is Dead Code (Never Calculated) | **P1 High** | Phase 1C — Group 2 |
| **TIME-01** | Timezone | India/UTC Midnight Boundary Desynchronization | **P1 High** | Phase 1C — Group 2 |
| **ERR-01** | Error | Mongo Error Code / Collection Leakage in Responses | **P1 High** | Phase 1C — Group 2 |
| **CONC-01** | Concurrency| Non-Transactional Multi-Document Evidence Updates | **P1 High** | Phase 1C — Group 3 |
| **TEST-01** | Testing | Severe Test Coverage Gaps Across Core Domains | **P1 High** | Phase 1C — Group 3 |
| **AUTH-03** | Auth | Weak Password Policy (No Complexity) | **P1 Medium** | Phase 1C — Group 3 |
| **DB-01** | Database | Subject Name Case-Sensitivity Collision | **P1 Medium** | Phase 1C — Group 3 |
| **EVID-03** | Evidence | Consistency Score Freezes at 100% after 2 Hours | **P1 Medium** | Phase 1C — Group 3 |
| **VALID-03** | Validation | Unbounded String Lengths in ConceptLab | **P1 Medium** | Phase 1C — Group 3 |
| **ARCH-01** | Arch | Direct Database Logic in Route Handlers | **P1 Medium** | Phase 1C — Group 3 |
| **AUTH-04** | Auth | Account Enumeration on Registration | **P2** | Phase 1C — Group 4 |

---

## 5. Recommended Implementation Order (Phase 1C Proposal)

To remediate these findings safely without breaking existing client flows:

### Group 1: Integrity Showstoppers (Critical P1s)
1. **AUTH-01 & AUTH-02**: Implement `/auth/refresh` with rotated refresh tokens in `httpOnly` cookies and `POST /auth/logout`.
2. **AUTHZ-01, AUTHZ-02, AUTHZ-03, AUTHZ-04**: Add parent ownership verification to all creation and upsert routes.
3. **REV-01 & REV-03**: Fix 2-4-7 failure interval logic (reset to Day 1 review without advancing index) and reject duplicate submissions.
4. **REV-02**: Guard revision completion with active evidence verification.

### Group 2: Validation, Pagination, and Error Safety (High P1s)
5. **VALID-01 & VALID-02**: Implement Zod validation middleware for all routes (validating params, body, and query).
6. **LIMIT-01**: Add cursor/offset pagination (`limit`, `page`) to all list endpoints.
7. **ERR-01**: Update `errorHandler.ts` to sanitize Mongo `11000`, `CastError`, and `ValidationError`.
8. **TIME-01**: Replace `new Date().toISOString().split('T')[0]` with `Intl.DateTimeFormat` using user's localized timezone (`req.user.timezone`).
9. **EVID-01 & EVID-02**: Pass elapsed time into `calculateTopicMastery` to activate Ebbinghaus decay, and decouple quiz scores from `applicationScore`.
10. **DB-02 & DB-03**: Align timetable enums and add partial unique indexes on pending revision schedules.

### Group 3: Architecture & Concurrency Hardening (Medium P1s)
11. **ARCH-01**: Extract business logic from routes into domain services.
12. **CONC-01**: Wrap multi-document updates in Mongoose transactions.
13. **TEST-01**: Write comprehensive automated tests for all P1 fixes.

---

## 6. What Should NOT Be Changed Yet

In strict adherence to the project scope and specification rules:
- **DO NOT build new product features**: Exams, Projects, Contest Tracking, Notifications, Telegram, Web Push, SEO.
- **DO NOT redesign UI**: Warm Modern editorial aesthetic remains untouched.
- **DO NOT install heavy infrastructure**: No Redis/BullMQ worker queues or Cloudflare CDN until core data integrity and domain models are stabilized.
- **DO NOT migrate AI providers**: AI logic stays strictly on current server-side boundaries.

---

**End of Audit Report.**  
*Status: Ready for user review and approval. No code changes have been executed.*
