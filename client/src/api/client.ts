import type {
  ISubject,
  ITopic,
  IConceptLab,
  IQuiz,
  IRevisionSchedule,
  IScheduledStudyBlock,
  IMistake,
  IEvaluatedAnswer,
  IRevisionDiagnosticResponse,
  IRevisionSubmitResponse,
  IDiagnosticAnswerSubmission,
} from './types.js';

const API_BASE = 'http://localhost:5001/api/v1';

let refreshPromise: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        return res.ok;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

async function fetchJson<T>(url: string, options?: RequestInit, isRetry = false): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'include',
  });

  if (res.status === 401 && !isRetry && !url.startsWith('/auth/')) {
    const refreshed = await doRefresh();
    if (refreshed) {
      return fetchJson<T>(url, options, true);
    }
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `HTTP error ${res.status}`);
  }

  const json = await res.json();
  return json.data;
}

export const api = {
  // Auth
  login: async (email: string, password: string) => {
    return fetchJson<{ user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  logout: async () => {
    return fetchJson<{ message: string }>('/auth/logout', { method: 'POST' });
  },

  refresh: async () => {
    return fetchJson<{ message: string }>('/auth/refresh', { method: 'POST' });
  },

  // Seed demo data
  seedStarterData: async () => {
    return fetchJson<{ message: string }>('/seed/starter-data', { method: 'POST' });
  },

  // Subjects & Topics
  getSubjects: async () => {
    return fetchJson<{ subjects: ISubject[] }>('/subjects');
  },

  createSubject: async (data: { name: string; color?: string; description?: string }) => {
    return fetchJson<{ subject: ISubject }>('/subjects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  createTopic: async (data: { subjectId: string; name: string }) => {
    return fetchJson<{ topic: ITopic; conceptLab: IConceptLab }>('/topics', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getTopicLab: async (topicId: string) => {
    return fetchJson<{
      topic: ITopic;
      conceptLab: IConceptLab;
      mistakes: IMistake[];
      evidence: any;
    }>(`/topics/${topicId}/lab`);
  },

  updateTopicLab: async (
    topicId: string,
    data: { intuition?: string; personalNotes?: string; codeSnippets?: any[]; complexity?: any }
  ) => {
    return fetchJson<{ conceptLab: IConceptLab }>(`/topics/${topicId}/lab`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Study Sessions
  startSession: async (topicId: string) => {
    return fetchJson<{ sessionId: string; heartbeatIntervalSeconds: number }>('/sessions/start', {
      method: 'POST',
      body: JSON.stringify({ topicId }),
    });
  },

  sendHeartbeat: async (sessionId: string) => {
    return fetchJson<{ activeFocusMinutes: number }>(`/sessions/${sessionId}/heartbeat`, {
      method: 'POST',
    });
  },

  finishSession: async (sessionId: string, sessionNotes?: string) => {
    return fetchJson<{
      promptQuiz: boolean;
      promotedToLearning: boolean;
      topicStatus: string;
      masteryScore: number;
    }>(`/sessions/${sessionId}/finish`, {
      method: 'POST',
      body: JSON.stringify({ sessionNotes }),
    });
  },

  // Quizzes
  generateQuiz: async (topicId: string, difficulty?: string) => {
    return fetchJson<{ quiz: IQuiz }>('/quizzes/generate', {
      method: 'POST',
      body: JSON.stringify({ topicId, difficulty }),
    });
  },

  submitQuiz: async (quizId: string, answers: Array<{ questionId: string; userAnswer: string; timeSpentSeconds: number }>) => {
    return fetchJson<{
      scorePercentage: number;
      correctCount: number;
      totalQuestions: number;
      newMistakesCount: number;
      topicStatus: string;
      masteryScore: number;
      scheduledRevision?: any;
      evaluations?: IEvaluatedAnswer[];
    }>(`/quizzes/${quizId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    });
  },

  // Revisions
  getDueRevisions: async () => {
    return fetchJson<{ revisions: IRevisionSchedule[]; count: number }>('/revisions/due');
  },

  getRevisionDiagnostic: async (revisionId: string) => {
    return fetchJson<IRevisionDiagnosticResponse>(`/revisions/${revisionId}/diagnostic`);
  },

  submitRevision: async (
    revisionId: string,
    answers: IDiagnosticAnswerSubmission[],
    recallRating?: number
  ) => {
    return fetchJson<IRevisionSubmitResponse>(`/revisions/${revisionId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers, recallRating }),
    });
  },

  // Timetable
  getDailyPlan: async (dateStr?: string) => {
    return fetchJson<{
      date: string;
      blocks: IScheduledStudyBlock[];
      missedBlocks: IScheduledStudyBlock[];
      planVsReality: {
        plannedMinutes: number;
        actualMinutes: number;
        adherenceRatio: number;
      };
    }>(`/timetable/daily${dateStr ? `?date=${dateStr}` : ''}`);
  },

  updateStudyBlock: async (blockId: string, updates: { status?: string; activeFocusMinutes?: number }) => {
    return fetchJson<{ block: IScheduledStudyBlock }>(`/timetable/blocks/${blockId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  // Mistakes
  getMistakes: async (filter?: { rootCause?: string; status?: string }) => {
    const params = new URLSearchParams();
    if (filter?.rootCause) params.append('rootCause', filter.rootCause);
    if (filter?.status) params.append('status', filter.status);
    return fetchJson<{ mistakes: IMistake[]; stats: any }>(`/mistakes?${params.toString()}`);
  },

  drillMistake: async (mistakeId: string, passed: boolean) => {
    return fetchJson<{ mistake: IMistake; isResolved: boolean }>(`/mistakes/${mistakeId}/drill`, {
      method: 'POST',
      body: JSON.stringify({ passed }),
    });
  },

  // Analytics
  getAnalytics: async () => {
    return fetchJson<{
      totalFocusHours: number;
      totalTopics: number;
      retrievalResilience: number;
      lifecycleCounts: Record<string, number>;
      mistakeLiquidationRate: number;
      unresolvedMistakesCount: number;
      trajectory: {
        currentMastered: number;
        projected1YearBaseline: number;
        projected1YearDisciplined: number;
        projected1YearDecayDanger: number;
        keyLever: string;
      };
    }>('/analytics/overview');
  },
};
