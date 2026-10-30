# Phase 1C — Fix 6: Strict Server-Side Diagnostic Submission Validation Report

**Remediation Target:** `CRIT-VAL-02` (Insufficient structural validation of diagnostic submission answers payload)  
**Status:** COMPLETE & VERIFIED  
**Date:** 2026-10-04  
**Workspace:** `c:/Users/hp/OneDrive/Desktop/studyOS`  

---

## 1. Previous Validation Weakness

Prior to Fix 6, the revision diagnostic submission route (`POST /api/v1/revisions/:id/submit`) performed inadequate structural validation of the incoming submission payload:

1. **Primitive Array Check Only:** The endpoint only verified `!Array.isArray(answers)`, allowing empty arrays, arrays with fewer or more answers than expected, and non-object array items.
2. **Missing Question ID Validation:** Arbitrary or foreign `questionId` values could be submitted. If an answer referenced a question not in the challenge, it was either ignored or evaluated undefined.
3. **No Duplicate Question Prevention:** Clients could send duplicate answers for the same `questionId` (e.g., answering question 1 twice and omitting question 2). The server silently selected the first matching element without rejecting the malformed payload.
4. **No Type/Question Compatibility Enforcement:** A client could submit answers whose fields did not match the question type (e.g., submitting `selectedComplexity` for an `MCQ` question), allowing clients to dictate scoring types.
5. **Vulnerability to Forged Server Fields:** Critical server-authoritative fields (`isCorrect`, `correctCount`, `isPassing`, `score`, `performanceScore`, `stability`, `explanation`, `correctOptionId`, etc.) were not explicitly rejected if supplied by the client on the root body or inside answer items.
6. **No Membership Verification:** For choice-based and structured questions (`MCQ`, `DEBUGGING`, `STRUCTURED_CONCEPTUAL`), the server did not verify that submitted option, fix, or assertion IDs actually belonged to the stored challenge, only checking raw strings.

---

## 2. New Validation Contract

Fix 6 establishes a deterministic, multi-stage validation pipeline:

```
Client HTTP Request: POST /api/v1/revisions/:id/submit
      ↓
[Stage 1: Pre-Transaction Structural Validation: validateDiagnosticPayload(req.body)]
  • Verify req.body is non-null JSON object
  • Reject forbidden server-authoritative fields (isCorrect, correctCount, isPassing, score, etc.)
  • Reject unexpected root fields (only "answers", "recallConfidence", "recallRating" permitted)
  • Validate recall confidence/rating range (1–5) if provided
  • Verify answers is a non-empty array
  • Verify each answer item is a non-null object without forbidden fields
  • Detect & reject duplicate question IDs before opening any database transaction
      ↓ (Throws DiagnosticValidationError → immediate 400 VALIDATION_ERROR without starting session)
[Stage 2: Database Session & Transaction Boundary]
  • Session started & conditional CAS transition on RevisionSchedule (PENDING/OVERDUE → COMPLETED)
  • Load authoritative revision.challengeQuestions (assembled & saved atomically if not present)
      ↓
[Stage 3: Authoritative Challenge Validation: validateDiagnosticSubmission(...)]
  • Verify answers.length === challengeQuestions.length (exactly 3 questions)
  • Verify every submitted questionId strictly matches an authoritative challenge question
  • Verify answer shape matches authoritative question type (MCQ, TRUE_FALSE, etc.)
  • Enforce strict allowed keys per type (reject unexpected / forged fields in answer objects)
  • Verify membership of optionId, fixId, assertionIds against the stored challenge subdocuments
  • Verify canonical complexity against CANONICAL_COMPLEXITIES
  • Detect & reject duplicate assertion IDs in STRUCTURED_CONCEPTUAL
      ↓ (Throws DiagnosticValidationError → session.withTransaction cleanly aborts & rolls back)
[Stage 4: Server-Authoritative Deterministic Evaluation]
  • evaluateDiagnosticSubmission(challengeQuestions, validatedSubmissions, topicId)
  • Integer threshold scoring: isPassing = correctCount >= 2
  • Atomically commit revision completion, mistakes, topic mastery, and next schedule
```

---

## 3. Question-ID Validation

Every submitted answer must map 1:1 to one of the server-stored challenge questions:
- An authoritative lookup `Map<string, IRevisionChallengeQuestion>` is constructed from `revision.challengeQuestions`.
- Any submitted `questionId` not present in this map triggers an immediate `DiagnosticValidationError`:
  `Submitted question ID "${qId}" does not belong to the current diagnostic challenge.`
- Arbitrary IDs, random UUIDs, or question IDs from other revisions are rejected deterministically.

---

## 4. Duplicate Detection

Duplicate question IDs are strictly prohibited:
- Both `validateDiagnosticPayload` (Stage 1) and `validateDiagnosticSubmission` (Stage 3) track seen question IDs via a `Set<string>`.
- If an ID appears more than once, it is immediately rejected with:
  `Duplicate question ID detected: "${qId}". Each question must be answered exactly once.`
- The server **never silently deduplicates** submissions.

---

## 5. Type-Specific Validation

Each diagnostic question type enforces an exact allowed field set and rejects unexpected fields:

| Question Type | Required Answer Field | Type & Constraints | Allowed Properties |
| :--- | :--- | :--- | :--- |
| **MCQ** | `selectedOptionId` | Non-empty string; must match `q.options[].optionId` | `questionId`, `type`, `selectedOptionId`, `timeSpentSeconds` |
| **TRUE_FALSE** | `userBoolean` | Strict boolean (`typeof === 'boolean'`) | `questionId`, `type`, `userBoolean`, `timeSpentSeconds` |
| **OUTPUT_PREDICTION** | `userOutput` | String (`typeof === 'string'`) | `questionId`, `type`, `userOutput`, `timeSpentSeconds` |
| **COMPLEXITY** | `selectedComplexity` | String in `CANONICAL_COMPLEXITIES` | `questionId`, `type`, `selectedComplexity`, `timeSpentSeconds` |
| **DEBUGGING** | `selectedFixId` | Non-empty string; must match `q.debuggingOptions[].fixId` | `questionId`, `type`, `selectedFixId`, `timeSpentSeconds` |
| **STRUCTURED_CONCEPTUAL** | `selectedAssertionIds` | Array of strings; each matches `q.assertions[].assertionId`; no duplicates | `questionId`, `type`, `selectedAssertionIds`, `timeSpentSeconds` |

If a submitted answer contains any property outside its allowed set (e.g., sending `selectedFixId` for a `COMPLEXITY` question, or `selectedComplexity` for an `MCQ` question), the submission is rejected with:
`Unexpected field "${key}" in submitted answer for ${q.type} question "${q.questionId}".`

---

## 6. Forged-Field Protection

To ensure the client can never tamper with evaluation results, scoring, or intervals, the server maintains a strict list of prohibited server-authoritative fields:

```ts
export const FORBIDDEN_SERVER_FIELDS = Object.freeze([
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
  'evaluations',
  'mistakesToCreate',
  'totalQuestions',
  'scorePercentage',
]);
```

- **Root Body Enforcement:** If `req.body` contains any of these fields (checked case-insensitively, e.g., `isCorrect`, `is_correct`, `score`), the request is immediately rejected with HTTP 400 `VALIDATION_ERROR`.
- **Answer Item Enforcement:** If any answer item contains any of these fields, the request is rejected with HTTP 400 `VALIDATION_ERROR`.

---

## 7. Option / Assertion / Fix Membership Validation

The server verifies value membership directly against the stored challenge subdocuments:
1. **MCQ:** `selectedOptionId` must match one of `q.options.map(o => o.optionId)`.
2. **DEBUGGING:** `selectedFixId` must match one of `q.debuggingOptions.map(d => d.fixId)`.
3. **COMPLEXITY:** `selectedComplexity` must be included in `CANONICAL_COMPLEXITIES`:
   `['O(1)', 'O(log N)', 'O(N)', 'O(N log N)', 'O(N^2)', 'O(2^N)', 'O(N!)']`.
4. **STRUCTURED_CONCEPTUAL:**
   - `selectedAssertionIds` must be a JavaScript `Array`.
   - Every element in `selectedAssertionIds` must be a non-empty string.
   - Every element must match an assertion in `q.assertions.map(a => a.assertionId)`.
   - Duplicate assertion IDs within the submission array are rejected.

---

## 8. Tests Added

A comprehensive test suite was added to `server/src/tests/group1Hardening.test.ts` under Section 8:

| Test ID | Test Name | Invariant Verified |
| :--- | :--- | :--- |
| **Test A** | Valid 3-question submission succeeds | Valid payload with 3 matching answers passes validation and evaluates 100% |
| **Test B** | Empty answers array → 400 validation error | `answers: []` rejected with `DiagnosticValidationError` and `code: 'VALIDATION_ERROR'` |
| **Test C** | Only 2 answers → rejected | Submitting 2 answers for 3 questions rejected (`must contain exactly 3 answers, received 2`) |
| **Test D** | 4 answers → rejected | Submitting 4 answers for 3 questions rejected (`must contain exactly 3 answers, received 4`) |
| **Test E** | Unknown question ID → rejected | Submitting answer with non-challenge ID rejected (`does not belong to the current diagnostic challenge`) |
| **Test F** | Duplicate question ID → rejected | Submitting identical question ID twice rejected (`Duplicate question ID detected`) |
| **Test G** | Missing answer field → rejected | Submitting missing required answer fields (`selectedFixId`, `selectedComplexity`, etc.) rejected |
| **Test H** | Wrong answer shape for question type → rejected | Submitting `selectedFixId` for `COMPLEXITY` question rejected as unexpected field |
| **Test I** | Forged `isCorrect` → rejected | Submitting `isCorrect: true` at root or in answer object rejected as prohibited field |
| **Test J** | Forged `correctCount` → rejected | Submitting `correctCount: 3` at root or in answer object rejected as prohibited field |
| **Test K** | Forged `isPassing` → rejected | Submitting `isPassing: true` at root or in answer object rejected as prohibited field |
| **Test L** | Forged score/stability/performance fields → rejected | Submitting `score`, `performanceScore`, or `stability` rejected as prohibited field |
| **Test M** | Invalid option/fix/assertion ID → rejected | Submitting unmodeled fix ID or non-canonical complexity rejected |
| **Test N** | Valid `STRUCTURED_CONCEPTUAL` answer succeeds | Submitting valid assertion IDs matching challenge succeeds |
| **Test O** | Malformed `selectedAssertionIds` structure → rejected | Submitting string, non-string, duplicate, or foreign assertion IDs rejected |
| **Test P** | Public diagnostic payload strips authoritative keys | `sanitizeDiagnosticChallenge` strips all secret keys and explanations |

---

## 9. Test Results

### `npm run test:group1`
```
====================================================
 TEST SUMMARY: 90/90 PASSED (0 FAILED)
====================================================
```
All 90 automated tests in `group1Hardening.test.ts` passed (including all 16 Fix 6 tests A–P).

### `npm run test:security`
```
====================================================
 TEST SUMMARY: 19/19 PASSED (0 FAILED)
====================================================
```
All 19 security tests passed with zero regressions.

---

## 10. Build Results

### Server (`tsc`)
```bash
npm run build (in server)
> tsc
Exit code: 0 (No TypeScript errors)
```

### Client (`tsc -b && vite build`)
```bash
npm run build (in client)
> tsc -b && vite build
✓ 1908 modules transformed.
dist/index.html                   1.17 kB │ gzip:   0.64 kB
dist/assets/index-DBfWcbAL.css    3.63 kB │ gzip:   1.26 kB
dist/assets/index-BTkhaDUe.js   344.98 kB │ gzip: 102.07 kB
✓ built in 400ms
Exit code: 0
```

---

## 11. Exact Files Changed

1. **`server/src/services/revisionDiagnosticService.ts`**:
   - Added `DiagnosticValidationError` class with `code = 'VALIDATION_ERROR'`.
   - Defined `FORBIDDEN_SERVER_FIELDS` constant.
   - Defined `ALLOWED_KEYS_BY_TYPE` map for all 6 question types.
   - Implemented `validateDiagnosticPayload(body: any)` for pre-transaction validation.
   - Implemented `validateDiagnosticSubmission(challengeQuestions, answers, rawBody)` for authoritative question-level validation.
   - Implemented `validateAnswerShapeForQuestion(q, ans)` enforcing exact keys and option/assertion/fix membership.

2. **`server/src/routes/revision.routes.ts`**:
   - Imported `validateDiagnosticPayload`, `validateDiagnosticSubmission`, and `DiagnosticValidationError`.
   - Added pre-transaction validation running before `mongoose.startSession()`.
   - Added authoritative validation inside `session.withTransaction()` before `evaluateDiagnosticSubmission()`.
   - Added catch handler for `DiagnosticValidationError` returning HTTP 400 with `code: 'VALIDATION_ERROR'`.

3. **`server/src/tests/group1Hardening.test.ts`**:
   - Imported validation functions and error class.
   - Added Section 8 containing Tests A through P.

---

## 12. Scope Confirmation

All modifications adhere strictly to Phase 1C Fix 6 constraints:
- ONLY diagnostic submission payload validation was implemented.
- Refresh-token and auth session rotation logic were **not modified**.
- Multi-document revision transaction boundaries were **preserved**.
- Timezone and local civil-midnight calculations were **not modified**.
- Global error handler sanitization logic was **not modified**.
- Mongoose diagnostic runtime schemas were **not modified**.
- Deterministic scoring algorithm (`correctCount >= 2`) was **not modified**.
- UI components, notifications, exams, competitive programming, Redis/BullMQ, and SEO were **not modified**.
- Secrets remain server-side and are never exposed to clients.
