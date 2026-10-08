'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { useTimer } from '@/lib/timer/useTimer';
import {
  Calendar, Check, Play, Pause, Square as StopIcon,
  Trash2, Edit2, Plus, Sparkles, Clock, ChevronLeft, ChevronRight,
  Bold as BoldIcon, Underline as UnderlineIcon, Strikethrough as StrikethroughIcon,
  Palette, Bell, BellOff, AlertTriangle, FileText, ChevronDown, ChevronUp, Eye, Edit3
} from 'lucide-react';
import type { Task, TimeLog, Day, DayReview } from '@/types';

interface TodoScreenProps {
  currentDate: string;
  onChangeDate: (date: string) => void;
  isPhone: boolean;
}

const COLOR_OPTIONS = [
  { label: 'Red', value: '#ef4444', ring: 'rgba(239, 68, 68, 0.4)' },
  { label: 'Blue', value: '#38bdf8', ring: 'rgba(56, 189, 248, 0.4)' },
  { label: 'Green', value: '#22c55e', ring: 'rgba(34, 197, 94, 0.4)' },
  { label: 'Amber', value: '#f59e0b', ring: 'rgba(245, 158, 11, 0.4)' },
  { label: 'Default', value: '', ring: 'rgba(255, 255, 255, 0.3)' },
];

/**
 * Safely render text that may contain HTML formatting tags (<b>, <u>, <s>, <span style="...">)
 */
function FormattedText({ text, style, className }: { text?: string; style?: React.CSSProperties; className?: string }) {
  if (!text) return null;
  if (text.includes('<b') || text.includes('<u') || text.includes('<s') || text.includes('<span')) {
    return <span className={className} style={style} dangerouslySetInnerHTML={{ __html: text }} />;
  }
  return <span className={className} style={style}>{text}</span>;
}

export function TodoScreen({ currentDate, onChangeDate, isPhone }: TodoScreenProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);

  // Add Task Inputs & Formatting State
  const [title, setTitle] = useState('');
  const [strategy, setStrategy] = useState('');
  const [targetMinutes, setTargetMinutes] = useState(25);
  const [isBold, setIsBold] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [textColor, setTextColor] = useState('');

  // Active focused input ref for formatting toolbar
  const activeInputRef = useRef<{
    element: HTMLInputElement | HTMLTextAreaElement | null;
    setter: (val: string) => void;
    getValue: () => string;
  } | null>(null);

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const strategyInputRef = useRef<HTMLInputElement | null>(null);

  // Inline editing state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editStrategy, setEditStrategy] = useState('');
  const [editBold, setEditBold] = useState(false);
  const [editUnderline, setEditUnderline] = useState(false);
  const [editStrikethrough, setEditStrikethrough] = useState(false);
  const [editColor, setEditColor] = useState('');

  // Time & Pomodoro Duration Setup Modal State
  const [timeModalTask, setTimeModalTask] = useState<Task | null>(null);
  const [modalDuration, setModalDuration] = useState<number>(25);
  const [customMinutesInput, setCustomMinutesInput] = useState<string>('25');

  // Notes & Reflection State (NOT called Daily Summary)
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [noteTab, setNoteTab] = useState<'write' | 'dashboard'>('write');
  const [review, setReview] = useState<DayReview>({
    worked: '',
    blocked: '',
    change: '',
    obstacles: '',
    happened: '',
    solved: '',
    betterTomorrow: '',
  });
  const [noteSaved, setNoteSaved] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Note textarea refs for text selection formatting
  const obstaclesRef = useRef<HTMLTextAreaElement | null>(null);
  const happenedRef = useRef<HTMLTextAreaElement | null>(null);
  const solvedRef = useRef<HTMLTextAreaElement | null>(null);
  const improveRef = useRef<HTMLTextAreaElement | null>(null);

  // Pomodoro Timer hook
  const {
    activeTimer,
    formattedCountdown,
    isFocus,
    isBreak,
    isTimerRunning,
    currentSessionNumber,
    totalSessions,
    expectedCompletionFormatted,
    notificationStatus,
    enableNotifications,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    skipBreak,
  } = useTimer();

  // Load daily tasks, time logs, and notes
  const loadData = async () => {
    const dayTasks = await db.tasks.filter(t => t.date === currentDate && !t.deleted).toArray();
    dayTasks.sort((a, b) => a.order - b.order);

    const dayLogs = await db.timeLogs.filter(tl => tl.date === currentDate && !tl.deleted).toArray();

    const dayRecord = await db.days.get(currentDate);
    if (dayRecord && dayRecord.review) {
      setReview({
        worked: dayRecord.review.worked || '',
        blocked: dayRecord.review.blocked || '',
        change: dayRecord.review.change || '',
        obstacles: dayRecord.review.obstacles || '',
        happened: dayRecord.review.happened || '',
        solved: dayRecord.review.solved || '',
        betterTomorrow: dayRecord.review.betterTomorrow || '',
      });
    } else {
      setReview({
        worked: '',
        blocked: '',
        change: '',
        obstacles: '',
        happened: '',
        solved: '',
        betterTomorrow: '',
      });
    }

    setTasks(dayTasks);
    setTimeLogs(dayLogs);
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2000);
    const unsubscribe = syncEngine.subscribe(() => {
      loadData();
    });
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [currentDate]);

  // Day of week name (e.g. MONDAY)
  const dayName = useMemo(() => {
    try {
      const [y, m, d] = currentDate.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toUpperCase();
    } catch {
      return 'TODAY';
    }
  }, [currentDate]);

  const todayStr = useMemo(() => new Date().toLocaleDateString('en-CA'), []);
  const isToday = currentDate === todayStr;

  const shiftDate = (days: number) => {
    const [y, m, d] = currentDate.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + days);
    onChangeDate(date.toISOString().split('T')[0]);
  };

  // Calculate actual hours taken for a specific task
  const getTaskHoursTaken = (taskId: string) => {
    const taskLogs = timeLogs.filter(tl => tl.taskId === taskId);
    const totalMinutes = taskLogs.reduce((acc, l) => acc + (l.minutes || 0), 0);
    const hours = Math.round((totalMinutes / 60) * 10) / 10;
    return { hours, totalMinutes };
  };

  /**
   * Apply formatting to selected text in currently focused field
   */
  const handleApplyFormattingToSelection = (
    formatType: 'bold' | 'underline' | 'strikethrough' | 'color',
    colorValue = '#ef4444'
  ) => {
    const active = activeInputRef.current;
    if (!active || !active.element) {
      // Fallback: toggle task creation flags if no input is focused
      if (formatType === 'bold') setIsBold(prev => !prev);
      if (formatType === 'underline') setIsUnderline(prev => !prev);
      if (formatType === 'strikethrough') setIsStrikethrough(prev => !prev);
      if (formatType === 'color') setTextColor(colorValue);
      return;
    }

    const elem = active.element;
    const currentVal = active.getValue();
    const start = elem.selectionStart ?? 0;
    const end = elem.selectionEnd ?? 0;
    const selected = currentVal.substring(start, end);

    let prefix = '';
    let suffix = '';

    if (formatType === 'bold') {
      prefix = '<b>';
      suffix = '</b>';
    } else if (formatType === 'underline') {
      prefix = '<u>';
      suffix = '</u>';
    } else if (formatType === 'strikethrough') {
      prefix = '<s>';
      suffix = '</s>';
    } else if (formatType === 'color') {
      prefix = `<span style="color:${colorValue}">`;
      suffix = '</span>';
    }

    const textToWrap = selected || 'text';
    const nextVal = currentVal.substring(0, start) + prefix + textToWrap + suffix + currentVal.substring(end);
    active.setter(nextVal);

    setTimeout(() => {
      elem.focus();
      const newCursorStart = start + prefix.length;
      const newCursorEnd = newCursorStart + textToWrap.length;
      elem.setSelectionRange(newCursorStart, newCursorEnd);
    }, 10);
  };

  // Add new task
  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const now = Date.now();
    const newTask: Task = {
      id: crypto.randomUUID(),
      date: currentDate,
      sectionId: 'default-sec-1',
      title: title.trim(),
      description: '',
      strategy: strategy.trim(),
      doneMeans: '',
      estimatedMinutes: targetMinutes,
      priority: 'Medium',
      mustDo: false,
      tags: [],
      icon: '🎯',
      textColor: textColor || undefined,
      isBold,
      isUnderline,
      isStrikethrough,
      targetMinutes,
      isCompleted: false,
      completedAt: null,
      order: tasks.length,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      isSample: false,
      synced: 0,
    };

    await db.tasks.put(newTask);
    setTasks(prev => [...prev, newTask]);
    setTitle('');
    setStrategy('');
    setIsBold(false);
    setIsUnderline(false);
    setIsStrikethrough(false);
    setTextColor('');
    syncEngine.notifyLocalMutation();
  };

  // Toggle complete
  const handleToggleTask = async (task: Task) => {
    const nextCompleted = !task.isCompleted;
    await db.tasks.update(task.id, {
      isCompleted: nextCompleted,
      completedAt: nextCompleted ? Date.now() : null,
      updatedAt: Date.now(),
      synced: 0,
    });
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, isCompleted: nextCompleted } : t));
    syncEngine.notifyLocalMutation();
  };

  // Delete task
  const handleDeleteTask = async (taskId: string) => {
    await db.tasks.update(taskId, {
      deleted: true,
      updatedAt: Date.now(),
      synced: 0,
    });
    setTasks(prev => prev.filter(t => t.id !== taskId));
    syncEngine.notifyLocalMutation();
  };

  // Inline editing
  const handleStartEdit = (t: Task) => {
    setEditingTaskId(t.id);
    setEditTitle(t.title);
    setEditStrategy(t.strategy || '');
    setEditBold(!!t.isBold);
    setEditUnderline(!!t.isUnderline);
    setEditStrikethrough(!!t.isStrikethrough);
    setEditColor(t.textColor || '');
  };

  const handleSaveEdit = async (taskId: string) => {
    if (!editTitle.trim()) return;
    await db.tasks.update(taskId, {
      title: editTitle.trim(),
      strategy: editStrategy.trim(),
      isBold: editBold,
      isUnderline: editUnderline,
      isStrikethrough: editStrikethrough,
      textColor: editColor || undefined,
      updatedAt: Date.now(),
      synced: 0,
    });
    setTasks(prev =>
      prev.map(t =>
        t.id === taskId
          ? {
              ...t,
              title: editTitle.trim(),
              strategy: editStrategy.trim(),
              isBold: editBold,
              isUnderline: editUnderline,
              isStrikethrough: editStrikethrough,
              textColor: editColor || undefined,
            }
          : t
      )
    );
    setEditingTaskId(null);
    syncEngine.notifyLocalMutation();
  };

  // Toggle format directly on card
  const handleToggleTaskFormat = async (
    task: Task,
    type: 'bold' | 'underline' | 'strikethrough' | 'color' | 'preset_exercise'
  ) => {
    let updates: Partial<Task> = { updatedAt: Date.now(), synced: 0 };

    if (type === 'bold') {
      updates.isBold = !task.isBold;
    } else if (type === 'underline') {
      updates.isUnderline = !task.isUnderline;
    } else if (type === 'strikethrough') {
      updates.isStrikethrough = !task.isStrikethrough;
    } else if (type === 'color') {
      const nextColor =
        task.textColor === '#ef4444'
          ? '#38bdf8'
          : task.textColor === '#38bdf8'
          ? '#22c55e'
          : task.textColor === '#22c55e'
          ? ''
          : '#ef4444';
      updates.textColor = nextColor || undefined;
    } else if (type === 'preset_exercise') {
      // Fulfill exercise requirement: Make title bold, strikethrough, and red
      updates.isBold = true;
      updates.isStrikethrough = true;
      updates.textColor = '#ef4444';
    }

    await db.tasks.update(task.id, updates);
    setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, ...updates } : t)));
    syncEngine.notifyLocalMutation();
  };

  // Open Time Modal
  const handleOpenTimeModal = (task: Task) => {
    setTimeModalTask(task);
    const currentTarget = task.targetMinutes || task.estimatedMinutes || 25;
    setModalDuration(currentTarget);
    setCustomMinutesInput(String(currentTarget));
  };

  // Pomodoro duration calculations
  const pomodoroCalculations = useMemo(() => {
    const mins = Math.max(5, modalDuration);
    const sessions = Math.max(1, Math.ceil(mins / 25));
    const breaks = sessions - 1;
    const totalSpanMinutes = sessions * 25 + breaks * 5;
    const now = Date.now();
    const expectedEpoch = now + totalSpanMinutes * 60 * 1000;
    const expectedTimeStr = new Date(expectedEpoch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return {
      sessions,
      breaks,
      totalSpanMinutes,
      expectedTimeStr,
    };
  }, [modalDuration]);

  // Start Pomodoro timer from Modal
  const handleConfirmStartTimer = async () => {
    if (!timeModalTask) return;
    const duration = Math.max(5, modalDuration);

    await db.tasks.update(timeModalTask.id, {
      targetMinutes: duration,
      estimatedMinutes: duration,
      expectedCompletionTime: pomodoroCalculations.expectedTimeStr,
      updatedAt: Date.now(),
      synced: 0,
    });
    setTasks(prev =>
      prev.map(t =>
        t.id === timeModalTask.id
          ? { ...t, targetMinutes: duration, expectedCompletionTime: pomodoroCalculations.expectedTimeStr }
          : t
      )
    );
    syncEngine.notifyLocalMutation();

    await startTimer(timeModalTask.id, timeModalTask.title, duration, '#38bdf8');
    setTimeModalTask(null);
  };

  // Auto-save Notes / Reflection
  const handleReviewChange = (field: keyof DayReview, value: string) => {
    const updated = { ...review, [field]: value };
    setReview(updated);
    setNoteSaved(false);

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      const now = Date.now();
      const existing = await db.days.get(currentDate);
      const dayData: Day = {
        id: currentDate,
        date: currentDate,
        freeHours: existing?.freeHours ?? 8,
        review: updated,
        updatedAt: now,
        deleted: false,
        isSample: false,
        synced: 0,
      };
      await db.days.put(dayData);
      setNoteSaved(true);
      syncEngine.notifyLocalMutation();
    }, 400);
  };

  // Check if today has any written notes
  const hasNotesContent = Boolean(
    review.obstacles || review.happened || review.solved || review.betterTomorrow
  );

  // Day total hours
  const totalDayMinutes = useMemo(() => {
    return timeLogs.reduce((acc, l) => acc + (l.minutes || 0), 0);
  }, [timeLogs]);
  const totalDayHours = Math.round((totalDayMinutes / 60) * 10) / 10;
  const completedCount = tasks.filter(t => t.isCompleted).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%' }}>

      {/* ── 0. RUNNING POMODORO BANNER (STICKY PROMINENCE) ── */}
      {activeTimer && (
        <div
          className="v-card"
          style={{
            padding: isPhone ? '14px 16px' : '16px 24px',
            background: isFocus ? 'rgba(56, 189, 248, 0.18)' : 'rgba(34, 197, 94, 0.18)',
            borderColor: isFocus ? '#38bdf8' : '#22c55e',
            boxShadow: `0 0 30px ${isFocus ? 'rgba(56, 189, 248, 0.35)' : 'rgba(34, 197, 94, 0.35)'}`,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 200 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: isFocus ? 'rgba(56, 189, 248, 0.3)' : 'rgba(34, 197, 94, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
              }}
            >
              {isFocus ? '🎯' : '☕'}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: isFocus ? '#38bdf8' : '#22c55e',
                  }}
                >
                  {isFocus ? `Focus Session ${currentSessionNumber} of ${totalSessions}` : '5-Minute Rest Break'}
                </span>
                {notificationStatus === 'denied' && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      background: 'rgba(239, 68, 68, 0.2)',
                      color: '#ef4444',
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}
                  >
                    Audio chime active
                  </span>
                )}
              </div>
              <div
                className="font-bloody"
                style={{
                  fontSize: 17,
                  color: 'var(--text-primary)',
                  maxWidth: isPhone ? 220 : 380,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {activeTimer.taskTitle}
              </div>
              {expectedCompletionFormatted && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Expected completion: <strong>{expectedCompletionFormatted}</strong>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                fontSize: 28,
                fontWeight: 900,
                fontFamily: 'monospace',
                color: isFocus ? '#38bdf8' : '#22c55e',
                letterSpacing: '0.04em',
              }}
            >
              {formattedCountdown}
            </div>

            {isTimerRunning ? (
              <button
                type="button"
                onClick={pauseTimer}
                className="v-circle-btn"
                style={{ width: 38, height: 38 }}
                title="Pause Pomodoro"
                aria-label="Pause"
              >
                <Pause size={16} />
              </button>
            ) : (
              <button
                type="button"
                onClick={resumeTimer}
                className="v-circle-btn v-pill-btn-primary"
                style={{ width: 38, height: 38 }}
                title="Resume Pomodoro"
                aria-label="Resume"
              >
                <Play size={16} fill="currentColor" />
              </button>
            )}

            {isBreak && (
              <button
                type="button"
                onClick={skipBreak}
                className="v-pill-btn"
                style={{ padding: '6px 12px', fontSize: 12 }}
                title="Skip break and start next focus session"
              >
                Skip Break
              </button>
            )}

            <button
              type="button"
              onClick={stopTimer}
              className="v-circle-btn"
              style={{ width: 38, height: 38, color: '#f87171' }}
              title="Stop & Log Focus Time"
              aria-label="Stop"
            >
              <StopIcon size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── 1. DAY HEADER & DATE NAVIGATOR ── */}
      <div
        className="v-card"
        style={{
          padding: isPhone ? '18px 16px' : '22px 28px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1
              className="font-bloody"
              style={{
                fontSize: isPhone ? 28 : 38,
                margin: 0,
                lineHeight: 1,
                color: 'var(--text-primary)',
                letterSpacing: '0.04em',
              }}
            >
              {dayName}
            </h1>
            {isToday && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(56, 189, 248, 0.2)',
                  color: 'var(--accent-color)',
                  border: '1px solid var(--accent-glow)',
                }}
              >
                TODAY
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, display: 'flex', gap: 12 }}>
            <span>{completedCount} of {tasks.length} tasks completed</span>
            <span>•</span>
            <span>{totalDayHours}h total hours taken</span>
          </div>
        </div>

        {/* Date switcher buttons & Small "Note" Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* ── SMALL "NOTE" BUTTON (Requirement: Opens reflection questions and answer dashboard) ── */}
          <button
            type="button"
            onClick={() => setIsNoteOpen(prev => !prev)}
            className={`v-pill-btn${isNoteOpen ? ' v-pill-btn-primary' : ''}`}
            style={{
              padding: '6px 14px',
              minHeight: 38,
              fontSize: 13,
              gap: 6,
              boxShadow: isNoteOpen ? '0 0 15px var(--accent-glow)' : undefined,
            }}
            title={isNoteOpen ? 'Close Note' : 'Open Note'}
          >
            <FileText size={15} />
            <span>Note</span>
            {hasNotesContent && <span style={{ fontSize: 11, color: '#22c55e' }}>●</span>}
          </button>

          <button
            type="button"
            onClick={() => shiftDate(-1)}
            className="v-circle-btn"
            style={{ width: 38, height: 38 }}
            title="Previous Day"
            aria-label="Previous Day"
          >
            <ChevronLeft size={16} />
          </button>

          <div
            className="v-pill-btn"
            style={{
              padding: '6px 14px',
              minHeight: 38,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Calendar size={14} style={{ opacity: 0.7 }} />
            <input
              type="date"
              value={currentDate}
              onChange={e => onChangeDate(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                fontSize: 13,
                fontWeight: 600,
                outline: 'none',
                cursor: 'pointer',
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => shiftDate(1)}
            className="v-circle-btn"
            style={{ width: 38, height: 38 }}
            title="Next Day"
            aria-label="Next Day"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* ── 2. NOTES SECTION (EXPANDED ON "NOTE" BUTTON CLICK, COMPRESSED WHEN CLOSED) ── */}
      {isNoteOpen && (
        <div
          className="v-card"
          style={{
            padding: isPhone ? '18px 16px' : '24px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            border: '2px solid var(--accent-color)',
            boxShadow: '0 0 35px var(--accent-glow)',
          }}
        >
          {/* Header of Note Section */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <FileText size={20} style={{ color: 'var(--accent-color)' }} />
              <div>
                <h2
                  className="font-bloody"
                  style={{
                    fontSize: isPhone ? 20 : 24,
                    margin: 0,
                    color: 'var(--text-primary)',
                    letterSpacing: '0.02em',
                  }}
                >
                  NOTES & REFLECTION DASHBOARD
                </h2>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Private psychological debrief for {dayName} • Auto-saved & synced
                </div>
              </div>
            </div>

            {/* Sub-tabs: Writing View vs Answer Dashboard */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {noteSaved && (
                <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600, marginRight: 4 }}>
                  ✓ Saved locally
                </span>
              )}
              <button
                type="button"
                onClick={() => setNoteTab('write')}
                className={`v-pill-btn${noteTab === 'write' ? ' v-pill-btn-primary' : ''}`}
                style={{ padding: '4px 12px', fontSize: 12 }}
              >
                <Edit3 size={13} />
                <span>Write</span>
              </button>
              <button
                type="button"
                onClick={() => setNoteTab('dashboard')}
                className={`v-pill-btn${noteTab === 'dashboard' ? ' v-pill-btn-primary' : ''}`}
                style={{ padding: '4px 12px', fontSize: 12 }}
              >
                <Eye size={13} />
                <span>Dashboard</span>
              </button>
              <button
                type="button"
                onClick={() => setIsNoteOpen(false)}
                className="v-circle-btn"
                style={{ width: 30, height: 30 }}
                title="Compress & Close Note"
              >
                <ChevronUp size={14} />
              </button>
            </div>
          </div>

          {/* ── WRITING TOOLBAR FOR NOTES (Applies to highlighted text in active field) ── */}
          {noteTab === 'write' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 10,
                background: 'var(--v-glass-bg-subtle)',
                border: '1px solid var(--v-glass-border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginRight: 4 }}>
                  Format Selection:
                </span>
                <button
                  type="button"
                  onMouseDown={e => {
                    e.preventDefault();
                    handleApplyFormattingToSelection('bold');
                  }}
                  className="v-circle-btn"
                  style={{ width: 28, height: 28 }}
                  title="Make Selected Text Bold"
                >
                  <BoldIcon size={12} />
                </button>
                <button
                  type="button"
                  onMouseDown={e => {
                    e.preventDefault();
                    handleApplyFormattingToSelection('underline');
                  }}
                  className="v-circle-btn"
                  style={{ width: 28, height: 28 }}
                  title="Underline Selected Text"
                >
                  <UnderlineIcon size={12} />
                </button>
                <button
                  type="button"
                  onMouseDown={e => {
                    e.preventDefault();
                    handleApplyFormattingToSelection('strikethrough');
                  }}
                  className="v-circle-btn"
                  style={{ width: 28, height: 28 }}
                  title="Strikethrough Selected Text"
                >
                  <StrikethroughIcon size={12} />
                </button>

                <div style={{ display: 'flex', gap: 6, marginLeft: 6 }}>
                  {COLOR_OPTIONS.filter(c => c.value).map(c => (
                    <button
                      key={c.label}
                      type="button"
                      onMouseDown={e => {
                        e.preventDefault();
                        handleApplyFormattingToSelection('color', c.value);
                      }}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: c.value,
                        border: '1px solid var(--v-glass-border)',
                        cursor: 'pointer',
                      }}
                      title={`Color Selected Text: ${c.label}`}
                    />
                  ))}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Highlight text, then click formatting
              </div>
            </div>
          )}

          {/* ── WRITING VIEW: 4 REFLECTION QUESTIONS ── */}
          {noteTab === 'write' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Question 1: What obstacles did I face today? */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  1. What obstacles did I face today?
                </label>
                <textarea
                  ref={obstaclesRef}
                  value={review.obstacles || ''}
                  onFocus={() => {
                    activeInputRef.current = {
                      element: obstaclesRef.current,
                      setter: val => handleReviewChange('obstacles', val),
                      getValue: () => review.obstacles || '',
                    };
                  }}
                  onChange={e => handleReviewChange('obstacles', e.target.value)}
                  placeholder="Distractions, low energy around 2 PM, unexpected calls..."
                  rows={2}
                  className="v-input"
                  style={{ resize: 'vertical', fontSize: 13, minHeight: 64 }}
                />
              </div>

              {/* Question 2: What happened? */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  2. What happened?
                </label>
                <textarea
                  ref={happenedRef}
                  value={review.happened || ''}
                  onFocus={() => {
                    activeInputRef.current = {
                      element: happenedRef.current,
                      setter: val => handleReviewChange('happened', val),
                      getValue: () => review.happened || '',
                    };
                  }}
                  onChange={e => handleReviewChange('happened', e.target.value)}
                  placeholder="I got pulled into answering emails for 1 hour and lost momentum..."
                  rows={2}
                  className="v-input"
                  style={{ resize: 'vertical', fontSize: 13, minHeight: 64 }}
                />
              </div>

              {/* Question 3: How did I solve it? */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  3. How did I solve it?
                </label>
                <textarea
                  ref={solvedRef}
                  value={review.solved || ''}
                  onFocus={() => {
                    activeInputRef.current = {
                      element: solvedRef.current,
                      setter: val => handleReviewChange('solved', val),
                      getValue: () => review.solved || '',
                    };
                  }}
                  onChange={e => handleReviewChange('solved', e.target.value)}
                  placeholder="Silenced phone, took a 5-minute walk, and ran a 25m Pomodoro sprint..."
                  rows={2}
                  className="v-input"
                  style={{ resize: 'vertical', fontSize: 13, minHeight: 64 }}
                />
              </div>

              {/* Question 4: What can I improve? */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  4. What can I improve?
                </label>
                <textarea
                  ref={improveRef}
                  value={review.betterTomorrow || ''}
                  onFocus={() => {
                    activeInputRef.current = {
                      element: improveRef.current,
                      setter: val => handleReviewChange('betterTomorrow', val),
                      getValue: () => review.betterTomorrow || '',
                    };
                  }}
                  onChange={e => handleReviewChange('betterTomorrow', e.target.value)}
                  placeholder="Block the first 90 minutes of the morning for deep work before opening messages..."
                  rows={2}
                  className="v-input"
                  style={{ resize: 'vertical', fontSize: 13, minHeight: 64 }}
                />
              </div>
            </div>
          ) : (
            /* ── ANSWER DASHBOARD (Displays user's written responses cleanly) ── */
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isPhone ? '1fr' : 'repeat(2, 1fr)',
                gap: 14,
              }}
            >
              <div
                style={{
                  padding: '16px',
                  borderRadius: 12,
                  background: 'var(--v-glass-bg-subtle)',
                  border: '1px solid var(--v-glass-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: '#f87171', letterSpacing: '0.04em' }}>
                  1. OBSTACLES FACED
                </span>
                <div style={{ fontSize: 14, color: 'var(--text-primary)', minHeight: 40, lineHeight: 1.5 }}>
                  <FormattedText text={review.obstacles || 'No obstacles recorded.'} />
                </div>
              </div>

              <div
                style={{
                  padding: '16px',
                  borderRadius: 12,
                  background: 'var(--v-glass-bg-subtle)',
                  border: '1px solid var(--v-glass-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8', letterSpacing: '0.04em' }}>
                  2. WHAT HAPPENED
                </span>
                <div style={{ fontSize: 14, color: 'var(--text-primary)', minHeight: 40, lineHeight: 1.5 }}>
                  <FormattedText text={review.happened || 'Nothing recorded.'} />
                </div>
              </div>

              <div
                style={{
                  padding: '16px',
                  borderRadius: 12,
                  background: 'var(--v-glass-bg-subtle)',
                  border: '1px solid var(--v-glass-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', letterSpacing: '0.04em' }}>
                  3. HOW I SOLVED IT
                </span>
                <div style={{ fontSize: 14, color: 'var(--text-primary)', minHeight: 40, lineHeight: 1.5 }}>
                  <FormattedText text={review.solved || 'No solution recorded.'} />
                </div>
              </div>

              <div
                style={{
                  padding: '16px',
                  borderRadius: 12,
                  background: 'var(--v-glass-bg-subtle)',
                  border: '1px solid var(--v-glass-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', letterSpacing: '0.04em' }}>
                  4. WHAT CAN I IMPROVE
                </span>
                <div style={{ fontSize: 14, color: 'var(--text-primary)', minHeight: 40, lineHeight: 1.5 }}>
                  <FormattedText text={review.betterTomorrow || 'No improvement notes recorded.'} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 3. ADD TASK BOX WITH FORMATTING TOOLBAR ── */}
      <form
        onSubmit={handleAddTask}
        className="v-card"
        style={{
          padding: isPhone ? '18px 16px' : '22px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
            + ADD TASK FOR {dayName}
          </div>

          {/* Quick preset button for Exercise title requirement */}
          <button
            type="button"
            onClick={() => {
              if (!title) setTitle('Exercise');
              setIsBold(true);
              setIsStrikethrough(true);
              setTextColor('#ef4444');
            }}
            className="v-pill-btn"
            style={{
              padding: '4px 10px',
              fontSize: 11,
              color: '#ef4444',
              borderColor: 'rgba(239, 68, 68, 0.4)',
              background: 'rgba(239, 68, 68, 0.1)',
            }}
            title="Preset: Make title Bold, Strikethrough & Red"
          >
            🔴 Preset: Bold, Strikethrough & Red
          </button>
        </div>

        {/* Title Input */}
        <input
          ref={titleInputRef}
          type="text"
          value={title}
          onFocus={() => {
            activeInputRef.current = {
              element: titleInputRef.current,
              setter: setTitle,
              getValue: () => title,
            };
          }}
          onChange={e => setTitle(e.target.value)}
          placeholder="Title (e.g. Exercise or Finish design specs)"
          className="v-input"
          style={{
            fontSize: 15,
            fontWeight: isBold ? 800 : 500,
            textDecoration: [
              isStrikethrough ? 'line-through' : '',
              isUnderline ? 'underline' : '',
            ].filter(Boolean).join(' ') || 'none',
            color: textColor || 'var(--text-primary)',
          }}
        />

        {/* Strategy Input */}
        <input
          ref={strategyInputRef}
          type="text"
          value={strategy}
          onFocus={() => {
            activeInputRef.current = {
              element: strategyInputRef.current,
              setter: setStrategy,
              getValue: () => strategy,
            };
          }}
          onChange={e => setStrategy(e.target.value)}
          placeholder="Strategy (How will you do it? e.g. 2 Pomodoro focus sessions, phone silenced)"
          className="v-input"
          style={{ fontSize: 13 }}
        />

        {/* ── SMALL FORMATTING TOOLBAR (Color, Bold, Underline, Strikethrough) ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
            padding: '10px 14px',
            borderRadius: 12,
            background: 'var(--v-glass-bg-subtle)',
            border: '1px solid var(--v-glass-border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginRight: 4 }}>
              Format:
            </span>

            {/* Bold Toggle / Selection apply */}
            <button
              type="button"
              onMouseDown={e => {
                e.preventDefault();
                handleApplyFormattingToSelection('bold');
              }}
              className="v-circle-btn"
              style={{
                width: 32,
                height: 32,
                background: isBold ? 'rgba(56, 189, 248, 0.25)' : undefined,
                borderColor: isBold ? 'var(--accent-color)' : undefined,
                color: isBold ? 'var(--accent-color)' : 'var(--text-secondary)',
              }}
              title="Bold"
            >
              <BoldIcon size={14} />
            </button>

            {/* Underline Toggle / Selection apply */}
            <button
              type="button"
              onMouseDown={e => {
                e.preventDefault();
                handleApplyFormattingToSelection('underline');
              }}
              className="v-circle-btn"
              style={{
                width: 32,
                height: 32,
                background: isUnderline ? 'rgba(56, 189, 248, 0.25)' : undefined,
                borderColor: isUnderline ? 'var(--accent-color)' : undefined,
                color: isUnderline ? 'var(--accent-color)' : 'var(--text-secondary)',
              }}
              title="Underline"
            >
              <UnderlineIcon size={14} />
            </button>

            {/* Strikethrough Toggle / Selection apply */}
            <button
              type="button"
              onMouseDown={e => {
                e.preventDefault();
                handleApplyFormattingToSelection('strikethrough');
              }}
              className="v-circle-btn"
              style={{
                width: 32,
                height: 32,
                background: isStrikethrough ? 'rgba(56, 189, 248, 0.25)' : undefined,
                borderColor: isStrikethrough ? 'var(--accent-color)' : undefined,
                color: isStrikethrough ? 'var(--accent-color)' : 'var(--text-secondary)',
              }}
              title="Strikethrough"
            >
              <StrikethroughIcon size={14} />
            </button>

            {/* Color Palette */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
              {COLOR_OPTIONS.map(c => (
                <button
                  key={c.label}
                  type="button"
                  onMouseDown={e => {
                    e.preventDefault();
                    if (c.value) {
                      handleApplyFormattingToSelection('color', c.value);
                    } else {
                      setTextColor('');
                    }
                  }}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: c.value || 'var(--text-primary)',
                    border: textColor === c.value ? '2px solid #ffffff' : '1px solid var(--v-glass-border)',
                    boxShadow: textColor === c.value ? `0 0 8px ${c.ring}` : 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  title={`Color: ${c.label}`}
                />
              ))}
            </div>
          </div>

          {/* Add Task Submit Button */}
          <button
            type="submit"
            disabled={!title.trim()}
            className="v-pill-btn v-pill-btn-primary"
            style={{
              padding: '8px 22px',
              fontSize: 13,
              opacity: !title.trim() ? 0.4 : 1,
              width: isPhone ? '100%' : 'auto',
            }}
          >
            <Plus size={15} />
            <span>Add Task</span>
          </button>
        </div>
      </form>

      {/* ── 4. TASK LIST BOX ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', paddingLeft: 4 }}>
          TASKS FOR {dayName} ({tasks.length})
        </div>

        {tasks.length === 0 ? (
          <div
            className="v-card"
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 32 }}>✨</div>
            <div className="font-bloody" style={{ fontSize: 20, color: 'var(--text-primary)' }}>
              No Tasks for {dayName}
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', maxWidth: 360 }}>
              Plan clearly what you will do and how you will do it using the form above.
            </p>
          </div>
        ) : (
          tasks.map(task => {
            const { hours, totalMinutes: loggedMins } = getTaskHoursTaken(task.id);
            const isThisTimerActive = activeTimer?.taskId === task.id;
            const isEditing = editingTaskId === task.id;

            return (
              <div
                key={task.id}
                className="v-card"
                style={{
                  padding: isPhone ? '16px' : '20px 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  opacity: task.isCompleted ? 0.65 : 1,
                  borderColor: isThisTimerActive ? 'var(--accent-color)' : undefined,
                  boxShadow: isThisTimerActive ? '0 0 25px var(--accent-glow)' : undefined,
                }}
              >
                {isEditing ? (
                  /* Inline Editing Mode */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      className="v-input"
                      placeholder="Title"
                      style={{
                        fontWeight: editBold ? 800 : 500,
                        textDecoration: [
                          editStrikethrough ? 'line-through' : '',
                          editUnderline ? 'underline' : '',
                        ].filter(Boolean).join(' ') || 'none',
                        color: editColor || 'var(--text-primary)',
                      }}
                    />
                    <input
                      type="text"
                      value={editStrategy}
                      onChange={e => setEditStrategy(e.target.value)}
                      className="v-input"
                      placeholder="Strategy"
                    />

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => setEditBold(prev => !prev)}
                        className="v-circle-btn"
                        style={{
                          width: 30,
                          height: 30,
                          background: editBold ? 'rgba(56, 189, 248, 0.25)' : undefined,
                          color: editBold ? 'var(--accent-color)' : undefined,
                        }}
                      >
                        <BoldIcon size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditUnderline(prev => !prev)}
                        className="v-circle-btn"
                        style={{
                          width: 30,
                          height: 30,
                          background: editUnderline ? 'rgba(56, 189, 248, 0.25)' : undefined,
                          color: editUnderline ? 'var(--accent-color)' : undefined,
                        }}
                      >
                        <UnderlineIcon size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditStrikethrough(prev => !prev)}
                        className="v-circle-btn"
                        style={{
                          width: 30,
                          height: 30,
                          background: editStrikethrough ? 'rgba(56, 189, 248, 0.25)' : undefined,
                          color: editStrikethrough ? 'var(--accent-color)' : undefined,
                        }}
                      >
                        <StrikethroughIcon size={13} />
                      </button>

                      <div style={{ display: 'flex', gap: 6, marginLeft: 6 }}>
                        {COLOR_OPTIONS.map(c => (
                          <button
                            key={c.label}
                            type="button"
                            onClick={() => setEditColor(c.value)}
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              background: c.value || 'var(--text-primary)',
                              border: editColor === c.value ? '2px solid #fff' : '1px solid var(--v-glass-border)',
                              cursor: 'pointer',
                            }}
                          />
                        ))}
                      </div>

                      <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                        <button
                          type="button"
                          onClick={() => setEditingTaskId(null)}
                          className="v-pill-btn"
                          style={{ padding: '6px 14px', fontSize: 12 }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(task.id)}
                          className="v-pill-btn v-pill-btn-primary"
                          style={{ padding: '6px 16px', fontSize: 12 }}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Standard Display Mode */
                  <>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                      {/* Checkbox */}
                      <button
                        type="button"
                        onClick={() => handleToggleTask(task)}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 8,
                          background: task.isCompleted ? 'rgba(34, 197, 94, 0.2)' : 'var(--v-glass-bg-subtle)',
                          border: `2px solid ${task.isCompleted ? '#22c55e' : 'var(--v-glass-border)'}`,
                          color: '#22c55e',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          flexShrink: 0,
                          marginTop: 2,
                          transition: 'all 0.15s ease',
                        }}
                        aria-label={task.isCompleted ? 'Mark incomplete' : 'Mark complete'}
                      >
                        {task.isCompleted && <Check size={14} strokeWidth={3} />}
                      </button>

                      {/* Title & Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          className="font-bloody"
                          style={{
                            fontSize: 19,
                            fontWeight: task.isBold ? 800 : 600,
                            color: task.textColor || 'var(--text-primary)',
                            textDecoration: [
                              task.isStrikethrough || task.isCompleted ? 'line-through' : '',
                              task.isUnderline ? 'underline' : '',
                            ]
                              .filter(Boolean)
                              .join(' ') || 'none',
                            lineHeight: 1.3,
                            wordBreak: 'break-word',
                          }}
                        >
                          <FormattedText text={task.title} />
                        </div>

                        {/* Strategy Box */}
                        {task.strategy ? (
                          <div
                            style={{
                              marginTop: 8,
                              padding: '8px 12px',
                              borderRadius: 10,
                              background: 'var(--v-glass-bg-subtle)',
                              border: '1px solid var(--v-glass-border-subtle)',
                              fontSize: 13,
                              color: 'var(--text-secondary)',
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 6,
                            }}
                          >
                            <span style={{ color: 'var(--accent-color)', fontWeight: 700 }}>Strategy:</span>
                            <FormattedText text={task.strategy} />
                          </div>
                        ) : (
                          <div
                            onClick={() => handleStartEdit(task)}
                            style={{
                              marginTop: 6,
                              fontSize: 12,
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              fontStyle: 'italic',
                            }}
                          >
                            + Add strategy (how you will do it)
                          </div>
                        )}
                      </div>

                      {/* Top Action Toolbar (Format + Edit + Delete) */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => handleToggleTaskFormat(task, 'bold')}
                          className="v-circle-btn"
                          style={{
                            width: 30,
                            height: 30,
                            background: task.isBold ? 'rgba(56, 189, 248, 0.25)' : undefined,
                            color: task.isBold ? 'var(--accent-color)' : undefined,
                          }}
                          title="Toggle Bold"
                        >
                          <BoldIcon size={12} />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleToggleTaskFormat(task, 'strikethrough')}
                          className="v-circle-btn"
                          style={{
                            width: 30,
                            height: 30,
                            background: task.isStrikethrough ? 'rgba(56, 189, 248, 0.25)' : undefined,
                            color: task.isStrikethrough ? 'var(--accent-color)' : undefined,
                          }}
                          title="Toggle Strikethrough"
                        >
                          <StrikethroughIcon size={12} />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleToggleTaskFormat(task, 'color')}
                          className="v-circle-btn"
                          style={{
                            width: 30,
                            height: 30,
                            color: task.textColor || undefined,
                          }}
                          title="Cycle Color"
                        >
                          <Palette size={12} />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleStartEdit(task)}
                          className="v-circle-btn"
                          style={{ width: 30, height: 30 }}
                          title="Edit Task"
                          aria-label="Edit task"
                        >
                          <Edit2 size={12} />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteTask(task.id)}
                          className="v-circle-btn"
                          style={{ width: 30, height: 30, color: '#f87171' }}
                          title="Delete Task"
                          aria-label="Delete task"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Bottom Row: Hours Taken & TIME BUTTON */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingTop: 10,
                        borderTop: '1px solid var(--v-glass-border-subtle)',
                        flexWrap: 'wrap',
                        gap: 12,
                      }}
                    >
                      {/* Hours Taken */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
                        <Clock size={15} style={{ opacity: 0.7 }} />
                        <span>Hours Taken:</span>
                        <strong style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: 14 }}>
                          {hours}h {loggedMins > 0 ? `(${loggedMins}m)` : ''}
                        </strong>
                      </div>

                      {/* TIME BUTTON */}
                      <div>
                        {isThisTimerActive ? (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              background: isFocus ? 'rgba(56, 189, 248, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                              border: `1.5px solid ${isFocus ? '#38bdf8' : '#22c55e'}`,
                              borderRadius: 999,
                              padding: '4px 12px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: 800,
                                fontFamily: 'monospace',
                                color: isFocus ? '#38bdf8' : '#22c55e',
                              }}
                            >
                              {isFocus ? '🎯 Focus' : '☕ Break'}: {formattedCountdown}
                            </span>

                            {isTimerRunning ? (
                              <button
                                type="button"
                                onClick={pauseTimer}
                                className="v-circle-btn"
                                style={{ width: 28, height: 28 }}
                                title="Pause"
                              >
                                <Pause size={12} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={resumeTimer}
                                className="v-circle-btn"
                                style={{ width: 28, height: 28 }}
                                title="Resume"
                              >
                                <Play size={12} />
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={stopTimer}
                              className="v-circle-btn"
                              style={{ width: 28, height: 28, color: '#f87171' }}
                              title="Stop & Log Time"
                            >
                              <StopIcon size={12} />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenTimeModal(task)}
                            className="v-pill-btn"
                            style={{
                              padding: '8px 18px',
                              fontSize: 13,
                              borderColor: 'var(--accent-color)',
                              background: 'var(--accent-glow)',
                            }}
                          >
                            <Play size={13} fill="currentColor" />
                            <span>Time ({task.targetMinutes || 25}m)</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── 5. TIME & POMODORO SETUP MODAL ── */}
      {timeModalTask && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(8px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setTimeModalTask(null)}
        >
          <div
            className="v-card"
            style={{
              width: '100%',
              maxWidth: 520,
              padding: isPhone ? '20px 18px' : '28px 32px',
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent-color)' }}>
                SET TASK DEADLINE & POMODORO TARGET
              </div>
              <h2
                className="font-bloody"
                style={{
                  fontSize: 22,
                  margin: '4px 0 0',
                  color: 'var(--text-primary)',
                }}
              >
                {timeModalTask.title}
              </h2>
            </div>

            {/* Duration Selector */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
                Choose Target Duration:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {[25, 50, 75, 100].map(mins => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => {
                      setModalDuration(mins);
                      setCustomMinutesInput(String(mins));
                    }}
                    className={`v-pill-btn${modalDuration === mins ? ' v-pill-btn-primary' : ''}`}
                    style={{ padding: '8px 10px', fontSize: 13, fontWeight: 700, textAlign: 'center' }}
                  >
                    {mins}m
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Custom minutes:</span>
                <input
                  type="number"
                  min="5"
                  max="600"
                  value={customMinutesInput}
                  onChange={e => {
                    setCustomMinutesInput(e.target.value);
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val > 0) {
                      setModalDuration(val);
                    }
                  }}
                  className="v-input"
                  style={{ width: 90, padding: '6px 10px', fontSize: 13 }}
                />
              </div>
            </div>

            {/* Automatic Pomodoro calculation */}
            <div
              style={{
                padding: '14px 18px',
                borderRadius: 14,
                background: 'var(--v-glass-bg-subtle)',
                border: '1.5px solid var(--v-glass-border-bright)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
                AUTOMATIC POMODORO SESSIONS NEEDED:
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, color: '#38bdf8' }}>
                  <span>🎯 {pomodoroCalculations.sessions} Focus Sessions</span>
                  <span style={{ fontSize: 12, opacity: 0.8 }}>(25m each)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#22c55e' }}>
                  <span>☕ {pomodoroCalculations.breaks} Breaks</span>
                  <span style={{ fontSize: 11, opacity: 0.8 }}>(5m each)</span>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--v-glass-border-subtle)', paddingTop: 8, marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Total Span: <strong>{pomodoroCalculations.totalSpanMinutes} minutes</strong>
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-color)' }}>
                  Expected Completion: <strong>{pomodoroCalculations.expectedTimeStr}</strong>
                </span>
              </div>
            </div>

            {/* Notification permission prompt */}
            <div
              style={{
                padding: '12px 16px',
                borderRadius: 12,
                background:
                  notificationStatus === 'granted'
                    ? 'rgba(34, 197, 94, 0.1)'
                    : notificationStatus === 'denied'
                    ? 'rgba(239, 68, 68, 0.1)'
                    : 'rgba(56, 189, 248, 0.1)',
                border: `1px solid ${
                  notificationStatus === 'granted'
                    ? 'rgba(34, 197, 94, 0.3)'
                    : notificationStatus === 'denied'
                    ? 'rgba(239, 68, 68, 0.3)'
                    : 'rgba(56, 189, 248, 0.3)'
                }`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {notificationStatus === 'granted' ? (
                  <Bell size={18} style={{ color: '#22c55e', flexShrink: 0 }} />
                ) : notificationStatus === 'denied' ? (
                  <BellOff size={18} style={{ color: '#ef4444', flexShrink: 0 }} />
                ) : (
                  <AlertTriangle size={18} style={{ color: '#38bdf8', flexShrink: 0 }} />
                )}
                <div style={{ fontSize: 12, lineHeight: 1.4 }}>
                  {notificationStatus === 'granted' ? (
                    <span style={{ color: '#22c55e', fontWeight: 600 }}>
                      Notifications Active (Alerts ready online & offline)
                    </span>
                  ) : notificationStatus === 'denied' ? (
                    <span style={{ color: 'var(--text-secondary)' }}>
                      Notifications disabled in browser. In-app banner & audio chimes will alert you.
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-secondary)' }}>
                      Enable notifications to get session start, break, and completion alerts.
                    </span>
                  )}
                </div>
              </div>

              {notificationStatus === 'default' && (
                <button
                  type="button"
                  onClick={enableNotifications}
                  className="v-pill-btn v-pill-btn-primary"
                  style={{ padding: '4px 12px', fontSize: 11, flexShrink: 0 }}
                >
                  Enable
                </button>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
              <button
                type="button"
                onClick={() => setTimeModalTask(null)}
                className="v-pill-btn"
                style={{ padding: '8px 18px', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmStartTimer}
                className="v-pill-btn v-pill-btn-primary"
                style={{ padding: '8px 24px', fontSize: 13 }}
              >
                <Play size={14} fill="currentColor" />
                <span>Start Focus ({modalDuration}m)</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
