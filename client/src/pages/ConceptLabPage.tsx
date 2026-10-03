import { useState, useEffect } from 'react';
import {
  BookOpen,
  Code,
  Brain,
  Play,
  Sparkles,
  Save,
} from 'lucide-react';
import { api } from '../api/client.js';
import type { ISubject, ITopic } from '../api/types.js';

interface ConceptLabPageProps {
  onStartSession: (topicId: string, topicName: string) => void;
  onLaunchQuiz: (topicId: string, topicName: string) => void;
}

export const ConceptLabPage: React.FC<ConceptLabPageProps> = ({
  onStartSession,
  onLaunchQuiz,
}) => {
  const [subjects, setSubjects] = useState<ISubject[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<ITopic | null>(null);
  const [labData, setLabData] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  // Editable fields
  const [notes, setNotes] = useState<string>('');
  const [intuition, setIntuition] = useState<string>('');

  const loadHierarchy = async () => {
    try {
      const res = await api.getSubjects();
      setSubjects(res.subjects);

      if (res.subjects.length > 0 && res.subjects[0].topics.length > 0) {
        selectTopic(res.subjects[0].topics[0]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHierarchy();
  }, []);

  const selectTopic = async (topic: ITopic) => {
    setSelectedTopic(topic);
    try {
      const data = await api.getTopicLab(topic._id);
      setLabData(data);
      setNotes(data.conceptLab?.personalNotes || '');
      setIntuition(data.conceptLab?.intuition || '');
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedTopic) return;
    setSaving(true);
    try {
      await api.updateTopicLab(selectedTopic._id, {
        personalNotes: notes,
        intuition,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Secondary Sidebar: Subjects & Topics Tree */}
      <div
        style={{
          width: '320px',
          borderRight: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-surface)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          padding: '24px 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 800 }}>Knowledge Base</h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {subjects.map((sub) => (
            <div key={sub._id}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  fontWeight: 800,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: '8px',
                  paddingLeft: '8px',
                }}
              >
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: sub.color }} />
                <span>{sub.name}</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {sub.topics.map((t) => {
                  const isSelected = selectedTopic?._id === t._id;
                  return (
                    <button
                      key={t._id}
                      onClick={() => selectTopic(t)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: isSelected ? 'var(--bg-canvas)' : 'transparent',
                        border: `1px solid ${isSelected ? 'var(--border-medium)' : 'transparent'}`,
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span style={{ fontSize: '13px', fontWeight: isSelected ? 700 : 500, color: 'var(--text-primary)' }}>
                        {t.name}
                      </span>
                      <span className={`badge badge-${t.lifecycleStatus}`} style={{ fontSize: '10px' }}>
                        {t.lifecycleStatus}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Workspace Pane: Concept Lab Deep Dive */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 48px', backgroundColor: 'var(--bg-canvas)' }}>
        {selectedTopic ? (
          <div style={{ maxWidth: '960px', margin: '0 auto' }}>
            {/* Top Header Card */}
            <div
              className="card"
              style={{
                marginBottom: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '16px',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                  <span className={`badge badge-${selectedTopic.lifecycleStatus}`}>
                    {selectedTopic.lifecycleStatus}
                  </span>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    Stability: {selectedTopic.stabilityDays}d • {selectedTopic.totalStudyMinutes} mins logged
                  </span>
                </div>
                <h1 style={{ fontSize: '26px', fontWeight: 800 }}>{selectedTopic.name}</h1>
              </div>

              {/* Action CTAs */}
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => onStartSession(selectedTopic._id, selectedTopic.name)}
                  className="btn btn-secondary"
                >
                  <Play size={16} />
                  <span>Start Focus Session</span>
                </button>

                <button
                  onClick={() => onLaunchQuiz(selectedTopic._id, selectedTopic.name)}
                  className="btn btn-primary"
                >
                  <Sparkles size={16} />
                  <span>Diagnostic Quiz</span>
                </button>
              </div>
            </div>

            {/* Evidence Radar / Metrics Breakdown */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '16px',
                marginBottom: '28px',
              }}
            >
              <div className="card" style={{ padding: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Comprehension (25%)
                </div>
                <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '4px', color: 'var(--text-primary)' }}>
                  {labData?.evidence?.breakdown?.comprehension || selectedTopic.comprehensionScore || 0}%
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  AI Quiz accuracy
                </div>
              </div>

              <div className="card" style={{ padding: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Application (35%)
                </div>
                <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '4px', color: 'var(--text-primary)' }}>
                  {labData?.evidence?.breakdown?.application || selectedTopic.applicationScore || 0}%
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Practical code drills
                </div>
              </div>

              <div className="card" style={{ padding: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Retention (30%)
                </div>
                <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '4px', color: 'var(--text-primary)' }}>
                  {labData?.evidence?.breakdown?.retention || selectedTopic.retentionScore || 0}%
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Decay-calibrated recall
                </div>
              </div>

              <div className="card" style={{ padding: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Mastery Index
                </div>
                <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '4px', color: 'var(--accent-terracotta)' }}>
                  {labData?.evidence?.masteryScore || selectedTopic.masteryScore || 0}%
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Evidence weighted
                </div>
              </div>
            </div>

            {/* Core Intuition & Invariants */}
            <div className="card" style={{ marginBottom: '28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <Brain size={18} color="var(--accent-terracotta)" />
                <h3 style={{ fontSize: '17px', fontWeight: 800 }}>Core Intuition & Search Invariant</h3>
              </div>
              <textarea
                value={intuition}
                onChange={(e) => setIntuition(e.target.value)}
                rows={5}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: 'inherit',
                  fontSize: '14px',
                  lineHeight: 1.6,
                  resize: 'vertical',
                  backgroundColor: 'var(--bg-canvas)',
                  outline: 'none',
                }}
              />
            </div>

            {/* Canonical Code Implementation */}
            {labData?.conceptLab?.codeSnippets?.length > 0 && (
              <div className="card" style={{ marginBottom: '28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Code size={18} color="var(--accent-terracotta)" />
                    <h3 style={{ fontSize: '17px', fontWeight: 800 }}>
                      Canonical Code ({labData.conceptLab.codeSnippets[0].language})
                    </h3>
                  </div>
                </div>

                <pre
                  style={{
                    backgroundColor: '#1E1B18',
                    color: '#F5F5F4',
                    padding: '20px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '13px',
                    lineHeight: 1.6,
                    overflowX: 'auto',
                  }}
                >
                  <code>{labData.conceptLab.codeSnippets[0].code}</code>
                </pre>
              </div>
            )}

            {/* Personal Notes Editor */}
            <div className="card" style={{ marginBottom: '28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <BookOpen size={18} color="var(--accent-terracotta)" />
                  <h3 style={{ fontSize: '17px', fontWeight: 800 }}>Personal Insights & Edge Cases</h3>
                </div>

                <button onClick={handleSaveNotes} disabled={saving} className="btn btn-secondary" style={{ fontSize: '12px' }}>
                  <Save size={14} />
                  <span>{saving ? 'Saving...' : 'Save Notes'}</span>
                </button>
              </div>

              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={6}
                placeholder="Record critical edge case failures, off-by-one takeaways, and personal Gotchas..."
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: 'inherit',
                  fontSize: '14px',
                  lineHeight: 1.6,
                  resize: 'vertical',
                  backgroundColor: 'var(--bg-canvas)',
                  outline: 'none',
                }}
              />
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '64px', color: 'var(--text-muted)' }}>
            Select a topic from the left sidebar to enter the Concept Lab.
          </div>
        )}
      </div>
    </div>
  );
};
