import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Compass,
  BookOpen,
  RotateCcw,
  Calendar,
  AlertTriangle,
  TrendingUp,
  BrainCircuit,
  Sparkles,
} from 'lucide-react';

interface SidebarProps {
  activeSession: { topicName: string; elapsedMinutes: number } | null;
  onOpenTimer?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeSession, onOpenTimer }) => {
  const navItems = [
    { to: '/', label: 'Mission Control', icon: Compass },
    { to: '/topics', label: 'Concept Lab', icon: BookOpen },
    { to: '/revisions', label: 'Spaced Revision', icon: RotateCcw },
    { to: '/timetable', label: 'Daily Timetable', icon: Calendar },
    { to: '/mistakes', label: 'Mistake Vault', icon: AlertTriangle },
    { to: '/analytics', label: '1-Year Trajectory', icon: TrendingUp },
  ];

  return (
    <aside
      style={{
        width: '260px',
        backgroundColor: 'var(--bg-surface)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}
    >
      {/* Brand Header */}
      <div
        style={{
          padding: '24px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--accent-terracotta)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <BrainCircuit size={22} strokeWidth={2.2} />
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: '18px', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            Study<span style={{ color: 'var(--accent-terracotta)' }}>OS</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Evidence Learning
          </div>
        </div>
      </div>

      {/* Navigation Links */}
      <nav style={{ padding: '16px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '14px',
                fontWeight: isActive ? 700 : 500,
                color: isActive ? 'var(--accent-terracotta)' : 'var(--text-secondary)',
                backgroundColor: isActive ? 'var(--accent-terracotta-subtle)' : 'transparent',
                transition: 'all 0.15s ease',
              })}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Active Focus Session Widget */}
      {activeSession ? (
        <div
          style={{
            margin: '12px',
            padding: '14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-canvas)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: 'var(--accent-terracotta)',
                animation: 'pulse 1.5s infinite',
              }}
            />
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-terracotta)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Focusing Now
            </span>
          </div>
          <div style={{ fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {activeSession.topicName}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {activeSession.elapsedMinutes} mins recorded
          </div>
        </div>
      ) : (
        <div style={{ padding: '16px', borderTop: '1px solid var(--border-subtle)' }}>
          <div
            style={{
              padding: '12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-canvas)',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
            }}
          >
            <Sparkles size={16} color="var(--accent-terracotta)" style={{ marginTop: '2px', flexShrink: 0 }} />
            <div>
              <strong>Rule 1:</strong> Progress is based on evidence, not checkboxes.
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
