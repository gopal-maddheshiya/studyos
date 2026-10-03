import { TopicLifecycleStatus } from '../models/Topic.js';

export interface IEvidenceMetrics {
  comprehensionScore: number; // 0 - 100
  applicationScore: number;   // 0 - 100
  retentionScore: number;     // 0 - 100
  consistencyScore: number;   // 0 - 100
  stabilityDays: number;
  totalStudyMinutes: number;
  revisionCycleCount: number;
  unresolvedMistakeCount: number;
}

export interface IEvidenceResult {
  masteryScore: number;
  newStatus: TopicLifecycleStatus;
  statusChanged: boolean;
  decayRisk: boolean;
  breakdown: {
    comprehension: number;
    application: number;
    retention: number;
    consistency: number;
  };
}

/**
 * Deterministic Evidence-Based Learning Calculation Engine
 * Mastery Formula: M_t = 0.25 * C_t + 0.35 * A_t + 0.30 * R_t + 0.10 * D_t
 */
export function calculateTopicMastery(
  currentStatus: TopicLifecycleStatus,
  metrics: IEvidenceMetrics,
  daysSinceLastRevision?: number
): IEvidenceResult {
  // 1. Calculate Retention Decay if time has passed
  let effectiveRetention = metrics.retentionScore;
  if (daysSinceLastRevision !== undefined && daysSinceLastRevision > 0 && metrics.stabilityDays > 0) {
    // Ebbinghaus exponential decay: R(t) = 100 * e^(-t / S)
    const decay = Math.exp(-daysSinceLastRevision / metrics.stabilityDays);
    effectiveRetention = Math.round(metrics.retentionScore * decay);
  }

  // 2. Bound scores between 0 and 100
  const c = Math.min(100, Math.max(0, metrics.comprehensionScore));
  const a = Math.min(100, Math.max(0, metrics.applicationScore));
  const r = Math.min(100, Math.max(0, effectiveRetention));
  const d = Math.min(100, Math.max(0, metrics.consistencyScore));

  // 3. Compute weighted mastery score
  const masteryScore = Math.round(0.25 * c + 0.35 * a + 0.30 * r + 0.10 * d);

  // 4. Decay risk flag if retention drops below 60% on retained or mastered topics
  const decayRisk = (currentStatus === 'RETAINED' || currentStatus === 'MASTERED') && r < 60;

  // 5. Determine State Transitions
  let newStatus: TopicLifecycleStatus = currentStatus;

  switch (currentStatus) {
    case 'NOT_STARTED':
      if (metrics.totalStudyMinutes >= 15) {
        newStatus = 'LEARNING';
      }
      break;

    case 'LEARNING':
      // Requires passing initial assessment with at least 70% comprehension
      if (c >= 70) {
        newStatus = 'ASSESSED';
      }
      break;

    case 'ASSESSED':
      // Requires passing at least 2 spaced revision intervals with retention >= 75%
      if (metrics.revisionCycleCount >= 2 && r >= 75 && a >= 50) {
        newStatus = 'RETAINED';
      }
      break;

    case 'RETAINED':
      // Mastery requires cycle 3+, unassisted practice, 0 critical mistakes, and M >= 85
      if (
        metrics.revisionCycleCount >= 3 &&
        masteryScore >= 85 &&
        r >= 80 &&
        a >= 75 &&
        metrics.unresolvedMistakeCount === 0
      ) {
        newStatus = 'MASTERED';
      } else if (decayRisk) {
        newStatus = 'LEARNING'; // Dropped back to re-learning due to retention collapse
      }
      break;

    case 'MASTERED':
      if (decayRisk || metrics.unresolvedMistakeCount > 0) {
        newStatus = 'RETAINED'; // Demoted back to retained
      }
      break;
  }

  return {
    masteryScore,
    newStatus,
    statusChanged: newStatus !== currentStatus,
    decayRisk,
    breakdown: {
      comprehension: c,
      application: a,
      retention: r,
      consistency: d,
    },
  };
}
