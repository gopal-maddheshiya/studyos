import { useState, useEffect } from 'react';
import { RotateCcw, CheckCircle2, ArrowRight } from 'lucide-react';
import { api } from '../api/client.js';
import type { IRevisionSchedule } from '../api/types.js';

interface RevisionsPageProps {
  onOpenRevision: (revision: IRevisionSchedule) => void;
}

export const RevisionsPage: React.FC<RevisionsPageProps> = ({ onOpenRevision }) => {
  const [revisions, setRevisions] = useState<IRevisionSchedule[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    api.getDueRevisions()
      .then((res) => {
        setRevisions(res.revisions);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <RotateCcw size={20} color="var(--accent-terracotta)" />
          <h1 style={{ fontSize: '28px', fontWeight: 800 }}>Spaced Revision Engine</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>
          Configured with the <strong>2-4-7 Spaced Repetition Cadence</strong>. Revision requires active recall challenge, not simple checkbox marking.
        </p>
      </div>

      {/* Cadence Information Card */}
      <div
        className="card"
        style={{
          marginBottom: '28px',
          backgroundColor: 'var(--bg-surface)',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '16px',
        }}
      >
        <div style={{ borderRight: '1px solid var(--border-subtle)', paddingRight: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Day 0
          </div>
          <div style={{ fontSize: '16px', fontWeight: 800, marginTop: '2px' }}>Initial Study</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Diagnostic Quiz passed
          </div>
        </div>

        <div style={{ borderRight: '1px solid var(--border-subtle)', paddingRight: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-terracotta)', textTransform: 'uppercase' }}>
            Day 2 (+2d)
          </div>
          <div style={{ fontSize: '16px', fontWeight: 800, marginTop: '2px' }}>First Recall</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Halts initial decay
          </div>
        </div>

        <div style={{ borderRight: '1px solid var(--border-subtle)', paddingRight: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--state-assessed)', textTransform: 'uppercase' }}>
            Day 6 (+4d)
          </div>
          <div style={{ fontSize: '16px', fontWeight: 800, marginTop: '2px' }}>Second Recall</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Promotes to RETAINED
          </div>
        </div>

        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--state-retained)', textTransform: 'uppercase' }}>
            Day 13 (+7d)
          </div>
          <div style={{ fontSize: '16px', fontWeight: 800, marginTop: '2px' }}>Consolidation</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Permanence encoding
          </div>
        </div>
      </div>

      {/* Due Revisions Queue */}
      <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '16px' }}>
        Due & Overdue Reviews ({revisions.length})
      </h2>

      {revisions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
          <CheckCircle2 size={36} color="var(--state-retained)" style={{ margin: '0 auto 12px' }} />
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
            No Revisions Pending Today
          </h3>
          <p style={{ fontSize: '14px', marginTop: '4px' }}>
            Your memory stability factor across all topics is optimal.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {revisions.map((rev) => (
            <div
              key={rev._id}
              className="card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '20px 24px',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                  <span className={`badge badge-${rev.topicId?.lifecycleStatus}`}>
                    {rev.topicId?.lifecycleStatus}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Stability: {rev.topicId?.stabilityDays}d • Mastery: {rev.topicId?.masteryScore}%
                  </span>
                </div>
                <h3 style={{ fontSize: '18px', fontWeight: 800 }}>{rev.topicId?.name}</h3>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Scheduled: Interval {rev.targetIntervalIndex} of 2-4-7 sequence
                </div>
              </div>

              <button
                onClick={() => onOpenRevision(rev)}
                className="btn btn-primary"
                style={{ padding: '10px 18px' }}
              >
                <span>Launch Recall Challenge</span>
                <ArrowRight size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
