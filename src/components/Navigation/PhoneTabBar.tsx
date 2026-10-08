'use client';

import React from 'react';
import { Calendar, CheckSquare, BarChart3, Settings, Play, Pause, Square, Plus } from 'lucide-react';
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
    { id: 'plan', label: 'Plan', icon: <Calendar className="w-5 h-5" /> },
    { id: 'today', label: 'Today', icon: <CheckSquare className="w-5 h-5" /> },
    { id: 'progress', label: 'Progress', icon: <BarChart3 className="w-5 h-5" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-5 h-5" /> },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-bg-secondary/95 backdrop-blur-lg border-t border-border-color pb-safe">
      {/* Sticky Mini Timer Bar (docked above bottom tab bar) */}
      {activeTimer && (
        <div className="px-4 py-2 bg-bg-tertiary border-b border-border-color flex items-center justify-between gap-3 animate-in slide-in-from-bottom duration-200">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0 animate-ping"
              style={{ backgroundColor: activeTimer.sectionColor || '#8b5cf6' }}
            />
            <span className="text-xs font-semibold text-text-primary truncate">
              {activeTimer.taskTitle}
            </span>
            <span className="font-mono text-xs font-bold text-accent-primary shrink-0">
              {formattedTime}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isTimerRunning ? (
              <button
                onClick={pauseTimer}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-bg-card border border-border-color text-text-primary hover:bg-bg-secondary active:scale-95"
                aria-label="Pause timer"
              >
                <Pause className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={resumeTimer}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-bg-card border border-border-color text-text-primary hover:bg-bg-secondary active:scale-95"
                aria-label="Resume timer"
              >
                <Play className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={stopTimer}
              className="w-8 h-8 rounded-full flex items-center justify-center bg-red-950/60 border border-red-800 text-red-300 hover:bg-red-900 active:scale-95"
              aria-label="Stop timer and save actual time log"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom Tabs with Touch Target >= 48px */}
      <nav className="flex items-center justify-around h-16 px-2" aria-label="Mobile Navigation">
        {tabs.map(tab => {
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`flex flex-col items-center justify-center flex-1 h-full min-h-[48px] py-1 transition-colors ${
                isActive ? 'text-accent-primary font-medium' : 'text-text-muted hover:text-text-primary'
              }`}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <div className="relative">
                {tab.icon}
                {isActive && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent-primary" />
                )}
              </div>
              <span className="text-[11px] mt-1 tracking-tight">{tab.label}</span>
            </button>
          );
        })}

        {/* Big Mobile + Button to add task */}
        {currentTab === 'plan' && (
          <button
            onClick={onOpenNewTask}
            className="fixed right-4 bottom-20 z-50 w-14 h-14 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-xl shadow-purple-900/50 flex items-center justify-center active:scale-90 transition-transform focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-purple-400"
            aria-label="Add new task"
          >
            <Plus className="w-7 h-7" />
          </button>
        )}
      </nav>
    </div>
  );
}
