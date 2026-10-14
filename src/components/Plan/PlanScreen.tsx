'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { withActionFeedback } from '@/lib/utils/actionFeedback';
import { getPreviousDayData } from '@/lib/plan/autoPlan';
import { useTimer } from '@/lib/timer/useTimer';
import {
  Calendar, Clock, Sparkles, Star, ChevronLeft, ChevronRight,
  Edit2, Trash2, CheckSquare, Square, Plus, Coffee, Utensils,
  Phone, ShoppingBag, ListTodo, Play, Pause, X, ChevronUp, ChevronDown,
  Tag as TagIcon, RotateCcw, AlertTriangle
} from 'lucide-react';
import type { Task, Section, Day, DaySheetData, PriorityLevel } from '@/types';
import { detectScheduleConflicts } from '@/lib/plan/scheduleConflict';
import { ScheduleConflictModal } from '@/components/Modals/ScheduleConflictModal';

interface PlanScreenProps {
  currentDate: string;
  onChangeDate: (date: string) => void;
  sections: Section[];
  onOpenTaskModal: (task?: Task | null) => void;
  onPreviewImage: (url: string, title: string) => void;
  onOpenAutoPlan: (previousDate: string, candidateTasks: Task[]) => void;
  isPhone: boolean;
}

const SCHEDULE_HOURS = [
  '6:00 AM', '7:00 AM', '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM',
  '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM',
  '6:00 PM', '7:00 PM', '8:00 PM', '9:00 PM', '10:00 PM'
];

const QUICK_TIMES = [15, 30, 45, 60, 120];

export function PlanScreen({
  currentDate,
  onChangeDate,
  sections,
  onOpenTaskModal,
  onOpenAutoPlan,
  isPhone,
}: PlanScreenProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dayRecord, setDayRecord] = useState<Day | null>(null);
  const [freeHours, setFreeHours] = useState<number>(8);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sheetData, setSheetData] = useState<DaySheetData>({
    notes: '',
    schedule: {},
    breakfast: '',
    lunch: '',
    dinner: '',
    snacks: '',
    waterGlasses: 0,
    exercise: '',
  });

  const { activeTimer, isTimerRunning, startTimer, pauseTimer, resumeTimer } = useTimer();

  // Flag to prevent background polling from clobbering inputs while user is typing
  const isTypingRef = useRef(false);
  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const dbSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (dbSaveTimeoutRef.current) clearTimeout(dbSaveTimeoutRef.current);
    };
  }, []);

  // Quick composer state for master TO DO
  const [newTodoTitle, setNewTodoTitle] = useState('');
  const [newTodoTime, setNewTodoTime] = useState<number>(30);
  const [newTodoPriority, setNewTodoPriority] = useState<PriorityLevel>('Medium');

  // Quick inputs for Goals, Calls, Errands
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalTime, setNewGoalTime] = useState<number>(45);
  const [newGoalPriority, setNewGoalPriority] = useState<PriorityLevel>('High');

  const [newCallTitle, setNewCallTitle] = useState('');
  const [newCallTime, setNewCallTime] = useState<number>(15);

  const [newErrandTitle, setNewErrandTitle] = useState('');
  const [newErrandTime, setNewErrandTime] = useState<number>(30);

  // Rollover state
  const [prevUnfinished, setPrevUnfinished] = useState<Task[]>([]);
  const [prevDate, setPrevDate] = useState<string>('');
  const [yesterdayReflection, setYesterdayReflection] = useState<string | null>(null);
  const [showConflictModal, setShowConflictModal] = useState(false);

  // 1. Initial Load & Non-intrusive Refresh
  const loadData = async () => {
    if (isTypingRef.current) return; // Never overwrite while typing!

    const t = await db.tasks.filter(t => t.date === currentDate && !t.deleted).toArray();
    t.sort((a, b) => a.order - b.order);
    const d = await db.days.get(currentDate);
    const prevData = await getPreviousDayData(currentDate);

    setTasks(t);
    setDayRecord(d || null);
    setFreeHours(d?.freeHours ?? 8);
    setYesterdayReflection(prevData.previousReviewChange);
    setPrevUnfinished(prevData.unfinishedTasks);
    setPrevDate(prevData.previousDate);

    if (d?.sheetData && !isTypingRef.current) {
      setSheetData({
        notes: d.sheetData.notes || '',
        schedule: d.sheetData.schedule || {},
        breakfast: d.sheetData.breakfast || '',
        lunch: d.sheetData.lunch || '',
        dinner: d.sheetData.dinner || '',
        snacks: d.sheetData.snacks || '',
        waterGlasses: d.sheetData.waterGlasses || 0,
        exercise: d.sheetData.exercise || '',
      });
    }
  };

  useEffect(() => {
    loadData();
    const iv = setInterval(() => {
      if (!isTypingRef.current) loadData();
    }, 3000);
    return () => clearInterval(iv);
  }, [currentDate]);

  // Handle typing activity to protect user input from polling reset
  const handleUserTyping = () => {
    isTypingRef.current = true;
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
    }, 2000);
  };

  // Debounced persistence for sheet data to eliminate UI stuttering & DB thrashing
  const saveSheetData = (partial: Partial<DaySheetData>) => {
    handleUserTyping();
    const updated: DaySheetData = { ...sheetData, ...partial };
    setSheetData(updated);

    if (dbSaveTimeoutRef.current) clearTimeout(dbSaveTimeoutRef.current);
    dbSaveTimeoutRef.current = setTimeout(async () => {
      const now = Date.now();
      const existing = await db.days.get(currentDate);
      await db.days.put({
        id: currentDate,
        date: currentDate,
        freeHours: existing?.freeHours ?? freeHours,
        review: existing?.review || { worked: '', blocked: '', change: '' },
        sheetData: updated,
        updatedAt: now,
        deleted: false,
        isSample: false,
        synced: 0,
      });
      syncEngine.notifyLocalMutation();
    }, 350);
  };

  const handleUpdateScheduleHour = (hour: string, text: string) => {
    const sched = { ...(sheetData.schedule || {}), [hour]: text };
    saveSheetData({ schedule: sched });
  };

  const handleClearScheduleHour = (hour: string) => {
    const sched = { ...(sheetData.schedule || {}) };
    delete sched[hour];
    saveSheetData({ schedule: sched });
  };

  const handleToggleWater = (glassIndex: number) => {
    const newCount = sheetData.waterGlasses === glassIndex ? glassIndex - 1 : glassIndex;
    saveSheetData({ waterGlasses: Math.max(0, newCount) });
  };

  // Direct Inline Task Attribute Mutators (Time & Hard/Medium/Low)
  const handleUpdateTaskTime = async (taskId: string, minutes: number) => {
    await db.tasks.update(taskId, {
      estimatedMinutes: minutes,
      updatedAt: Date.now(),
      synced: 0,
    });
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, estimatedMinutes: minutes } : t));
    syncEngine.notifyLocalMutation();
  };

  const handleUpdateTaskPriority = async (taskId: string, priority: PriorityLevel) => {
    await db.tasks.update(taskId, {
      priority,
      updatedAt: Date.now(),
      synced: 0,
    });
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, priority } : t));
    syncEngine.notifyLocalMutation();
  };

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

  const handleDeleteTask = async (taskId: string) => {
    await db.tasks.update(taskId, {
      deleted: true,
      updatedAt: Date.now(),
      synced: 0,
    });
    setTasks(prev => prev.filter(t => t.id !== taskId));
    syncEngine.notifyLocalMutation();
  };

  const handleMoveTask = async (taskId: string, direction: 'up' | 'down') => {
    const list = [...tasks];
    const idx = list.findIndex(t => t.id === taskId);
    if (idx < 0) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === list.length - 1) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    const temp = list[idx];
    list[idx] = list[targetIdx];
    list[targetIdx] = temp;

    const now = Date.now();
    const updated = list.map((item, i) => ({ ...item, order: i, updatedAt: now, synced: 0 }));
    setTasks(updated);

    await db.transaction('rw', db.tasks, async () => {
      for (const item of updated) {
        await db.tasks.update(item.id, { order: item.order, updatedAt: item.updatedAt, synced: 0 });
      }
    });
    syncEngine.notifyLocalMutation();
  };

  const handleUpdateFreeHours = async (val: number) => {
    const hours = Math.max(1, Math.min(24, Math.round(val * 10) / 10));
    setFreeHours(hours);
    const now = Date.now();
    const existing = await db.days.get(currentDate);
    await db.days.put({
      id: currentDate,
      date: currentDate,
      freeHours: hours,
      review: existing?.review || { worked: '', blocked: '', change: '' },
      sheetData,
      updatedAt: now,
      deleted: false,
      isSample: false,
      synced: 0,
    });
    syncEngine.notifyLocalMutation();
  };

  // Task Creation Helper
  const createQuickTask = async (
    title: string,
    estimatedMinutes: number,
    priority: PriorityLevel,
    opts: { mustDo?: boolean; tags?: string[]; icon?: string }
  ) => {
    if (!title.trim()) return;

    if (opts.mustDo) {
      const existingMustDos = tasks.filter(t => t.mustDo && !t.deleted);
      if (existingMustDos.length >= 3) {
        alert('Max 3 Must-Do goals allowed per day. Focus on your top 3 non-negotiables.');
        return;
      }
    }

    const now = Date.now();
    const defaultSec = sections[0]?.id || 'default-sec-1';

    const newTask: Task = {
      id: crypto.randomUUID(),
      date: currentDate,
      sectionId: defaultSec,
      title: title.trim(),
      description: '',
      strategy: '',
      doneMeans: 'Finished as planned',
      estimatedMinutes,
      priority,
      mustDo: !!opts.mustDo,
      tags: opts.tags || [],
      icon: opts.icon || (opts.mustDo ? '⭐' : opts.tags?.includes('call') ? '📞' : opts.tags?.includes('errand') ? '🏃' : '📌'),
      textColor: '',
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
    syncEngine.notifyLocalMutation();
  };

  const shiftDate = (days: number) => {
    const [y, m, d] = currentDate.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + days);
    onChangeDate(date.toISOString().split('T')[0]);
  };

  const dayOfWeekName = useMemo(() => {
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

  // Filter tasks by selected tag if set
  const filteredTasks = useMemo(() => {
    if (!selectedTag) return tasks;
    return tasks.filter(t => t.tags?.includes(selectedTag));
  }, [tasks, selectedTag]);

  // Grouped task segments
  const goalTasks = useMemo(() => filteredTasks.filter(t => t.mustDo), [filteredTasks]);
  const callTasks = useMemo(() => filteredTasks.filter(t => !t.mustDo && (t.tags?.includes('call') || t.title.toLowerCase().includes('call'))), [filteredTasks]);
  const errandTasks = useMemo(() => filteredTasks.filter(t => !t.mustDo && (t.tags?.includes('errand') || t.title.toLowerCase().includes('errand') || t.title.toLowerCase().includes('buy'))), [filteredTasks]);
  const todoTasks = useMemo(() => filteredTasks.filter(t => !t.mustDo && !callTasks.includes(t) && !errandTasks.includes(t)), [filteredTasks, callTasks, errandTasks]);

  // Unique tags for tag filter bar
  const allTags = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach(t => t.tags?.forEach(tag => set.add(tag)));
    return Array.from(set);
  }, [tasks]);

  const totalEstimatedMins = useMemo(() => tasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0), [tasks]);
  const totalPlannedHrs = Math.round((totalEstimatedMins / 60) * 10) / 10;
  const isOverBudget = totalPlannedHrs > freeHours;
  const conflictAnalysis = useMemo(() => detectScheduleConflicts(tasks, freeHours), [tasks, freeHours]);

  // ══════════════════════════════════════════════════════════════════
  // REUSABLE TASK ITEM WITH INLINE TIME & HARD / MEDIUM / LOW SELECTORS
  // ══════════════════════════════════════════════════════════════════
  const renderTaskItem = (t: Task) => {
    const sec = sections.find(s => s.id === t.sectionId);
    const isThisTimerActive = activeTimer?.taskId === t.id;

    return (
      <div
        key={t.id}
        style={{
          background: 'rgba(22, 22, 28, 0.88)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: 10,
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          transition: 'all 0.15s ease',
        }}
      >
        {/* Top Line: Checkbox, Reorder Buttons, Title, Tags & Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Reorder Up/Down arrows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
            <button
              type="button"
              onClick={event => { void withActionFeedback('Reordering task', () => handleMoveTask(t.id, 'up'), event.currentTarget); }}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 0, lineHeight: 1 }}
              title="Move Up"
              aria-label="Move task up"
            >
              <ChevronUp size={11} />
            </button>
            <button
              type="button"
              onClick={event => { void withActionFeedback('Reordering task', () => handleMoveTask(t.id, 'down'), event.currentTarget); }}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 0, lineHeight: 1 }}
              title="Move Down"
              aria-label="Move task down"
            >
              <ChevronDown size={11} />
            </button>
          </div>

          {/* Checkbox */}
          <button
            onClick={event => { void withActionFeedback(t.isCompleted ? 'Updating task' : 'Completing task', () => handleToggleTask(t), event.currentTarget); }}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: t.isCompleted ? '#4ade80' : 'rgba(255, 255, 255, 0.45)',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
            aria-label={t.isCompleted ? 'Mark incomplete' : 'Mark complete'}
          >
            {t.isCompleted ? <CheckSquare size={17} /> : <Square size={17} />}
          </button>

          {/* Task Title */}
          <span
            onClick={() => onOpenTaskModal(t)}
            style={{
              flex: 1,
              fontSize: 13,
              fontWeight: 600,
              color: t.isCompleted ? 'rgba(255, 255, 255, 0.35)' : (t.textColor || '#ffffff'),
              textDecoration: t.isCompleted ? 'line-through' : 'none',
              cursor: 'pointer',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={t.title}
          >
            {t.icon && <span style={{ marginRight: 4 }}>{t.icon}</span>}
            {t.title}
          </span>

          {/* Strategy / Done Means badge */}
          {(t.strategy || t.doneMeans) && (
            <span
              onClick={() => onOpenTaskModal(t)}
              style={{
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 4,
                background: 'rgba(167, 139, 250, 0.15)',
                color: '#a78bfa',
                border: '1px solid rgba(167, 139, 250, 0.3)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
              title="Has Strategy / Done criteria"
            >
              🎯 Plan
            </span>
          )}

          {/* Section badge */}
          {sec && (
            <span
              style={{
                fontSize: 9,
                color: sec.color,
                background: `${sec.color}15`,
                border: `1px solid ${sec.color}35`,
                borderRadius: 4,
                padding: '1px 5px',
                flexShrink: 0,
              }}
            >
              {sec.icon} {sec.name}
            </span>
          )}

          {/* Collision Warning Badge */}
          {conflictAnalysis.conflictingTaskIds.has(t.id) && (
            <span
              onClick={() => setShowConflictModal(true)}
              style={{
                fontSize: 9,
                padding: '1px 6px',
                borderRadius: 4,
                background: 'rgba(239, 68, 68, 0.22)',
                border: '1px solid rgba(239, 68, 68, 0.55)',
                color: '#fca5a5',
                cursor: 'pointer',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                flexShrink: 0,
              }}
              title="Time overlap detected with another scheduled task. Click to resolve."
            >
              <AlertTriangle size={10} style={{ color: '#ef4444' }} />
              Overlap
            </span>
          )}

          {/* Timer Button on Today */}
          {isToday && (
            <button
              type="button"
              onClick={() => {
                if (isThisTimerActive) {
                  if (isTimerRunning) pauseTimer();
                  else resumeTimer();
                } else {
                  startTimer(t.id, t.title, sec?.color);
                }
              }}
              style={{
                background: isThisTimerActive ? 'rgba(56, 189, 248, 0.25)' : 'none',
                border: isThisTimerActive ? '1px solid #38bdf8' : 'none',
                borderRadius: 4,
                padding: '2px 4px',
                color: isThisTimerActive ? '#38bdf8' : 'rgba(255,255,255,0.45)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                flexShrink: 0,
              }}
              title={isThisTimerActive ? (isTimerRunning ? 'Pause timer' : 'Resume timer') : 'Start timer'}
            >
              {isThisTimerActive && isTimerRunning ? <Pause size={11} /> : <Play size={11} />}
            </button>
          )}

          {/* Edit & Delete Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            <button
              onClick={() => onOpenTaskModal(t)}
              style={{ background: 'none', border: 'none', color: 'rgba(255, 255, 255, 0.35)', cursor: 'pointer', padding: 2 }}
              title="Edit Task Strategy"
            >
              <Edit2 size={12} />
            </button>
            <button
              onClick={event => { void withActionFeedback('Deleting task', () => handleDeleteTask(t.id), event.currentTarget); }}
              style={{ background: 'none', border: 'none', color: 'rgba(239, 68, 68, 0.45)', cursor: 'pointer', padding: 2 }}
              title="Delete Task"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {/* ── BOTTOM CONTROLS: TIME & HARD, MEDIUM, LOW SELECTOR ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            paddingTop: 4,
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            flexWrap: 'wrap',
          }}
        >
          {/* Quick Time Selector Buttons at Bottom */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', gap: 2, marginRight: 2 }}>
              <Clock size={10} />
            </span>
            {QUICK_TIMES.map(mins => {
              const isSelected = t.estimatedMinutes === mins;
              return (
                <button
                  key={mins}
                  type="button"
                  onClick={event => { void withActionFeedback('Updating task time', () => handleUpdateTaskTime(t.id, mins), event.currentTarget); }}
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '2px 5px',
                    borderRadius: 4,
                    border: isSelected ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                    background: isSelected ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                    color: isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.5)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  title={`Set duration to ${mins}m`}
                >
                  {mins >= 60 ? `${mins / 60}h` : `${mins}m`}
                </button>
              );
            })}
          </div>

          {/* Hard / Medium / Low Difficulty Buttons at Bottom */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            {(['High', 'Medium', 'Low'] as PriorityLevel[]).map(lvl => {
              const label = lvl === 'High' ? 'Hard' : lvl;
              const isSelected = t.priority === lvl;
              const color = lvl === 'High' ? '#f87171' : lvl === 'Medium' ? '#fbbf24' : '#34d399';
              const bgColor = lvl === 'High' ? 'rgba(239,68,68,0.22)' : lvl === 'Medium' ? 'rgba(245,158,11,0.22)' : 'rgba(16,185,129,0.22)';
              const borderColor = lvl === 'High' ? 'rgba(239,68,68,0.55)' : lvl === 'Medium' ? 'rgba(245,158,11,0.55)' : 'rgba(16,185,129,0.55)';

              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={event => { void withActionFeedback('Updating task priority', () => handleUpdateTaskPriority(t.id, lvl), event.currentTarget); }}
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: isSelected ? `1px solid ${borderColor}` : '1px solid rgba(255, 255, 255, 0.1)',
                    background: isSelected ? bgColor : 'rgba(255, 255, 255, 0.04)',
                    color: isSelected ? color : 'rgba(255, 255, 255, 0.45)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  title={`Set difficulty to ${label}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ══════════════════════════════════════════════════════════════════
          1. PLANNER SHEET HEADER (DATE & DAY OF WEEK BANNER)
         ══════════════════════════════════════════════════════════════════ */}
      <div
        style={{
          borderBottom: '2.5px solid rgba(255, 255, 255, 0.45)',
          paddingBottom: 12,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        {/* Date Selector Row */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>
            DATE:
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => shiftDate(-1)} className="v-circle-btn" style={{ width: 28, height: 28 }} aria-label="Previous Day">
              <ChevronLeft size={14} />
            </button>

            <div
              className="v-pill-btn"
              style={{ padding: '4px 12px', background: 'rgba(255,255,255,0.08)', cursor: 'pointer' }}
            >
              <Calendar size={13} style={{ opacity: 0.7 }} />
              <input
                type="date"
                value={currentDate}
                onChange={e => onChangeDate(e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 600,
                  outline: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <button onClick={() => shiftDate(1)} className="v-circle-btn" style={{ width: 28, height: 28 }} aria-label="Next Day">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* Large Day of Week Title (strictly matching MONDAY in reference image) */}
        <div style={{ textAlign: 'right' }}>
          <h2
            style={{
              fontSize: isPhone ? 32 : 44,
              fontWeight: 900,
              letterSpacing: '0.04em',
              margin: 0,
              lineHeight: 1,
              color: '#ffffff',
              textTransform: 'uppercase',
              textShadow: '0 2px 10px rgba(0,0,0,0.5)',
            }}
          >
            {dayOfWeekName}
          </h2>
          {/* Budget adjuster & progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 11, color: isOverBudget ? '#f87171' : 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>
              Planned: <strong>{totalPlannedHrs}h</strong>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 999, padding: '2px 6px' }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>Budget:</span>
              <button
                type="button"
                onClick={event => { void withActionFeedback('Updating available hours', () => handleUpdateFreeHours(freeHours - 0.5), event.currentTarget); }}
                style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer', fontSize: 11, padding: '0 3px', fontWeight: 700 }}
                title="Decrease budget by 0.5h"
              >
                -
              </button>
              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: '#ffffff' }}>
                {freeHours}h
              </span>
              <button
                type="button"
                onClick={event => { void withActionFeedback('Updating available hours', () => handleUpdateFreeHours(freeHours + 0.5), event.currentTarget); }}
                style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer', fontSize: 11, padding: '0 3px', fontWeight: 700 }}
                title="Increase budget by 0.5h"
              >
                +
              </button>
            </div>
          </div>

          {/* Visual Budget Progress Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
            <div style={{ width: 130, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, (totalPlannedHrs / (freeHours || 1)) * 100)}%`,
                  background: isOverBudget ? 'linear-gradient(90deg, #f87171, #ef4444)' : 'linear-gradient(90deg, #38bdf8, #818cf8)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            {isOverBudget && (
              <span style={{ fontSize: 10, color: '#f87171', fontWeight: 700 }}>
                ⚠ OVER
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Schedule Conflicts Banner */}
      {conflictAnalysis.hasConflicts && (
        <div
          className="v-card"
          style={{
            padding: '10px 16px',
            background: 'rgba(239, 68, 68, 0.12)',
            borderColor: 'rgba(239, 68, 68, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} style={{ color: '#f87171', flexShrink: 0 }} />
            <div style={{ fontSize: 12, color: '#fee2e2' }}>
              <strong>
                {conflictAnalysis.timeCollisions.length > 0
                  ? `${conflictAnalysis.timeCollisions.length} Time Overlap${conflictAnalysis.timeCollisions.length > 1 ? 's' : ''}`
                  : ''}
              </strong>
              {conflictAnalysis.timeCollisions.length > 0 && conflictAnalysis.isOverBudget ? ' · ' : ''}
              <strong>
                {conflictAnalysis.isOverBudget
                  ? `${Math.round(conflictAnalysis.budgetOverflowMinutes / 6) / 10}h Over Focus Budget`
                  : ''}
              </strong>
              <span style={{ color: 'rgba(255,255,255,0.7)', marginLeft: 6 }}>
                Schedule collisions detected on today&apos;s timeline.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowConflictModal(true)}
            className="v-pill-btn"
            style={{
              padding: '5px 14px',
              fontSize: 11,
              background: 'rgba(245, 158, 11, 0.25)',
              borderColor: '#fbbf24',
              color: '#ffffff',
              fontWeight: 700,
              gap: 5,
            }}
          >
            <Sparkles size={12} style={{ color: '#facc15' }} />
            Auto-Resolve Conflicts with AI
          </button>
        </div>
      )}

      {/* Unfinished Tasks Rollover Banner */}
      {prevUnfinished.length > 0 && (
        <div
          className="v-card"
          style={{
            padding: '10px 16px',
            background: 'rgba(245, 158, 11, 0.12)',
            borderColor: 'rgba(245, 158, 11, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={15} style={{ color: '#fbbf24', flexShrink: 0 }} />
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)' }}>
              You have <strong style={{ color: '#fbbf24' }}>{prevUnfinished.length}</strong> unfinished tasks from {prevDate}.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenAutoPlan(prevDate, prevUnfinished)}
            className="v-pill-btn v-pill-btn-primary"
            style={{ padding: '4px 12px', fontSize: 11, background: 'rgba(245,158,11,0.25)', borderColor: '#fbbf24', color: '#ffffff' }}
          >
            Review & Rollover →
          </button>
        </div>
      )}

      {/* Yesterday's Change Reflection Banner */}
      {yesterdayReflection && (
        <div
          className="v-card"
          style={{
            padding: '10px 16px',
            background: 'rgba(99, 102, 241, 0.12)',
            borderColor: 'rgba(99, 102, 241, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Sparkles size={15} style={{ color: '#a5b4fc', flexShrink: 0 }} />
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
            <strong>One Change Promised Yesterday:</strong> {yesterdayReflection}
          </div>
        </div>
      )}

      {/* Tag Filter Bar */}
      {allTags.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <TagIcon size={11} /> Filter:
          </span>
          <button
            type="button"
            onClick={() => setSelectedTag(null)}
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 999,
              border: !selectedTag ? '1px solid rgba(255,255,255,0.4)' : '1px solid rgba(255,255,255,0.08)',
              background: !selectedTag ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.03)',
              color: !selectedTag ? '#ffffff' : 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
            }}
          >
            All ({tasks.length})
          </button>
          {allTags.map(tag => {
            const count = tasks.filter(t => t.tags?.includes(tag)).length;
            const isSel = selectedTag === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTag(isSel ? null : tag)}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 999,
                  border: isSel ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)',
                  background: isSel ? 'rgba(56,189,248,0.2)' : 'rgba(255,255,255,0.03)',
                  color: isSel ? '#38bdf8' : 'rgba(255,255,255,0.5)',
                  cursor: 'pointer',
                }}
              >
                #{tag} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          2. THREE-COLUMN DAILY PLANNER SHEET GRID
         ══════════════════════════════════════════════════════════════════ */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isPhone ? '1fr' : '1.1fr 1.3fr 1fr',
          gap: 14,
          alignItems: 'start',
        }}
      >
        {/* ── COLUMN 1: NOTES & TODAY'S SCHEDULE ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 1. NOTES BOX */}
          <div
            className="v-card"
            style={{
              padding: 0,
              borderRadius: 14,
              border: '1.5px solid rgba(255, 255, 255, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: '#000000',
                color: '#ffffff',
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: '0.12em',
                textAlign: 'center',
                borderBottom: '1.5px solid rgba(255, 255, 255, 0.25)',
              }}
            >
              NOTES
            </div>
            <div style={{ padding: '10px 14px', background: 'rgba(16, 16, 20, 0.75)' }}>
              <textarea
                value={sheetData.notes || ''}
                onChange={e => saveSheetData({ notes: e.target.value })}
                onFocus={handleUserTyping}
                placeholder="Write reminders, priorities, focus rules..."
                rows={5}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255, 255, 255, 0.85)',
                  fontSize: 12,
                  lineHeight: '24px',
                  resize: 'vertical',
                  outline: 'none',
                  fontFamily: 'inherit',
                  backgroundImage: 'repeating-linear-gradient(transparent, transparent 23px, rgba(255,255,255,0.08) 23px, rgba(255,255,255,0.08) 24px)',
                }}
              />
            </div>
          </div>

          {/* 2. TODAY'S SCHEDULE BOX (6:00 AM to 10:00 PM) */}
          <div
            className="v-card"
            style={{
              padding: 0,
              borderRadius: 14,
              border: '1.5px solid rgba(255, 255, 255, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: '#000000',
                color: '#ffffff',
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: '0.12em',
                textAlign: 'center',
                borderBottom: '1.5px solid rgba(255, 255, 255, 0.25)',
              }}
            >
              TODAY&apos;S SCHEDULE
            </div>

            <div style={{ padding: '8px 12px', background: 'rgba(16, 16, 20, 0.75)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {SCHEDULE_HOURS.map(hour => {
                const val = (sheetData.schedule && sheetData.schedule[hour]) || '';
                return (
                  <div
                    key={hour}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                      paddingBottom: 2,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: 'monospace',
                        color: 'rgba(255, 255, 255, 0.45)',
                        width: 58,
                        flexShrink: 0,
                        textAlign: 'right',
                      }}
                    >
                      {hour}
                    </span>
                    <input
                      type="text"
                      value={val}
                      onChange={e => handleUpdateScheduleHour(hour, e.target.value)}
                      onFocus={handleUserTyping}
                      placeholder="—"
                      style={{
                        flex: 1,
                        background: 'transparent',
                        border: 'none',
                        color: '#ffffff',
                        fontSize: 12,
                        outline: 'none',
                        padding: '2px 4px',
                      }}
                    />
                    {val && (
                      <button
                        type="button"
                        onClick={() => handleClearScheduleHour(hour)}
                        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 2 }}
                        title="Clear slot"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── COLUMN 2: GOALS, NEED TO CALL, ERRANDS TO RUN, MASTER TO DO ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 1. GOALS BOX (Top 3 Must-Dos) */}
          <div
            className="v-card"
            style={{
              padding: 0,
              borderRadius: 14,
              border: '1.5px solid rgba(255, 255, 255, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: '#000000',
                color: '#ffffff',
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: '0.12em',
                textAlign: 'center',
                borderBottom: '1.5px solid rgba(255, 255, 255, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <Star size={12} style={{ color: '#facc15', fill: '#facc15' }} />
              <span>GOALS (TOP 3)</span>
            </div>

            <div style={{ padding: '8px 10px', background: 'rgba(16, 16, 20, 0.75)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {goalTasks.length === 0 ? (
                <div style={{ padding: '6px 0', fontSize: 11, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', textAlign: 'center' }}>
                  No top goals set for today (max 3)
                </div>
              ) : (
                goalTasks.map(t => renderTaskItem(t))
              )}

              {/* Quick Goal Input with Time & Priority at Bottom */}
              {goalTasks.length < 3 && (
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    void withActionFeedback('Adding goal', async () => {
                      await createQuickTask(newGoalTitle, newGoalTime, newGoalPriority, { mustDo: true });
                      setNewGoalTitle('');
                    }, e.currentTarget);
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    marginTop: 4,
                    borderTop: '1px dashed rgba(255,255,255,0.12)',
                    paddingTop: 6,
                  }}
                >
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      value={newGoalTitle}
                      onChange={e => setNewGoalTitle(e.target.value)}
                      onFocus={handleUserTyping}
                      placeholder="+ Add Must-Do Goal..."
                      style={{ flex: 1, background: 'transparent', border: 'none', color: '#ffffff', fontSize: 12, outline: 'none' }}
                    />
                    <button
                      type="submit"
                      disabled={!newGoalTitle.trim()}
                      className="v-pill-btn v-pill-btn-primary"
                      style={{ padding: '3px 10px', fontSize: 10 }}
                    >
                      Add
                    </button>
                  </div>

                  {/* Time and Priority Picker at bottom of goal creator */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {QUICK_TIMES.slice(0, 4).map(m => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setNewGoalTime(m)}
                          style={{
                            fontSize: 9,
                            padding: '1px 4px',
                            borderRadius: 3,
                            border: newGoalTime === m ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)',
                            background: newGoalTime === m ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                            color: newGoalTime === m ? '#38bdf8' : 'rgba(255,255,255,0.4)',
                            cursor: 'pointer',
                          }}
                        >
                          {m}m
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {(['High', 'Medium', 'Low'] as PriorityLevel[]).map(lvl => (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => setNewGoalPriority(lvl)}
                          style={{
                            fontSize: 9,
                            padding: '1px 4px',
                            borderRadius: 3,
                            border: newGoalPriority === lvl ? '1px solid #facc15' : '1px solid rgba(255,255,255,0.08)',
                            background: newGoalPriority === lvl ? 'rgba(250, 204, 21, 0.2)' : 'transparent',
                            color: newGoalPriority === lvl ? '#facc15' : 'rgba(255,255,255,0.4)',
                            cursor: 'pointer',
                          }}
                        >
                          {lvl === 'High' ? 'Hard' : lvl}
                        </button>
                      ))}
                    </div>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* 2. NEED TO CALL BOX */}
          <div
            className="v-card"
            style={{
              padding: 0,
              borderRadius: 14,
              border: '1.5px solid rgba(255, 255, 255, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: '#000000',
                color: '#ffffff',
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: '0.12em',
                textAlign: 'center',
                borderBottom: '1.5px solid rgba(255, 255, 255, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <Phone size={12} />
              <span>NEED TO CALL</span>
            </div>

            <div style={{ padding: '8px 10px', background: 'rgba(16, 16, 20, 0.75)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {callTasks.map(t => renderTaskItem(t))}

              <form
                onSubmit={e => {
                  e.preventDefault();
                  void withActionFeedback('Adding call', async () => {
                    await createQuickTask(newCallTitle, newCallTime, 'Medium', { tags: ['call'], icon: '📞' });
                    setNewCallTitle('');
                  }, e.currentTarget);
                }}
                style={{ display: 'flex', gap: 6, marginTop: 4, borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: 6 }}
              >
                <input
                  type="text"
                  value={newCallTitle}
                  onChange={e => setNewCallTitle(e.target.value)}
                  onFocus={handleUserTyping}
                  placeholder="+ Add person to call..."
                  style={{ flex: 1, background: 'transparent', border: 'none', color: '#ffffff', fontSize: 12, outline: 'none' }}
                />
                <button type="submit" disabled={!newCallTitle.trim()} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer' }}>
                  <Plus size={14} />
                </button>
              </form>
            </div>
          </div>

          {/* 3. ERRANDS TO RUN BOX */}
          <div
            className="v-card"
            style={{
              padding: 0,
              borderRadius: 14,
              border: '1.5px solid rgba(255, 255, 255, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: '#000000',
                color: '#ffffff',
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: '0.12em',
                textAlign: 'center',
                borderBottom: '1.5px solid rgba(255, 255, 255, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <ShoppingBag size={12} />
              <span>ERRANDS TO RUN</span>
            </div>

            <div style={{ padding: '8px 10px', background: 'rgba(16, 16, 20, 0.75)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {errandTasks.map(t => renderTaskItem(t))}

              <form
                onSubmit={e => {
                  e.preventDefault();
                  void withActionFeedback('Adding errand', async () => {
                    await createQuickTask(newErrandTitle, newErrandTime, 'Medium', { tags: ['errand'], icon: '🏃' });
                    setNewErrandTitle('');
                  }, e.currentTarget);
                }}
                style={{ display: 'flex', gap: 6, marginTop: 4, borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: 6 }}
              >
                <input
                  type="text"
                  value={newErrandTitle}
                  onChange={e => setNewErrandTitle(e.target.value)}
                  onFocus={handleUserTyping}
                  placeholder="+ Add errand to run..."
                  style={{ flex: 1, background: 'transparent', border: 'none', color: '#ffffff', fontSize: 12, outline: 'none' }}
                />
                <button type="submit" disabled={!newErrandTitle.trim()} style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer' }}>
                  <Plus size={14} />
                </button>
              </form>
            </div>
          </div>

          {/* 4. MASTER TO DO BOX (The Main Daily Task List) */}
          <div
            className="v-card"
            style={{
              padding: 0,
              borderRadius: 14,
              border: '1.5px solid rgba(255, 255, 255, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: '#000000',
                color: '#ffffff',
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: '0.12em',
                textAlign: 'center',
                borderBottom: '1.5px solid rgba(255, 255, 255, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <ListTodo size={13} />
              <span>TO DO</span>
            </div>

            <div style={{ padding: '8px 10px', background: 'rgba(16, 16, 20, 0.75)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {todoTasks.length === 0 ? (
                <div style={{ padding: '12px 0', fontSize: 11, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', textAlign: 'center' }}>
                  No tasks on to-do list. Add below or configure details.
                </div>
              ) : (
                todoTasks.map(t => renderTaskItem(t))
              )}

              {/* ── QUICK TO-DO CREATION BOX WITH TIME & HARD/MEDIUM/LOW AT BOTTOM ── */}
              <form
                onSubmit={e => {
                  e.preventDefault();
                  void withActionFeedback('Adding task', async () => {
                    await createQuickTask(newTodoTitle, newTodoTime, newTodoPriority, {});
                    setNewTodoTitle('');
                  }, e.currentTarget);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  marginTop: 6,
                  borderTop: '1px dashed rgba(255,255,255,0.12)',
                  paddingTop: 8,
                }}
              >
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    value={newTodoTitle}
                    onChange={e => setNewTodoTitle(e.target.value)}
                    onFocus={handleUserTyping}
                    placeholder="+ Add new task to daily to-do..."
                    style={{ flex: 1, background: 'transparent', border: 'none', color: '#ffffff', fontSize: 12, outline: 'none' }}
                  />
                  <button
                    type="submit"
                    disabled={!newTodoTitle.trim()}
                    className="v-pill-btn v-pill-btn-primary"
                    style={{ padding: '3px 12px', fontSize: 11 }}
                  >
                    Add
                  </button>
                </div>

                {/* Quick Time and Hard/Med/Low Pickers */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginRight: 2 }}>Time:</span>
                    {QUICK_TIMES.map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setNewTodoTime(m)}
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: '2px 5px',
                          borderRadius: 4,
                          border: newTodoTime === m ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                          background: newTodoTime === m ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                          color: newTodoTime === m ? '#38bdf8' : 'rgba(255, 255, 255, 0.5)',
                          cursor: 'pointer',
                        }}
                      >
                        {m >= 60 ? `${m / 60}h` : `${m}m`}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginRight: 2 }}>Difficulty:</span>
                    {(['High', 'Medium', 'Low'] as PriorityLevel[]).map(lvl => {
                      const label = lvl === 'High' ? 'Hard' : lvl;
                      const isSelected = newTodoPriority === lvl;
                      const color = lvl === 'High' ? '#f87171' : lvl === 'Medium' ? '#fbbf24' : '#34d399';
                      const bgColor = lvl === 'High' ? 'rgba(239,68,68,0.22)' : lvl === 'Medium' ? 'rgba(245,158,11,0.22)' : 'rgba(16,185,129,0.22)';
                      const borderColor = lvl === 'High' ? 'rgba(239,68,68,0.55)' : lvl === 'Medium' ? 'rgba(245,158,11,0.55)' : 'rgba(16,185,129,0.55)';

                      return (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => setNewTodoPriority(lvl)}
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: 4,
                            border: isSelected ? `1px solid ${borderColor}` : '1px solid rgba(255, 255, 255, 0.1)',
                            background: isSelected ? bgColor : 'rgba(255, 255, 255, 0.04)',
                            color: isSelected ? color : 'rgba(255, 255, 255, 0.45)',
                            cursor: 'pointer',
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* ── COLUMN 3: MEALS, WATER & EXERCISE ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 1. BREAKFAST BOX */}
          <div
            className="v-card"
            style={{
              padding: 0,
              borderRadius: 14,
              border: '1.5px solid rgba(255, 255, 255, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: '#000000',
                color: '#ffffff',
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: '0.12em',
                textAlign: 'center',
                borderBottom: '1.5px solid rgba(255, 255, 255, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
              }}
            >
              <Coffee size={12} />
              <span>BREAKFAST</span>
            </div>
            <div style={{ padding: '8px 12px', background: 'rgba(16, 16, 20, 0.75)' }}>
              <input
                type="text"
                value={sheetData.breakfast || ''}
                onChange={e => saveSheetData({ breakfast: e.target.value })}
                onFocus={handleUserTyping}
                placeholder="e.g. Eggs, toast & avocado"
                style={{ width: '100%', background: 'transparent', border: 'none', color: '#ffffff', fontSize: 12, outline: 'none' }}
              />
            </div>
          </div>

          {/* 2. LUNCH BOX */}
          <div
            className="v-card"
            style={{
              padding: 0,
              borderRadius: 14,
              border: '1.5px solid rgba(255, 255, 255, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: '#000000',
                color: '#ffffff',
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: '0.12em',
                textAlign: 'center',
                borderBottom: '1.5px solid rgba(255, 255, 255, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
              }}
            >
              <Utensils size={12} />
              <span>LUNCH</span>
            </div>
            <div style={{ padding: '8px 12px', background: 'rgba(16, 16, 20, 0.75)' }}>
              <input
                type="text"
                value={sheetData.lunch || ''}
                onChange={e => saveSheetData({ lunch: e.target.value })}
                onFocus={handleUserTyping}
                placeholder="e.g. Chicken bowl & salad"
                style={{ width: '100%', background: 'transparent', border: 'none', color: '#ffffff', fontSize: 12, outline: 'none' }}
              />
            </div>
          </div>

          {/* 3. DINNER BOX */}
          <div
            className="v-card"
            style={{
              padding: 0,
              borderRadius: 14,
              border: '1.5px solid rgba(255, 255, 255, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: '#000000',
                color: '#ffffff',
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: '0.12em',
                textAlign: 'center',
                borderBottom: '1.5px solid rgba(255, 255, 255, 0.25)',
              }}
            >
              DINNER
            </div>
            <div style={{ padding: '8px 12px', background: 'rgba(16, 16, 20, 0.75)' }}>
              <input
                type="text"
                value={sheetData.dinner || ''}
                onChange={e => saveSheetData({ dinner: e.target.value })}
                onFocus={handleUserTyping}
                placeholder="e.g. Grilled salmon & rice"
                style={{ width: '100%', background: 'transparent', border: 'none', color: '#ffffff', fontSize: 12, outline: 'none' }}
              />
            </div>
          </div>

          {/* 4. SNACKS BOX */}
          <div
            className="v-card"
            style={{
              padding: 0,
              borderRadius: 14,
              border: '1.5px solid rgba(255, 255, 255, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: '#000000',
                color: '#ffffff',
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: '0.12em',
                textAlign: 'center',
                borderBottom: '1.5px solid rgba(255, 255, 255, 0.25)',
              }}
            >
              SNACKS
            </div>
            <div style={{ padding: '8px 12px', background: 'rgba(16, 16, 20, 0.75)' }}>
              <input
                type="text"
                value={sheetData.snacks || ''}
                onChange={e => saveSheetData({ snacks: e.target.value })}
                onFocus={handleUserTyping}
                placeholder="e.g. Protein shake, fruit"
                style={{ width: '100%', background: 'transparent', border: 'none', color: '#ffffff', fontSize: 12, outline: 'none' }}
              />
            </div>
          </div>

          {/* 5. WATER TRACKER BOX (10 Glass Tumbler Cups) */}
          <div
            className="v-card"
            style={{
              padding: 0,
              borderRadius: 14,
              border: '1.5px solid rgba(255, 255, 255, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: '#000000',
                color: '#ffffff',
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: '0.12em',
                textAlign: 'center',
                borderBottom: '1.5px solid rgba(255, 255, 255, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <span>WATER ({sheetData.waterGlasses || 0}/10)</span>
            </div>

            <div style={{ padding: '12px 10px', background: 'rgba(16, 16, 20, 0.75)' }}>
              {/* Row 1: Cups 1 to 5 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 8 }}>
                {[1, 2, 3, 4, 5].map(num => {
                  const isFilled = (sheetData.waterGlasses || 0) >= num;
                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handleToggleWater(num)}
                      style={{
                        height: 42,
                        clipPath: 'polygon(10% 0%, 90% 0%, 80% 100%, 20% 100%)', // realistic tumbler cup silhouette
                        borderRadius: '2px 2px 4px 4px',
                        border: `1.5px solid ${isFilled ? '#38bdf8' : 'rgba(255,255,255,0.3)'}`,
                        background: isFilled ? 'linear-gradient(180deg, rgba(56,189,248,0.4) 0%, rgba(14,165,233,0.8) 100%)' : 'rgba(255,255,255,0.04)',
                        color: isFilled ? '#ffffff' : 'rgba(255,255,255,0.45)',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s ease',
                        boxShadow: isFilled ? '0 0 10px rgba(56,189,248,0.4)' : 'none',
                      }}
                      title={`Glass ${num} - click to toggle`}
                    >
                      {num}
                    </button>
                  );
                })}
              </div>

              {/* Row 2: Cups 6 to 10 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                {[6, 7, 8, 9, 10].map(num => {
                  const isFilled = (sheetData.waterGlasses || 0) >= num;
                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handleToggleWater(num)}
                      style={{
                        height: 42,
                        clipPath: 'polygon(10% 0%, 90% 0%, 80% 100%, 20% 100%)',
                        borderRadius: '2px 2px 4px 4px',
                        border: `1.5px solid ${isFilled ? '#38bdf8' : 'rgba(255,255,255,0.3)'}`,
                        background: isFilled ? 'linear-gradient(180deg, rgba(56,189,248,0.4) 0%, rgba(14,165,233,0.8) 100%)' : 'rgba(255,255,255,0.04)',
                        color: isFilled ? '#ffffff' : 'rgba(255,255,255,0.45)',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s ease',
                        boxShadow: isFilled ? '0 0 10px rgba(56,189,248,0.4)' : 'none',
                      }}
                      title={`Glass ${num} - click to toggle`}
                    >
                      {num}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 6. EXERCISE BOX */}
          <div
            className="v-card"
            style={{
              padding: 0,
              borderRadius: 14,
              border: '1.5px solid rgba(255, 255, 255, 0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: '#000000',
                color: '#ffffff',
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: '0.12em',
                textAlign: 'center',
                borderBottom: '1.5px solid rgba(255, 255, 255, 0.25)',
              }}
            >
              EXERCISE
            </div>
            <div style={{ padding: '8px 12px', background: 'rgba(16, 16, 20, 0.75)' }}>
              <textarea
                value={sheetData.exercise || ''}
                onChange={e => saveSheetData({ exercise: e.target.value })}
                onFocus={handleUserTyping}
                placeholder="e.g. 45 min strength training or 5k run"
                rows={2}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: 12,
                  outline: 'none',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <ScheduleConflictModal
        isOpen={showConflictModal}
        onClose={() => setShowConflictModal(false)}
        tasks={tasks}
        freeHours={freeHours}
        onApplied={updated => setTasks(updated)}
      />
    </div>
  );
}
