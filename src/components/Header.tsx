'use client';

import React from 'react';
import { useSync } from '@/lib/sync/useSync';
import { useTimer } from '@/lib/timer/useTimer';
import { WifiOff, RefreshCw, CheckCircle2, Clock, AlertTriangle, Moon, Sun, Lock, Play, Pause, Square } from 'lucide-react';

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

  const formatLastSync = (timestamp: number | null) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getSyncBadge = () => {
    if (sync.warningIfStale) {
      return (
        <button
          onClick={() => sync.triggerSync()}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-red-950/80 text-red-400 border border-red-800 animate-pulse"
          title="Changes waiting over 5 minutes. Click to retry sync."
          aria-label="Changes waiting over 5 minutes. Click to retry sync."
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>{sync.unsyncedCount} changes waiting (stale)</span>
        </button>
      );
    }

    switch (sync.status) {
      case 'offline':
        return (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-950/60 text-amber-400 border border-amber-800/60"
            title="Working offline. Changes saved locally."
          >
            <WifiOff className="w-3.5 h-3.5" />
            <span>Offline</span>
          </div>
        );
      case 'syncing':
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-blue-950/60 text-blue-400 border border-blue-800/60">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Syncing...</span>
          </div>
        );
      case 'auth_required':
        return (
          <button
            onClick={onOpenLogin}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-purple-900/60 text-purple-300 border border-purple-700 hover:bg-purple-800/80 transition-colors"
            aria-label="Cloud sync requires login"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Login to Sync</span>
          </button>
        );
      case 'changes_waiting':
        return (
          <button
            onClick={() => sync.triggerSync()}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-900/50 text-amber-300 border border-amber-700/60 hover:bg-amber-900/70"
            title="Click to sync now"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{sync.unsyncedCount} changes waiting</span>
          </button>
        );
      case 'all_saved':
      default:
        return (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-800/60"
            title={`Last synced at ${formatLastSync(sync.lastSyncedAt)}`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>All saved</span>
            {sync.lastSyncedAt && (
              <span className="text-[10px] text-emerald-500/80 hidden sm:inline">
                ({formatLastSync(sync.lastSyncedAt)})
              </span>
            )}
          </div>
        );
    }
  };

  return (
    <header className="sticky top-0 z-30 w-full border-b border-border-color bg-bg-secondary/95 backdrop-blur-md px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Brand / Logo */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-700 flex items-center justify-center shadow-lg shadow-purple-900/30">
            <span className="text-white text-base">🌙</span>
          </div>
          <div>
            <h1 className="font-bloody text-xl font-bold tracking-wider text-text-primary leading-none">
              Night Planner
            </h1>
            <p className="text-[11px] text-text-muted mt-0.5 hidden sm:block">
              Plan clearly tonight. Master tomorrow.
            </p>
          </div>
        </div>

        {/* PC Active Timer Mini-Widget in Top Bar */}
        {isPC && activeTimer && (
          <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-bg-tertiary border border-border-color shadow-sm">
            <div
              className="w-2.5 h-2.5 rounded-full animate-ping"
              style={{ backgroundColor: activeTimer.sectionColor || '#8b5cf6' }}
            />
            <span className="text-xs font-medium text-text-primary truncate max-w-[160px]">
              {activeTimer.taskTitle}
            </span>
            <span className="font-mono text-xs font-bold text-accent-primary">
              {formattedTime}
            </span>
            <div className="flex items-center gap-1">
              {isTimerRunning ? (
                <button
                  onClick={pauseTimer}
                  className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors"
                  aria-label="Pause timer"
                  title="Pause timer (Space)"
                >
                  <Pause className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={resumeTimer}
                  className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors"
                  aria-label="Resume timer"
                  title="Resume timer (Space)"
                >
                  <Play className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={stopTimer}
                className="p-1 rounded text-red-400 hover:text-red-300 hover:bg-red-950/40 transition-colors"
                aria-label="Stop timer and log actual time"
                title="Stop timer & save log"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Sync Status & Controls */}
        <div className="flex items-center gap-2.5">
          {getSyncBadge()}

          {/* Light / Dark Mode Switch */}
          <button
            onClick={onToggleTheme}
            className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary border border-border-color transition-colors"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}
