'use client';

import React from 'react';
import { ListChecks, BarChart3, Settings, Play, Pause, Square, Plus, StickyNote, Tag, CalendarRange, CalendarDays } from 'lucide-react';
import { useTimer } from '@/lib/timer/useTimer';

export type TabType = 'todo' | 'weekly' | 'monthly' | 'add_task' | 'note' | 'category' | 'analytics' | 'settings';

interface PhoneTabBarProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
}

export function PhoneTabBar({ currentTab, onSelectTab }: PhoneTabBarProps) {
  const {
    activeTimer,
    formattedCountdown,
    isFocus,
    isTimerRunning,
    pauseTimer,
    resumeTimer,
    stopTimer,
  } = useTimer();

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'todo', label: 'To-Do', icon: <ListChecks size={18} /> },
    { id: 'weekly', label: 'Weekly', icon: <CalendarRange size={18} /> },
    { id: 'monthly', label: 'Monthly', icon: <CalendarDays size={18} /> },
    { id: 'add_task', label: 'Add', icon: <Plus size={18} /> },
    { id: 'note', label: 'Note', icon: <StickyNote size={18} /> },
    { id: 'category', label: 'Category', icon: <Tag size={18} /> },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingBottom: 'env(safe-area-inset-bottom, 12px)',
        pointerEvents: 'none',
      }}
    >
      {/* Sticky Pomodoro Timer Bar on Mobile when timer is active */}
      {activeTimer && (
        <div
          className="v-pill-btn"
          style={{
            pointerEvents: 'auto',
            marginBottom: 8,
            padding: '8px 16px',
            background: isFocus ? 'rgba(56, 189, 248, 0.2)' : 'rgba(34, 197, 94, 0.2)',
            borderColor: isFocus ? '#38bdf8' : '#22c55e',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            maxWidth: '92%',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isFocus ? '#38bdf8' : '#22c55e',
              animation: 'timerPulse 1.4s infinite',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 130,
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
              flexShrink: 0,
            }}
          >
            {isFocus ? '🎯' : '☕'} {formattedCountdown}
          </span>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {isTimerRunning ? (
              <button
                type="button"
                onClick={pauseTimer}
                className="v-circle-btn"
                style={{ width: 28, height: 28 }}
                aria-label="Pause Pomodoro"
              >
                <Pause size={12} />
              </button>
            ) : (
              <button
                type="button"
                onClick={resumeTimer}
                className="v-circle-btn"
                style={{ width: 28, height: 28 }}
                aria-label="Resume Pomodoro"
              >
                <Play size={12} />
              </button>
            )}
            <button
              type="button"
              onClick={stopTimer}
              className="v-circle-btn"
              style={{ width: 28, height: 28, color: '#f87171' }}
              aria-label="Stop Pomodoro"
            >
              <Square size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Floating Bottom Capsule Dock */}
      <div style={{ width: '100%', maxWidth: 400, padding: '0 16px 8px', pointerEvents: 'auto' }}>
        <nav
          className="v-dock"
          style={{
            height: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            padding: '0 8px',
          }}
          aria-label="Phone Navigation Tab Bar"
        >
          {tabs.map(tab => {
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                  padding: '6px 10px',
                  borderRadius: 14,
                  border: isActive ? '1.5px solid var(--accent-color)' : '1px solid transparent',
                  background: isActive ? 'var(--accent-glow)' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  minWidth: 56,
                }}
                title={tab.label}
                aria-label={tab.label}
              >
                {tab.icon}
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.02em' }}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
