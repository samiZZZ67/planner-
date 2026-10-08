'use client';

import React from 'react';
import { useSync } from '@/lib/sync/useSync';
import { useTimer } from '@/lib/timer/useTimer';
import {
  WifiOff, RefreshCw, CheckCircle2, Clock, AlertTriangle,
  Moon, Sun, Lock, Play, Pause, Square
} from 'lucide-react';

interface HeaderProps {
  onOpenLogin: () => void;
  isPC: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenNewTask?: () => void;
}

export function Header({ onOpenLogin, isPC, theme, onToggleTheme, onOpenNewTask }: HeaderProps) {
  const sync = useSync();
  const { activeTimer, formattedTime, isTimerRunning, pauseTimer, resumeTimer, stopTimer } = useTimer();

  const formatTime = (ts: number | null) => {
    if (!ts) return 'Never';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const SyncBadge = () => {
    if (sync.warningIfStale) {
      return (
        <button onClick={() => sync.triggerSync()} className="g-badge animate-pulse"
          style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: 'rgba(239,68,68,0.9)' }}
          title="Changes stale — click to retry">
          <AlertTriangle size={11} />
          <span>{sync.unsyncedCount} stale</span>
        </button>
      );
    }
    switch (sync.status) {
      case 'offline':
        return (
          <div className="g-badge" style={{ borderColor: 'rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.07)', color: 'rgba(234,179,8,0.8)' }}>
            <WifiOff size={11} /><span>Offline</span>
          </div>
        );
      case 'syncing':
        return (
          <div className="g-badge" style={{ borderColor: 'rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.07)', color: 'rgba(99,102,241,0.9)' }}>
            <RefreshCw size={11} className="animate-spin" /><span>Syncing</span>
          </div>
        );
      case 'auth_required':
        return (
          <button onClick={onOpenLogin} className="g-badge" style={{ borderColor: 'rgba(139,92,246,0.35)', background: 'rgba(139,92,246,0.08)', color: 'rgba(139,92,246,0.9)', cursor: 'pointer' }}>
            <Lock size={11} /><span>Login to Sync</span>
          </button>
        );
      case 'changes_waiting':
        return (
          <button onClick={() => sync.triggerSync()} className="g-badge" style={{ borderColor: 'rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.07)', color: 'rgba(234,179,8,0.8)', cursor: 'pointer' }}>
            <Clock size={11} /><span>{sync.unsyncedCount} waiting</span>
          </button>
        );
      default:
        return (
          <div className="g-badge" style={{ borderColor: 'rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.07)', color: 'rgba(34,197,94,0.8)' }}
            title={sync.lastSyncedAt ? `Last sync: ${formatTime(sync.lastSyncedAt)}` : ''}>
            <CheckCircle2 size={11} /><span>Saved</span>
            {sync.lastSyncedAt && <span style={{ color: 'rgba(34,197,94,0.5)', fontSize: 10 }}>· {formatTime(sync.lastSyncedAt)}</span>}
          </div>
        );
    }
  };

  return (
    <header style={{
      background: 'rgba(7,7,8,0.92)',
      borderBottom: '1px solid rgba(255,255,255,0.07)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      position: 'sticky',
      top: 0,
      zIndex: 30,
    }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 20px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: 'linear-gradient(135deg, rgba(139,92,246,0.3), rgba(99,102,241,0.2))',
            border: '1px solid rgba(139,92,246,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 16px rgba(139,92,246,0.2)',
          }}>
            <span style={{ fontSize: 16 }}>🌙</span>
          </div>
          <div>
            <div className="font-bloody" style={{ fontSize: 18, color: 'rgba(255,255,255,0.9)', lineHeight: 1 }}>
              Night Planner
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', letterSpacing: '0.08em' }}>
              PLAN WITH INTENTION
            </div>
          </div>
        </div>

        {/* PC Active Timer */}
        {isPC && activeTimer && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '6px 14px 6px 10px',
            background: 'rgba(18,18,20,0.95)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 999,
            boxShadow: '0 0 12px rgba(0,0,0,0.4)',
          }}>
            <div className="g-timer-dot" style={{ color: activeTimer.sectionColor || '#8b5cf6', background: activeTimer.sectionColor || '#8b5cf6' }} />
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeTimer.taskTitle}
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.9)', minWidth: 56 }}>
              {formattedTime}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {isTimerRunning ? (
                <button onClick={pauseTimer} className="g-icon-btn" style={{ width: 26, height: 26 }} aria-label="Pause">
                  <Pause size={12} />
                </button>
              ) : (
                <button onClick={resumeTimer} className="g-icon-btn" style={{ width: 26, height: 26 }} aria-label="Resume">
                  <Play size={12} />
                </button>
              )}
              <button onClick={stopTimer} className="g-icon-btn" style={{ width: 26, height: 26, color: 'rgba(239,68,68,0.7)', borderColor: 'rgba(239,68,68,0.2)' }} aria-label="Stop">
                <Square size={12} />
              </button>
            </div>
          </div>
        )}

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <SyncBadge />
          <button
            onClick={onToggleTheme}
            className="g-icon-btn"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </div>
    </header>
  );
}
