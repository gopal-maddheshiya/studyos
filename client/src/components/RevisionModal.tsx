import React, { useState, useEffect } from 'react';
import { X, RotateCcw, Award, CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../api/client.js';
import {
  type IRevisionSchedule,
  type IPublicDiagnosticQuestion,
  type IRevisionSubmitResponse,
  type IDiagnosticEvaluation,
  CANONICAL_COMPLEXITIES,
  buildDiagnosticSubmission,
} from '../api/types.js';

interface RevisionModalProps {
  revision: IRevisionSchedule;
  onClose: () => void;
  onCompleted: () => void;
}

function formatAnswerDisplay(
  item: IDiagnosticEvaluation,
  type: 'user' | 'expected',
  questions?: IPublicDiagnosticQuestion[]
): string {
  const q = questions?.find((question) => question.questionId === item.questionId);

  if (type === 'user') {
    if (item.userAnswer) return item.userAnswer;
    if (item.submittedOptionId) {
      const opt = q?.options?.find((o) => (typeof o === 'string' ? o : o.optionId) === item.submittedOptionId);
      const text = typeof opt === 'string' ? opt : opt?.text;
      return text ? `${text} (${item.submittedOptionId})` : item.submittedOptionId;
    }
    if (typeof item.submittedBoolean === 'boolean') {
      return item.submittedBoolean ? 'True' : 'False';
    }
    if (item.submittedOutput) return item.submittedOutput;
    if (item.submittedComplexity) return item.submittedComplexity;
    if (item.submittedFixId) {
      const fix = q?.debuggingOptions?.find((f) => f.fixId === item.submittedFixId);
      return fix?.description ? fix.description : item.submittedFixId;
    }
    if (item.submittedAssertionIds && item.submittedAssertionIds.length > 0) {
      const assertionTexts = item.submittedAssertionIds.map((id) => {
        const ast = q?.assertions?.find((a) => a.assertionId === id);
        return ast?.text || id;
      });
      return assertionTexts.join('; ');
    }
    return '(none)';
  } else {
    if (item.correctAnswer) return item.correctAnswer;
    if (item.correctOptionId) {
      const opt = q?.options?.find((o) => (typeof o === 'string' ? o : o.optionId) === item.correctOptionId);
      const text = typeof opt === 'string' ? opt : opt?.text;
      return text ? `${text} (${item.correctOptionId})` : item.correctOptionId;
    }
    if (typeof item.correctBoolean === 'boolean') {
      return item.correctBoolean ? 'True' : 'False';
    }
    if (item.expectedOutput) return item.expectedOutput;
    if (item.expectedComplexity) return item.expectedComplexity;
    if (item.correctFixId) {
      const fix = q?.debuggingOptions?.find((f) => f.fixId === item.correctFixId);
      return fix?.description ? fix.description : item.correctFixId;
    }
    if (item.correctAssertionIds && item.correctAssertionIds.length > 0) {
      const assertionTexts = item.correctAssertionIds.map((id) => {
        const ast = q?.assertions?.find((a) => a.assertionId === id);
        return ast?.text || id;
      });
      return assertionTexts.join('; ');
    }
    return '';
  }
}

export const RevisionModal: React.FC<RevisionModalProps> = ({
  revision,
  onClose,
  onCompleted,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [questions, setQuestions] = useState<IPublicDiagnosticQuestion[]>([]);
  const [topicInfo, setTopicInfo] = useState<{ id?: string; name?: string; stabilityDays?: number } | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [recallRating, setRecallRating] = useState<number>(3);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IRevisionSubmitResponse | null>(null);

  useEffect(() => {
    let mounted = true;

    api.getRevisionDiagnostic(revision._id)
      .then((res) => {
        if (mounted) {
          setQuestions(res.questions || []);
          if (res.topic) {
            setTopicInfo(res.topic);
          }
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err.message || 'Failed to load revision diagnostic');
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [revision._id]);

  const handleSelectAnswer = (questionId: string, answer: any) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: answer,
    }));
  };

  const handleToggleAssertion = (questionId: string, assertionId: string) => {
    setAnswers((prev) => {
      const currentList: string[] = Array.isArray(prev[questionId]) ? prev[questionId] : [];
      const updated = currentList.includes(assertionId)
        ? currentList.filter((id) => id !== assertionId)
        : [...currentList, assertionId];
      return {
        ...prev,
        [questionId]: updated,
      };
    });
  };

  const isFormComplete =
    questions.length > 0 &&
    questions.every((q) => {
      const val = answers[q.questionId];
      if (q.type === 'TRUE_FALSE') {
        return typeof val === 'boolean';
      }
      if (q.type === 'STRUCTURED_CONCEPTUAL') {
        return Array.isArray(val) && val.length > 0;
      }
      return typeof val === 'string' && val.trim().length > 0;
    });

  const handleSubmit = async () => {
    if (!isFormComplete) return;

    setSubmitting(true);
    setError(null);

    try {
      const submissionAnswers = buildDiagnosticSubmission(questions, answers);
      const res = await api.submitRevision(revision._id, submissionAnswers, recallRating);
      setResult(res);
    } catch (err: any) {
      setError(err.message || 'Failed to submit revision diagnostic');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(28, 25, 23, 0.5)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 110,
        padding: '16px',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: 'var(--bg-surface)',
          padding: '32px',
          position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
          aria-label="Close"
        >
          <X size={20} />
        </button>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <Loader2 className="animate-spin" size={36} color="var(--accent-terracotta)" style={{ margin: '0 auto 16px' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
              Preparing Active Retrieval Diagnostic...
            </p>
          </div>
        ) : error && !result ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <AlertCircle size={40} color="var(--state-decay)" style={{ margin: '0 auto 12px' }} />
            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>
              Unable to Load Diagnostic
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
              {error}
            </p>
            <button onClick={onClose} className="btn btn-secondary">
              Close
            </button>
          </div>
        ) : result ? (
          /* Results View */
          <div>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  backgroundColor: result.isPassing ? 'var(--state-retained-bg, #ecfdf5)' : 'var(--state-decay-bg, #fff1f2)',
                  color: result.isPassing ? 'var(--state-retained, #059669)' : 'var(--state-decay, #e11d48)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                }}
              >
                {result.isPassing ? <Award size={36} /> : <AlertCircle size={36} />}
              </div>

              <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '6px' }}>
                {result.isPassing ? 'Active Retrieval Passed!' : 'Retrieval Incomplete — Needs Review'}
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                Evaluated {result.correctCount} of {result.totalQuestions} questions correctly ({result.scorePercentage}%).
              </p>
            </div>

            {/* Performance Summary Metrics */}
            <div
              style={{
                padding: '16px',
                backgroundColor: 'var(--bg-canvas)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                marginBottom: '24px',
                display: 'flex',
                justifyContent: 'space-around',
                textAlign: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Topic Status
                </div>
                <div style={{ fontSize: '16px', fontWeight: 800, marginTop: '2px' }}>
                  {result.topicStatus}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Mastery Score
                </div>
                <div style={{ fontSize: '16px', fontWeight: 800, marginTop: '2px', color: 'var(--accent-terracotta)' }}>
                  {result.masteryScore}%
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Memory Stability
                </div>
                <div style={{ fontSize: '16px', fontWeight: 800, marginTop: '2px' }}>
                  {result.stabilityDays}d
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Next Interval
                </div>
                <div style={{ fontSize: '16px', fontWeight: 800, marginTop: '2px', color: result.isPassing ? 'var(--state-retained, #059669)' : 'var(--state-decay, #e11d48)' }}>
                  +{result.nextIntervalDays} {result.nextIntervalDays === 1 ? 'Day' : 'Days'}
                </div>
              </div>
            </div>

            {/* Invariant Explanation Banner */}
            <div
              style={{
                padding: '12px 16px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: result.isPassing ? 'rgba(5, 150, 105, 0.08)' : 'rgba(225, 29, 72, 0.08)',
                border: `1px solid ${result.isPassing ? 'rgba(5, 150, 105, 0.2)' : 'rgba(225, 29, 72, 0.2)'}`,
                fontSize: '13px',
                color: 'var(--text-secondary)',
                marginBottom: '24px',
              }}
            >
              {result.isPassing ? (
                <span>
                  Memory consolidation verified. Target interval successfully advanced. Next scheduled review on{' '}
                  <strong>
                    {result.nextRevision?.scheduledDate
                      ? new Date(result.nextRevision.scheduledDate).toLocaleDateString()
                      : result.nextDueDate
                      ? new Date(result.nextDueDate).toLocaleDateString()
                      : 'next interval'}
                  </strong>
                  .
                </span>
              ) : (
                <span>
                  Active retrieval threshold (≥ 2/3) not met. Per 2-4-7 spacing invariant, interval was NOT advanced. Retry
                  scheduled for tomorrow (+1 day). Stability halved to <strong>{result.stabilityDays}d</strong>.
                </span>
              )}
            </div>

            {/* Question Breakdown with Explanations */}
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px', color: 'var(--text-primary)' }}>
                Diagnostic Review & Invariant Feedback
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {(result.evaluations || []).map((evalItem, idx) => (
                  <div
                    key={evalItem.questionId || idx}
                    style={{
                      padding: '14px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--bg-canvas)',
                      border: `1px solid ${evalItem.isCorrect ? 'var(--state-retained, #059669)' : 'var(--state-decay, #e11d48)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                        Question {idx + 1} • {evalItem.type}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 700, color: evalItem.isCorrect ? 'var(--state-retained, #059669)' : 'var(--state-decay, #e11d48)' }}>
                        {evalItem.isCorrect ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                        <span>{evalItem.isCorrect ? 'Correct' : 'Incorrect'}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: '13px', marginBottom: '4px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Your Answer: </span>
                      <strong>{formatAnswerDisplay(evalItem, 'user', questions)}</strong>
                    </div>
                    {!evalItem.isCorrect && formatAnswerDisplay(evalItem, 'expected', questions) && (
                      <div style={{ fontSize: '13px', marginBottom: '4px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Expected Answer: </span>
                        <strong style={{ color: 'var(--state-retained, #059669)' }}>{formatAnswerDisplay(evalItem, 'expected', questions)}</strong>
                      </div>
                    )}
                    {evalItem.explanation && (
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.5 }}>
                        {evalItem.explanation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => {
                onCompleted();
                onClose();
              }}
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px', fontWeight: 700 }}
            >
              Continue
            </button>
          </div>
        ) : questions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <AlertCircle size={40} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>
              No Diagnostic Questions Available
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
              This revision schedule has no questions configured.
            </p>
            <button onClick={onClose} className="btn btn-secondary">
              Close
            </button>
          </div>
        ) : (
          /* Active Retrieval Diagnostic View */
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <RotateCcw size={18} color="var(--accent-terracotta)" />
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--accent-terracotta)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Spaced Recall Diagnostic (2-4-7 Rule)
              </span>
            </div>

            <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '4px' }}>
              {revision.topicId?.name || topicInfo?.name || (revision as any).topic?.name || 'Topic Revision'}
            </h2>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
              Target Interval: {revision.targetIntervalIndex} • Stability: {revision.topicId?.stabilityDays ?? topicInfo?.stabilityDays ?? 1}d • Active Evidence Mode
            </div>

            {/* Questions Container */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '24px' }}>
              {questions.map((q, idx) => (
                <div
                  key={q.questionId}
                  style={{
                    backgroundColor: 'var(--bg-canvas)',
                    borderRadius: 'var(--radius-md)',
                    padding: '20px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-terracotta)', textTransform: 'uppercase' }}>
                      Question {idx + 1} of {questions.length}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        fontWeight: 600,
                        color: 'var(--text-muted)',
                      }}
                    >
                      {q.type}
                    </span>
                  </div>

                  <p style={{ fontSize: '15px', color: 'var(--text-primary)', fontWeight: 600, lineHeight: 1.5, marginBottom: '12px' }}>
                    {q.prompt}
                  </p>

                  {/* Code snippet display */}
                  {(q.codeSnippet || q.buggyCode) && (
                    <pre
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        padding: '12px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '13px',
                        overflowX: 'auto',
                        marginBottom: '16px',
                        fontFamily: 'monospace',
                      }}
                    >
                      <code>{q.codeSnippet || q.buggyCode}</code>
                    </pre>
                  )}

                  {/* Question inputs based on type */}
                  {q.type === 'TRUE_FALSE' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      {[true, false].map((val) => {
                        const label = val ? 'True' : 'False';
                        const isSelected = answers[q.questionId] === val;
                        return (
                          <button
                            key={label}
                            type="button"
                            onClick={() => handleSelectAnswer(q.questionId, val)}
                            className={isSelected ? 'btn btn-primary' : 'btn btn-secondary'}
                            style={{ padding: '10px', fontWeight: 600 }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  ) : q.type === 'MCQ' && q.options && q.options.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {q.options.map((opt: any, optIdx: number) => {
                        const optId = typeof opt === 'string' ? opt : opt.optionId;
                        const optText = typeof opt === 'string' ? opt : opt.text;
                        const isSelected = answers[q.questionId] === optId;
                        return (
                          <div
                            key={optId || optIdx}
                            onClick={() => handleSelectAnswer(q.questionId, optId)}
                            style={{
                              padding: '12px 14px',
                              borderRadius: 'var(--radius-sm)',
                              border: `1px solid ${isSelected ? 'var(--accent-terracotta)' : 'var(--border-subtle)'}`,
                              backgroundColor: isSelected ? 'rgba(194, 65, 12, 0.08)' : 'var(--bg-surface)',
                              cursor: 'pointer',
                              fontSize: '14px',
                              color: 'var(--text-primary)',
                              transition: 'all 0.15s ease',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                            }}
                          >
                            <input
                              type="radio"
                              name={`question-${q.questionId}`}
                              checked={isSelected}
                              onChange={() => handleSelectAnswer(q.questionId, optId)}
                              onClick={(e) => e.stopPropagation()}
                              style={{ cursor: 'pointer' }}
                            />
                            <span>{optText}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : q.type === 'DEBUGGING' && q.debuggingOptions && q.debuggingOptions.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                        Select the corrective fix:
                      </div>
                      {q.debuggingOptions.map((fix, fixIdx) => {
                        const isSelected = answers[q.questionId] === fix.fixId;
                        return (
                          <div
                            key={fix.fixId || fixIdx}
                            onClick={() => handleSelectAnswer(q.questionId, fix.fixId)}
                            style={{
                              padding: '12px 14px',
                              borderRadius: 'var(--radius-sm)',
                              border: `1px solid ${isSelected ? 'var(--accent-terracotta)' : 'var(--border-subtle)'}`,
                              backgroundColor: isSelected ? 'rgba(194, 65, 12, 0.08)' : 'var(--bg-surface)',
                              cursor: 'pointer',
                              fontSize: '14px',
                              color: 'var(--text-primary)',
                              transition: 'all 0.15s ease',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                            }}
                          >
                            <input
                              type="radio"
                              name={`question-${q.questionId}`}
                              checked={isSelected}
                              onChange={() => handleSelectAnswer(q.questionId, fix.fixId)}
                              onClick={(e) => e.stopPropagation()}
                              style={{ cursor: 'pointer' }}
                            />
                            <span>{fix.description}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : q.type === 'COMPLEXITY' ? (
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        Select canonical complexity:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {CANONICAL_COMPLEXITIES.map((comp) => {
                          const isSelected = answers[q.questionId] === comp;
                          return (
                            <button
                              key={comp}
                              type="button"
                              onClick={() => handleSelectAnswer(q.questionId, comp)}
                              className={isSelected ? 'btn btn-primary' : 'btn btn-secondary'}
                              style={{
                                padding: '8px 16px',
                                fontSize: '13px',
                                fontWeight: 700,
                                fontFamily: 'monospace',
                              }}
                            >
                              {comp}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : q.type === 'STRUCTURED_CONCEPTUAL' && q.assertions && q.assertions.length > 0 ? (
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        Select all fundamental invariants that must hold true:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {q.assertions.map((ast, astIdx) => {
                          const selectedList: string[] = Array.isArray(answers[q.questionId]) ? answers[q.questionId] : [];
                          const isSelected = selectedList.includes(ast.assertionId);
                          return (
                            <div
                              key={ast.assertionId || astIdx}
                              onClick={() => handleToggleAssertion(q.questionId, ast.assertionId)}
                              style={{
                                padding: '12px 14px',
                                borderRadius: 'var(--radius-sm)',
                                border: `1px solid ${isSelected ? 'var(--accent-terracotta)' : 'var(--border-subtle)'}`,
                                backgroundColor: isSelected ? 'rgba(194, 65, 12, 0.08)' : 'var(--bg-surface)',
                                cursor: 'pointer',
                                fontSize: '14px',
                                color: 'var(--text-primary)',
                                transition: 'all 0.15s ease',
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '10px',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleAssertion(q.questionId, ast.assertionId)}
                                onClick={(e) => e.stopPropagation()}
                                style={{ marginTop: '2px', cursor: 'pointer' }}
                              />
                              <span style={{ lineHeight: 1.4 }}>{ast.text}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <input
                        type="text"
                        placeholder="Type your answer here..."
                        value={answers[q.questionId] || ''}
                        onChange={(e) => handleSelectAnswer(q.questionId, e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px 14px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-subtle)',
                          backgroundColor: 'var(--bg-surface)',
                          fontSize: '14px',
                          color: 'var(--text-primary)',
                          outline: 'none',
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Optional Recall Confidence Rating */}
            <div
              style={{
                padding: '14px 16px',
                backgroundColor: 'var(--bg-canvas)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                marginBottom: '20px',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Self-Calibrated Recall Confidence (1 = Low Recall, 5 = Instant Retrieval):
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
                {[1, 2, 3, 4, 5].map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setRecallRating(lvl)}
                    className={recallRating === lvl ? 'btn btn-primary' : 'btn btn-secondary'}
                    style={{ padding: '8px 4px', fontSize: '12px', fontWeight: 700 }}
                  >
                    Level {lvl}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(225, 29, 72, 0.1)',
                  color: 'var(--state-decay, #e11d48)',
                  fontSize: '13px',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting || !isFormComplete}
              className="btn btn-primary"
              style={{
                width: '100%',
                padding: '14px',
                fontSize: '15px',
                fontWeight: 700,
                opacity: !isFormComplete || submitting ? 0.6 : 1,
                cursor: !isFormComplete || submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Evaluating Diagnostic...' : isFormComplete ? 'Submit Diagnostic Evidence' : 'Answer All Questions to Submit'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
