'use client';

import React, { useState, useEffect, useRef } from 'react';
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
import { BookPlannerScreen } from '@/components/Books/BookPlannerScreen';
import { LoginModal } from '@/components/Modals/LoginModal';
import { MasterLockScreen } from '@/components/Auth/MasterLockScreen';
import { AIChatPanel } from '@/components/Chat/AIChatPanel';
import { FreeLLMAssistant } from '@/components/FreeLLM/FreeLLMAssistant';
import { apiFetch } from '@/lib/api/apiClient';
import { ActionFeedbackHost } from '@/components/Shared/ActionFeedbackHost';
import { getTraditionalDayDate } from '@/lib/date/ethiopianTime';

export default function SamsSpaceApp() {
  const { isPhone, isPC } = useDeviceType();
  const { isTimerRunning, pauseTimer, resumeTimer, startTimer, stopTimer, activeTimer } = useTimer();

  // Mount Guard for Offline Client SPA & Next 16 Safety
  const [isMounted, setIsMounted] = useState(false);
  // Full-Site Master Password Gate: null = verifying, false = locked, true = unlocked
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  // 4 Primary Views: add_task | note | todo | category (plus analytics | settings)
  const [currentTab, setCurrentTab] = useState<TabType>('todo');
  const [currentDate, setCurrentDate] = useState<string>('2026-01-01');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);

  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isAIChatOpen, setIsAIChatOpen] = useState(false);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string>('/icons/icon-192.png');
  const [returnBookId, setReturnBookId] = useState<string | null>(null);
  const [returnAssignmentId, setReturnAssignmentId] = useState<string | null>(null);

  // Draggable Launcher Button State
  const [btnPos, setBtnPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragInfoRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);

  const clampPosition = (x: number, y: number) => {
    const btnSize = 48;
    const margin = 12;
    const maxX = typeof window !== 'undefined' ? window.innerWidth - btnSize - margin : 500;
    const maxY = typeof window !== 'undefined' ? window.innerHeight - btnSize - margin : 500;
    return {
      x: Math.max(margin, Math.min(maxX, x)),
      y: Math.max(margin, Math.min(maxY, y)),
    };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const currentPos = btnPos || clampPosition(
      window.innerWidth - (isPhone ? 64 : 76),
      window.innerHeight - (isPhone ? 132 : 76)
    );

    dragInfoRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: currentPos.x,
      origY: currentPos.y,
      moved: false,
    };

    const handlePointerMove = (moveEvt: PointerEvent) => {
      if (!dragInfoRef.current) return;
      const dx = moveEvt.clientX - dragInfoRef.current.startX;
      const dy = moveEvt.clientY - dragInfoRef.current.startY;
      if (Math.hypot(dx, dy) > 4) {
        dragInfoRef.current.moved = true;
        setIsDragging(true);
        const newPos = clampPosition(
          dragInfoRef.current.origX + dx,
          dragInfoRef.current.origY + dy
        );
        setBtnPos(newPos);
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      setIsDragging(false);

      if (dragInfoRef.current && !dragInfoRef.current.moved) {
        setIsAIChatOpen(true);
      }
      dragInfoRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // Lifecycle Initialization
  useEffect(() => {
    setIsMounted(true);

    const onResize = () => {
      setBtnPos(prev => prev ? clampPosition(prev.x, prev.y) : null);
    };
    window.addEventListener('resize', onResize);

    // Default planning date to active traditional Ethiopian day (6:00 AM Addis Ababa boundary) or Gregorian
    const savedMode = typeof window !== 'undefined' ? localStorage.getItem('np_calendar_mode') : null;
    const today = savedMode === 'gregorian'
      ? new Date().toLocaleDateString('en-CA')
      : getTraditionalDayDate(new Date(), 'Africa/Addis_Ababa');
    setCurrentDate(today);

    // Deep link support: inspect ?tab=... and ?quiz=... on initial mount
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const requestedQuiz = searchParams.get('quiz');
      const requestedTab = searchParams.get('tab');
      const requestedBookId = searchParams.get('bookId');
      const requestedAssignmentId = searchParams.get('assignmentId');
      if (requestedTab === 'books' && requestedAssignmentId) {
        if (requestedBookId) setReturnBookId(requestedBookId);
        setReturnAssignmentId(requestedAssignmentId);
      }
      if (requestedQuiz) {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('quiz');
        window.history.replaceState({}, '', cleanUrl.pathname + (cleanUrl.search ? cleanUrl.search : ''));
        const returnTo = `/?tab=books&assignmentId=${encodeURIComponent(requestedQuiz)}`;
        window.location.replace(`/quiz?assignmentId=${encodeURIComponent(requestedQuiz)}&returnTo=${encodeURIComponent(returnTo)}`);
        return;
      } else if (requestedTab && ['todo', 'weekly', 'monthly', 'add_task', 'note', 'category', 'books', 'analytics', 'settings'].includes(requestedTab)) {
        setCurrentTab(requestedTab as TabType);
      }
    }

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

    // Profile avatar for Sam's AI
    const savedAvatar = localStorage.getItem('np_sams_ai_avatar');
    if (savedAvatar) setProfileAvatarUrl(savedAvatar);

    // Voice assistant navigation listener
    const handleVoiceNavigate = (e: any) => {
      if (e.detail?.tab) setCurrentTab(e.detail.tab);
      if (e.detail?.date) setCurrentDate(e.detail.date);
    };
    window.addEventListener('np-navigate', handleVoiceNavigate);

    // Full-Site Master Password Verification
    async function verifyAuthStatus() {
      const token = typeof window !== 'undefined' ? localStorage.getItem('np_session_token') : null;
      if (!token) {
        setIsAuthenticated(false);
        return;
      }
      try {
        const res = await apiFetch('/api/auth/verify', { method: 'GET' });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data && data.authenticated) {
            setIsAuthenticated(true);
            return;
          }
        }
        if (typeof window !== 'undefined') localStorage.removeItem('np_session_token');
        setIsAuthenticated(false);
      } catch {
        // Offline resilience: if token exists locally, allow offline planner access
        if (token) {
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
      }
    }
    verifyAuthStatus();

    // Live Action Listeners (Sam's Space)
    const handleNavigate = (e: any) => {
      const tab = e?.detail?.tab;
      if (tab) setCurrentTab(tab as TabType);
    };

    const handleTimerAction = (e: any) => {
      const detail = e?.detail;
      if (!detail) return;
      if (detail.action === 'start') {
        startTimer(detail.taskId, detail.taskTitle, detail.minutes || 25);
      } else if (detail.action === 'pause') {
        pauseTimer();
      } else if (detail.action === 'stop') {
        stopTimer();
      }
    };

    window.addEventListener('samsspace:navigate', handleNavigate);
    window.addEventListener('samsspace:timer-action', handleTimerAction);
    window.addEventListener('nightplanner:navigate', handleNavigate);
    window.addEventListener('nightplanner:timer-action', handleTimerAction);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('samsspace:navigate', handleNavigate);
      window.removeEventListener('samsspace:timer-action', handleTimerAction);
      window.removeEventListener('nightplanner:navigate', handleNavigate);
      window.removeEventListener('nightplanner:timer-action', handleTimerAction);
    };
  }, [startTimer, pauseTimer, stopTimer]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('np_theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  const handleLogout = async () => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('np_session_token');
      }
      setIsAuthenticated(false);
      await apiFetch('/api/logout', { method: 'POST' });
    } catch {
      // Offline fallback
      if (typeof window !== 'undefined') {
        localStorage.removeItem('np_session_token');
      }
      setIsAuthenticated(false);
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
      } else if (e.key === '9') {
        e.preventDefault();
        setCurrentTab('books');
      } else if (e.key === ' ' && activeTimer) {
        e.preventDefault();
        if (isTimerRunning) pauseTimer();
        else resumeTimer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPC, activeTimer, isTimerRunning, pauseTimer, resumeTimer, isLoginModalOpen]);

  if (!isMounted || isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b0b0d] text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-xl border border-white/20 flex items-center justify-center shadow-[0_0_35px_rgba(201,201,204,0.16)] animate-pulse overflow-hidden">
            <img
              src="/icons/icon-192.png"
              alt="Sam'Space"
              className="w-full h-full object-cover"
            />
          </div>
          <span className="font-bloody text-xl tracking-wider text-white/90">Sam'Space</span>
        </div>
      </div>
    );
  }

  if (isAuthenticated === false) {
    return (
      <MasterLockScreen
        onUnlock={() => setIsAuthenticated(true)}
        theme={theme}
      />
    );
  }

  return (
    <div className="min-h-screen relative flex flex-col items-center justify-start overflow-x-hidden selection:bg-sky-500/30 selection:text-white">
      <ActionFeedbackHost />
      {/* ── 1. Room Backdrop ── */}
      <div className="vision-room-bg" />

      {/* ── 2. Service Worker Update Notification Banner ── */}
      <UpdateBanner />

      {/* ── 3. Floating Glass Header Bar ── */}
      <Header
        onOpenLogin={() => setIsLoginModalOpen(true)}
        onLockSession={handleLogout}
        isPC={isPC}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenAIChat={() => setIsAIChatOpen(true)}
      />

      {/* ── 4. Main Spacious Workspace ── */}
      <div
        className="app-workspace-shell"
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
          className="v-window app-content-window"
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
            <button
              onClick={() => setCurrentTab('books')}
              className={`v-tab-btn${currentTab === 'books' ? ' active' : ''}`}
              role="tab"
              aria-selected={currentTab === 'books'}
              style={{ whiteSpace: 'nowrap' }}
            >
              Book Planner
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
          <div className="app-main-content" style={{ padding: isPhone ? '20px 16px' : '28px 32px' }}>
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
                onChangeDate={setCurrentDate}
                isPhone={isPhone}
                focusTaskId={focusTaskId}
                onClearFocus={() => setFocusTaskId(null)}
              />
            )}

            {currentTab === 'books' && (
              <BookPlannerScreen
                initialBookId={returnBookId || undefined}
                initialAssignmentId={returnAssignmentId || undefined}
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

      {/* ── 7. Floating Draggable Profile Button for Sam's AI ── */}
      {!isAIChatOpen && (
        <button
          onPointerDown={handlePointerDown}
          className="v-pill-btn"
          aria-label="Open Sam’s AI (Draggable)"
          title="Drag to reposition • Click to open Sam’s AI"
          style={{
            position: 'fixed',
            ...(btnPos
              ? { left: btnPos.x, top: btnPos.y, right: 'auto', bottom: 'auto' }
              : { right: isPhone ? 16 : 28, bottom: isPhone ? 84 : 28 }),
            zIndex: 45,
            width: 50,
            height: 50,
            borderRadius: '50%',
            padding: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--v-glass-bg)',
            backdropFilter: 'blur(24px) saturate(170%)',
            WebkitBackdropFilter: 'blur(24px) saturate(170%)',
            border: '1.5px solid var(--v-glass-border-bright)',
            boxShadow: isDragging
              ? '0 14px 32px rgba(0, 0, 0, 0.7), 0 0 28px var(--accent-glow)'
              : '0 8px 24px rgba(0, 0, 0, 0.4), 0 0 16px var(--accent-glow)',
            cursor: isDragging ? 'grabbing' : 'grab',
            touchAction: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease',
            transform: isDragging ? 'scale(1.12)' : undefined,
          }}
          onMouseEnter={e => { if (!isDragging) e.currentTarget.style.transform = 'scale(1.08)'; }}
          onMouseLeave={e => { if (!isDragging) e.currentTarget.style.transform = 'scale(1)'; }}
        >
          <img
            src={profileAvatarUrl}
            alt="Sam’s AI Profile"
            style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', pointerEvents: 'none' }}
            onError={() => setProfileAvatarUrl('/icons/icon-192.png')}
          />
        </button>
      )}

      {/* ── 8. AI Chat Assistant Panel ── */}
      <AIChatPanel
        isOpen={isAIChatOpen}
        onClose={() => setIsAIChatOpen(false)}
        currentDate={currentDate}
        isPhone={isPhone}
        theme={theme}
      />

      {/* ── 9. Independent FreeLLMAPI Assistant (Movable, Expandable AI Moon Button) ── */}
      <FreeLLMAssistant
        isPhone={isPhone}
        theme={theme}
        currentTab={currentTab}
        onNavigateTab={setCurrentTab}
        currentDate={currentDate}
      />
    </div>
  );
}
