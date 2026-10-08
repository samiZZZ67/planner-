'use client';

import React from 'react';
import { Calendar, CheckSquare, BarChart3, Settings, Play, Pause, Square } from 'lucide-react';
import { useTimer } from '@/lib/timer/useTimer';

export type TabType = 'plan' | 'today' | 'progress' | 'settings';

interface PhoneTabBarProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  onOpenNewTask: () => void;
}

export function PhoneTabBar({ currentTab, onSelectTab }: PhoneTabBarProps) {
  const { activeTimer, formattedTime, isTimerRunning, pauseTimer, resumeTimer, stopTimer } = useTimer();

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'plan', label: 'Plan', icon: <Calendar size={18} /> },
    { id: 'today', label: 'Today', icon: <CheckSquare size={18} /> },
    { id: 'progress', label: 'Stats', icon: <BarChart3 size={18} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
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
        paddingBottom: 'env(safe-area-inset-bottom, 8px)',
        pointerEvents: 'none',
      }}
    >
      {/* Sticky Timer Bar on Mobile */}
      {activeTimer && (
        <div
          className="v-pill-btn"
          style={{
            pointerEvents: 'auto',
            marginBottom: 8,
            padding: '6px 14px',
            background: 'rgba(20, 20, 25, 0.92)',
            borderColor: 'rgba(255, 255, 255, 0.3)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            maxWidth: '90%',
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
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
            {activeTimer.taskTitle}
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#ffffff', flexShrink: 0 }}>
            {formattedTime}
          </span>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {isTimerRunning ? (
              <button onClick={pauseTimer} className="v-circle-btn" style={{ width: 26, height: 26 }} aria-label="Pause">
                <Pause size={11} />
              </button>
            ) : (
              <button onClick={resumeTimer} className="v-circle-btn" style={{ width: 26, height: 26 }} aria-label="Resume">
                <Play size={11} />
              </button>
            )}
            <button onClick={stopTimer} className="v-circle-btn" style={{ width: 26, height: 26, color: '#f87171' }} aria-label="Stop">
              <Square size={11} />
            </button>
          </div>
        </div>
      )}

      {/* Floating Bottom Capsule Dock */}
      <div style={{ width: '100%', maxWidth: 360, padding: '0 16px 8px', pointerEvents: 'auto' }}>
        <nav
          className="v-dock"
          style={{
            height: 54,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            padding: '0 8px',
          }}
          aria-label="Mobile VisionOS navigation"
        >
          {tabs.map(tab => {
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                className={`v-circle-btn${isActive ? ' active' : ''}`}
                style={{
                  width: 40,
                  height: 40,
                  border: isActive ? '1px solid rgba(255,255,255,0.45)' : 'none',
                  background: isActive ? 'rgba(255,255,255,0.22)' : 'transparent',
                  color: isActive ? '#ffffff' : 'rgba(255,255,255,0.45)',
                }}
                aria-label={tab.label}
                aria-current={isActive ? 'page' : undefined}
                title={tab.label}
              >
                {tab.icon}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
