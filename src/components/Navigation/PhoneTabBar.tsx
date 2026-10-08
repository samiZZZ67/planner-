'use client';

import React from 'react';
import { Calendar, CheckSquare, BarChart3, Settings, Plus, Play, Pause, Square } from 'lucide-react';
import { useTimer } from '@/lib/timer/useTimer';

export type TabType = 'plan' | 'today' | 'progress' | 'settings';

interface PhoneTabBarProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  onOpenNewTask: () => void;
}

export function PhoneTabBar({ currentTab, onSelectTab, onOpenNewTask }: PhoneTabBarProps) {
  const { activeTimer, formattedTime, isTimerRunning, pauseTimer, resumeTimer, stopTimer } = useTimer();

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'plan', label: 'Plan', icon: <Calendar size={20} /> },
    { id: 'today', label: 'Today', icon: <CheckSquare size={20} /> },
    { id: 'progress', label: 'Stats', icon: <BarChart3 size={20} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={20} /> },
  ];

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
    }}>
      {/* Sticky Timer Bar */}
      {activeTimer && (
        <div style={{
          background: 'rgba(8,8,10,0.97)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(20px)',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: activeTimer.sectionColor || '#8b5cf6',
            boxShadow: `0 0 8px ${activeTimer.sectionColor || '#8b5cf6'}`,
            animation: 'timerPulse 1.4s ease-in-out infinite',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeTimer.taskTitle}
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.9)', flexShrink: 0 }}>
            {formattedTime}
          </span>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {isTimerRunning ? (
              <button onClick={pauseTimer} className="g-icon-btn" style={{ width: 32, height: 32 }} aria-label="Pause">
                <Pause size={13} />
              </button>
            ) : (
              <button onClick={resumeTimer} className="g-icon-btn" style={{ width: 32, height: 32 }} aria-label="Resume">
                <Play size={13} />
              </button>
            )}
            <button onClick={stopTimer} className="g-icon-btn" style={{ width: 32, height: 32, color: 'rgba(239,68,68,0.7)', borderColor: 'rgba(239,68,68,0.2)' }} aria-label="Stop">
              <Square size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Bottom Tab Bar */}
      <nav style={{
        background: 'rgba(7,7,8,0.97)',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        display: 'flex',
        alignItems: 'center',
        height: 64,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingLeft: 8,
        paddingRight: 8,
      }} aria-label="Mobile navigation">
        {tabs.map(tab => {
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                height: '100%',
                minHeight: 48,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: isActive ? 'rgba(139,92,246,0.9)' : 'rgba(255,255,255,0.28)',
                transition: 'color 0.2s',
                outline: 'none',
                fontFamily: 'system-ui, sans-serif',
              }}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              {tab.icon}
              <span style={{ fontSize: 10, fontWeight: 500 }}>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Floating Add Task FAB */}
      {currentTab === 'plan' && (
        <button
          onClick={onOpenNewTask}
          style={{
            position: 'fixed',
            right: 18,
            bottom: 80,
            width: 54,
            height: 54,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(139,92,246,0.35), rgba(99,102,241,0.25))',
            border: '1px solid rgba(139,92,246,0.45)',
            color: 'rgba(255,255,255,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 0 24px rgba(139,92,246,0.3), 0 8px 24px rgba(0,0,0,0.6)',
            transition: 'transform 0.15s, box-shadow 0.15s',
            outline: 'none',
            zIndex: 50,
          }}
          aria-label="Add new task"
        >
          <Plus size={22} />
        </button>
      )}
    </div>
  );
}
