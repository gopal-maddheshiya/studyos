export type DiagnosticQuestionType =
  | 'MCQ'
  | 'TRUE_FALSE'
  | 'OUTPUT_PREDICTION'
  | 'COMPLEXITY'
  | 'DEBUGGING'
  | 'STRUCTURED_CONCEPTUAL';

export type CanonicalComplexity =
  | 'O(1)'
  | 'O(log N)'
  | 'O(N)'
  | 'O(N log N)'
  | 'O(N^2)'
  | 'O(2^N)'
  | 'O(N!)';

export const CANONICAL_COMPLEXITIES: CanonicalComplexity[] = [
  'O(1)',
  'O(log N)',
  'O(N)',
  'O(N log N)',
  'O(N^2)',
  'O(2^N)',
  'O(N!)',
];

// Full Question Definition in Database (Contains Authoritative Secret Keys)
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

// Sanitized Question Definition Delivered to Client (Excludes All Secret Keys and Explanations)
export interface IPublicRevisionChallengeQuestion {
  questionId: string;
  type: DiagnosticQuestionType;
  prompt: string;
  codeSnippet?: string;
  options?: Array<{ optionId: string; text: string }>;
  normalization?: string;
  targetMetric?: string;
  debuggingOptions?: Array<{ fixId: string; description: string }>;
  assertions?: Array<{ assertionId: string; text: string }>;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

// Client Answer Submission Discriminated Union
export type DiagnosticAnswerSubmission =
  | { questionId: string; type: 'MCQ'; selectedOptionId: string; timeSpentSeconds?: number }
  | { questionId: string; type: 'TRUE_FALSE'; userBoolean: boolean; timeSpentSeconds?: number }
  | { questionId: string; type: 'OUTPUT_PREDICTION'; userOutput: string; timeSpentSeconds?: number }
  | { questionId: string; type: 'COMPLEXITY'; selectedComplexity: CanonicalComplexity; timeSpentSeconds?: number }
  | { questionId: string; type: 'DEBUGGING'; selectedFixId: string; timeSpentSeconds?: number }
  | { questionId: string; type: 'STRUCTURED_CONCEPTUAL'; selectedAssertionIds: string[]; timeSpentSeconds?: number };

// Stored Discriminated Union Evaluation in DB
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
