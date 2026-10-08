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

import {
  Plus, MoreHorizontal, Bookmark, Heart, MessageSquare, Repeat2, Send,
  Flame, Sparkles, CheckCircle2, Shield
} from 'lucide-react';
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

  // Quick Inline Task State (What's new? compose bar)
  const [quickTitle, setQuickTitle] = useState('');
  const [quickTime, setQuickTime] = useState<number>(30);
  const [quickPriority, setQuickPriority] = useState<'High' | 'Medium' | 'Low'>('Medium');

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
  const [taskCount, setTaskCount] = useState({ total: 0, completed: 0 });

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

    const allTasks = await db.tasks.filter(t => !t.deleted).toArray();
    setTaskCount({
      total: allTasks.length,
      completed: allTasks.filter(t => t.isCompleted).length,
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(loadSections, 3000);
    return () => clearInterval(interval);
  }, [loadSections]);

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
      // Guard against modal interactions
      if (isTaskModalOpen || !!previewImage || !!manualTimeTarget || autoPlanState.isOpen || isLoginModalOpen) {
        return;
      }

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
        e.preventDefault();
        if (isTimerRunning) pauseTimer();
        else resumeTimer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPC, activeTimer, isTimerRunning, pauseTimer, resumeTimer, isTaskModalOpen, previewImage, manualTimeTarget, autoPlanState.isOpen, isLoginModalOpen]);

  const handleOpenTaskModal = (task?: Task | null) => {
    setEditingTask(task || null);
    setIsTaskModalOpen(true);
  };

  // Quick inline task creation from the VisionOS "What's new?" composer
  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTitle.trim()) return;

    const defaultSec = sections[0]?.id || 'default-sec-1';
    const now = Date.now();
    const newTask: Task = {
      id: crypto.randomUUID(),
      date: currentDate,
      sectionId: defaultSec,
      title: quickTitle.trim(),
      description: '',
      strategy: '',
      doneMeans: 'Completed as planned',
      estimatedMinutes: quickTime,
      priority: quickPriority,
      mustDo: false,
      tags: [],
      icon: '⚡',
      textColor: '',
      isCompleted: false,
      completedAt: null,
      order: taskCount.total,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      isSample: false,
      synced: 0,
    };

    await db.tasks.put(newTask);
    setQuickTitle('');
    loadSections();
  };

  if (!isMounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#121214] text-white">
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
    <div className="min-h-screen relative flex flex-col items-center justify-start overflow-x-hidden selection:bg-white/20 selection:text-white">
      {/* ── 1. Photorealistic Vision Pro Room Background ── */}
      <div className="vision-room-bg" />

      {/* ── Top Left Title Badge (matching "#5. Profile - Threads Vision Pro. UI Design") ── */}
      <div
        style={{
          position: 'fixed',
          top: 20,
          left: 28,
          zIndex: 30,
          pointerEvents: 'none',
          display: isPhone ? 'none' : 'block',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: '#ffffff' }}>
          Night Planner
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.45)', marginTop: 1 }}>
          Vision Pro Spatial UI
        </div>
      </div>

      {/* ── Update Notification Banner ── */}
      <UpdateBanner />

      {/* ── Floating Spatial Header Bar ── */}
      <Header
        onOpenLogin={() => setIsLoginModalOpen(true)}
        isPC={isPC}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenNewTask={() => handleOpenTaskModal(null)}
      />

      {/* ── Spatial Floating App Content Workspace ── */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          width: '100%',
          maxWidth: 960,
          margin: '0 auto',
          padding: isPhone ? '12px 14px 100px' : '16px 20px 80px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
        }}
      >
        {/* ── Left Floating Vertical Capsule Dock (matching reference image) ── */}
        {isPC && (
          <PCSidebar
            currentTab={currentTab}
            onSelectTab={setCurrentTab}
            onOpenNewTask={() => handleOpenTaskModal(null)}
          />
        )}

        {/* ── Main Central Floating Spatial Window (matching reference image) ── */}
        <div style={{ flex: 1, maxWidth: 740, width: '100%' }}>
          {/* Window Spatial Header (floating above the card) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              marginBottom: 10,
            }}
          >
            <div
              className="v-pill-btn"
              style={{
                padding: '4px 14px',
                fontSize: 12,
                fontWeight: 600,
                color: 'rgba(255, 255, 255, 0.85)',
                background: 'rgba(30, 30, 36, 0.65)',
                cursor: 'default',
              }}
            >
              {currentTab === 'plan' && 'Night Plan'}
              {currentTab === 'today' && 'Today Focus'}
              {currentTab === 'progress' && 'Analytics'}
              {currentTab === 'settings' && 'Settings'}
            </div>

            <button
              onClick={() => setIsTaskModalOpen(true)}
              className="v-circle-btn"
              style={{ position: 'absolute', right: 4, width: 32, height: 32 }}
              aria-label="Options menu"
              title="New Plan (N)"
            >
              <MoreHorizontal size={14} />
            </button>
          </div>

          {/* Main Frosted Glass Window */}
          <main className="v-window">
            {/* ── Card Header (Profile & Identity Block) ── */}
            <div style={{ padding: '24px 28px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div>
                  <h1 className="font-bloody" style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#ffffff', letterSpacing: '0.02em' }}>
                    NIGHT ARCHITECT
                  </h1>
                  <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.5)', marginTop: 2 }}>
                    plan.nightly
                  </div>
                </div>

                {/* Circular Character Avatar (matching sketch avatar in reference image) */}
                <div
                  style={{
                    width: 58,
                    height: 58,
                    borderRadius: '50%',
                    background: '#ffffff',
                    border: '3px solid rgba(255, 255, 255, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                    flexShrink: 0,
                    overflow: 'hidden',
                  }}
                >
                  {/* Stylized Avatar Illustration */}
                  <div style={{ fontSize: 28 }}>🌙</div>
                </div>
              </div>

              {/* Bio & Intent Tagline */}
              <p style={{ margin: '14px 0 10px', fontSize: 13, color: 'rgba(255, 255, 255, 0.82)', lineHeight: 1.55 }}>
                🚀 Plan at night with crystal clarity | <span style={{ color: '#60a5fa' }}>What</span> • <span style={{ color: '#a78bfa' }}>How</span> • <span style={{ color: '#34d399' }}>How long</span> • <span style={{ color: '#fbbf24' }}>Done means</span>
              </p>

              {/* Metrics / Status Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16, fontSize: 12, color: 'rgba(255, 255, 255, 0.5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Flame size={14} style={{ color: '#f59e0b' }} />
                  <span>14 Day Streak</span>
                </div>
                <span>•</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Shield size={14} style={{ color: '#34d399' }} />
                  <span>100% Offline IndexedDB</span>
                </div>
                <span>•</span>
                <span>{taskCount.completed} done</span>
              </div>

              {/* Action Button: "Edit Plan & Schedule" (matching "Edit Profile" in image) */}
              <button
                onClick={() => handleOpenTaskModal(null)}
                className="v-pill-btn"
                style={{ width: '100%', padding: '10px 20px', fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,0.06)' }}
              >
                + New Clear Plan
              </button>
            </div>

            {/* ── Segmented Tabs (matching "Threads | Replies | Reposts") ── */}
            <div className="v-tabs" role="tablist">
              <button
                onClick={() => setCurrentTab('plan')}
                className={`v-tab-btn${currentTab === 'plan' ? ' active' : ''}`}
                role="tab"
                aria-selected={currentTab === 'plan'}
              >
                Plan Tomorrow
              </button>
              <button
                onClick={() => setCurrentTab('today')}
                className={`v-tab-btn${currentTab === 'today' ? ' active' : ''}`}
                role="tab"
                aria-selected={currentTab === 'today'}
              >
                Today
              </button>
              <button
                onClick={() => setCurrentTab('progress')}
                className={`v-tab-btn${currentTab === 'progress' ? ' active' : ''}`}
                role="tab"
                aria-selected={currentTab === 'progress'}
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

            {/* ── Quick Compose Bar (matching "What's new? Post") ── */}
            <form
              onSubmit={handleQuickAdd}
              style={{
                padding: '14px 24px',
                borderBottom: '1px solid var(--v-glass-border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    background: 'rgba(255, 255, 255, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    flexShrink: 0,
                  }}
                >
                  ⚡
                </div>

                <input
                  type="text"
                  value={quickTitle}
                  onChange={e => setQuickTitle(e.target.value)}
                  placeholder="What will you accomplish tomorrow?"
                  className="v-input"
                  style={{ flex: 1, height: 38, fontSize: 13, padding: '0 14px' }}
                />

                <button
                  type="submit"
                  disabled={!quickTitle.trim()}
                  className="v-pill-btn v-pill-btn-primary"
                  style={{ height: 38, padding: '0 18px', fontSize: 12, opacity: !quickTitle.trim() ? 0.35 : 1 }}
                >
                  Plan
                </button>
              </div>

              {/* Time & Priority Selector Pills at bottom of quick compose */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingLeft: 46,
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                {/* Time duration buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginRight: 2 }}>Duration:</span>
                  {[15, 30, 45, 60, 120].map(mins => {
                    const isSelected = quickTime === mins;
                    return (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => setQuickTime(mins)}
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '3px 7px',
                          borderRadius: 6,
                          border: isSelected ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                          background: isSelected ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                          color: isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.5)',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >
                        {mins >= 60 ? `${mins / 60}h` : `${mins}m`}
                      </button>
                    );
                  })}
                </div>

                {/* Difficulty buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginRight: 2 }}>Difficulty:</span>
                  {(['High', 'Medium', 'Low'] as const).map(lvl => {
                    const label = lvl === 'High' ? 'Hard' : lvl;
                    const isSelected = quickPriority === lvl;
                    const color = lvl === 'High' ? '#f87171' : lvl === 'Medium' ? '#fbbf24' : '#34d399';
                    const bgColor = lvl === 'High' ? 'rgba(239,68,68,0.22)' : lvl === 'Medium' ? 'rgba(245,158,11,0.22)' : 'rgba(16,185,129,0.22)';
                    const borderColor = lvl === 'High' ? 'rgba(239,68,68,0.55)' : lvl === 'Medium' ? 'rgba(245,158,11,0.55)' : 'rgba(16,185,129,0.55)';

                    return (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setQuickPriority(lvl)}
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: 6,
                          border: isSelected ? `1px solid ${borderColor}` : '1px solid rgba(255, 255, 255, 0.1)',
                          background: isSelected ? bgColor : 'rgba(255, 255, 255, 0.04)',
                          color: isSelected ? color : 'rgba(255, 255, 255, 0.45)',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </form>

            {/* ── Active Screen Feed Content ── */}
            <div style={{ padding: '20px 24px' }}>
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
                  setSections={setSections}
                  onOpenLogin={() => setIsLoginModalOpen(true)}
                  isPhone={isPhone}
                />
              )}
            </div>

            {/* ── Window Bottom Reaction & Metrics Bar (matching image) ── */}
            <div
              style={{
                padding: '14px 28px',
                borderTop: '1px solid var(--v-glass-border-subtle)',
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                fontSize: 12,
                color: 'rgba(255, 255, 255, 0.45)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Heart size={14} style={{ color: '#f43f5e' }} />
                <span>{taskCount.completed} done</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <MessageSquare size={14} />
                <span>{taskCount.total} total</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Repeat2 size={14} style={{ color: '#a78bfa' }} />
                <span>Delta Sync</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                <CheckCircle2 size={13} style={{ color: '#34d399' }} />
                <span>Offline Persistent</span>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* ── 3. Lower Left Floating Profile Widget (matching reference image) ── */}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          left: 28,
          zIndex: 40,
          display: isPhone ? 'none' : 'block',
        }}
      >
        <div className="v-floating-widget">
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}
          >
            🌙
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#ffffff' }}>@night.planner</div>
            <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.5)' }}>Night Architect</div>
          </div>
        </div>
      </div>

      {/* ── 4. Lower Right Floating Squircle '+' Action Button (matching reference image) ── */}
      <button
        onClick={() => handleOpenTaskModal(null)}
        className="v-floating-squircle"
        style={{
          position: 'fixed',
          bottom: isPhone ? 88 : 36,
          right: isPhone ? 20 : 160,
          zIndex: 50,
        }}
        title="Add New Plan (+)"
        aria-label="Add new plan"
      >
        <Plus size={26} strokeWidth={2.5} />
      </button>

      {/* ── 5. Lower Right Floating 'Save for later' Badge (matching reference image) ── */}
      <div
        style={{
          position: 'fixed',
          bottom: 36,
          right: 28,
          zIndex: 40,
          display: isPhone ? 'none' : 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
        }}
        onClick={() => handleOpenTaskModal(null)}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.01em' }}>
          Save for later
        </span>
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: 'rgba(255, 255, 255, 0.9)',
            color: '#000000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Bookmark size={14} style={{ fill: '#000000' }} />
        </div>
      </div>

      {/* ── Phone Bottom Floating Capsule Navigation Dock ── */}
      {isPhone && (
        <PhoneTabBar
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          onOpenNewTask={() => handleOpenTaskModal(null)}
        />
      )}

      {/* ── Modals (All Retaining 100% Functionality) ── */}
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

      <ImagePreviewModal
        imageUrl={previewImage?.url || null}
        title={previewImage?.title || ''}
        onClose={() => setPreviewImage(null)}
      />

      <ManualTimeModal
        taskId={manualTimeTarget?.taskId || null}
        taskTitle={manualTimeTarget?.title || ''}
        isOpen={!!manualTimeTarget}
        onClose={() => setManualTimeTarget(null)}
      />

      <AutoPlanReviewModal
        isOpen={autoPlanState.isOpen}
        onClose={() => setAutoPlanState(prev => ({ ...prev, isOpen: false }))}
        targetDate={currentDate}
        previousDate={autoPlanState.previousDate}
        candidateTasks={autoPlanState.candidateTasks}
        sections={sections}
        onTasksImported={() => loadSections()}
      />

      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
      />
    </div>
  );
}
