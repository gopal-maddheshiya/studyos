import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { api } from '../api/client.js';
import type { IMistake } from '../api/types.js';

export const MistakeVaultPage: React.FC = () => {
  const [mistakes, setMistakes] = useState<IMistake[]>([]);
  const [stats, setStats] = useState<any | null>(null);
  const [selectedRootCause, setSelectedRootCause] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  const loadMistakes = async (rootCause?: string) => {
    try {
      const res = await api.getMistakes({ rootCause: rootCause || undefined });
      setMistakes(res.mistakes);
      setStats(res.stats);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMistakes(selectedRootCause);
  }, [selectedRootCause]);

  const handleDrill = async (mistakeId: string, passed: boolean) => {
    try {
      await api.drillMistake(mistakeId, passed);
      await loadMistakes(selectedRootCause);
    } catch (err) {
      console.error(err);
    }
  };

  const rootCauses = [
    { key: '', label: 'All Causes' },
    { key: 'EDGE_CASE_BLINDNESS', label: 'Edge Case Blindness' },
    { key: 'CONCEPTUAL_GAP', label: 'Conceptual Gap' },
    { key: 'EXECUTION_SLIP', label: 'Execution Slip' },
    { key: 'TIME_COMPLEXITY_EXCEEDED', label: 'Complexity Exceeded' },
  ];

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <AlertTriangle size={20} color="var(--accent-terracotta)" />
          <h1 style={{ fontSize: '28px', fontWeight: 800 }}>The Mistake Vault</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>
          "Mistakes are the highest-signal learning data in existence." Every quiz failure routes here and requires 2 consecutive passed drills to resolve.
        </p>
      </div>

      {/* Stats Counter Bar */}
      <div
        className="card"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '16px',
          marginBottom: '28px',
          textAlign: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Active Flaws
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, marginTop: '2px', color: 'var(--state-decay)' }}>
            {stats?.active || 0}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            On Probation (1 Pass)
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, marginTop: '2px', color: 'var(--state-learning)' }}>
            {stats?.probation || 0}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Liquidated & Resolved
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, marginTop: '2px', color: 'var(--state-mastered)' }}>
            {stats?.resolved || 0}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {rootCauses.map((rc) => (
          <button
            key={rc.key}
            onClick={() => setSelectedRootCause(rc.key)}
            className="btn"
            style={{
              backgroundColor: selectedRootCause === rc.key ? 'var(--accent-terracotta)' : 'var(--bg-surface)',
              color: selectedRootCause === rc.key ? '#FFFFFF' : 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              fontSize: '13px',
              padding: '6px 14px',
            }}
          >
            {rc.label}
          </button>
        ))}
      </div>

      {/* Mistake Entries */}
      {mistakes.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
          <CheckCircle size={36} color="var(--state-retained)" style={{ margin: '0 auto 12px' }} />
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Zero Mistakes Logged in this Category
          </h3>
          <p style={{ fontSize: '14px', marginTop: '4px' }}>
            Diagnostic quizzes and contests automatically capture failed questions here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {mistakes.map((m) => (
            <div key={m._id} className="card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                <div>
                  <span className="badge badge-LEARNING" style={{ marginRight: '8px' }}>
                    {m.rootCause}
                  </span>
                  <span className={`badge badge-${m.status}`}>
                    {m.status} ({m.consecutivePasses}/2 Passes)
                  </span>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Origin: {m.origin}
                </span>
              </div>

              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px', lineHeight: 1.4 }}>
                {m.prompt}
              </h3>

              {m.codeSnippet && (
                <pre
                  style={{
                    backgroundColor: '#1E1B18',
                    color: '#F5F5F4',
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    marginBottom: '14px',
                    overflowX: 'auto',
                  }}
                >
                  <code>{m.codeSnippet}</code>
                </pre>
              )}

              {/* Takeaway Rule Pill */}
              <div
                style={{
                  backgroundColor: 'var(--bg-canvas)',
                  borderLeft: '3px solid var(--accent-terracotta)',
                  padding: '10px 14px',
                  borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  marginBottom: '16px',
                }}
              >
                One-Line Rule: "{m.oneLineRule}"
              </div>

              {/* Drill Re-Test Actions */}
              {m.status !== 'RESOLVED' && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    Re-test yourself: Did you recall this rule correctly?
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => handleDrill(m._id, true)}
                      className="btn btn-secondary"
                      style={{ fontSize: '12px', padding: '6px 12px', color: 'var(--state-retained)' }}
                    >
                      <CheckCircle size={14} />
                      <span>Pass Drill (+1)</span>
                    </button>
                    <button
                      onClick={() => handleDrill(m._id, false)}
                      className="btn btn-secondary"
                      style={{ fontSize: '12px', padding: '6px 12px', color: 'var(--state-decay)' }}
                    >
                      <XCircle size={14} />
                      <span>Fail Drill (Reset)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
