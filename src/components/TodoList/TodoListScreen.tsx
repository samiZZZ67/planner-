'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { useTimer } from '@/lib/timer/useTimer';
import {
  ListChecks, Check, Clock, Play, Pause, Square as StopIcon,
  Plus, Target, ChevronLeft, ChevronRight, X, ExternalLink, Sparkles
} from 'lucide-react';
import type { Task, Section, TimeLog } from '@/types';

interface TodoListScreenProps {
  currentDate: string;
  onChangeDate: (date: string) => void;
  isPhone: boolean;
  onOpenTaskInCategory: (taskId: string) => void;
  onNavigateToAddTask: () => void;
}

function timeToMinutes(t?: string): number {
  if (!t) return 9999; // Sort unscheduled at end
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatTime12(t?: string): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function TodoListScreen({
  currentDate,
  onChangeDate,
  isPhone,
  onOpenTaskInCategory,
  onNavigateToAddTask,
}: TodoListScreenProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [dayFreeHours, setDayFreeHours] = useState<number>(8);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState('8');

  // Quick inline add
  const [inlineTitle, setInlineTitle] = useState('');
  const [inlineStartTime, setInlineStartTime] = useState('');
  const [inlineEndTime, setInlineEndTime] = useState('');
  const [showInlineAdd, setShowInlineAdd] = useState(false);
  const [inlineError, setInlineError] = useState('');

  // Pomodoro timer hook
  const {
    activeTimer,
    formattedCountdown,
    isFocus,
    isTimerRunning,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
  } = useTimer();

  const loadData = async () => {
    const [tList, sList, lList, dayRecord] = await Promise.all([
      db.tasks.filter(t => t.date === currentDate && !t.deleted).toArray(),
      db.sections.filter(s => !s.deleted).toArray(),
      db.timeLogs.filter(l => l.date === currentDate && !l.deleted).toArray(),
      db.days.get(currentDate),
    ]);

    setTasks(tList);
    setSections(sList);
    setTimeLogs(lList);
    const fh = dayRecord?.freeHours ?? 8;
    setDayFreeHours(fh);
    setBudgetInput(String(fh));
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2500);
    const unsub = syncEngine.subscribe(() => loadData());
    return () => {
      clearInterval(interval);
      unsub();
    };
  }, [currentDate]);

  // Chronologically sorted tasks: scheduled tasks first by startTime, then others by order
  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const timeA = timeToMinutes(a.startTime);
      const timeB = timeToMinutes(b.startTime);
      if (timeA !== timeB) return timeA - timeB;
      return a.order - b.order;
    });
  }, [tasks]);

  // Focus Budget: total, allocated, remaining
  const budget = useMemo(() => {
    const allocated = tasks.reduce((acc, t) => {
      if (t.deleted) return acc;
      const mins = t.scheduledMinutes || t.estimatedMinutes || 0;
      return acc + mins;
    }, 0);
    const totalMinutes = dayFreeHours * 60;
    const remaining = totalMinutes - allocated;
    const pct = Math.min(100, (allocated / totalMinutes) * 100);
    return {
      totalHours: dayFreeHours,
      allocatedMinutes: allocated,
      remainingMinutes: remaining,
      percentage: pct,
    };
  }, [tasks, dayFreeHours]);

  const budgetBarColor = budget.percentage >= 100 ? '#ef4444' : budget.percentage >= 80 ? '#f59e0b' : '#22c55e';

  const handleSaveBudget = async () => {
    const hrs = parseFloat(budgetInput);
    if (isNaN(hrs) || hrs <= 0 || hrs > 24) return;
    const now = Date.now();
    await db.days.put({
      id: currentDate,
      date: currentDate,
      freeHours: hrs,
      review: { worked: '', blocked: '', change: '' },
      updatedAt: now,
      deleted: false,
      isSample: false,
      synced: 0,
    });
    setDayFreeHours(hrs);
    setEditingBudget(false);
    syncEngine.notifyLocalMutation();
  };

  const handleToggleTask = async (task: Task) => {
    const nextCompleted = !task.isCompleted;
    await db.tasks.update(task.id, {
      isCompleted: nextCompleted,
      completedAt: nextCompleted ? Date.now() : null,
      status: nextCompleted ? 'completed' : 'not_started',
      updatedAt: Date.now(),
      synced: 0,
    });
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, isCompleted: nextCompleted } : t));
    syncEngine.notifyLocalMutation();
  };

  const handleInlineAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineTitle.trim()) return;

    let scheduledMinutes: number | undefined;
    if (inlineStartTime && inlineEndTime) {
      const sm = timeToMinutes(inlineStartTime);
      const em = timeToMinutes(inlineEndTime);
      if (em <= sm) {
        setInlineError('End time must be after start time.');
        return;
      }
      scheduledMinutes = em - sm;
      if (scheduledMinutes > budget.remainingMinutes) {
        setInlineError(`Exceeds remaining focus budget (${Math.round(budget.remainingMinutes)}m available).`);
        return;
      }
    }
    setInlineError('');

    const now = Date.now();
    const defaultSecId = sections[0]?.id || 'default-sec-1';
    const newTask: Task = {
      id: crypto.randomUUID(),
      date: currentDate,
      sectionId: defaultSecId,
      title: inlineTitle.trim(),
      description: '',
      strategy: '',
      doneMeans: '',
      estimatedMinutes: scheduledMinutes || 25,
      priority: 'Medium',
      mustDo: false,
      tags: [],
      icon: '🎯',
      isCompleted: false,
      completedAt: null,
      order: tasks.length,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      isSample: false,
      synced: 0,
      startTime: inlineStartTime || undefined,
      endTime: inlineEndTime || undefined,
      scheduledMinutes,
      status: 'not_started',
    };

    await db.tasks.put(newTask);
    setTasks(prev => [...prev, newTask]);
    setInlineTitle('');
    setInlineStartTime('');
    setInlineEndTime('');
    setShowInlineAdd(false);
    syncEngine.notifyLocalMutation();
  };

  const shiftDate = (days: number) => {
    const [y, m, d] = currentDate.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + days);
    onChangeDate(date.toISOString().split('T')[0]);
  };

  const dayName = useMemo(() => {
    try {
      const [y, m, d] = currentDate.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toUpperCase();
    } catch {
      return 'TODAY';
    }
  }, [currentDate]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── 1. Date Navigator ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={() => shiftDate(-1)}
          className="v-circle-btn"
          style={{ width: 36, height: 36, flexShrink: 0 }}
          aria-label="Previous day"
        >
          ‹
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div className="font-bloody" style={{ fontSize: isPhone ? 18 : 22, fontWeight: 700, letterSpacing: '0.05em' }}>
            {dayName}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {currentDate}
          </div>
        </div>
        <button
          type="button"
          onClick={() => shiftDate(1)}
          className="v-circle-btn"
          style={{ width: 36, height: 36, flexShrink: 0 }}
          aria-label="Next day"
        >
          ›
        </button>
      </div>

      {/* ── 2. Daily Focus-Time Budget Bar ── */}
      <div className="v-card" style={{ padding: '16px 20px', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Target size={16} color="var(--accent-color)" />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
              Daily Focus Budget
            </span>
          </div>
          {editingBudget ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="number"
                value={budgetInput}
                onChange={e => setBudgetInput(e.target.value)}
                min="0.5"
                max="24"
                step="0.5"
                style={{
                  width: 58,
                  padding: '4px 8px',
                  borderRadius: 8,
                  border: '1.5px solid var(--accent-color)',
                  background: 'var(--v-glass-bg-card)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  textAlign: 'center',
                }}
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>hrs</span>
              <button
                type="button"
                onClick={handleSaveBudget}
                className="v-pill-btn"
                style={{ padding: '4px 10px', fontSize: 12, minHeight: 30 }}
              >
                ✓
              </button>
              <button
                type="button"
                onClick={() => setEditingBudget(false)}
                className="v-circle-btn"
                style={{ width: 28, height: 28 }}
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingBudget(true)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: 12,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Adjust budget
            </button>
          )}
        </div>
        <div className="v-budget-bar">
          <div
            className="v-budget-bar-fill"
            style={{ width: `${budget.percentage}%`, background: budgetBarColor }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Total: <strong style={{ color: 'var(--text-secondary)' }}>{budget.totalHours}h</strong>
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Allocated: <strong style={{ color: budgetBarColor }}>{Math.round(budget.allocatedMinutes / 60 * 10) / 10}h</strong>
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Remaining: <strong style={{ color: budget.remainingMinutes <= 0 ? '#ef4444' : '#22c55e' }}>
              {Math.max(0, Math.round(budget.remainingMinutes / 60 * 10) / 10)}h
            </strong>
          </span>
        </div>
      </div>

      {/* ── 3. Active Pomodoro Banner (if running) ── */}
      {activeTimer && (
        <div
          className="v-card"
          style={{
            padding: '12px 18px',
            background: isFocus ? 'rgba(56, 189, 248, 0.12)' : 'rgba(34, 197, 94, 0.12)',
            border: `1.5px solid ${isFocus ? '#38bdf8' : '#22c55e'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: isFocus ? '#38bdf8' : '#22c55e',
                animation: 'timerPulse 1.4s infinite',
                flexShrink: 0,
              }}
            />
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {activeTimer.taskTitle}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {isFocus ? 'Focus Session (25 min)' : 'Break Time (5 min)'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 800, color: isFocus ? '#38bdf8' : '#22c55e' }}>
              {formattedCountdown}
            </span>
            {isTimerRunning ? (
              <button type="button" onClick={pauseTimer} className="v-circle-btn" style={{ width: 32, height: 32 }}>
                <Pause size={14} />
              </button>
            ) : (
              <button type="button" onClick={resumeTimer} className="v-circle-btn" style={{ width: 32, height: 32 }}>
                <Play size={14} />
              </button>
            )}
            <button type="button" onClick={stopTimer} className="v-circle-btn" style={{ width: 32, height: 32, color: '#f87171' }}>
              <StopIcon size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── 4. Checklist Header & Add Buttons ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ListChecks size={20} color="var(--accent-color)" />
          <span className="font-bloody" style={{ fontSize: 17, fontWeight: 700 }}>
            To-Do Checklist
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            ({tasks.filter(t => t.isCompleted).length}/{tasks.length})
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setShowInlineAdd(prev => !prev)}
            className="v-pill-btn"
            style={{ padding: '6px 14px', fontSize: 12, minHeight: 34, gap: 4 }}
          >
            <Plus size={13} /> Quick Add
          </button>
          <button
            type="button"
            onClick={onNavigateToAddTask}
            className="v-pill-btn v-pill-btn-primary"
            style={{ padding: '6px 14px', fontSize: 12, minHeight: 34, gap: 4 }}
          >
            Full Form
          </button>
        </div>
      </div>

      {/* Inline Quick Add Form */}
      {showInlineAdd && (
        <form onSubmit={handleInlineAdd}>
          <div className="v-card" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="text"
              placeholder="Task title..."
              value={inlineTitle}
              onChange={e => setInlineTitle(e.target.value)}
              className="v-input"
              style={{ fontSize: 14 }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={13} color="var(--text-muted)" />
                <input
                  type="time"
                  value={inlineStartTime}
                  onChange={e => setInlineStartTime(e.target.value)}
                  className="v-input"
                  style={{ width: 110, fontSize: 13, minHeight: 36, padding: '6px 10px' }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>→</span>
                <input
                  type="time"
                  value={inlineEndTime}
                  onChange={e => setInlineEndTime(e.target.value)}
                  className="v-input"
                  style={{ width: 110, fontSize: 13, minHeight: 36, padding: '6px 10px' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                <button type="submit" className="v-pill-btn v-pill-btn-primary" style={{ padding: '6px 16px', fontSize: 12, minHeight: 34 }}>
                  Add
                </button>
                <button type="button" onClick={() => setShowInlineAdd(false)} className="v-pill-btn" style={{ padding: '6px 12px', fontSize: 12, minHeight: 34 }}>
                  Cancel
                </button>
              </div>
            </div>
            {inlineError && (
              <span style={{ fontSize: 12, color: '#ef4444' }}>{inlineError}</span>
            )}
          </div>
        </form>
      )}

      {/* ── 5. Phone Notes Checklist ── */}
      <div className="v-card" style={{ padding: 0, overflow: 'hidden' }}>
        {sortedTasks.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <ListChecks size={36} style={{ marginBottom: 12, opacity: 0.35 }} />
            <p style={{ fontSize: 14, margin: 0 }}>No tasks scheduled for {dayName.toLowerCase()}.</p>
            <p style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
              Click <strong>Add Task</strong> or <strong>Quick Add</strong> above to plan your focus slots.
            </p>
          </div>
        ) : (
          sortedTasks.map((task, idx) => {
            const sec = sections.find(s => s.id === task.sectionId);
            const isCurrentTimerTask = activeTimer?.taskId === task.id;

            return (
              <div
                key={task.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 20px',
                  borderBottom: idx < sortedTasks.length - 1 ? '1px solid var(--v-glass-border-subtle)' : 'none',
                  background: task.isCompleted
                    ? 'rgba(34, 197, 94, 0.03)'
                    : isCurrentTimerTask
                    ? 'rgba(56, 189, 248, 0.06)'
                    : 'transparent',
                  transition: 'background 0.2s',
                }}
              >
                {/* Clean round notes-style checkbox */}
                <button
                  type="button"
                  onClick={() => handleToggleTask(task)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    border: `2px solid ${task.isCompleted ? '#22c55e' : 'var(--v-glass-border)'}`,
                    background: task.isCompleted ? '#22c55e' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'all 0.2s',
                  }}
                  aria-label={task.isCompleted ? 'Mark incomplete' : 'Mark complete'}
                >
                  {task.isCompleted && <Check size={14} color="#0d0d11" strokeWidth={3} />}
                </button>

                {/* Section Color Pip */}
                <div
                  style={{
                    width: 3,
                    height: 28,
                    borderRadius: 2,
                    background: sec?.color || 'var(--accent-color)',
                    flexShrink: 0,
                  }}
                />

                {/* Task Title (Clicking opens details in Category section) */}
                <div
                  style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                  onClick={() => onOpenTaskInCategory(task.id)}
                  title="Click to view full details in Category section"
                >
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: task.isCompleted ? 'var(--text-muted)' : 'var(--text-primary)',
                      textDecoration: task.isCompleted ? 'line-through' : 'none',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>{task.title}</span>
                    <ExternalLink size={12} color="var(--text-muted)" style={{ opacity: 0.6, flexShrink: 0 }} />
                  </div>

                  {/* Scheduled Time slot & duration */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                    {task.startTime ? (
                      <span style={{ fontSize: 12, color: 'var(--accent-color)', fontWeight: 600 }}>
                        {formatTime12(task.startTime)} {task.endTime ? `– ${formatTime12(task.endTime)}` : ''}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Unscheduled</span>
                    )}

                    {task.scheduledMinutes && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        · {task.scheduledMinutes}m
                      </span>
                    )}

                    {sec && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
                        · {sec.icon} {sec.name}
                      </span>
                    )}
                  </div>
                </div>

                {/* Time / Pomodoro button */}
                <button
                  type="button"
                  onClick={() => {
                    const dur = task.scheduledMinutes || task.targetMinutes || 25;
                    startTimer(task.id, task.title, dur, sec?.color);
                  }}
                  className="v-pill-btn"
                  style={{
                    padding: '6px 12px',
                    fontSize: 11,
                    minHeight: 32,
                    gap: 5,
                    flexShrink: 0,
                    borderColor: isCurrentTimerTask ? 'var(--accent-color)' : 'var(--v-glass-border)',
                    background: isCurrentTimerTask ? 'var(--accent-glow)' : 'var(--v-glass-bg-subtle)',
                  }}
                  title="Start 25m Focus + 5m Break Pomodoro"
                >
                  <Clock size={12} />
                  <span>Time</span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
