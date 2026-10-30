# Phase 1C — Fix 5: Explicit Mongoose Runtime Schemas for Diagnostic Subdocuments Report

**Status:** Complete & Fully Verified  
**Date:** October 3, 2026  
**Target:** `server/src/models/RevisionSchedule.ts` & `server/src/tests/group1Hardening.test.ts`  

---

## 1. Previous Mixed-Schema Weakness

In the initial implementation, `server/src/models/RevisionSchedule.ts` used:

```typescript
// DEFECTIVE PREVIOUS IMPLEMENTATION:
challengeQuestions: [Schema.Types.Mixed] as any,
evaluations: [Schema.Types.Mixed] as any,
```

### Consequences of Using `Schema.Types.Mixed`:
1. **Disabled Runtime Schema Validation:** `Schema.Types.Mixed` completely turns off Mongoose schema enforcement for subdocuments. While TypeScript provided compile-time checks, any malformed question or evaluation payload arriving at runtime was silently persisted.
2. **Missing Invariant Checks:** Required question attributes (such as `correctOptionId` in MCQs or `correctBoolean` in True/False) were not validated before writing to MongoDB.
3. **No Unknown Field Guard:** Malformed or malicious injected properties were stored in the database without warning or rejection.
4. **Data Corruption Risk:** Mongoose would allow saving empty objects `{}` or invalid types as `challengeQuestions` and `evaluations`.

---

## 2. Existing TypeScript Diagnostic Contract

The Mongoose schemas were engineered to directly model the authoritative discriminated union defined in `server/src/types/diagnostic.ts` without inventing a second incompatible contract:

```typescript
export type DiagnosticQuestionType =
  | 'MCQ'
  | 'TRUE_FALSE'
  | 'OUTPUT_PREDICTION'
  | 'COMPLEXITY'
  | 'DEBUGGING'
  | 'STRUCTURED_CONCEPTUAL';

export interface IRevisionChallengeQuestion {
  questionId: string;
  type: DiagnosticQuestionType;
  prompt: string;
  codeSnippet?: string;
  options?: Array<{ optionId: string; text: string }>;
  correctOptionId?: string;
  correctBoolean?: boolean;
  expectedOutput?: string;
  normalization?: 'EXACT' | 'WHITESPACE_TRIMMED' | 'CASE_INSENSITIVE_TRIMMED';
  expectedComplexity?: CanonicalComplexity;
  targetMetric?: 'TIME_WORST' | 'TIME_AVERAGE' | 'SPACE_AUXILIARY';
  debuggingOptions?: Array<{ fixId: string; description: string }>;
  correctFixId?: string;
  assertions?: Array<{ assertionId: string; text: string }>;
  correctAssertionIds?: string[];
  explanation: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

export type StoredDiagnosticEvaluation =
  | { questionId: string; type: 'MCQ'; submittedOptionId: string; correctOptionId: string; isCorrect: boolean; timeSpentSeconds: number }
  | { questionId: string; type: 'TRUE_FALSE'; submittedBoolean: boolean; correctBoolean: boolean; isCorrect: boolean; timeSpentSeconds: number }
  | { questionId: string; type: 'OUTPUT_PREDICTION'; submittedOutput: string; normalizedSubmittedOutput: string; expectedOutput: string; isCorrect: boolean; timeSpentSeconds: number }
  | { questionId: string; type: 'COMPLEXITY'; submittedComplexity: CanonicalComplexity; expectedComplexity: CanonicalComplexity; isCorrect: boolean; timeSpentSeconds: number }
  | { questionId: string; type: 'DEBUGGING'; submittedFixId: string; correctFixId: string; isCorrect: boolean; timeSpentSeconds: number }
  | { questionId: string; type: 'STRUCTURED_CONCEPTUAL'; submittedAssertionIds: string[]; correctAssertionIds: string[]; isCorrect: boolean; timeSpentSeconds: number };
```

---

## 3. New Mongoose Schema Design

To accurately model the discriminated unions at runtime, we implemented **Mongoose DocumentArray Discriminators** with `discriminatorKey: 'type'` and strict schema validation:

```typescript
// 1. Base Question Schema
export const BaseQuestionSchema = new Schema(
  {
    questionId: { type: String, required: true },
    type: { type: String, required: true, enum: DIAGNOSTIC_QUESTION_TYPES },
    prompt: { type: String, required: true },
    codeSnippet: { type: String },
    explanation: { type: String, required: true },
    difficulty: { type: String, enum: ['EASY', 'MEDIUM', 'HARD'], default: 'MEDIUM', required: true },
  },
  { discriminatorKey: 'type', _id: false, strict: 'throw' }
);

// 2. Base Evaluation Schema
export const BaseEvaluationSchema = new Schema(
  {
    questionId: { type: String, required: true },
    type: { type: String, required: true, enum: DIAGNOSTIC_QUESTION_TYPES },
    isCorrect: { type: Boolean, required: true },
    timeSpentSeconds: { type: Number, required: true, default: 0 },
  },
  { discriminatorKey: 'type', _id: false, strict: 'throw' }
);
```

Discriminator sub-schemas are registered on the `DocumentArray` paths in `RevisionScheduleSchema`:

```typescript
// Attach Question Discriminators
const questionsArray = RevisionScheduleSchema.path('challengeQuestions') as mongoose.Schema.Types.DocumentArray;
questionsArray.discriminator('MCQ', MCQQuestionSchema);
questionsArray.discriminator('TRUE_FALSE', TrueFalseQuestionSchema);
questionsArray.discriminator('OUTPUT_PREDICTION', OutputPredictionQuestionSchema);
questionsArray.discriminator('COMPLEXITY', ComplexityQuestionSchema);
questionsArray.discriminator('DEBUGGING', DebuggingQuestionSchema);
questionsArray.discriminator('STRUCTURED_CONCEPTUAL', StructuredConceptualQuestionSchema);

// Attach Evaluation Discriminators
const evaluationsArray = RevisionScheduleSchema.path('evaluations') as mongoose.Schema.Types.DocumentArray;
evaluationsArray.discriminator('MCQ', MCQEvaluationSchema);
evaluationsArray.discriminator('TRUE_FALSE', TrueFalseEvaluationSchema);
evaluationsArray.discriminator('OUTPUT_PREDICTION', OutputPredictionEvaluationSchema);
evaluationsArray.discriminator('COMPLEXITY', ComplexityEvaluationSchema);
evaluationsArray.discriminator('DEBUGGING', DebuggingEvaluationSchema);
evaluationsArray.discriminator('STRUCTURED_CONCEPTUAL', StructuredConceptualEvaluationSchema);
```

---

## 4. Runtime Validation Behavior

1. **Discriminator Routing:** Mongoose inspects the `type` property of each element in the `challengeQuestions` and `evaluations` arrays.
2. **Specific Schema Activation:** If `type === 'MCQ'`, Mongoose validates using `MCQQuestionSchema`, enforcing `options` and `correctOptionId`.
3. **Invalid Discriminator Rejection:** If `type` is unknown or missing, `BaseQuestionSchema`'s enum validator rejects the document with `ValidationError`.
4. **Missing Type-Specific Field Rejection:** If an MCQ omits `correctOptionId`, Mongoose immediately rejects with `ValidationError: Path 'correctOptionId' is required`.

---

## 5. Six Diagnostic Types Covered

| Diagnostic Type | Specific Question Fields Enforced | Specific Evaluation Fields Enforced |
|---|---|---|
| **MCQ** | `options` (array of `{ optionId, text }`, min 2), `correctOptionId` (string) | `submittedOptionId` (string), `correctOptionId` (string) |
| **TRUE_FALSE** | `correctBoolean` (boolean) | `submittedBoolean` (boolean), `correctBoolean` (boolean) |
| **OUTPUT_PREDICTION** | `expectedOutput` (string), `normalization` (`'EXACT' \| 'WHITESPACE_TRIMMED' \| 'CASE_INSENSITIVE_TRIMMED'`) | `submittedOutput` (string), `normalizedSubmittedOutput` (string), `expectedOutput` (string) |
| **COMPLEXITY** | `expectedComplexity` (one of `CANONICAL_COMPLEXITIES`), `targetMetric` (`'TIME_WORST' \| 'TIME_AVERAGE' \| 'SPACE_AUXILIARY'`) | `submittedComplexity` (string/enum), `expectedComplexity` (canonical complexity) |
| **DEBUGGING** | `debuggingOptions` (array of `{ fixId, description }`, min 1), `correctFixId` (string) | `submittedFixId` (string), `correctFixId` (string) |
| **STRUCTURED_CONCEPTUAL** | `assertions` (array of `{ assertionId, text }`, min 1), `correctAssertionIds` (array of strings, min 1) | `submittedAssertionIds` (array of strings), `correctAssertionIds` (array of strings) |

---

## 6. Evaluation Validation

The `evaluations` array on `RevisionSchedule` validates each scored question submission:
- Common fields: `questionId`, `type`, `isCorrect` (boolean), `timeSpentSeconds` (number >= 0).
- Submissions match the format produced by `evaluateDiagnosticSubmission` in `server/src/services/revisionDiagnosticService.ts`.
- Non-canonical complexities or malformed evaluation payloads are rejected by Mongoose schema validation.

---

## 7. Strictness Behavior

- All subdocument schemas are configured with `{ strict: 'throw', _id: false }`.
- If an unmodeled field (e.g. `injectedMaliciousField: 'exploit'`) is included in a question or evaluation, Mongoose throws a `StrictModeError` wrapped in a `ValidationError`.
- This prevents arbitrary or unvetted data from being persisted in diagnostic questions or evaluation history.

---

## 8. Compatibility and Migration Considerations

1. **Non-Breaking for Stored Data:**
   - The new schemas accept every valid object currently produced by:
     - `assembleDiagnosticChallenge()`
     - `evaluateDiagnosticSubmission()`
     - seed generators
     - all revision route execution paths.
2. **Backward Compatibility:**
   - Existing schedules created prior to completing a revision have `challengeQuestions: []` and `evaluations: undefined`. The schema explicitly defaults `challengeQuestions` to `[]` and `evaluations` to `undefined`, allowing existing records to load and save without conflict.
3. **Legacy Mixed Records:**
   - If any legacy record contains fields not matching the 6 diagnostic types, it would be rejected on subsequent save. Existing databases can be validated without modification as all prior test/seed questions conformed to the TypeScript `IRevisionChallengeQuestion` shape.
4. **No Destructive Database Changes:**
   - No collections were dropped or altered, and no documents were mutated.

---

## 9. Tests Added

Added **Section 7: EXPLICIT MONGOOSE RUNTIME SCHEMA (FIX 5) TESTS** to `server/src/tests/group1Hardening.test.ts`:

1. **Test A — Valid MCQ:** Validates that a valid MCQ passes Mongoose runtime validation.
2. **Test B — Valid TRUE_FALSE:** Validates that a valid TRUE_FALSE question passes Mongoose runtime validation.
3. **Test C — Valid OUTPUT_PREDICTION:** Validates output prediction schema validation with normalization.
4. **Test D — Valid COMPLEXITY:** Validates canonical complexity enum validation (`O(1)` through `O(N!)`).
5. **Test E — Valid DEBUGGING:** Validates debugging question schema with `debuggingOptions` and `correctFixId`.
6. **Test F — Valid STRUCTURED_CONCEPTUAL:** Validates assertions and `correctAssertionIds`.
7. **Test G — Malformed Questions:** Confirms that questions missing required type-specific fields (e.g. MCQ missing `correctOptionId`, TRUE_FALSE missing `correctBoolean`, etc.) are rejected with `ValidationError`.
8. **Test H — Invalid Discriminator Type:** Confirms that an unknown question `type: 'NON_EXISTENT_TYPE'` is rejected by enum validation.
9. **Test I — Evaluation Schema:** Confirms valid evaluations pass and malformed evaluation shapes (e.g. non-canonical complexity) fail.
10. **Test J — Strict Mode:** Confirms arbitrary unmodeled fields trigger a `StrictModeError` rejection.
11. **Test K — Security Invariant (Answer Key Shielding):** Verifies that `sanitizeDiagnosticChallenge()` continues to strip all secret answer keys (`correctOptionId`, `correctBoolean`, `expectedOutput`, `expectedComplexity`, `correctFixId`, `correctAssertionIds`, `explanation`) before sending challenges to clients.

---

## 10. Test Results

### `npm run test:group1`
```
====================================================
 RUNNING STUDYOS PHASE 1C GROUP 1 HARDENING TEST SUITE
====================================================
--- 1. AUTH-01 REFRESH TOKEN LIFECYCLE & SECURITY --- 10/10 PASS
--- 1B. ATOMIC REFRESH ROTATION & CONCURRENCY RACE TESTS --- 8/8 PASS
--- 2. ORIGIN / CSRF VALIDATION (AUTH-02) TESTS --- 4/4 PASS
--- 3. NESTED RESOURCE AUTHORIZATION (AUTHZ-01..04) TESTS --- 6/6 PASS
--- 4. REVISION STATE MACHINE & CONCURRENCY (REV-01 & REV-03) TESTS --- 7/7 PASS
--- 4B. ATOMIC MULTI-DOCUMENT REVISION COMPLETION TESTS --- 4/4 PASS
--- 4C. REVISION CIVIL-MIDNIGHT TIMEZONE (FIX 3) TESTS --- 8/8 PASS
--- 5. EVIDENCE-BASED ARD (REV-02) ENGINE TESTS --- 11/11 PASS
--- 6. ERROR SANITIZATION (FIX 4) TESTS --- 5/5 PASS
--- 7. EXPLICIT MONGOOSE RUNTIME SCHEMA (FIX 5) TESTS ---
  [PASS] Test A — Valid MCQ: Persists and passes Mongoose runtime schema validation
  [PASS] Test B — Valid TRUE_FALSE: Persists and passes Mongoose runtime schema validation
  [PASS] Test C — Valid OUTPUT_PREDICTION: Persists and passes Mongoose runtime schema validation
  [PASS] Test D — Valid COMPLEXITY: Persists and passes Mongoose runtime schema validation
  [PASS] Test E — Valid DEBUGGING: Persists and passes Mongoose runtime schema validation
  [PASS] Test F — Valid STRUCTURED_CONCEPTUAL: Persists and passes Mongoose runtime schema validation
  [PASS] Test G — Malformed Questions: Rejects missing required type-specific fields at runtime
  [PASS] Test H — Invalid Discriminator Type: Rejects unknown diagnostic question type
  [PASS] Test I — Evaluation Schema: Valid evaluations pass and malformed shapes are rejected
  [PASS] Test J — Strict Mode: Rejects arbitrary unmodeled fields on diagnostic subdocuments
  [PASS] Test K — Security Invariant: Public challenge projection strips all authoritative answer keys
====================================================
 TEST SUMMARY: 74/74 PASSED (0 FAILED)
====================================================
```

### `npm run test:security`
```
====================================================
 RUNNING STUDYOS PHASE 1A P0 SECURITY TEST SUITE
====================================================
--- 1. DEV AUTH BACKDOOR (P0-1) TESTS --- 4/4 PASS
--- 2. QUIZ ANSWER LEAK (P0-2) TESTS --- 3/3 PASS
--- 3. STUDY HEARTBEAT FORGERY (P0-3) TESTS --- 7/7 PASS
--- 4. AI QUIZ PROMPT INJECTION (P0-4) TESTS --- 5/5 PASS
====================================================
 TEST SUMMARY: 19/19 PASSED (0 FAILED)
====================================================
```

---

## 11. Build Results

- **Server (`server`):** `npm run build` (`tsc`) executed cleanly with exit code 0.
- **Client (`client`):** `npm run build` (`tsc -b && vite build`) executed cleanly with exit code 0.

---

## 12. Remaining Mixed Usages

A full codebase search for `Schema.Types.Mixed` confirms **zero** remaining `Mixed` types across all Mongoose models in `server/src/models/`.

---

## 13. Exact Files Changed

1. **`server/src/models/RevisionSchedule.ts`:**
   - Replaced `challengeQuestions: [Schema.Types.Mixed]` and `evaluations: [Schema.Types.Mixed]` with `BaseQuestionSchema`, `BaseEvaluationSchema`, and 12 discriminator subdocument schemas with strict validation.
2. **`server/src/tests/group1Hardening.test.ts`:**
   - Added Section 7 containing Tests A through K verifying runtime validation, discriminator routing, field-level requirements, strictness, and answer-key protection.

---

## 14. Scope Confirmation

- **Only Fix 5 was implemented.**
- No modifications to:
  - diagnostic scoring algorithms or formulas
  - public diagnostic payload formats
  - transaction execution logic
  - refresh token / auth architecture
  - timezone calculations
  - error handling logic
  - frontend UI
  - notifications, exams, projects, or competitive programming
  - Redis / BullMQ
  - SEO
  - AI providers.
