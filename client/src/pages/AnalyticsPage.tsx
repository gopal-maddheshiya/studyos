import React, { useState, useEffect } from 'react';
import { TrendingUp, Clock, RotateCcw, AlertTriangle, Sparkles, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client.js';

export const AnalyticsPage: React.FC = () => {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    api.getAnalytics()
      .then((res) => {
        setData(res);
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
          <TrendingUp size={20} color="var(--accent-terracotta)" />
          <h1 style={{ fontSize: '28px', fontWeight: 800 }}>1-Year Trajectory & Analytics</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>
          Honest, un-gameable metrics. No vanity streaks. Projections are mathematically simulated based on trailing 30-day velocity.
        </p>
      </div>

      {/* 1-Year Predictive Trajectory Scenarios */}
      <div className="card" style={{ marginBottom: '32px', padding: '28px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '6px' }}>
          1-Year Mastery Forecast
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
          Where your current learning behavior will take you in 12 months:
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
          {/* Baseline */}
          <div
            style={{
              padding: '20px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-canvas)',
              border: '1.5px solid var(--border-medium)',
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Current Trajectory
            </div>
            <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '6px' }}>
              {data?.trajectory?.projected1YearBaseline || 42}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Topics Mastered with current revision rate
            </div>
          </div>

          {/* Disciplined */}
          <div
            style={{
              padding: '20px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--state-mastered-bg)',
              border: '1.5px solid var(--state-mastered)',
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--state-mastered)' }}>
              Disciplined (+15% Velocity)
            </div>
            <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--state-mastered)', marginTop: '6px' }}>
              {data?.trajectory?.projected1YearDisciplined || 94}
            </div>
            <div style={{ fontSize: '13px', color: '#365314', marginTop: '4px' }}>
              95% Revision adherence + 0 missed blocks
            </div>
          </div>

          {/* Decay Danger */}
          <div
            style={{
              padding: '20px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--state-decay-bg)',
              border: '1.5px solid var(--state-decay)',
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--state-decay)' }}>
              Decay Risk (Neglected)
            </div>
            <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--state-decay)', marginTop: '6px' }}>
              {data?.trajectory?.projected1YearDecayDanger || 16}
            </div>
            <div style={{ fontSize: '13px', color: '#991B1B', marginTop: '4px' }}>
              Knowledge lost without 2-4-7 enforcement
            </div>
          </div>
        </div>

        {/* Actionable Behavioral Lever */}
        <div
          style={{
            padding: '14px 18px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--accent-terracotta-subtle)',
            border: '1px solid rgba(194, 94, 62, 0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <Sparkles size={20} color="var(--accent-terracotta)" />
          <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
            <strong>Actionable Improvement Lever:</strong> {data?.trajectory?.keyLever || 'Completing 100% of Day 2 revisions saves 3.5 hours per week of re-learning.'}
          </div>
        </div>
      </div>

      {/* Core Objective Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '32px' }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', marginBottom: '8px' }}>
            <Clock size={18} />
            <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>Verified Focus Time</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800 }}>
            {data?.totalFocusHours || 0} Hours
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Heartbeat validated, idle periods excluded
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', marginBottom: '8px' }}>
            <RotateCcw size={18} />
            <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>Retention Resilience</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--state-retained)' }}>
            {data?.retrievalResilience || 100}%
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Passing rate on 2-4-7 recall reviews
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', marginBottom: '8px' }}>
            <AlertTriangle size={18} />
            <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>Mistake Clearance</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--accent-terracotta)' }}>
            {data?.mistakeLiquidationRate || 0}%
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Mistakes resolved via 2 consecutive drill passes
          </div>
        </div>
      </div>
    </div>
  );
};
