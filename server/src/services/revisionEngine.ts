export interface IRevisionScheduleResult {
  nextIntervalIndex: number;
  nextIntervalDays: number;
  nextScheduledDate: Date;
  newStabilityDays: number;
  isPromoted: boolean;
  cycleCountIncrement: number;
}

export interface IRevisionEngine {
  calculateNextSchedule(
    currentIntervalIndex: number,
    currentCycleCount: number,
    currentStabilityDays: number,
    isPassing: boolean,
    recallConfidence?: number, // 1 to 5
    timezone?: string
  ): IRevisionScheduleResult;
}

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
 *
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

/**
 * 2-4-7 Spaced Revision Algorithm (Master Specification Sections 10, 11, 12)
 *
 * Intervals:
 * - Interval 1: Initial Day 2 (+2 days)
 * - Interval 2: Day 4 after Interval 1 (+4 days)
 * - Interval 3: Day 7 after Interval 2 (+7 days)
 * - Interval 4+: Maintenance (+14 to +30 days)
 *
 * Failure Rule:
 * - Contract to Day 1 (tomorrow)
 * - Stability slashed by 50%: S_new = max(1.0, S_prev * 0.5)
 * - CRITICAL: Interval index and cycle count DO NOT advance!
 */
export class Rule247RevisionEngine implements IRevisionEngine {
  calculateNextSchedule(
    currentIntervalIndex: number,
    currentCycleCount: number,
    currentStabilityDays: number,
    isPassing: boolean,
    recallConfidence: number = 3,
    timezone: string = 'Asia/Kolkata'
  ): IRevisionScheduleResult {
    const now = new Date();
    const boundedConfidence = Math.min(5, Math.max(1, recallConfidence));

    // CASE 1: FAILED REVISION
    if (!isPassing) {
      // Contract interval back to Day 1 (tomorrow) and slash stability by 50%
      const newStabilityDays = Math.max(1.0, Math.round(currentStabilityDays * 0.5 * 10) / 10);
      const nextScheduledDate = calculateCivilMidnight(now, 1, timezone);

      return {
        nextIntervalIndex: currentIntervalIndex, // CRITICAL INVARIANT: DO NOT ADVANCE ON FAILURE
        nextIntervalDays: 1,
        nextScheduledDate,
        newStabilityDays,
        isPromoted: false,
        cycleCountIncrement: 0,
      };
    }

    // CASE 2: SUCCESSFUL REVISION
    let nextIntervalDays = 4;
    let nextIntervalIndex = currentIntervalIndex + 1;
    let cycleCountIncrement = 0;

    switch (currentIntervalIndex) {
      case 0:
        nextIntervalIndex = 1;
        nextIntervalDays = 2; // Initial assessment to Revision 1
        cycleCountIncrement = 0;
        break;
      case 1:
        nextIntervalIndex = 2;
        nextIntervalDays = 4; // Revision 1 to Revision 2
        cycleCountIncrement = 0;
        break;
      case 2:
        nextIntervalIndex = 3;
        nextIntervalDays = 7; // Revision 2 to Revision 3
        cycleCountIncrement = 0;
        break;
      case 3:
      default:
        // Maintenance phase (14 to 30 days based on retrieval confidence)
        nextIntervalIndex = 1;
        nextIntervalDays = Math.min(30, Math.round(14 * (boundedConfidence >= 4 ? 1.5 : 1.0)));
        cycleCountIncrement = 1;
        break;
    }

    // Stability expansion: S_new = S_prev * (1 + 0.1 * rating) + nextIntervalDays * 0.5
    const newStabilityDays = Math.round(
      (currentStabilityDays * (1 + 0.1 * boundedConfidence) + nextIntervalDays * 0.5) * 10
    ) / 10;

    const nextScheduledDate = calculateCivilMidnight(now, nextIntervalDays, timezone);

    return {
      nextIntervalIndex,
      nextIntervalDays,
      nextScheduledDate,
      newStabilityDays,
      isPromoted: true,
      cycleCountIncrement,
    };
  }
}

export const defaultRevisionEngine = new Rule247RevisionEngine();
export const revisionEngine = defaultRevisionEngine;
