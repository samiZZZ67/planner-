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

import { TodoScreen } from '@/components/Todo/TodoScreen';
import { AnalyticsScreen } from '@/components/Analytics/AnalyticsScreen';
import { SettingsScreen } from '@/components/Settings/SettingsScreen';
import { LoginModal } from '@/components/Modals/LoginModal';

export default function NightPlannerApp() {
  const { isPhone, isPC } = useDeviceType();
  const { isTimerRunning, pauseTimer, resumeTimer, activeTimer } = useTimer();

  // Mount Guard for Offline Client SPA & Next 16 Safety
  const [isMounted, setIsMounted] = useState(false);

  // Navigation: Only Todo, Analytics, Settings
  const [currentTab, setCurrentTab] = useState<TabType>('todo');
  const [currentDate, setCurrentDate] = useState<string>('2026-01-01');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

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
        setCurrentTab('analytics');
      } else if (e.key === '3') {
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
      />

      {/* ── 4. Main Spacious Workspace ── */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          width: '100%',
          maxWidth: 960,
          margin: '0 auto',
          padding: isPhone ? '12px 16px 110px' : '20px 24px 80px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
        }}
      >
        {/* Left Vertical Dock on PC */}
        {isPC && (
          <PCSidebar
            currentTab={currentTab}
            onSelectTab={setCurrentTab}
          />
        )}

        {/* Central Floating Glass Window */}
        <main
          className="v-window"
          style={{
            flex: 1,
            maxWidth: 780,
            width: '100%',
          }}
        >
          {/* Segmented Glass Tabs: Todo, Analytics, Settings */}
          <div className="v-tabs" role="tablist">
            <button
              onClick={() => setCurrentTab('todo')}
              className={`v-tab-btn${currentTab === 'todo' ? ' active' : ''}`}
              role="tab"
              aria-selected={currentTab === 'todo'}
            >
              Todo
            </button>
            <button
              onClick={() => setCurrentTab('analytics')}
              className={`v-tab-btn${currentTab === 'analytics' ? ' active' : ''}`}
              role="tab"
              aria-selected={currentTab === 'analytics'}
            >
              Analytics
            </button>
            <button
              onClick={() => setCurrentTab('settings')}
              className={`v-tab-btn${currentTab === 'settings' ? ' active' : ''}`}
              role="tab"
              aria-selected={currentTab === 'settings'}
            >
              Settings
            </button>
          </div>

          {/* Active Screen Content (Spacious & Clean) */}
          <div style={{ padding: isPhone ? '20px 16px' : '28px 32px' }}>
            {currentTab === 'todo' && (
              <TodoScreen
                currentDate={currentDate}
                onChangeDate={setCurrentDate}
                isPhone={isPhone}
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
    </div>
  );
}
