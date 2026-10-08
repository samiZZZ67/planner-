'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { db, seedDefaultSectionsIfEmpty, requestPersistentStorage } from '@/lib/db';
import { registerServiceWorker } from '@/lib/pwa/registerSw';
import { useDeviceType } from '@/lib/hooks/useDeviceType';
import { useTimer } from '@/lib/timer/useTimer';
import { getDefaultPlanningDate } from '@/lib/plan/autoPlan';

import { Header } from '@/components/Header';
import { PCSidebar } from '@/components/Navigation/PCSidebar';
import { PhoneTabBar, type TabType } from '@/components/Navigation/PhoneTabBar';
import { UpdateBanner } from '@/components/Navigation/UpdateBanner';

import { PlanScreen } from '@/components/Plan/PlanScreen';
import { TodayScreen } from '@/components/Today/TodayScreen';
import { ProgressScreen } from '@/components/Progress/ProgressScreen';
import { SettingsScreen } from '@/components/Settings/SettingsScreen';

import { TaskFormModal } from '@/components/Modals/TaskFormModal';
import { ImagePreviewModal } from '@/components/Modals/ImagePreviewModal';
import { ManualTimeModal } from '@/components/Modals/ManualTimeModal';
import { AutoPlanReviewModal } from '@/components/Modals/AutoPlanReviewModal';
import { LoginModal } from '@/components/Modals/LoginModal';

import type { Section, Task } from '@/types';

export default function NightPlannerApp() {
  const { isPhone, isPC } = useDeviceType();
  const { isTimerRunning, pauseTimer, resumeTimer, activeTimer } = useTimer();

  // Mount Guard for Offline Client SPA & Next 16 Prerender Safety
  const [isMounted, setIsMounted] = useState(false);

  // Navigation & Date State
  const [currentTab, setCurrentTab] = useState<TabType>('plan');
  const [currentDate, setCurrentDate] = useState<string>('2026-01-01');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Modals & Panels State
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);
  const [manualTimeTarget, setManualTimeTarget] = useState<{ taskId: string; title: string } | null>(null);
  const [autoPlanState, setAutoPlanState] = useState<{
    isOpen: boolean;
    previousDate: string;
    candidateTasks: Task[];
  }>({
    isOpen: false,
    previousDate: '',
    candidateTasks: [],
  });
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  // Sections State
  const [sections, setSections] = useState<Section[]>([]);

  // 1. Initial Lifecycle Setup
  useEffect(() => {
    setIsMounted(true);
    setCurrentDate(getDefaultPlanningDate());

    // Register PWA service worker
    registerServiceWorker();

    // Ask browser for persistent storage
    requestPersistentStorage();

    // Seed default sections
    seedDefaultSectionsIfEmpty().then(() => {
      loadSections();
    });

    // Theme initialization
    const savedTheme = (localStorage.getItem('np_theme') as 'dark' | 'light') || 'dark';
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  const loadSections = useCallback(async () => {
    const list = await db.sections.filter(s => !s.deleted).toArray();
    list.sort((a, b) => a.order - b.order);
    setSections(list);
  }, []);

  // Poll sections periodically to keep in sync with local edits
  useEffect(() => {
    const interval = setInterval(loadSections, 3000);
    return () => clearInterval(interval);
  }, [loadSections]);

  // Theme Toggle Handler
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('np_theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  // Keyboard Shortcuts (PC UI)
  useEffect(() => {
    if (!isPC) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing in an input or textarea
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = targetTag === 'input' || targetTag === 'textarea' || (e.target as HTMLElement)?.isContentEditable;

      if (isInput) return;

      if (e.key === '1') {
        e.preventDefault();
        setCurrentTab('plan');
      } else if (e.key === '2') {
        e.preventDefault();
        setCurrentTab('today');
      } else if (e.key === '3') {
        e.preventDefault();
        setCurrentTab('progress');
      } else if (e.key === '4') {
        e.preventDefault();
        setCurrentTab('settings');
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setEditingTask(null);
        setIsTaskModalOpen(true);
      } else if (e.key === ' ' && activeTimer) {
        // Space to toggle timer on active task
        e.preventDefault();
        if (isTimerRunning) pauseTimer();
        else resumeTimer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPC, activeTimer, isTimerRunning, pauseTimer, resumeTimer]);

  const handleOpenTaskModal = (task?: Task | null) => {
    setEditingTask(task || null);
    setIsTaskModalOpen(true);
  };

  if (!isMounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary text-text-primary">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center shadow-xl shadow-purple-900/40 animate-pulse">
            <span className="text-2xl">🌙</span>
          </div>
          <span className="font-bloody text-lg tracking-wider">Night Planner</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg-primary text-text-primary selection:bg-purple-600 selection:text-white">
      {/* PWA Update Reload Banner */}
      <UpdateBanner />

      {/* Top Header */}
      <Header
        onOpenLogin={() => setIsLoginModalOpen(true)}
        isPC={isPC}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenNewTask={() => handleOpenTaskModal(null)}
      />

      <div className="flex-1 flex w-full">
        {/* PC Sidebar Navigation */}
        {isPC && (
          <PCSidebar
            currentTab={currentTab}
            onSelectTab={setCurrentTab}
            onOpenNewTask={() => handleOpenTaskModal(null)}
          />
        )}

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 lg:p-8">
          {currentTab === 'plan' && (
            <PlanScreen
              currentDate={currentDate}
              onChangeDate={setCurrentDate}
              sections={sections}
              onOpenTaskModal={handleOpenTaskModal}
              onPreviewImage={(url, title) => setPreviewImage({ url, title })}
              onOpenAutoPlan={(prevDate, tasks) => {
                setAutoPlanState({
                  isOpen: true,
                  previousDate: prevDate,
                  candidateTasks: tasks,
                });
              }}
              isPhone={isPhone}
            />
          )}

          {currentTab === 'today' && (
            <TodayScreen
              sections={sections}
              onOpenManualTime={(taskId, title) => setManualTimeTarget({ taskId, title })}
              onPreviewImage={(url, title) => setPreviewImage({ url, title })}
              isPhone={isPhone}
            />
          )}

          {currentTab === 'progress' && (
            <ProgressScreen
              sections={sections}
              isPhone={isPhone}
            />
          )}

          {currentTab === 'settings' && (
            <SettingsScreen
              theme={theme}
              onToggleTheme={toggleTheme}
              sections={sections}
              onOpenLogin={() => setIsLoginModalOpen(true)}
              isPhone={isPhone}
            />
          )}
        </main>
      </div>

      {/* Phone Bottom Tab Bar */}
      {isPhone && (
        <PhoneTabBar
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          onOpenNewTask={() => handleOpenTaskModal(null)}
        />
      )}

      {/* Task Creation & Editing Modal */}
      <TaskFormModal
        isOpen={isTaskModalOpen}
        onClose={() => {
          setIsTaskModalOpen(false);
          setEditingTask(null);
        }}
        currentDate={currentDate}
        sections={sections}
        existingTask={editingTask}
        onPreviewImage={(url, title) => setPreviewImage({ url, title })}
        isPhone={isPhone}
      />

      {/* Image Preview Modal */}
      <ImagePreviewModal
        imageUrl={previewImage?.url || null}
        title={previewImage?.title || ''}
        onClose={() => setPreviewImage(null)}
      />

      {/* Manual Time Logging Modal */}
      <ManualTimeModal
        taskId={manualTimeTarget?.taskId || null}
        taskTitle={manualTimeTarget?.title || ''}
        isOpen={!!manualTimeTarget}
        onClose={() => setManualTimeTarget(null)}
      />

      {/* Automated Plan from Previous Day Review Modal */}
      <AutoPlanReviewModal
        isOpen={autoPlanState.isOpen}
        onClose={() => setAutoPlanState(prev => ({ ...prev, isOpen: false }))}
        targetDate={currentDate}
        previousDate={autoPlanState.previousDate}
        candidateTasks={autoPlanState.candidateTasks}
        sections={sections}
        onTasksImported={() => {
          // Trigger refresh
        }}
      />

      {/* Login Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
      />
    </div>
  );
}
