'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { useTimer } from '@/lib/timer/useTimer';
import {
  Calendar, Check, Square, Play, Pause, Square as StopIcon,
  Trash2, Edit2, Plus, Sparkles, Clock, CheckCircle2, ChevronLeft, ChevronRight, X
} from 'lucide-react';
import type { Task, TimeLog } from '@/types';

interface TodoScreenProps {
  currentDate: string;
  onChangeDate: (date: string) => void;
  isPhone: boolean;
}

export function TodoScreen({ currentDate, onChangeDate, isPhone }: TodoScreenProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  
  // Add Task Inputs
  const [title, setTitle] = useState('');
  const [strategy, setStrategy] = useState('');

  // Inline editing state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editStrategy, setEditStrategy] = useState('');

  // Pomodoro Timer hook
  const {
    activeTimer,
    formattedCountdown,
    isFocus,
    isBreak,
    isTimerRunning,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    skipBreak,
  } = useTimer();

  // Load daily tasks & time logs
  const loadData = async () => {
    const dayTasks = await db.tasks.filter(t => t.date === currentDate && !t.deleted).toArray();
    dayTasks.sort((a, b) => a.order - b.order);

    const dayLogs = await db.timeLogs.filter(tl => tl.date === currentDate && !tl.deleted).toArray();

    setTasks(dayTasks);
    setTimeLogs(dayLogs);
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2500);
    return () => clearInterval(interval);
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
      estimatedMinutes: 25,
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
    };

    await db.tasks.put(newTask);
    setTasks(prev => [...prev, newTask]);
    setTitle('');
    setStrategy('');
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

  // Edit task
  const handleStartEdit = (t: Task) => {
    setEditingTaskId(t.id);
    setEditTitle(t.title);
    setEditStrategy(t.strategy || '');
  };

  const handleSaveEdit = async (taskId: string) => {
    if (!editTitle.trim()) return;
    await db.tasks.update(taskId, {
      title: editTitle.trim(),
      strategy: editStrategy.trim(),
      updatedAt: Date.now(),
      synced: 0,
    });
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, title: editTitle.trim(), strategy: editStrategy.trim() } : t));
    setEditingTaskId(null);
    syncEngine.notifyLocalMutation();
  };

  // Day total hours
  const totalDayMinutes = useMemo(() => {
    return timeLogs.reduce((acc, l) => acc + (l.minutes || 0), 0);
  }, [timeLogs]);
  const totalDayHours = Math.round((totalDayMinutes / 60) * 10) / 10;
  const completedCount = tasks.filter(t => t.isCompleted).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%' }}>

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

        {/* Date switcher buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                fontFamily: 'inherit',
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

      {/* ── 2. ADD TASK BOX (Clean & Spacious) ── */}
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
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          + ADD TASK FOR {dayName}
        </div>

        {/* Title Input */}
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Title (What will you do? e.g. Finish client dashboard redesign)"
          className="v-input"
          style={{ fontSize: 14 }}
        />

        {/* Strategy Input */}
        <input
          type="text"
          value={strategy}
          onChange={e => setStrategy(e.target.value)}
          placeholder="Strategy (How will you do it? e.g. 2 Pomodoro focus sessions, phone silenced)"
          className="v-input"
          style={{ fontSize: 13 }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
          <button
            type="submit"
            disabled={!title.trim()}
            className="v-pill-btn v-pill-btn-primary"
            style={{
              padding: '10px 24px',
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

      {/* ── 3. TASK BOX (Master Daily Task List) ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', paddingLeft: 4 }}>
          TASKS FOR {dayName} ({tasks.length})
        </div>

        {tasks.length === 0 ? (
          /* Empty state */
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
            const { hours, totalMinutes } = getTaskHoursTaken(task.id);
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
                {/* Task Main Row */}
                {isEditing ? (
                  /* Inline Editing Mode */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      className="v-input"
                      placeholder="Title"
                    />
                    <input
                      type="text"
                      value={editStrategy}
                      onChange={e => setEditStrategy(e.target.value)}
                      className="v-input"
                      placeholder="Strategy"
                    />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
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
                            fontSize: 18,
                            fontWeight: 700,
                            color: 'var(--text-primary)',
                            textDecoration: task.isCompleted ? 'line-through' : 'none',
                            lineHeight: 1.3,
                            wordBreak: 'break-word',
                          }}
                        >
                          {task.title}
                        </div>

                        {/* Strategy Box (Clearly shown as requested) */}
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
                            <span>{task.strategy}</span>
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

                      {/* Top Action Buttons (Edit / Delete) */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => handleStartEdit(task)}
                          className="v-circle-btn"
                          style={{ width: 32, height: 32 }}
                          title="Edit Task"
                          aria-label="Edit task"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTask(task.id)}
                          className="v-circle-btn"
                          style={{ width: 32, height: 32, color: '#f87171' }}
                          title="Delete Task"
                          aria-label="Delete task"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Bottom Row: Hours Taken & Time (Pomodoro) Button */}
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
                          {hours}h {totalMinutes > 0 ? `(${totalMinutes}m)` : ''}
                        </strong>
                      </div>

                      {/* ── TIME BUTTON (Real 25m Focus + 5m Break Pomodoro Timer) ── */}
                      <div>
                        {isThisTimerActive ? (
                          /* Active Pomodoro Timer Controls */
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
                                title="Pause Pomodoro"
                                aria-label="Pause Pomodoro"
                              >
                                <Pause size={12} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={resumeTimer}
                                className="v-circle-btn"
                                style={{ width: 28, height: 28 }}
                                title="Resume Pomodoro"
                                aria-label="Resume Pomodoro"
                              >
                                <Play size={12} />
                              </button>
                            )}

                            {isBreak && (
                              <button
                                type="button"
                                onClick={skipBreak}
                                className="v-pill-btn"
                                style={{ padding: '2px 8px', fontSize: 11, minHeight: 28 }}
                                title="Skip break and start next focus"
                              >
                                Skip
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={stopTimer}
                              className="v-circle-btn"
                              style={{ width: 28, height: 28, color: '#f87171' }}
                              title="Stop & Log Time"
                              aria-label="Stop & Log Time"
                            >
                              <StopIcon size={12} />
                            </button>
                          </div>
                        ) : (
                          /* Inactive: Responsive "Time" Button */
                          <button
                            type="button"
                            onClick={() => startTimer(task.id, task.title, '#38bdf8')}
                            className="v-pill-btn"
                            style={{
                              padding: '8px 18px',
                              fontSize: 13,
                              borderColor: 'var(--accent-color)',
                              background: 'var(--accent-glow)',
                            }}
                          >
                            <Play size={13} fill="currentColor" />
                            <span>Time (25m Focus)</span>
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

    </div>
  );
}
