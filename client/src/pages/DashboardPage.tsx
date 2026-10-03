import { useState, useEffect } from 'react';
import {
  Sparkles,
  RotateCcw,
  Play,
  CheckCircle2,
  Calendar,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';
import { api } from '../api/client.js';
import type { IRevisionSchedule, IScheduledStudyBlock } from '../api/types.js';

interface DashboardPageProps {
  onStartSession: (topicId: string, topicName: string) => void;
  onOpenRevision: (revision: IRevisionSchedule) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  onStartSession,
  onOpenRevision,
}) => {
  const [revisions, setRevisions] = useState<IRevisionSchedule[]>([]);
  const [dailyPlan, setDailyPlan] = useState<any | null>(null);
  const [analytics, setAnalytics] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [seeding, setSeeding] = useState<boolean>(false);

  const loadData = async () => {
    try {
      const [revData, planData, anaData] = await Promise.all([
        api.getDueRevisions().catch(() => ({ revisions: [], count: 0 })),
        api.getDailyPlan().catch(() => null),
        api.getAnalytics().catch(() => null),
      ]);

      setRevisions(revData.revisions);
      setDailyPlan(planData);
      setAnalytics(anaData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await api.seedStarterData();
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Top Welcome Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.03em' }}>
            Mission Control
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '15px', marginTop: '4px' }}>
            "Learning progress must be based on evidence, not manual checkboxes."
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="btn btn-secondary"
            style={{ fontSize: '13px' }}
          >
            <Sparkles size={15} color="var(--accent-terracotta)" />
            <span>{seeding ? 'Seeding Data...' : 'Seed Starter DSA Curricula'}</span>
          </button>
        </div>
      </div>

      {/* Hero: "What Should I Study Today?" Dynamic Allocator */}
      <div
        className="card"
        style={{
          backgroundColor: '#FFFFFF',
          border: '1.5px solid var(--accent-terracotta)',
          padding: '28px',
          marginBottom: '32px',
          boxShadow: 'var(--shadow-md)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '4px',
            height: '100%',
            backgroundColor: 'var(--accent-terracotta)',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span className="badge badge-LEARNING">Recommended Focus</span>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Based on memory decay risk & planned timetable block
              </span>
            </div>

            <h2 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '6px' }}>
              {dailyPlan?.blocks?.[0]?.allocatedTopicId?.name || 'Binary Search & Monotonic Space'}
            </h2>

            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '640px' }}>
              Priority allocation: scheduled for <strong>{dailyPlan?.blocks?.[0]?.plannedMinutes || 60} mins</strong>.
              Log an active focus session to unlock your post-study diagnostic quiz and advance lifecycle mastery.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => {
                const topicId = dailyPlan?.blocks?.[0]?.allocatedTopicId?._id || '670000000000000000000010';
                const topicName = dailyPlan?.blocks?.[0]?.allocatedTopicId?.name || 'Binary Search & Monotonic Space';
                onStartSession(topicId, topicName);
              }}
              className="btn btn-primary"
              style={{ padding: '12px 24px', fontSize: '15px' }}
            >
              <Play size={18} fill="currentColor" />
              <span>Launch Focus Session</span>
            </button>
          </div>
        </div>

        {/* Plan vs Reality Bar for Today */}
        {dailyPlan?.planVsReality && (
          <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
              <span>Today's Execution: {dailyPlan.planVsReality.actualMinutes}m / {dailyPlan.planVsReality.plannedMinutes}m planned</span>
              <span style={{ color: 'var(--accent-terracotta)' }}>{dailyPlan.planVsReality.adherenceRatio}% Adherence</span>
            </div>
            <div className="progress-bar-bg">
              <div
                className="progress-bar-fill"
                style={{ width: `${Math.min(100, dailyPlan.planVsReality.adherenceRatio)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Grid: Due Spaced Revisions & Timetable Timeline */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px', marginBottom: '32px' }}>
        {/* Due Spaced Revisions */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <RotateCcw size={18} color="var(--accent-terracotta)" />
              <h3 style={{ fontSize: '17px', fontWeight: 800 }}>Due Spaced Revisions</h3>
            </div>
            <span className="badge badge-LEARNING">{revisions.length} Due</span>
          </div>

          {revisions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)' }}>
              <CheckCircle2 size={32} color="var(--state-retained)" style={{ margin: '0 auto 8px' }} />
              <p style={{ fontSize: '14px', fontWeight: 600 }}>Zero Overdue Revisions</p>
              <p style={{ fontSize: '13px', marginTop: '4px' }}>All memory stability curves are reinforced and healthy.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {revisions.map((rev) => (
                <div
                  key={rev._id}
                  style={{
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-canvas)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '14px' }}>
                      {rev.topicId?.name}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Interval {rev.targetIntervalIndex} (2-4-7 Rule) • Stability: {rev.topicId?.stabilityDays}d
                    </div>
                  </div>

                  <button
                    onClick={() => onOpenRevision(rev)}
                    className="btn btn-outline"
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    <span>Recall Now</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Today's Timetable Routine */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Calendar size={18} color="var(--accent-terracotta)" />
              <h3 style={{ fontSize: '17px', fontWeight: 800 }}>Today's Scheduled Blocks</h3>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
              {dailyPlan?.blocks?.length || 0} Blocks
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {dailyPlan?.blocks?.map((b: IScheduledStudyBlock) => (
              <div
                key={b._id}
                style={{
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-canvas)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 600, color: 'var(--accent-terracotta)' }}>
                      {b.startTime} - {b.endTime}
                    </span>
                    <span className="badge badge-NOT_STARTED" style={{ fontSize: '10px' }}>
                      {b.type}
                    </span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '14px', marginTop: '4px' }}>
                    {b.name}
                  </div>
                </div>

                <div style={{ textAlign: 'right', fontSize: '13px', color: 'var(--text-muted)' }}>
                  {b.plannedMinutes}m
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Trajectory Snippet Banner */}
      {analytics?.trajectory && (
        <div
          className="card"
          style={{
            backgroundColor: 'var(--bg-surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--state-mastered-bg)',
                color: 'var(--state-mastered)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <TrendingUp size={24} />
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                1-Year Trajectory Forecast
              </div>
              <div style={{ fontSize: '16px', fontWeight: 800, marginTop: '2px' }}>
                Projected {analytics.trajectory.projected1YearDisciplined} Topics Mastered at Current Velocity
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {analytics.trajectory.keyLever}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
