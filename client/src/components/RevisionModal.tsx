import { useState } from 'react';
import { X, RotateCcw, Award, Brain } from 'lucide-react';
import { api } from '../api/client.js';
import type { IRevisionSchedule } from '../api/types.js';

interface RevisionModalProps {
  revision: IRevisionSchedule;
  onClose: () => void;
  onCompleted: () => void;
}

export const RevisionModal: React.FC<RevisionModalProps> = ({
  revision,
  onClose,
  onCompleted,
}) => {
  const [revealed, setRevealed] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [result, setResult] = useState<any | null>(null);

  const handleRate = async (rating: number) => {
    setSubmitting(true);
    // Rating 1 -> 20%, 2 -> 50%, 3 -> 75%, 4 -> 90%, 5 -> 100%
    const scoreMap: Record<number, number> = { 1: 20, 2: 50, 3: 75, 4: 90, 5: 100 };
    const performanceScore = scoreMap[rating] || 75;

    try {
      const res = await api.submitRevision(revision._id, performanceScore, rating);
      setResult(res);
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
          maxWidth: '560px',
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
            color: 'var(--text-muted)',
          }}
        >
          <X size={20} />
        </button>

        {result ? (
          /* Results View */
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                backgroundColor: 'var(--state-retained-bg)',
                color: 'var(--state-retained)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}
            >
              <Award size={32} />
            </div>

            <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '8px' }}>
              Spaced Reinforcement Logged!
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
              Memory stability expanded to <strong>{result.stabilityDays} days</strong>.
            </p>

            <div
              style={{
                padding: '16px',
                backgroundColor: 'var(--bg-canvas)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                marginBottom: '24px',
                display: 'flex',
                justifyContent: 'space-around',
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
                  Next Review
                </div>
                <div style={{ fontSize: '16px', fontWeight: 800, marginTop: '2px' }}>
                  +{result.nextIntervalDays} Days
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                onCompleted();
                onClose();
              }}
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px' }}
            >
              Continue
            </button>
          </div>
        ) : (
          /* Active Recall Challenge View */
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <RotateCcw size={18} color="var(--accent-terracotta)" />
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-terracotta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Spaced Recall Session (2-4-7 Rule)
              </span>
            </div>

            <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '6px' }}>
              {revision.topicId?.name}
            </h2>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '24px' }}>
              Interval {revision.targetIntervalIndex} • Stability {revision.topicId?.stabilityDays}d
            </div>

            {/* Prompt Box */}
            <div
              style={{
                backgroundColor: 'var(--bg-canvas)',
                borderRadius: 'var(--radius-md)',
                padding: '24px',
                border: '1px solid var(--border-subtle)',
                marginBottom: '20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                <Brain size={18} />
                <span style={{ fontWeight: 700, fontSize: '14px' }}>Active Retrieval Challenge:</span>
              </div>
              <p style={{ fontSize: '15px', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                Without looking at notes, mentally state:
              </p>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <li>What is the core predicate or search space invariant?</li>
                <li>What is the standard edge case failure mode (e.g., off-by-one, overflow)?</li>
                <li>What are the worst-case time and space complexities?</li>
              </ul>
            </div>

            {!revealed ? (
              <button
                onClick={() => setRevealed(true)}
                className="btn btn-secondary"
                style={{ width: '100%', padding: '14px', fontSize: '15px', fontWeight: 700 }}
              >
                Reveal Invariants & Verify Recall
              </button>
            ) : (
              <div>
                <div style={{ marginBottom: '16px', fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', textAlign: 'center' }}>
                  Calibrate your retrieval confidence:
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                  <button
                    onClick={() => handleRate(1)}
                    disabled={submitting}
                    className="btn btn-outline"
                    style={{ flexDirection: 'column', padding: '10px 4px', borderColor: 'var(--state-decay)' }}
                  >
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--state-decay)' }}>Blackout</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Reset to Day 1</span>
                  </button>

                  <button
                    onClick={() => handleRate(2)}
                    disabled={submitting}
                    className="btn btn-outline"
                    style={{ flexDirection: 'column', padding: '10px 4px', borderColor: 'var(--state-learning)' }}
                  >
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--state-learning)' }}>Hard</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Struggled</span>
                  </button>

                  <button
                    onClick={() => handleRate(3)}
                    disabled={submitting}
                    className="btn btn-outline"
                    style={{ flexDirection: 'column', padding: '10px 4px', borderColor: 'var(--state-assessed)' }}
                  >
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--state-assessed)' }}>Good</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Recalled</span>
                  </button>

                  <button
                    onClick={() => handleRate(4)}
                    disabled={submitting}
                    className="btn btn-outline"
                    style={{ flexDirection: 'column', padding: '10px 4px', borderColor: 'var(--state-retained)' }}
                  >
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--state-retained)' }}>Easy</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Instant</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
