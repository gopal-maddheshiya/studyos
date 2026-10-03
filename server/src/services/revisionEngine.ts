export interface IRevisionScheduleResult {
  nextIntervalDays: number;
  nextScheduledDate: Date;
  newStabilityDays: number;
  isPromoted: boolean;
  cycleCountIncrement: number;
}

export interface IRevisionEngine {
  calculateNextSchedule(
    currentCycleCount: number,
    currentStabilityDays: number,
    performanceScore: number, // 0 to 100
    recallRating?: number      // 1 to 5
  ): IRevisionScheduleResult;
}

/**
 * 2-4-7 Spaced Revision Algorithm Implementation
 * Cycle 0 -> Day 0 (Initial Assessment)
 * Cycle 1 -> Day 2 (+2 days)
 * Cycle 2 -> Day 6 (+4 days)
 * Cycle 3 -> Day 13 (+7 days)
 * Cycle 4+ -> +14 to +30 days maintenance
 */
export class Rule247RevisionEngine implements IRevisionEngine {
  calculateNextSchedule(
    currentCycleCount: number,
    currentStabilityDays: number,
    performanceScore: number,
    recallRating: number = 3
  ): IRevisionScheduleResult {
    const isPassing = performanceScore >= 60;
    const now = new Date();

    if (!isPassing) {
      // Failed revision: Contract interval back to Day 1 (tomorrow) and slash stability
      const newStabilityDays = Math.max(1.0, currentStabilityDays * 0.5);
      const nextScheduledDate = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

      return {
        nextIntervalDays: 1,
        nextScheduledDate,
        newStabilityDays,
        isPromoted: false,
        cycleCountIncrement: 0,
      };
    }

    // Success: Advance along the 2-4-7 progression
    let nextIntervalDays = 2;

    switch (currentCycleCount) {
      case 0:
        nextIntervalDays = 2; // Day 2
        break;
      case 1:
        nextIntervalDays = 4; // Day 4 after first review
        break;
      case 2:
        nextIntervalDays = 7; // Day 7 after second review
        break;
      default:
        // Maintenance phase: 14 days, scaled by recall confidence
        nextIntervalDays = Math.min(60, Math.round(14 * (recallRating >= 4 ? 1.5 : 1.0)));
        break;
    }

    // Stability expansion: S_new = S_prev * (1 + 0.1 * rating * multiplier)
    const ratingMultiplier = recallRating / 3;
    const newStabilityDays = Math.round(
      (currentStabilityDays * (1 + 0.25 * ratingMultiplier) + nextIntervalDays * 0.5) * 10
    ) / 10;

    const nextScheduledDate = new Date(now.getTime() + nextIntervalDays * 24 * 60 * 60 * 1000);

    return {
      nextIntervalDays,
      nextScheduledDate,
      newStabilityDays,
      isPromoted: true,
      cycleCountIncrement: 1,
    };
  }
}

export const defaultRevisionEngine = new Rule247RevisionEngine();
