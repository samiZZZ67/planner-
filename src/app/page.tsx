'use client';

import React, { useState, useEffect } from 'react';
import { seedDefaultSectionsIfEmpty, requestPersistentStorage } from '@/lib/db';
import { registerServiceWorker } from '@/lib/pwa/registerSw';
import { useDeviceType } from '@/lib/hooks/useDeviceType';
import { useTimer } from '@/lib/timer/useTimer';

import { Header } from '@/components/Header';
import { PCSidebar } from '@/components/Navigation/PCSidebar';
import { PhoneTabBar, type TabType } from '@/components/Navigation/PhoneTabBar';
import { UpdateBanner } from '@/components/Navigation/UpdateBanner';

import { AddTaskScreen } from '@/components/AddTask/AddTaskScreen';
import { NoteScreen } from '@/components/Note/NoteScreen';
import { TodoListScreen } from '@/components/TodoList/TodoListScreen';
import { CategoryScreen } from '@/components/Category/CategoryScreen';
import { WeeklyPlanScreen } from '@/components/Weekly/WeeklyPlanScreen';
import { MonthlyPlanScreen } from '@/components/Monthly/MonthlyPlanScreen';
import { AnalyticsScreen } from '@/components/Analytics/AnalyticsScreen';
import { SettingsScreen } from '@/components/Settings/SettingsScreen';
import { LoginModal } from '@/components/Modals/LoginModal';
import { AIChatPanel } from '@/components/Chat/AIChatPanel';

export default function NightPlannerApp() {
  const { isPhone, isPC } = useDeviceType();
  const { isTimerRunning, pauseTimer, resumeTimer, activeTimer } = useTimer();

  // Mount Guard for Offline Client SPA & Next 16 Safety
  const [isMounted, setIsMounted] = useState(false);

  // 4 Primary Views: add_task | note | todo | category (plus analytics | settings)
  const [currentTab, setCurrentTab] = useState<TabType>('todo');
  const [currentDate, setCurrentDate] = useState<string>('2026-01-01');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);

  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isAIChatOpen, setIsAIChatOpen] = useState(false);

  // Lifecycle Initialization
  useEffect(() => {
    setIsMounted(true);

    // Default planning date to today in local timezone
    const today = new Date().toLocaleDateString('en-CA');
    setCurrentDate(today);

    // Register PWA service worker
    registerServiceWorker();

    // Ask browser for persistent storage
    requestPersistentStorage();

    // Seed default database tables
    seedDefaultSectionsIfEmpty();

    // Theme initialization
    const savedTheme = (localStorage.getItem('np_theme') as 'dark' | 'light') || 'dark';
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('np_theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
      window.location.reload();
    } catch {
      // Offline fallback
    }
  };

  // Keyboard Shortcuts (PC UI)
  useEffect(() => {
    if (!isPC) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLoginModalOpen) return;

      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = targetTag === 'input' || targetTag === 'textarea' || (e.target as HTMLElement)?.isContentEditable;

      if (isInput) return;

      if (e.key === '1') {
        e.preventDefault();
        setCurrentTab('todo');
      } else if (e.key === '2') {
        e.preventDefault();
        setCurrentTab('weekly');
      } else if (e.key === '3') {
        e.preventDefault();
        setCurrentTab('monthly');
      } else if (e.key === '4') {
        e.preventDefault();
        setCurrentTab('add_task');
      } else if (e.key === '5') {
        e.preventDefault();
        setCurrentTab('note');
      } else if (e.key === '6') {
        e.preventDefault();
        setCurrentTab('category');
      } else if (e.key === '7') {
        e.preventDefault();
        setCurrentTab('analytics');
      } else if (e.key === '8') {
        e.preventDefault();
        setCurrentTab('settings');
      } else if (e.key === ' ' && activeTimer) {
        e.preventDefault();
        if (isTimerRunning) pauseTimer();
        else resumeTimer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPC, activeTimer, isTimerRunning, pauseTimer, resumeTimer, isLoginModalOpen]);

  if (!isMounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0d0d11] text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-xl border border-white/20 flex items-center justify-center shadow-2xl animate-pulse">
            <span className="text-2xl">🌙</span>
          </div>
          <span className="font-bloody text-lg tracking-wider">Night Planner</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex flex-col items-center justify-start overflow-x-hidden selection:bg-sky-500/30 selection:text-white">
      {/* ── 1. Room Backdrop ── */}
      <div className="vision-room-bg" />

      {/* ── 2. Service Worker Update Notification Banner ── */}
      <UpdateBanner />

      {/* ── 3. Floating Glass Header Bar ── */}
      <Header
        onOpenLogin={() => setIsLoginModalOpen(true)}
        isPC={isPC}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenAIChat={() => setIsAIChatOpen(true)}
      />

      {/* ── 4. Main Spacious Workspace ── */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          width: '100%',
          maxWidth: currentTab === 'analytics' ? 1040 : 960,
          margin: '0 auto',
          padding: isPhone ? '12px 16px 110px' : '20px 24px 80px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          transition: 'max-width 0.25s ease',
        }}
      >
        {/* Left Vertical Dock on PC */}
        {isPC && (
          <PCSidebar
            currentTab={currentTab}
            onSelectTab={setCurrentTab}
            onOpenAIChat={() => setIsAIChatOpen(true)}
          />
        )}

        {/* Central Floating Glass Window */}
        <main
          className="v-window"
          style={{
            flex: 1,
            maxWidth: currentTab === 'analytics' ? 880 : 780,
            width: '100%',
            transition: 'max-width 0.25s ease',
          }}
        >
          {/* Segmented Glass Tabs: Planning Hierarchy & Actions */}
          <div className="v-tabs" role="tablist" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', gap: isPhone ? 14 : 24 }}>
            <button
              onClick={() => setCurrentTab('todo')}
              className={`v-tab-btn${currentTab === 'todo' ? ' active' : ''}`}
              role="tab"
              aria-selected={currentTab === 'todo'}
              style={{ whiteSpace: 'nowrap' }}
            >
              To-Do List
            </button>
            <button
              onClick={() => setCurrentTab('weekly')}
              className={`v-tab-btn${currentTab === 'weekly' ? ' active' : ''}`}
              role="tab"
              aria-selected={currentTab === 'weekly'}
              style={{ whiteSpace: 'nowrap' }}
            >
              Weekly Plan
            </button>
            <button
              onClick={() => setCurrentTab('monthly')}
              className={`v-tab-btn${currentTab === 'monthly' ? ' active' : ''}`}
              role="tab"
              aria-selected={currentTab === 'monthly'}
              style={{ whiteSpace: 'nowrap' }}
            >
              Monthly Plan
            </button>
            <button
              onClick={() => setCurrentTab('add_task')}
              className={`v-tab-btn${currentTab === 'add_task' ? ' active' : ''}`}
              role="tab"
              aria-selected={currentTab === 'add_task'}
              style={{ whiteSpace: 'nowrap' }}
            >
              Add Task
            </button>
            <button
              onClick={() => setCurrentTab('note')}
              className={`v-tab-btn${currentTab === 'note' ? ' active' : ''}`}
              role="tab"
              aria-selected={currentTab === 'note'}
              style={{ whiteSpace: 'nowrap' }}
            >
              Note
            </button>
            <button
              onClick={() => setCurrentTab('category')}
              className={`v-tab-btn${currentTab === 'category' ? ' active' : ''}`}
              role="tab"
              aria-selected={currentTab === 'category'}
              style={{ whiteSpace: 'nowrap' }}
            >
              Category
            </button>

            {/* Preserved secondary tabs if active */}
            {currentTab === 'analytics' && (
              <button
                onClick={() => setCurrentTab('analytics')}
                className="v-tab-btn active"
                role="tab"
                aria-selected={true}
                style={{ whiteSpace: 'nowrap' }}
              >
                Analytics
              </button>
            )}
            {currentTab === 'settings' && (
              <button
                onClick={() => setCurrentTab('settings')}
                className="v-tab-btn active"
                role="tab"
                aria-selected={true}
                style={{ whiteSpace: 'nowrap' }}
              >
                Settings
              </button>
            )}
          </div>

          {/* Active Screen Content */}
          <div style={{ padding: isPhone ? '20px 16px' : '28px 32px' }}>
            {currentTab === 'todo' && (
              <TodoListScreen
                currentDate={currentDate}
                onChangeDate={setCurrentDate}
                isPhone={isPhone}
                onOpenTaskInCategory={(taskId) => {
                  setFocusTaskId(taskId);
                  setCurrentTab('category');
                }}
                onNavigateToAddTask={() => setCurrentTab('add_task')}
              />
            )}

            {currentTab === 'weekly' && (
              <WeeklyPlanScreen
                currentDate={currentDate}
                isPhone={isPhone}
              />
            )}

            {currentTab === 'monthly' && (
              <MonthlyPlanScreen
                currentDate={currentDate}
                isPhone={isPhone}
              />
            )}

            {currentTab === 'add_task' && (
              <AddTaskScreen
                currentDate={currentDate}
                onChangeDate={setCurrentDate}
                isPhone={isPhone}
                onTaskAdded={() => setCurrentTab('todo')}
              />
            )}

            {currentTab === 'note' && (
              <NoteScreen
                currentDate={currentDate}
                onChangeDate={setCurrentDate}
                isPhone={isPhone}
              />
            )}

            {currentTab === 'category' && (
              <CategoryScreen
                currentDate={currentDate}
                isPhone={isPhone}
                focusTaskId={focusTaskId}
                onClearFocus={() => setFocusTaskId(null)}
              />
            )}

            {currentTab === 'analytics' && (
              <AnalyticsScreen
                isPhone={isPhone}
              />
            )}

            {currentTab === 'settings' && (
              <SettingsScreen
                theme={theme}
                onToggleTheme={toggleTheme}
                onOpenLogin={() => setIsLoginModalOpen(true)}
                onLogout={handleLogout}
                isPhone={isPhone}
              />
            )}
          </div>
        </main>
      </div>

      {/* ── 5. Phone Bottom Floating Navigation Dock ── */}
      {isPhone && (
        <PhoneTabBar
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
        />
      )}

      {/* ── 6. Cloud Sync Login Modal ── */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
      />

      {/* ── 7. Floating Moon Button for AI Assistant ── */}
      {!isAIChatOpen && (
        <button
          onClick={() => setIsAIChatOpen(true)}
          className="v-pill-btn"
          aria-label="Open AI Assistant"
          title="Open AI Chat Assistant"
          style={{
            position: 'fixed',
            bottom: isPhone ? 84 : 28,
            right: isPhone ? 16 : 28,
            zIndex: 45,
            width: 48,
            height: 48,
            borderRadius: '50%',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            background: 'var(--v-glass-bg)',
            border: '1.5px solid var(--v-glass-border)',
            boxShadow: 'var(--v-shadow-btn), 0 0 20px rgba(168, 85, 247, 0.3)',
            cursor: 'pointer',
            transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease',
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.08)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <span>🌙</span>
        </button>
      )}

      {/* ── 8. AI Chat Assistant Panel ── */}
      <AIChatPanel
        isOpen={isAIChatOpen}
        onClose={() => setIsAIChatOpen(false)}
        currentDate={currentDate}
        isPhone={isPhone}
      />
    </div>
  );
}
