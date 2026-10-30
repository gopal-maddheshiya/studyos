# Phase 1C — Fix 3: Local Civil-Midnight Calculation Report

**Status:** Complete & Fully Verified  
**Date:** October 3, 2026  
**Target:** `server/src/services/revisionEngine.ts` & `server/src/tests/group1Hardening.test.ts`  

---

## 1. Previous Timezone Bug

The Phase 1C post-implementation audit identified a P1 timezone correctness defect in `server/src/services/revisionEngine.ts`:

```typescript
// PREVIOUS DEFECTIVE IMPLEMENTATION:
export function calculateCivilMidnight(baseDate: Date, addDays: number, timezone: string = 'Asia/Kolkata'): Date {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(baseDate);
    const y = Number(parts.find((p) => p.type === 'year')?.value);
    const m = Number(parts.find((p) => p.type === 'month')?.value) - 1;
    const d = Number(parts.find((p) => p.type === 'day')?.value) + addDays;

    // DEFECT: Date.UTC constructs 00:00:00 UTC, NOT 00:00:00 in the target timezone!
    const targetLocal = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
    return targetLocal;
  } catch {
    // DEFECT: Silent fallback to UTC masked invalid timezone inputs
    const d = new Date(baseDate.getTime() + addDays * 24 * 60 * 60 * 1000);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}
```

### Consequences of Previous Defect:
1. **Positive-Offset Zones (`Asia/Kolkata` +05:30):**
   - Local civil midnight (`00:00:00 IST`) requires UTC instant `18:30:00` on the previous UTC calendar date.
   - The previous code returned `00:00:00 UTC`, which corresponds to `05:30:00 IST`. Revisions were scheduled 5.5 hours late into the working morning rather than at the onset of the local civil day.
2. **Negative-Offset Zones (`America/New_York` UTC-4 / UTC-5):**
   - `00:00:00 UTC` corresponds to `20:00:00 EDT` or `19:00:00 EST` on the *previous* calendar day.
   - This caused scheduled study dates to cross into the previous local civil day, breaking due-date guarantees and UI daily planning filters.
3. **Silent Error Swallowing:**
   - Invalid timezones caught by `catch {}` silently defaulted to UTC rather than failing deterministically, concealing configuration mistakes.

---

## 2. New Calculation Approach

The corrected implementation introduces `getCivilDateParts` and an iterative offset-convergence algorithm that solves for the exact local `00:00:00` instant in any valid IANA timezone:

```typescript
export interface ICivilDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Extracts civil calendar date and time parts for an instant in a given IANA timezone.
 * Throws RangeError deterministically if timezone is invalid.
 */
export function getCivilDateParts(date: Date, timezone: string): ICivilDateParts {
  if (!timezone || typeof timezone !== 'string') {
    throw new RangeError(`Invalid time zone specified: ${timezone}`);
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * Calculates the exact instant representing 00:00:00 local civil midnight in the target IANA timezone.
 * Supports both:
 * - calculateCivilMidnight(date, timezone)
 * - calculateCivilMidnight(baseDate, addDays, timezone)
 *
 * Deterministically throws RangeError if an invalid timezone is provided.
 */
export function calculateCivilMidnight(
  baseDate: Date,
  addDaysOrTimezone: number | string = 0,
  timezone: string = 'Asia/Kolkata'
): Date {
  if (!(baseDate instanceof Date) || isNaN(baseDate.getTime())) {
    throw new RangeError('Invalid base date specified');
  }

  let addDays = 0;
  let targetTz = timezone;

  if (typeof addDaysOrTimezone === 'string') {
    targetTz = addDaysOrTimezone;
    addDays = 0;
  } else if (typeof addDaysOrTimezone === 'number') {
    addDays = addDaysOrTimezone;
  }

  if (!targetTz || typeof targetTz !== 'string') {
    throw new RangeError(`Invalid time zone specified: ${targetTz}`);
  }

  // 1. Determine local calendar date in the target timezone
  const baseParts = getCivilDateParts(baseDate, targetTz);

  // 2. Advance calendar date by addDays using UTC 12:00:00 noon to avoid DST edge anomalies during date arithmetic
  const tempUtc = new Date(Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day + addDays, 12, 0, 0));
  const targetYear = tempUtc.getUTCFullYear();
  const targetMonth = tempUtc.getUTCMonth() + 1;
  const targetDay = tempUtc.getUTCDate();

  // 3. Construct desired local instant: targetYear-targetMonth-targetDay 00:00:00 in targetTz
  const desiredLocalAsUtc = Date.UTC(targetYear, targetMonth - 1, targetDay, 0, 0, 0, 0);

  // Iteratively converge to the exact UTC timestamp corresponding to local 00:00:00
  let candidateTime = desiredLocalAsUtc;
  for (let i = 0; i < 3; i++) {
    const currentParts = getCivilDateParts(new Date(candidateTime), targetTz);
    const candidateLocalAsUtc = Date.UTC(
      currentParts.year,
      currentParts.month - 1,
      currentParts.day,
      currentParts.hour,
      currentParts.minute,
      currentParts.second
    );
    const diff = candidateLocalAsUtc - desiredLocalAsUtc;
    if (diff === 0) break;
    candidateTime -= diff;
  }

  return new Date(candidateTime);
}
```

---

## 3. Why It Represents Actual Local Midnight

1. **Target Specification:** The desired target is defined in local civil coordinate space: $(\text{year}, \text{month}, \text{day}, 0, 0, 0)$ in the specified `timezone`.
2. **Iterative Offset Resolution:** Rather than guessing or assuming a fixed offset, the algorithm uses standard `Intl.DateTimeFormat` against candidate timestamps.
3. **Exact Convergence:**
   - Candidate $t_0 = \text{Date.UTC}(\text{targetYear}, \text{targetMonth}-1, \text{targetDay}, 0, 0, 0)$.
   - At $t_0$, the local civil time is evaluated. If local time is $+05:30$ ahead of desired midnight (as in India), $\text{diff} = +5.5\text{ hours}$.
   - $t_1 = t_0 - \text{diff}$ shifts candidate time backward by 5.5 hours.
   - At $t_1$, local time in `Asia/Kolkata` is checked again. $\text{diff} == 0$, terminating the loop immediately.
4. **Instant Invariant:** The resulting `Date` object, when formatted using the target timezone, always produces `hour: 0, minute: 0, second: 0`.

---

## 4. DST Handling

Daylight Saving Time shifts clock offsets by 1 hour (e.g. BST vs GMT, EDT vs EST, PDT vs PST).

- **Dynamic IANA Resolution:** Because `Intl.DateTimeFormat` queries the platform's IANA tzdata database for the exact instant, the offset is computed for the specific calendar day.
- **DST Boundary Resilience:** The algorithm was verified across the UK DST transition on Sunday, October 25, 2026:
  - **Before Transition (October 24, 2026 - BST / UTC+1):**
    - Calculated instant: `2026-10-23T23:00:00.000Z`
    - Formatted in `Europe/London`: `2026-10-24 00:00:00 BST`
  - **After Transition (October 26, 2026 - GMT / UTC+0):**
    - Calculated instant: `2026-10-26T00:00:00.000Z`
    - Formatted in `Europe/London`: `2026-10-26 00:00:00 GMT`
- Both instants resolve to `00:00:00` local time without hardcoded offsets or drift.

---

## 5. Timezones Tested

| Timezone | Zone Name / Offset | Test Focus |
|---|---|---|
| `Asia/Kolkata` | IST (+05:30, no DST) | Local midnight `00:00:00 IST` is `18:30:00 UTC` previous calendar day |
| `America/New_York` | EDT (-04:00) / EST (-05:00) | Summer vs Winter offset handling without fixed constants |
| `America/Los_Angeles` | PDT (-07:00) / PST (-08:00) | West coast negative offset calculation |
| `Asia/Tokyo` | JST (+09:00, no DST) | Local midnight `00:00:00 JST` is `15:00:00 UTC` previous calendar day |
| `Europe/London` | BST (+01:00) / GMT (+00:00) | Fall daylight-saving transition (Oct 25, 2026) |
| `UTC` | UTC (+00:00) | Baseline UTC equivalence |

---

## 6. Tests Added

Section 4C was added to `server/src/tests/group1Hardening.test.ts` with 8 focused test specifications:

1. **Test A — India (`Asia/Kolkata`):**
   - Asserts local parts: `{ year: 2026, month: 10, day: 3, hour: 0, minute: 0, second: 0 }`.
   - Asserts UTC representation: `2026-10-02T18:30:00.000Z` (18:30:00 UTC on the previous UTC calendar date).
2. **Test B — New York (`America/New_York`):**
   - Tests summer EDT date (`2026-07-15T04:00:00.000Z` -> `00:00:00 EDT`).
   - Tests winter EST date (`2026-12-15T05:00:00.000Z` -> `00:00:00 EST`).
3. **Test C — Los Angeles (`America/Los_Angeles`):**
   - Tests summer PDT date (`2026-06-20T07:00:00.000Z` -> `00:00:00 PDT`).
   - Tests winter PST date (`2026-01-10T08:00:00.000Z` -> `00:00:00 PST`).
4. **Test D — Tokyo (`Asia/Tokyo`):**
   - Asserts local parts: `{ year: 2026, month: 10, day: 3, hour: 0, minute: 0, second: 0 }`.
   - Asserts UTC representation: `2026-10-02T15:00:00.000Z`.
5. **Test E — DST (`Europe/London`):**
   - Asserts local hour/minute/second is `00:00:00` for both BST (Oct 24) and GMT (Oct 26) across the transition.
6. **Test F — Civil Date Preservation:**
   - Evaluates identical UTC instant `2026-10-02T20:00:00.000Z`.
   - Verifies `America/New_York` (16:00 local) selects local civil date `2026-10-02`.
   - Verifies `Asia/Tokyo` (05:00 local) selects local civil date `2026-10-03`.
7. **Test G — Invalid Timezone:**
   - Verifies `calculateCivilMidnight` throws `RangeError` on invalid IANA timezone string, empty string, or null.
   - Verifies `getCivilDateParts` throws `RangeError` on invalid timezone string.
8. **Test H — Revision Engine Integration:**
   - Verifies `calculateNextSchedule(..., 'Asia/Kolkata')` outputs a scheduled instant with local `hour === 0, minute === 0, second === 0`.

---

## 7. Test Results

### `npm run test:group1`
```
====================================================
 RUNNING STUDYOS PHASE 1C GROUP 1 HARDENING TEST SUITE
====================================================

--- 1. AUTH-01 REFRESH TOKEN LIFECYCLE & SECURITY ---
  [PASS] Secure 256-bit random refresh token and SHA-256 hashing
  [PASS] Refresh cookie configuration adheres to secure attributes
  [PASS] Refresh endpoint rejects req.body.refreshToken (Cookie-Only Transport)
  [PASS] Refresh rotation marks predecessor revoked with ROTATED and links successor
  [PASS] Grace window allows concurrent replay within AUTH_REFRESH_GRACE_SECONDS
  [PASS] Grace replay is capped at 2 attempts (prevents replay abuse)
  [PASS] Replay outside grace window triggers FAMILY COMPROMISE REVOCATION
  [PASS] Grace replay fails if successor session has already been revoked
  [PASS] Expired session rejects refresh with SESSION_EXPIRED
  [PASS] Single-session logout revokes token with reason LOGOUT and clears cookie

--- 1B. ATOMIC REFRESH ROTATION & CONCURRENCY RACE TESTS ---
  [PASS] Case A: Concurrent fresh-token rotation creates exactly ONE successor and branches 0 times
  [PASS] Case A: Predecessor can have only one replacedBySessionId
  [PASS] Case A: Burst of > 2 losing concurrent requests triggers anti-abuse family revocation
  [PASS] Case B: Concurrent grace replay increments counter atomically without lost updates
  [PASS] Case B: Grace replay does not create a new refresh session
  [PASS] Case B: Excessive grace replay (> 2) compromises the family
  [PASS] Case C: Outside-grace replay compromises the family
  [PASS] Zero grace window (AUTH_REFRESH_GRACE_SECONDS=0) immediately compromises family on replay

--- 2. ORIGIN / CSRF VALIDATION (AUTH-02) TESTS ---
  [PASS] Origin validation allows trusted frontend origin
  [PASS] Origin validation allows trusted Referer when Origin header is omitted
  [PASS] Origin validation rejects untrusted/attacker origin with 403 CSRF_ORIGIN_MISMATCH
  [PASS] Origin validation allows safe GET requests through without origin requirement

--- 3. NESTED RESOURCE AUTHORIZATION (AUTHZ-01..04) TESTS ---
  [PASS] Foreign subject reference in topic creation is rejected with 404
  [PASS] Foreign parent topic reference in topic creation is rejected with 404
  [PASS] Foreign topic in session start is rejected with 404
  [PASS] Foreign study block in session start is rejected with 404
  [PASS] Foreign topic in ConceptLab update is rejected with 404 (prevents orphaned labs)
  [PASS] PATCH study block strips activeFocusMinutes and actualMinutesLogged tampering

--- 4. REVISION STATE MACHINE & CONCURRENCY (REV-01 & REV-03) TESTS ---
  [PASS] Passing revision advances interval along [2, 4, 7] sequence
  [PASS] Completing interval 3 (Day 7) increments cycle count and wraps to interval 1
  [PASS] CRITICAL INVARIANT: Failed revision MUST NOT advance interval
  [PASS] Failed revision halves memory stability with minimum 1.0 bound
  [PASS] Duplicate submission on COMPLETED revision returns 409 REVISION_ALREADY_COMPLETED
  [PASS] Atomic transition query prevents concurrent race execution
  [PASS] Partial unique compound index on RevisionSchedule is configured correctly

--- 4B. ATOMIC MULTI-DOCUMENT REVISION COMPLETION TESTS ---
  [PASS] Test A: Successful revision completion atomically performs all required mutations
  [PASS] Test B: Injected downstream failure forces complete atomic rollback of all mutations
  [PASS] Test C: Concurrent revision submissions result in exactly ONE commit and ONE 409 conflict
  [PASS] Test D: Standalone MongoDB deployment fails clearly with TRANSACTION_NOT_SUPPORTED

--- 4C. REVISION CIVIL-MIDNIGHT TIMEZONE (FIX 3) TESTS ---
  [PASS] Test A — India (Asia/Kolkata): Calculates exact 00:00:00 IST (18:30:00 UTC previous day)
  [PASS] Test B — New York (America/New_York): Accurately calculates local midnight in EDT and EST without fixed offset
  [PASS] Test C — Los Angeles (America/Los_Angeles): Accurately calculates local midnight
  [PASS] Test D — Tokyo (Asia/Tokyo): Accurately calculates local midnight (UTC+9)
  [PASS] Test E — DST: Both sides of DST transition remain 00:00:00 local time
  [PASS] Test F — Civil date preservation: Selects correct civil date for target timezone given identical UTC instant
  [PASS] Test G — Invalid timezone: Fails deterministically with RangeError
  [PASS] Test H — Revision engine calculateNextSchedule produces correct local midnight with timezone

--- 5. EVIDENCE-BASED ARD (REV-02) ENGINE TESTS ---
  [PASS] MCQ diagnostic question evaluates correctly
  [PASS] TRUE_FALSE diagnostic question evaluates correctly
  [PASS] OUTPUT_PREDICTION diagnostic question evaluates correctly with normalization
  [PASS] COMPLEXITY diagnostic question evaluates correctly
  [PASS] DEBUGGING diagnostic question evaluates correctly
  [PASS] STRUCTURED_CONCEPTUAL diagnostic question evaluates assertions
  [PASS] Public challenge projection NEVER leaks answers or explanations to client
  [PASS] ARD Evaluation: 2 of 3 correct passes (isPassing = true)
  [PASS] ARD Evaluation: 1 of 3 correct fails (isPassing = false)
  [PASS] Server ignores forged client performance score
  [PASS] Incorrect answers produce mistake candidates with root cause and one-line rule

====================================================
 TEST SUMMARY: 58/58 PASSED (0 FAILED)
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

## 8. Build Results

- **Server (`server`):** `npm run build` (`tsc`) executed cleanly with exit code 0.
- **Client (`client`):** `npm run build` (`tsc -b && vite build`) executed cleanly with exit code 0.

---

## 9. Exact Files Changed

1. **`server/src/services/revisionEngine.ts`:**
   - Replaced previous defective UTC-based `calculateCivilMidnight` with iterative local midnight solver.
   - Added exported `getCivilDateParts(date: Date, timezone: string): ICivilDateParts`.
   - Added strict validation throwing `RangeError` on invalid IANA timezone identifiers.
   - Preserved `2-4-7` algorithm intervals, failure-to-tomorrow reset, and stability halving.
2. **`server/src/tests/group1Hardening.test.ts`:**
   - Added Section 4C containing Tests A through H covering India, New York, Los Angeles, Tokyo, DST transitions, civil-date preservation, deterministic invalid-timezone rejection, and engine integration.

---

## 10. Scope Confirmation

- **Only Fix 3 was implemented.**
- No modifications to:
  - refresh-token logic
  - authentication endpoints
  - ARD question generators/evaluators
  - revision transaction completion logic
  - error handlers
  - Mongoose schemas
  - frontend UI components
  - notifications
  - exams / projects / competitive programming
  - Redis / BullMQ
  - SEO
  - AI providers.
