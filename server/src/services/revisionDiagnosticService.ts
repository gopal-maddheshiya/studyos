import crypto from 'node:crypto';
import {
  DiagnosticQuestionType,
  CanonicalComplexity,
  IRevisionChallengeQuestion,
  IPublicRevisionChallengeQuestion,
  DiagnosticAnswerSubmission,
  StoredDiagnosticEvaluation,
  CANONICAL_COMPLEXITIES,
} from '../types/diagnostic.js';
import { ITopic } from '../models/Topic.js';
import { IConceptLab } from '../models/ConceptLab.js';
import { IMistake } from '../models/Mistake.js';

export class DiagnosticValidationError extends Error {
  public readonly code: string = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'DiagnosticValidationError';
  }
}

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

const ALLOWED_ROOT_KEYS = new Set(['answers', 'recallConfidence', 'recallRating']);

export const ALLOWED_KEYS_BY_TYPE: Record<DiagnosticQuestionType, readonly string[]> = Object.freeze({
  MCQ: ['questionId', 'type', 'selectedOptionId', 'timeSpentSeconds'],
  TRUE_FALSE: ['questionId', 'type', 'userBoolean', 'timeSpentSeconds'],
  OUTPUT_PREDICTION: ['questionId', 'type', 'userOutput', 'timeSpentSeconds'],
  COMPLEXITY: ['questionId', 'type', 'selectedComplexity', 'timeSpentSeconds'],
  DEBUGGING: ['questionId', 'type', 'selectedFixId', 'timeSpentSeconds'],
  STRUCTURED_CONCEPTUAL: ['questionId', 'type', 'selectedAssertionIds', 'timeSpentSeconds'],
});

function isForbiddenField(key: string): boolean {
  const normalized = key.toLowerCase().replace(/_/g, '');
  return FORBIDDEN_SERVER_FIELDS.some(
    (f) => f.toLowerCase().replace(/_/g, '') === normalized
  );
}

export function validateDiagnosticPayload(body: any): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new DiagnosticValidationError('Request body must be a valid JSON object.');
  }

  // Reject forged server fields and unrecognized keys on the root body
  for (const key of Object.keys(body)) {
    if (isForbiddenField(key)) {
      throw new DiagnosticValidationError(
        `Payload contains prohibited server-authoritative field: "${key}".`
      );
    }
    if (!ALLOWED_ROOT_KEYS.has(key)) {
      throw new DiagnosticValidationError(
        `Unexpected field "${key}" in submission payload. Only "answers" and "recallConfidence" are permitted.`
      );
    }
  }

  const { answers, recallConfidence, recallRating } = body;
  const confidenceVal = recallConfidence ?? recallRating;

  if (confidenceVal !== undefined && confidenceVal !== null) {
    const num = Number(confidenceVal);
    if (isNaN(num) || num < 1 || num > 5) {
      throw new DiagnosticValidationError(
        `Invalid recall confidence rating: "${confidenceVal}". Must be a number between 1 and 5.`
      );
    }
  }

  if (answers === undefined || answers === null) {
    throw new DiagnosticValidationError('Diagnostic answers payload is required.');
  }

  if (!Array.isArray(answers)) {
    throw new DiagnosticValidationError('Diagnostic answers must be an array.');
  }

  if (answers.length === 0) {
    throw new DiagnosticValidationError('Diagnostic answers array must not be empty.');
  }

  // Check each answer item structure, forbidden fields, and duplicate questionId
  const seenQuestionIds = new Set<string>();

  for (let i = 0; i < answers.length; i++) {
    const ans = answers[i];
    if (!ans || typeof ans !== 'object' || Array.isArray(ans)) {
      throw new DiagnosticValidationError(`Answer at index ${i} must be a valid object.`);
    }

    // Reject forged server fields inside individual answers
    for (const key of Object.keys(ans)) {
      if (isForbiddenField(key)) {
        throw new DiagnosticValidationError(
          `Answer for question "${ans.questionId || i}" contains prohibited server-authoritative field: "${key}".`
        );
      }
    }

    if (typeof ans.questionId !== 'string' || ans.questionId.trim() === '') {
      throw new DiagnosticValidationError(
        `Answer at index ${i} has missing or invalid questionId.`
      );
    }

    const qId = ans.questionId.trim();
    if (seenQuestionIds.has(qId)) {
      throw new DiagnosticValidationError(
        `Duplicate question ID detected: "${qId}". Each question must be answered exactly once.`
      );
    }
    seenQuestionIds.add(qId);
  }
}

function validateAnswerShapeForQuestion(q: IRevisionChallengeQuestion, ans: any): void {
  const allowedKeys = ALLOWED_KEYS_BY_TYPE[q.type];
  if (!allowedKeys) {
    throw new DiagnosticValidationError(`Unsupported question type: "${q.type}".`);
  }

  for (const key of Object.keys(ans)) {
    if (isForbiddenField(key)) {
      throw new DiagnosticValidationError(
        `Answer for question "${q.questionId}" contains prohibited server-authoritative field: "${key}".`
      );
    }
    if (!allowedKeys.includes(key)) {
      throw new DiagnosticValidationError(
        `Unexpected field "${key}" in submitted answer for ${q.type} question "${q.questionId}".`
      );
    }
  }

  switch (q.type) {
    case 'MCQ': {
      if (ans.selectedOptionId === undefined || ans.selectedOptionId === null) {
        throw new DiagnosticValidationError(
          `MCQ question "${q.questionId}" requires a "selectedOptionId" property.`
        );
      }
      if (typeof ans.selectedOptionId !== 'string' || ans.selectedOptionId.trim() === '') {
        throw new DiagnosticValidationError(
          `MCQ question "${q.questionId}" has invalid "selectedOptionId". Must be a non-empty string.`
        );
      }
      const selectedOptionId = ans.selectedOptionId.trim();
      const validOptionIds = (q.options || []).map((o) => o.optionId);
      if (!validOptionIds.includes(selectedOptionId)) {
        throw new DiagnosticValidationError(
          `Invalid option ID "${selectedOptionId}" for question "${q.questionId}". Must match one of the challenge options.`
        );
      }
      break;
    }

    case 'TRUE_FALSE': {
      if (ans.userBoolean === undefined || ans.userBoolean === null) {
        throw new DiagnosticValidationError(
          `TRUE_FALSE question "${q.questionId}" requires a "userBoolean" property.`
        );
      }
      if (typeof ans.userBoolean !== 'boolean') {
        throw new DiagnosticValidationError(
          `TRUE_FALSE question "${q.questionId}" has invalid "userBoolean". Must be a boolean (true or false).`
        );
      }
      break;
    }

    case 'OUTPUT_PREDICTION': {
      if (ans.userOutput === undefined || ans.userOutput === null) {
        throw new DiagnosticValidationError(
          `OUTPUT_PREDICTION question "${q.questionId}" requires a "userOutput" property.`
        );
      }
      if (typeof ans.userOutput !== 'string') {
        throw new DiagnosticValidationError(
          `OUTPUT_PREDICTION question "${q.questionId}" has invalid "userOutput". Must be a string.`
        );
      }
      break;
    }

    case 'COMPLEXITY': {
      if (ans.selectedComplexity === undefined || ans.selectedComplexity === null) {
        throw new DiagnosticValidationError(
          `COMPLEXITY question "${q.questionId}" requires a "selectedComplexity" property.`
        );
      }
      if (
        typeof ans.selectedComplexity !== 'string' ||
        !CANONICAL_COMPLEXITIES.includes(ans.selectedComplexity as CanonicalComplexity)
      ) {
        throw new DiagnosticValidationError(
          `Invalid complexity "${ans.selectedComplexity}" for question "${q.questionId}". Must be one of canonical complexities: [${CANONICAL_COMPLEXITIES.join(', ')}].`
        );
      }
      break;
    }

    case 'DEBUGGING': {
      if (ans.selectedFixId === undefined || ans.selectedFixId === null) {
        throw new DiagnosticValidationError(
          `DEBUGGING question "${q.questionId}" requires a "selectedFixId" property.`
        );
      }
      if (typeof ans.selectedFixId !== 'string' || ans.selectedFixId.trim() === '') {
        throw new DiagnosticValidationError(
          `DEBUGGING question "${q.questionId}" has invalid "selectedFixId". Must be a non-empty string.`
        );
      }
      const selectedFixId = ans.selectedFixId.trim();
      const validFixIds = (q.debuggingOptions || []).map((d) => d.fixId);
      if (!validFixIds.includes(selectedFixId)) {
        throw new DiagnosticValidationError(
          `Invalid fix ID "${selectedFixId}" for question "${q.questionId}". Must match one of the challenge debugging options.`
        );
      }
      break;
    }

    case 'STRUCTURED_CONCEPTUAL': {
      if (ans.selectedAssertionIds === undefined || ans.selectedAssertionIds === null) {
        throw new DiagnosticValidationError(
          `STRUCTURED_CONCEPTUAL question "${q.questionId}" requires a "selectedAssertionIds" property.`
        );
      }
      if (!Array.isArray(ans.selectedAssertionIds)) {
        throw new DiagnosticValidationError(
          `STRUCTURED_CONCEPTUAL question "${q.questionId}" requires "selectedAssertionIds" to be an array.`
        );
      }
      const validAssertionIds = new Set((q.assertions || []).map((a) => a.assertionId));
      const seenAssertionIds = new Set<string>();

      for (let j = 0; j < ans.selectedAssertionIds.length; j++) {
        const astId = ans.selectedAssertionIds[j];
        if (typeof astId !== 'string' || astId.trim() === '') {
          throw new DiagnosticValidationError(
            `Invalid assertion ID at index ${j} in question "${q.questionId}". Must be a non-empty string.`
          );
        }
        const cleanId = astId.trim();
        if (seenAssertionIds.has(cleanId)) {
          throw new DiagnosticValidationError(
            `Duplicate assertion ID "${cleanId}" detected in question "${q.questionId}".`
          );
        }
        if (!validAssertionIds.has(cleanId)) {
          throw new DiagnosticValidationError(
            `Invalid assertion ID "${cleanId}" for question "${q.questionId}". Must match one of the challenge assertions.`
          );
        }
        seenAssertionIds.add(cleanId);
      }
      break;
    }
  }
}

export function validateDiagnosticSubmission(
  challengeQuestions: IRevisionChallengeQuestion[],
  answers: any[],
  rawBody?: any
): void {
  if (rawBody !== undefined) {
    validateDiagnosticPayload(rawBody);
  } else {
    validateDiagnosticPayload({ answers });
  }

  if (!Array.isArray(challengeQuestions) || challengeQuestions.length === 0) {
    throw new DiagnosticValidationError('Authoritative challenge questions are missing or empty.');
  }

  // Array size must match expected number of questions
  if (answers.length !== challengeQuestions.length) {
    throw new DiagnosticValidationError(
      `Diagnostic submission must contain exactly ${challengeQuestions.length} answers, received ${answers.length}.`
    );
  }

  const questionMap = new Map<string, IRevisionChallengeQuestion>();
  for (const q of challengeQuestions) {
    questionMap.set(q.questionId, q);
  }

  // Validate question IDs and question type compatibility
  for (let i = 0; i < answers.length; i++) {
    const ans = answers[i];
    const qId = ans.questionId.trim();
    const q = questionMap.get(qId);

    if (!q) {
      throw new DiagnosticValidationError(
        `Submitted question ID "${qId}" does not belong to the current diagnostic challenge.`
      );
    }

    // If client supplied explicit `type`, it MUST match the server's question type
    if (ans.type !== undefined && ans.type !== q.type) {
      throw new DiagnosticValidationError(
        `Submitted answer type "${ans.type}" does not match authoritative question type "${q.type}" for question "${qId}".`
      );
    }

    // Ensure answer object has type set to q.type for strict discriminated union compliance
    if (ans.type === undefined) {
      ans.type = q.type;
    }

    // Validate optional timeSpentSeconds
    if (ans.timeSpentSeconds !== undefined && ans.timeSpentSeconds !== null) {
      if (
        typeof ans.timeSpentSeconds !== 'number' ||
        isNaN(ans.timeSpentSeconds) ||
        !Number.isFinite(ans.timeSpentSeconds) ||
        ans.timeSpentSeconds < 0
      ) {
        throw new DiagnosticValidationError(
          `Invalid timeSpentSeconds for question "${qId}". Must be a non-negative number.`
        );
      }
    }

    // Validate answer shape and membership strictly by question type
    validateAnswerShapeForQuestion(q, ans);
  }
}

export function normalizeTextOutput(val: string, mode: string = 'WHITESPACE_TRIMMED'): string {
  let res = val.replace(/\r\n/g, '\n').trim();
  if (mode === 'WHITESPACE_TRIMMED') {
    res = res.replace(/\s+/g, ' ');
  } else if (mode === 'CASE_INSENSITIVE_TRIMMED') {
    res = res.toLowerCase().replace(/\s+/g, ' ');
  }
  return res;
}

export function sanitizeDiagnosticChallenge(
  questions: IRevisionChallengeQuestion[]
): IPublicRevisionChallengeQuestion[] {
  return questions.map((q) => ({
    questionId: q.questionId,
    type: q.type,
    prompt: q.prompt,
    codeSnippet: q.codeSnippet,
    options: q.options,
    normalization: q.normalization,
    targetMetric: q.targetMetric,
    debuggingOptions: q.debuggingOptions,
    assertions: q.assertions,
    difficulty: q.difficulty,
  }));
}

export function buildDiagnosticSubmission(
  questions: Array<{ questionId: string; type: DiagnosticQuestionType }>,
  answers: Record<string, any>
): DiagnosticAnswerSubmission[] {
  return questions.map((q) => {
    const raw = answers[q.questionId];

    switch (q.type) {
      case 'MCQ':
        return {
          questionId: q.questionId,
          type: 'MCQ',
          selectedOptionId: typeof raw === 'string' ? raw.trim() : String(raw ?? ''),
        };

      case 'TRUE_FALSE':
        return {
          questionId: q.questionId,
          type: 'TRUE_FALSE',
          userBoolean: typeof raw === 'boolean' ? raw : String(raw).toLowerCase() === 'true',
        };

      case 'OUTPUT_PREDICTION':
        return {
          questionId: q.questionId,
          type: 'OUTPUT_PREDICTION',
          userOutput: typeof raw === 'string' ? raw : String(raw ?? ''),
        };

      case 'COMPLEXITY':
        return {
          questionId: q.questionId,
          type: 'COMPLEXITY',
          selectedComplexity: raw as CanonicalComplexity,
        };

      case 'DEBUGGING':
        return {
          questionId: q.questionId,
          type: 'DEBUGGING',
          selectedFixId: typeof raw === 'string' ? raw.trim() : String(raw ?? ''),
        };

      case 'STRUCTURED_CONCEPTUAL': {
        const ids = Array.isArray(raw)
          ? raw
          : typeof raw === 'string' && raw.trim()
          ? [raw.trim()]
          : [];
        return {
          questionId: q.questionId,
          type: 'STRUCTURED_CONCEPTUAL',
          selectedAssertionIds: ids,
        };
      }

      default:
        throw new DiagnosticValidationError(`Unsupported diagnostic question type: ${(q as any).type}`);
    }
  });
}

export function assembleDiagnosticChallenge(
  topic: ITopic,
  conceptLab: IConceptLab | null,
  activeMistakes: IMistake[] = []
): IRevisionChallengeQuestion[] {
  const questions: IRevisionChallengeQuestion[] = [];
  const topicName = topic.name;
  const timeComplexity = (conceptLab?.complexity?.time || 'O(N)') as CanonicalComplexity;
  const canonicalComplexity: CanonicalComplexity = CANONICAL_COMPLEXITIES.includes(timeComplexity)
    ? timeComplexity
    : 'O(N)';

  // 1. Structured Invariant / Conceptual Question
  questions.push({
    questionId: `diag_q1_${crypto.randomBytes(4).toString('hex')}`,
    type: 'STRUCTURED_CONCEPTUAL',
    prompt: `Which of the following fundamental invariants must hold true for ${topicName}?`,
    assertions: [
      {
        assertionId: 'ast_1',
        text: `The core inductive predicate remains satisfied across every recursive or iterative state transition.`,
      },
      {
        assertionId: 'ast_2',
        text: `All state transitions proceed without verifying search space bounds or base case convergence.`,
      },
      {
        assertionId: 'ast_3',
        text: `Auxiliary space allocation can grow unbounded regardless of problem recursion depth.`,
      },
    ],
    correctAssertionIds: ['ast_1'],
    explanation: `In ${topicName}, preserving the inductive state invariant guarantees algorithmic correctness and deterministic convergence.`,
    difficulty: 'MEDIUM',
  });

  // 2. High-Risk Edge Case / Debugging (Drawn from Mistake Bank or topic template)
  if (activeMistakes.length > 0) {
    const mistake = activeMistakes[0];
    questions.push({
      questionId: `diag_q2_${crypto.randomBytes(4).toString('hex')}`,
      type: 'DEBUGGING',
      prompt: `[Mistake Bank Drill] In ${topicName}, address the following failure mode: "${mistake.prompt}"`,
      codeSnippet: mistake.codeSnippet || undefined,
      debuggingOptions: [
        { fixId: 'fix_1', description: `Apply rule: ${mistake.oneLineRule}` },
        { fixId: 'fix_2', description: `Bypass boundary check and proceed with unchecked traversal` },
        { fixId: 'fix_3', description: `Increase iteration count without re-evaluating termination condition` },
      ],
      correctFixId: 'fix_1',
      explanation: mistake.explanation || `Correct rule: ${mistake.oneLineRule}`,
      difficulty: 'HARD',
    });
  } else {
    questions.push({
      questionId: `diag_q2_${crypto.randomBytes(4).toString('hex')}`,
      type: 'DEBUGGING',
      prompt: `Identify the critical boundary safeguard required in ${topicName} to prevent off-by-one or overflow errors.`,
      codeSnippet: `// ${topicName} boundary check\nif (left >= right) return baseCase;`,
      debuggingOptions: [
        { fixId: 'fix_1', description: `Ensure termination bounds match strict inclusive/exclusive search invariants.` },
        { fixId: 'fix_2', description: `Omit lower bound checks since indices are always non-negative.` },
        { fixId: 'fix_3', description: `Double the search step to leap over boundary collisions.` },
      ],
      correctFixId: 'fix_1',
      explanation: `Strict inclusive/exclusive boundary alignment prevents off-by-one errors and infinite recursion.`,
      difficulty: 'MEDIUM',
    });
  }

  // 3. Complexity Verification Question
  questions.push({
    questionId: `diag_q3_${crypto.randomBytes(4).toString('hex')}`,
    type: 'COMPLEXITY',
    prompt: `What is the canonical worst-case time complexity of ${topicName}?`,
    targetMetric: 'TIME_WORST',
    expectedComplexity: canonicalComplexity,
    explanation: `The canonical algorithmic worst-case time complexity profile for ${topicName} is ${canonicalComplexity}.`,
    difficulty: 'EASY',
  });

  return questions;
}

export interface IDiagnosticEvaluationResult {
  correctCount: number;
  totalQuestions: number;
  isPassing: boolean;
  scorePercentage: number;
  evaluations: StoredDiagnosticEvaluation[];
  mistakesToCreate: Array<{
    origin: 'REVISION';
    topicId: any;
    prompt: string;
    codeSnippet?: string;
    userErroneousAnswer: string;
    correctAnswer: string;
    explanation: string;
    rootCause:
      | 'CONCEPTUAL_GAP'
      | 'EDGE_CASE_BLINDNESS'
      | 'EXECUTION_SLIP'
      | 'TIME_COMPLEXITY_EXCEEDED'
      | 'PATTERN_MISIDENTIFICATION';
    oneLineRule: string;
  }>;
}

export function evaluateDiagnosticSubmission(
  challengeQuestions: IRevisionChallengeQuestion[],
  submissions: DiagnosticAnswerSubmission[],
  topicId: any
): IDiagnosticEvaluationResult {
  let correctCount = 0;
  const evaluations: StoredDiagnosticEvaluation[] = [];
  const mistakesToCreate: IDiagnosticEvaluationResult['mistakesToCreate'] = [];

  for (const q of challengeQuestions) {
    const sub = submissions.find((s) => s.questionId === q.questionId);
    let isCorrect = false;
    const timeSpentSeconds = sub?.timeSpentSeconds || 0;

    switch (q.type) {
      case 'MCQ': {
        const selected = sub?.type === 'MCQ'
          ? (sub.selectedOptionId || (sub as any).selectedOption || (sub as any).submittedAnswer || '')
          : '';
        const correct = q.correctOptionId || (q as any).correctAnswer || '';
        isCorrect = Boolean(
          selected &&
          correct &&
          (selected.trim().toLowerCase() === correct.trim().toLowerCase() ||
           (q.options && q.options.some((opt: any) => {
             const optId = typeof opt === 'string' ? opt : opt.optionId;
             const optText = typeof opt === 'string' ? opt : opt.text;
             return (
               (optId === correct && (optText === selected || optId === selected)) ||
               (optText === correct && (optText === selected || optId === selected))
             );
           })))
        );
        evaluations.push({
          questionId: q.questionId,
          type: 'MCQ',
          submittedOptionId: selected,
          correctOptionId: correct,
          isCorrect,
          timeSpentSeconds,
        });
        if (!isCorrect) {
          mistakesToCreate.push({
            origin: 'REVISION',
            topicId,
            prompt: q.prompt,
            codeSnippet: q.codeSnippet,
            userErroneousAnswer: selected || 'No answer submitted',
            correctAnswer: correct,
            explanation: q.explanation,
            rootCause: 'CONCEPTUAL_GAP',
            oneLineRule: `Re-verify fundamental principles of ${q.prompt.substring(0, 40)}...`,
          });
        }
        break;
      }


      case 'TRUE_FALSE': {
        const userBool = sub?.type === 'TRUE_FALSE' ? sub.userBoolean : null;
        isCorrect = userBool !== null && userBool === q.correctBoolean;
        evaluations.push({
          questionId: q.questionId,
          type: 'TRUE_FALSE',
          submittedBoolean: Boolean(userBool),
          correctBoolean: Boolean(q.correctBoolean),
          isCorrect,
          timeSpentSeconds,
        });
        if (!isCorrect) {
          mistakesToCreate.push({
            origin: 'REVISION',
            topicId,
            prompt: q.prompt,
            codeSnippet: q.codeSnippet,
            userErroneousAnswer: String(userBool),
            correctAnswer: String(q.correctBoolean),
            explanation: q.explanation,
            rootCause: 'CONCEPTUAL_GAP',
            oneLineRule: `Distinguish true invariants from false assumptions in recall.`,
          });
        }
        break;
      }

      case 'OUTPUT_PREDICTION': {
        const rawOutput = sub?.type === 'OUTPUT_PREDICTION' ? sub.userOutput : '';
        const normMode = q.normalization || 'WHITESPACE_TRIMMED';
        const normSub = normalizeTextOutput(rawOutput, normMode);
        const normExp = normalizeTextOutput(q.expectedOutput || '', normMode);
        isCorrect = Boolean(rawOutput && normSub === normExp);
        evaluations.push({
          questionId: q.questionId,
          type: 'OUTPUT_PREDICTION',
          submittedOutput: rawOutput,
          normalizedSubmittedOutput: normSub,
          expectedOutput: q.expectedOutput || '',
          isCorrect,
          timeSpentSeconds,
        });
        if (!isCorrect) {
          mistakesToCreate.push({
            origin: 'REVISION',
            topicId,
            prompt: q.prompt,
            codeSnippet: q.codeSnippet,
            userErroneousAnswer: rawOutput || 'No output submitted',
            correctAnswer: q.expectedOutput || '',
            explanation: q.explanation,
            rootCause: 'EXECUTION_SLIP',
            oneLineRule: `Carefully trace output transitions step-by-step.`,
          });
        }
        break;
      }

      case 'COMPLEXITY': {
        const selectedComplexity = sub?.type === 'COMPLEXITY' ? sub.selectedComplexity : '';
        isCorrect = Boolean(selectedComplexity && selectedComplexity === q.expectedComplexity);
        evaluations.push({
          questionId: q.questionId,
          type: 'COMPLEXITY',
          submittedComplexity: selectedComplexity as CanonicalComplexity,
          expectedComplexity: (q.expectedComplexity || 'O(N)') as CanonicalComplexity,
          isCorrect,
          timeSpentSeconds,
        });
        if (!isCorrect) {
          mistakesToCreate.push({
            origin: 'REVISION',
            topicId,
            prompt: q.prompt,
            codeSnippet: q.codeSnippet,
            userErroneousAnswer: selectedComplexity || 'No complexity selected',
            correctAnswer: q.expectedComplexity || 'O(N)',
            explanation: q.explanation,
            rootCause: 'TIME_COMPLEXITY_EXCEEDED',
            oneLineRule: `Re-evaluate recurrences and loops to correctly determine ${q.expectedComplexity}.`,
          });
        }
        break;
      }

      case 'DEBUGGING': {
        const selectedFix = sub?.type === 'DEBUGGING' ? sub.selectedFixId : '';
        isCorrect = Boolean(selectedFix && selectedFix === q.correctFixId);
        evaluations.push({
          questionId: q.questionId,
          type: 'DEBUGGING',
          submittedFixId: selectedFix,
          correctFixId: q.correctFixId || '',
          isCorrect,
          timeSpentSeconds,
        });
        if (!isCorrect) {
          mistakesToCreate.push({
            origin: 'REVISION',
            topicId,
            prompt: q.prompt,
            codeSnippet: q.codeSnippet,
            userErroneousAnswer: selectedFix || 'No fix selected',
            correctAnswer: q.correctFixId || '',
            explanation: q.explanation,
            rootCause: 'EDGE_CASE_BLINDNESS',
            oneLineRule: `Identify edge case boundaries before concluding code correctness.`,
          });
        }
        break;
      }

      case 'STRUCTURED_CONCEPTUAL': {
        const selected = sub?.type === 'STRUCTURED_CONCEPTUAL' ? sub.selectedAssertionIds : [];
        const correctSet = new Set(q.correctAssertionIds || []);
        const submittedSet = new Set(selected || []);
        isCorrect =
          correctSet.size === submittedSet.size &&
          [...correctSet].every((id) => submittedSet.has(id));

        evaluations.push({
          questionId: q.questionId,
          type: 'STRUCTURED_CONCEPTUAL',
          submittedAssertionIds: selected || [],
          correctAssertionIds: q.correctAssertionIds || [],
          isCorrect,
          timeSpentSeconds,
        });
        if (!isCorrect) {
          mistakesToCreate.push({
            origin: 'REVISION',
            topicId,
            prompt: q.prompt,
            codeSnippet: q.codeSnippet,
            userErroneousAnswer: (selected || []).join(', ') || 'No assertions selected',
            correctAnswer: (q.correctAssertionIds || []).join(', '),
            explanation: q.explanation,
            rootCause: 'CONCEPTUAL_GAP',
            oneLineRule: `State inductive properties clearly without skipping invariants.`,
          });
        }
        break;
      }
    }

    if (isCorrect) {
      correctCount++;
    }
  }

  // Integer logic: 2 or 3 out of 3 is a PASS
  const isPassing = correctCount >= 2;
  const scorePercentage = Math.round((correctCount / challengeQuestions.length) * 100);

  return {
    correctCount,
    totalQuestions: challengeQuestions.length,
    isPassing,
    scorePercentage,
    evaluations,
    mistakesToCreate,
  };
}

export const evaluateDeterministicChallenge = evaluateDiagnosticSubmission;

