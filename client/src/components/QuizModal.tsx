import { useState, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, ArrowRight, Sparkles } from 'lucide-react';
import confetti from 'canvas-confetti';
import { api } from '../api/client.js';
import type { IQuiz } from '../api/types.js';

interface QuizModalProps {
  topicId: string;
  topicName: string;
  onClose: () => void;
  onCompleted: () => void;
}

export const QuizModal: React.FC<QuizModalProps> = ({
  topicId,
  topicName,
  onClose,
  onCompleted,
}) => {
  const [quiz, setQuiz] = useState<IQuiz | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [result, setResult] = useState<any | null>(null);

  useEffect(() => {
    let mounted = true;
    api.generateQuiz(topicId)
      .then((res) => {
        if (mounted) {
          setQuiz(res.quiz);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error(err);
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [topicId]);

  const handleSelectOption = (questionId: string, option: string) => {
    setSelectedAnswers((prev) => ({ ...prev, [questionId]: option }));
  };

  const handleSubmit = async () => {
    if (!quiz) return;
    setSubmitting(true);
    try {
      const answersPayload = quiz.questions.map((q) => ({
        questionId: q.questionId,
        userAnswer: selectedAnswers[q.questionId] || '',
        timeSpentSeconds: 30,
      }));

      const res = await api.submitQuiz(quiz._id, answersPayload);
      setResult(res);

      if (res.scorePercentage >= 70) {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#C25E3E', '#4D7C0F', '#D97706'],
        });
      }
    } catch (err) {
      console.error(err);
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
            top: '24px',
            right: '24px',
            background: 'none',
            color: 'var(--text-muted)',
          }}
        >
          <X size={20} />
        </button>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <Sparkles size={32} color="var(--accent-terracotta)" style={{ animation: 'spin 2s linear infinite', marginBottom: '12px' }} />
            <h3 style={{ fontSize: '18px', fontWeight: 700 }}>Synthesizing Diagnostic Questions...</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: '6px' }}>
              Formulating edge cases, invariants, and debugging challenges for {topicName}.
            </p>
          </div>
        ) : result ? (
          /* Results View */
          <div>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  backgroundColor: result.scorePercentage >= 70 ? 'var(--state-retained-bg)' : 'var(--state-learning-bg)',
                  color: result.scorePercentage >= 70 ? 'var(--state-retained)' : 'var(--state-learning)',
                  marginBottom: '16px',
                }}
              >
                {result.scorePercentage >= 70 ? <CheckCircle size={36} /> : <AlertCircle size={36} />}
              </div>
              <h2 style={{ fontSize: '24px', fontWeight: 800 }}>
                {result.scorePercentage >= 70 ? 'Assessment Cleared!' : 'Evidence Ingested — Weak Areas Identified'}
              </h2>
              <div style={{ fontSize: '15px', color: 'var(--text-secondary)', marginTop: '6px' }}>
                Score: <strong>{result.scorePercentage}%</strong> ({result.correctCount} of {result.totalQuestions} correct)
              </div>
            </div>

            {/* Lifecycle Impact Banner */}
            <div
              style={{
                padding: '16px 20px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--bg-canvas)',
                border: '1px solid var(--border-subtle)',
                marginBottom: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Topic Evidence Status
                </div>
                <div style={{ fontSize: '16px', fontWeight: 800, marginTop: '2px' }}>
                  {result.topicStatus} (Mastery: {result.masteryScore}%)
                </div>
              </div>

              {result.scheduledRevision && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-terracotta)', textTransform: 'uppercase' }}>
                    Spaced Revision 1 Scheduled
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Due in 2 Days (2-4-7 Rule)
                  </div>
                </div>
              )}
            </div>

            {/* Mistakes routed to Mistake Bank */}
            {result.newMistakesCount > 0 && (
              <div
                style={{
                  padding: '14px 18px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--accent-terracotta-subtle)',
                  border: '1px solid rgba(194, 94, 62, 0.2)',
                  marginBottom: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <AlertCircle size={20} color="var(--accent-terracotta)" />
                <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                  <strong>{result.newMistakesCount} question(s)</strong> failed and automatically routed to your <strong>Mistake Vault</strong> for targeted re-testing.
                </div>
              </div>
            )}

            <button
              onClick={() => {
                onCompleted();
                onClose();
              }}
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px' }}
            >
              Return to Concept Lab
            </button>
          </div>
        ) : quiz && quiz.questions.length > 0 ? (
          /* Step-by-step Question View */
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span className="badge badge-LEARNING">
                Question {currentIndex + 1} of {quiz.questions.length} • {quiz.questions[currentIndex].type}
              </span>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                {topicName}
              </span>
            </div>

            {/* Stepper Progress Bar */}
            <div className="progress-bar-bg" style={{ marginBottom: '24px' }}>
              <div
                className="progress-bar-fill"
                style={{ width: `${((currentIndex + 1) / quiz.questions.length) * 100}%` }}
              />
            </div>

            {/* Question Prompt */}
            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px', lineHeight: 1.4 }}>
              {quiz.questions[currentIndex].prompt}
            </h3>

            {/* Code Snippet Box (for Debugging & Output Prediction) */}
            {quiz.questions[currentIndex].codeSnippet && (
              <pre
                style={{
                  backgroundColor: '#1E1B18',
                  color: '#F5F5F4',
                  padding: '16px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '13px',
                  overflowX: 'auto',
                  marginBottom: '20px',
                  lineHeight: 1.5,
                }}
              >
                <code>{quiz.questions[currentIndex].codeSnippet}</code>
              </pre>
            )}

            {/* Options */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '28px' }}>
              {quiz.questions[currentIndex].options?.map((option, idx) => {
                const qId = quiz.questions[currentIndex].questionId;
                const isSelected = selectedAnswers[qId] === option;

                return (
                  <button
                    key={idx}
                    onClick={() => handleSelectOption(qId, option)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '14px 18px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: isSelected ? 'var(--accent-terracotta-subtle)' : 'var(--bg-canvas)',
                      border: `1.5px solid ${isSelected ? 'var(--accent-terracotta)' : 'var(--border-subtle)'}`,
                      textAlign: 'left',
                      fontSize: '14px',
                      fontWeight: isSelected ? 600 : 400,
                      color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        border: `1.5px solid ${isSelected ? 'var(--accent-terracotta)' : 'var(--border-strong)'}`,
                        backgroundColor: isSelected ? 'var(--accent-terracotta)' : 'transparent',
                        color: isSelected ? '#FFFFFF' : 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span>{option}</span>
                  </button>
                );
              })}
            </div>

            {/* Navigation Buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                disabled={currentIndex === 0}
                className="btn btn-secondary"
                style={{ visibility: currentIndex === 0 ? 'hidden' : 'visible' }}
              >
                Previous
              </button>

              {currentIndex < quiz.questions.length - 1 ? (
                <button
                  onClick={() => setCurrentIndex((i) => i + 1)}
                  disabled={!selectedAnswers[quiz.questions[currentIndex].questionId]}
                  className="btn btn-primary"
                >
                  <span>Next Question</span>
                  <ArrowRight size={16} />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !selectedAnswers[quiz.questions[currentIndex].questionId]}
                  className="btn btn-primary"
                >
                  <CheckCircle size={16} />
                  <span>{submitting ? 'Submitting & Scoring...' : 'Submit Answers'}</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '32px' }}>
            <p style={{ color: 'var(--text-muted)' }}>Could not load quiz at this moment.</p>
          </div>
        )}
      </div>
    </div>
  );
};
