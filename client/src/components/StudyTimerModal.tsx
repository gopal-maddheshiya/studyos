import React, { useState, useEffect } from 'react';
import { Play, Pause, CheckCircle2, Clock, X, Sparkles } from 'lucide-react';
import { api } from '../api/client.js';

interface StudyTimerModalProps {
  topicId: string;
  topicName: string;
  onClose: () => void;
  onFinish: (result: { promptQuiz: boolean; topicId: string }) => void;
}

export const StudyTimerModal: React.FC<StudyTimerModalProps> = ({
  topicId,
  topicName,
  onClose,
  onFinish,
}) => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [seconds, setSeconds] = useState<number>(0);
  const [isActive, setIsActive] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>('');

  // 1. Initialize session on backend
  useEffect(() => {
    let mounted = true;
    api.startSession(topicId).then((res) => {
      if (mounted) setSessionId(res.sessionId);
    }).catch(console.error);

    return () => {
      mounted = false;
    };
  }, [topicId]);

  // 2. Local Timer & 60s Heartbeat
  useEffect(() => {
    let interval: any = null;
    if (isActive) {
      interval = setInterval(() => {
        setSeconds((s) => {
          const nextSec = s + 1;
          // Send active focus heartbeat every 60s
          if (nextSec % 60 === 0 && sessionId) {
            api.sendHeartbeat(sessionId).catch(console.error);
          }
          return nextSec;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isActive, sessionId]);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleFinish = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await api.finishSession(sessionId, notes);
      onFinish({ promptQuiz: res.promptQuiz, topicId });
    } catch (err) {
      console.error(err);
      onFinish({ promptQuiz: true, topicId });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(28, 25, 23, 0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: '16px',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '460px',
          backgroundColor: 'var(--bg-surface)',
          padding: '28px',
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <Clock size={18} color="var(--accent-terracotta)" />
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-terracotta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Active Focus Session
          </span>
        </div>

        <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '20px' }}>
          {topicName}
        </h2>

        {/* Big Stopwatch Display */}
        <div
          style={{
            backgroundColor: 'var(--bg-canvas)',
            borderRadius: 'var(--radius-md)',
            padding: '28px',
            textAlign: 'center',
            marginBottom: '20px',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '48px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              letterSpacing: '-0.03em',
            }}
          >
            {formatTime(seconds)}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {isActive ? 'Heartbeat verified active focus' : 'Session paused'}
          </div>
        </div>

        {/* Session Note */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
            Quick Session Takeaway (Optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What core invariant or pattern did you focus on today?"
            rows={2}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              fontFamily: 'inherit',
              fontSize: '14px',
              resize: 'none',
              outline: 'none',
              backgroundColor: 'var(--bg-canvas)',
            }}
          />
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => setIsActive(!isActive)}
            className="btn btn-secondary"
            style={{ flex: 1 }}
          >
            {isActive ? <Pause size={16} /> : <Play size={16} />}
            <span>{isActive ? 'Pause' : 'Resume'}</span>
          </button>

          <button
            onClick={handleFinish}
            disabled={loading}
            className="btn btn-primary"
            style={{ flex: 2 }}
          >
            <CheckCircle2 size={16} />
            <span>{loading ? 'Recording Evidence...' : 'Finish & Assess'}</span>
          </button>
        </div>

        <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)', justifyContent: 'center' }}>
          <Sparkles size={14} color="var(--accent-terracotta)" />
          <span>Finishing triggers a diagnostic quiz to lock in comprehension evidence.</span>
        </div>
      </div>
    </div>
  );
};
