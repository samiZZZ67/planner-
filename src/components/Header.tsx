'use client';

import React from 'react';
import { useSync } from '@/lib/sync/useSync';
import { useTimer } from '@/lib/timer/useTimer';
import {
  WifiOff, RefreshCw, CheckCircle2, Clock, AlertTriangle,
  Moon, Sun, Lock, Play, Pause, Square, Save
} from 'lucide-react';

interface HeaderProps {
  onOpenLogin: () => void;
  isPC: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenAIChat?: () => void;
}

export function Header({ onOpenLogin, isPC, theme, onToggleTheme, onOpenAIChat }: HeaderProps) {
  const sync = useSync();
  const {
    activeTimer,
    formattedCountdown,
    isFocus,
    isTimerRunning,
    pauseTimer,
    resumeTimer,
    stopTimer,
  } = useTimer();

  const formatTime = (ts: number | null) => {
    if (!ts) return 'Never';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatSeconds = (sec?: number) => {
    if (!sec || sec <= 0) return '0s';
    const mins = Math.floor(sec / 60);
    const remaining = sec % 60;
    if (mins > 0) {
      return `${mins}m ${remaining}s`;
    }
    return `${remaining}s`;
  };

  const SyncBadge = () => {
    // 1. If auth is required or error is auth-related, show Login button
    if (
      sync.status === 'auth_required' ||
      (sync.errorMessage && (sync.errorMessage.toLowerCase().includes('login') || sync.errorMessage.toLowerCase().includes('auth')))
    ) {
      return (
        <button
          onClick={onOpenLogin}
          className="v-pill-btn animate-pulse"
          style={{
            padding: '6px 14px',
            fontSize: 11,
            minHeight: 34,
            borderColor: '#a855f7',
            background: 'rgba(168, 85, 247, 0.15)',
            color: '#c084fc',
            gap: 6,
            fontWeight: 700,
          }}
          title="Login to enable cloud sync across devices"
        >
          <Lock size={13} />
          <span>Login to Sync</span>
        </button>
      );
    }

    if (sync.warningIfStale || sync.errorMessage) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => sync.triggerSync()}
            className="v-pill-btn animate-pulse"
            style={{ padding: '6px 12px', fontSize: 11, minHeight: 34, borderColor: '#f87171', color: '#f87171', gap: 4 }}
            title={sync.errorMessage || "Save error — click to retry"}
          >
            <AlertTriangle size={12} />
            <span>Error saving (Retry)</span>
          </button>
          <button
            onClick={() => sync.triggerSync()}
            className="v-pill-btn v-pill-btn-primary"
            style={{ padding: '6px 12px', fontSize: 11, minHeight: 34, gap: 4 }}
          >
            <Save size={12} />
            <span>Save Now</span>
          </button>
        </div>
      );
    }
    switch (sync.status) {
      case 'offline':
        return (
          <div className="v-pill-btn" style={{ padding: '6px 12px', fontSize: 11, minHeight: 34, color: '#f59e0b', gap: 4 }}>
            <WifiOff size={12} />
            <span>Offline (unsaved locally)</span>
          </div>
        );
      case 'syncing':
        return (
          <div className="v-pill-btn" style={{ padding: '6px 14px', fontSize: 11, minHeight: 34, color: 'var(--accent-color)', gap: 5 }}>
            <RefreshCw size={12} className="animate-spin" />
            <span>Saving...</span>
          </div>
        );
      case 'changes_waiting':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              className="v-pill-btn"
              style={{ padding: '6px 12px', fontSize: 11, minHeight: 34, color: '#f59e0b', borderColor: 'rgba(245, 158, 11, 0.4)', gap: 4 }}
              title="Automatic save in 2 minutes"
            >
              <Clock size={12} />
              <span>
                Unsaved changes ({formatSeconds(sync.secondsUntilSync)})
              </span>
            </div>
            <button
              onClick={() => sync.triggerSync()}
              className="v-pill-btn v-pill-btn-primary"
              style={{ padding: '6px 12px', fontSize: 11, minHeight: 34, gap: 4, fontWeight: 700 }}
              title="Save immediately without waiting"
            >
              <Save size={12} />
              <span>Save Now</span>
            </button>
          </div>
        );
      default:
        return (
          <div
            className="v-pill-btn"
            style={{ padding: '6px 14px', fontSize: 11, minHeight: 34, gap: 5 }}
            title={sync.lastSyncedAt ? `Last saved: ${formatTime(sync.lastSyncedAt)}` : 'Saved locally & synced'}
          >
            <CheckCircle2 size={12} style={{ color: '#22c55e' }} />
            <span>Saved</span>
          </div>
        );
    }
  };

  return (
    <header
      style={{
        width: '100%',
        maxWidth: 960,
        margin: '0 auto',
        padding: isPC ? '20px 24px 10px' : '12px 16px 6px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        position: 'relative',
        zIndex: 40,
      }}
    >
      {/* Brand Title Badge in Bloody Hell font (AI Assistant Trigger) */}
      <div
        onClick={onOpenAIChat}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenAIChat?.(); } }}
        className="v-pill-btn"
        style={{ padding: '6px 16px', minHeight: 38, cursor: 'pointer', transition: 'all 0.2s ease' }}
        title="Open AI Assistant & Plan Review"
        aria-label="Open AI Assistant"
      >
        <span style={{ fontSize: 15 }}>🌙</span>
        <span className="font-bloody" style={{ fontSize: 17, fontWeight: 700, letterSpacing: '0.04em' }}>
          Night Planner
        </span>
      </div>

      {/* Active Pomodoro Timer Pill (when active on PC/Header) */}
      {activeTimer && (
        <div
          className="v-pill-btn"
          style={{
            padding: '6px 14px 6px 10px',
            minHeight: 38,
            borderColor: isFocus ? '#38bdf8' : '#22c55e',
            background: isFocus ? 'rgba(56, 189, 248, 0.15)' : 'rgba(34, 197, 94, 0.15)',
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isFocus ? '#38bdf8' : '#22c55e',
              animation: 'timerPulse 1.4s infinite',
            }}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              maxWidth: 120,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--text-primary)',
            }}
          >
            {activeTimer.taskTitle}
          </span>
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: 13,
              fontWeight: 800,
              color: isFocus ? '#38bdf8' : '#22c55e',
            }}
          >
            {isFocus ? '🎯' : '☕'} {formattedCountdown}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {isTimerRunning ? (
              <button
                onClick={pauseTimer}
                className="v-circle-btn"
                style={{ width: 26, height: 26 }}
                aria-label="Pause"
              >
                <Pause size={11} />
              </button>
            ) : (
              <button
                onClick={resumeTimer}
                className="v-circle-btn"
                style={{ width: 26, height: 26 }}
                aria-label="Resume"
              >
                <Play size={11} />
              </button>
            )}
            <button
              onClick={stopTimer}
              className="v-circle-btn"
              style={{ width: 26, height: 26, color: '#f87171' }}
              aria-label="Stop & Log Time"
            >
              <Square size={11} />
            </button>
          </div>
        </div>
      )}

      {/* Right Controls: Sync & Theme Switch & Cloud Login */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <SyncBadge />
        <button
          onClick={onOpenLogin}
          className="v-circle-btn"
          style={{ width: 38, height: 38 }}
          aria-label="Cloud Login"
          title="Sign in to Cloud Sync"
        >
          <Lock size={15} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <button
          onClick={onToggleTheme}
          className="v-circle-btn"
          style={{ width: 38, height: 38 }}
          aria-label="Toggle theme"
          title={theme === 'dark' ? 'Switch to White Glass' : 'Switch to Dark Glass'}
        >
          {theme === 'dark' ? <Sun size={15} style={{ color: '#f59e0b' }} /> : <Moon size={15} style={{ color: '#38bdf8' }} />}
        </button>
      </div>
    </header>
  );
}
