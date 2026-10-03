import { useState, useEffect } from 'react';
import { Calendar, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client.js';
import type { IScheduledStudyBlock } from '../api/types.js';

export const TimetablePage: React.FC = () => {
  const [dailyData, setDailyData] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const loadTimetable = async () => {
    try {
      const data = await api.getDailyPlan();
      setDailyData(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTimetable();
  }, []);

  const handleBlockAction = async (blockId: string, status: string) => {
    try {
      await api.updateStudyBlock(blockId, { status });
      await loadTimetable();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <Calendar size={20} color="var(--accent-terracotta)" />
          <h1 style={{ fontSize: '28px', fontWeight: 800 }}>Adaptive Timetable</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>
          Dynamic execution queue calibrated against recurring routines, overdue revisions, and real-time behavior.
        </p>
      </div>

      {/* Missed Blocks Prompt (Flexible Strategy) */}
      {dailyData?.missedBlocks?.length > 0 && (
        <div
          className="card"
          style={{
            backgroundColor: 'var(--state-learning-bg)',
            border: '1px solid rgba(217, 119, 6, 0.3)',
            marginBottom: '28px',
            padding: '20px 24px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <AlertTriangle size={18} color="var(--state-learning)" />
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#92400E' }}>
              Missed Study Block Detected
            </h3>
          </div>
          <p style={{ fontSize: '14px', color: '#78350F', marginBottom: '14px' }}>
            You had a planned block for <strong>{dailyData.missedBlocks[0].name}</strong> ({dailyData.missedBlocks[0].plannedMinutes}m) that was unfulfilled. How would you like StudyOS to handle this?
          </p>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => handleBlockAction(dailyData.missedBlocks[0]._id, 'RESCHEDULED')}
              className="btn btn-primary"
              style={{ fontSize: '13px' }}
            >
              <span>Reschedule to Next Available Slot</span>
            </button>
            <button
              onClick={() => handleBlockAction(dailyData.missedBlocks[0]._id, 'SKIPPED')}
              className="btn btn-secondary"
              style={{ fontSize: '13px' }}
            >
              <span>Drop Block (Don't Carry Over)</span>
            </button>
          </div>
        </div>
      )}

      {/* Plan vs Reality Progress Bar */}
      {dailyData?.planVsReality && (
        <div className="card" style={{ marginBottom: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 800 }}>Today's Plan vs. Reality</h3>
            <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--accent-terracotta)' }}>
              {dailyData.planVsReality.actualMinutes}m Actual / {dailyData.planVsReality.plannedMinutes}m Planned ({dailyData.planVsReality.adherenceRatio}%)
            </span>
          </div>

          <div className="progress-bar-bg" style={{ height: '8px' }}>
            <div
              className="progress-bar-fill"
              style={{ width: `${Math.min(100, dailyData.planVsReality.adherenceRatio)}%` }}
            />
          </div>
        </div>
      )}

      {/* Today's Allocated Blocks */}
      <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '16px' }}>
        Today's Schedule ({dailyData?.blocks?.length || 0} Blocks)
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '36px' }}>
        {dailyData?.blocks?.map((block: IScheduledStudyBlock) => (
          <div
            key={block._id}
            className="card"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '18px 24px',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, color: 'var(--accent-terracotta)' }}>
                  {block.startTime} - {block.endTime}
                </span>
                <span className="badge badge-NOT_STARTED" style={{ fontSize: '11px' }}>
                  {block.type}
                </span>
                <span className={`badge badge-${block.status}`} style={{ fontSize: '11px' }}>
                  {block.status}
                </span>
              </div>
              <h3 style={{ fontSize: '17px', fontWeight: 800 }}>{block.name}</h3>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Planned: {block.plannedMinutes}m • Logged Active: {block.activeFocusMinutes}m
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              {block.status === 'SCHEDULED' && (
                <button
                  onClick={() => handleBlockAction(block._id, 'COMPLETED')}
                  className="btn btn-secondary"
                  style={{ fontSize: '12px' }}
                >
                  <CheckCircle2 size={14} color="var(--state-retained)" />
                  <span>Mark Done</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Routine Archetype Reference */}
      <div className="card">
        <h3 style={{ fontSize: '16px', fontWeight: 800, marginBottom: '12px' }}>
          Weekly Routine Blueprint (Template)
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px', fontSize: '13px' }}>
          <div style={{ padding: '12px', backgroundColor: 'var(--bg-canvas)', borderRadius: 'var(--radius-sm)' }}>
            <strong>Monday – Friday:</strong>
            <ul style={{ paddingLeft: '18px', marginTop: '4px', color: 'var(--text-secondary)' }}>
              <li>Morning (07:00 - 09:30): DSA & Spaced Recall</li>
              <li>Evening (18:00 - 20:30): Full-Stack Dev / Systems</li>
            </ul>
          </div>
          <div style={{ padding: '12px', backgroundColor: 'var(--bg-canvas)', borderRadius: 'var(--radius-sm)' }}>
            <strong>Saturday & Sunday:</strong>
            <ul style={{ paddingLeft: '18px', marginTop: '4px', color: 'var(--text-secondary)' }}>
              <li>Saturday: Core Project Development Sprint (5h)</li>
              <li>Sunday: Weekly Contest & Mistake Bank Clearance (4h)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
