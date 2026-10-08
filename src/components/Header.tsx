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

export function Header({ onOpenLogin, isPC, theme, onToggleTheme }: HeaderProps) {
  const sync = useSync();
  const { activeTimer, formattedTime, isTimerRunning, pauseTimer, resumeTimer, stopTimer } = useTimer();

  const formatTime = (ts: number | null) => {
    if (!ts) return 'Never';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const SyncBadge = () => {
    if (sync.warningIfStale) {
      return (
        <button
          onClick={() => sync.triggerSync()}
          className="v-pill-btn animate-pulse"
          style={{ padding: '4px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.15)', color: '#f87171' }}
          title="Changes stale — click to retry"
        >
          <AlertTriangle size={11} />
          <span>{sync.unsyncedCount} stale</span>
        </button>
      );
    }
    switch (sync.status) {
      case 'offline':
        return (
          <div className="v-pill-btn" style={{ padding: '4px 10px', fontSize: 11, borderColor: 'rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.1)', color: '#facc15' }}>
            <WifiOff size={11} />
            <span>Offline</span>
          </div>
        );
      case 'syncing':
        return (
          <div className="v-pill-btn" style={{ padding: '4px 10px', fontSize: 11, borderColor: 'rgba(99,102,241,0.35)', background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}>
            <RefreshCw size={11} className="animate-spin" />
            <span>Syncing</span>
          </div>
        );
      case 'auth_required':
        return (
          <button
            onClick={onOpenLogin}
            className="v-pill-btn"
            style={{ padding: '4px 10px', fontSize: 11, borderColor: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.15)', color: '#ffffff' }}
          >
            <Lock size={11} />
            <span>Login to Sync</span>
          </button>
        );
      case 'changes_waiting':
        return (
          <button
            onClick={() => sync.triggerSync()}
            className="v-pill-btn"
            style={{ padding: '4px 10px', fontSize: 11, borderColor: 'rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.1)', color: '#facc15' }}
          >
            <Clock size={11} />
            <span>{sync.unsyncedCount} waiting</span>
          </button>
        );
      default:
        return (
          <div
            className="v-pill-btn"
            style={{ padding: '4px 12px', fontSize: 11, borderColor: 'rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.9)' }}
            title={sync.lastSyncedAt ? `Last sync: ${formatTime(sync.lastSyncedAt)}` : 'Synced with Cloud'}
          >
            <CheckCircle2 size={11} style={{ color: '#4ade80' }} />
            <span>Saved</span>
            {sync.lastSyncedAt && (
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>· {formatTime(sync.lastSyncedAt)}</span>
            )}
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
        padding: '16px 20px 8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        position: 'relative',
        zIndex: 40,
      }}
    >
      {/* Left Title / Spatial Capsule */}
      <div className="v-pill-btn" style={{ padding: '6px 14px', background: 'rgba(28,28,34,0.7)', cursor: 'default' }}>
        <span style={{ fontSize: 14 }}>🌙</span>
        <span className="font-bloody" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.04em' }}>
          Night Planner
        </span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em' }}>SPATIAL</span>
      </div>

      {/* Active Timer Pill */}
      {activeTimer && (
        <div
          className="v-pill-btn"
          style={{
            padding: '5px 12px 5px 8px',
            background: 'rgba(20,20,25,0.85)',
            borderColor: 'rgba(255,255,255,0.3)',
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: activeTimer.sectionColor || '#3b82f6',
              boxShadow: `0 0 8px ${activeTimer.sectionColor || '#3b82f6'}`,
              animation: 'timerPulse 1.4s infinite',
            }}
          />
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeTimer.taskTitle}
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#ffffff' }}>
            {formattedTime}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {isTimerRunning ? (
              <button onClick={pauseTimer} className="v-circle-btn" style={{ width: 24, height: 24 }} aria-label="Pause">
                <Pause size={10} />
              </button>
            ) : (
              <button onClick={resumeTimer} className="v-circle-btn" style={{ width: 24, height: 24 }} aria-label="Resume">
                <Play size={10} />
              </button>
            )}
            <button onClick={stopTimer} className="v-circle-btn" style={{ width: 24, height: 24, color: '#f87171' }} aria-label="Stop">
              <Square size={10} />
            </button>
          </div>
        </div>
      )}

      {/* Right Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <SyncBadge />
        <button
          onClick={onToggleTheme}
          className="v-circle-btn"
          style={{ width: 34, height: 34 }}
          aria-label={`Switch theme`}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </header>
  );
}
