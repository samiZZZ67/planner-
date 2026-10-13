'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { withActionFeedback } from '@/lib/utils/actionFeedback';
import {
  Plus, Clock, Calendar, Tag, AlertCircle, ChevronDown, ChevronUp,
  Target, FileText, Layers, Flag, CheckSquare, X
} from 'lucide-react';
import type { Task, Section, PriorityLevel, TaskStatus } from '@/types';

interface AddTaskScreenProps {
  currentDate: string;
  onChangeDate: (date: string) => void;
  isPhone: boolean;
  onTaskAdded?: () => void;
}

/** Parse "HH:MM" to total minutes since midnight */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Format minutes since midnight to "h:mm AM/PM" */
function formatTime12(t: string): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Calculate scheduled minutes from startTime/endTime */
function calcScheduledMinutes(start: string, end: string): number {
  if (!start || !end) return 0;
  const diff = timeToMinutes(end) - timeToMinutes(start);
  return diff > 0 ? diff : 0;
}

const PRIORITY_COLORS: Record<PriorityLevel, string> = {
  Low: '#22c55e',
  Medium: '#f59e0b',
  High: '#ef4444',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
};

interface FocusBudget {
  totalHours: number;
  allocatedMinutes: number;
}

export function AddTaskScreen({ currentDate, onChangeDate, isPhone, onTaskAdded }: AddTaskScreenProps) {
  const [sections, setSections] = useState<Section[]>([]);
  const [dayTasks, setDayTasks] = useState<Task[]>([]);
  const [dayFreeHours, setDayFreeHours] = useState<number>(8);
  const [editingBudget, setEditingBudget] = useState(false);
  const editingBudgetRef = useRef(false);
  const [budgetInput, setBudgetInput] = useState('8');

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [strategy, setStrategy] = useState('');
  const [doneMeans, setDoneMeans] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [actualMinutes, setActualMinutes] = useState('');
  const [priority, setPriority] = useState<PriorityLevel>('Medium');
  const [status, setStatus] = useState<TaskStatus>('not_started');
  const [deadline, setDeadline] = useState('');
  const [result, setResult] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [mustDo, setMustDo] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Load sections, tasks, and day budget
  useEffect(() => {
    const load = async () => {
      const secs = await db.sections.filter(s => !s.deleted).toArray();
      secs.sort((a, b) => a.order - b.order);
      setSections(secs);
      if (secs.length > 0 && !sectionId) {
        setSectionId(secs[0].id);
      }

      const tasks = await db.tasks.filter(t => t.date === currentDate && !t.deleted).toArray();
      setDayTasks(tasks);

      const dayRecord = await db.days.get(currentDate);
      const fh = dayRecord?.freeHours ?? 8;
      setDayFreeHours(fh);
      if (!editingBudgetRef.current) {
        setBudgetInput(String(fh));
      }
    };
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [currentDate]);

  /** Auto-calculate scheduled minutes from times */
  const scheduledMinutes = useMemo(() => calcScheduledMinutes(startTime, endTime), [startTime, endTime]);

  /** Calculate Focus Budget used */
  const budget: FocusBudget = useMemo(() => {
    const allocated = dayTasks.reduce((acc, t) => {
      if (t.deleted) return acc;
      const mins = t.scheduledMinutes || t.estimatedMinutes || 0;
      return acc + mins;
    }, 0);
    return { totalHours: dayFreeHours, allocatedMinutes: allocated };
  }, [dayTasks, dayFreeHours]);

  const budgetUsedPct = Math.min(100, (budget.allocatedMinutes / (budget.totalHours * 60)) * 100);
  const remainingMinutes = budget.totalHours * 60 - budget.allocatedMinutes;

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

  const handleSaveBudget = async () => {
    const hrs = parseFloat(budgetInput);
    if (isNaN(hrs) || hrs <= 0) return;
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
    editingBudgetRef.current = false;
    syncEngine.notifyLocalMutation();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Task title is required.');
      return;
    }
    setError('');

    // Time overlap validation: if both times set, check for overlaps
    if (startTime && endTime && scheduledMinutes > 0) {
      const newStart = timeToMinutes(startTime);
      const newEnd = timeToMinutes(endTime);
      if (newEnd <= newStart) {
        setError('End time must be after start time.');
        return;
      }
      // Check budget
      if (scheduledMinutes > remainingMinutes) {
        const over = scheduledMinutes - remainingMinutes;
        setError(`This task exceeds your focus budget by ${over} min. Adjust times or increase budget.`);
        return;
      }
      // Check overlaps
      const overlap = dayTasks.find(t => {
        if (!t.startTime || !t.endTime || t.deleted) return false;
        const ts = timeToMinutes(t.startTime);
        const te = timeToMinutes(t.endTime);
        return newStart < te && newEnd > ts;
      });
      if (overlap) {
        setError(`Time slot overlaps with "${overlap.title}". Please choose a different time.`);
        return;
      }
    }

    setSaving(true);
    const now = Date.now();
    const newTask: Task = {
      id: crypto.randomUUID(),
      date: currentDate,
      sectionId: sectionId || sections[0]?.id || 'default-sec-1',
      title: title.trim(),
      description: description.trim(),
      strategy: strategy.trim(),
      doneMeans: doneMeans.trim(),
      estimatedMinutes: scheduledMinutes || 25,
      priority,
      mustDo,
      tags: [],
      icon: '🎯',
      isCompleted: false,
      completedAt: null,
      order: dayTasks.length,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      isSample: false,
      synced: 0,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      scheduledMinutes: scheduledMinutes || undefined,
      actualMinutes: actualMinutes ? parseInt(actualMinutes) : undefined,
      status,
      deadline: deadline || undefined,
      result: result.trim() || undefined,
    };

    await db.tasks.put(newTask);
    syncEngine.notifyLocalMutation();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);

    // Reset form
    setTitle('');
    setDescription('');
    setStrategy('');
    setDoneMeans('');
    setStartTime('');
    setEndTime('');
    setActualMinutes('');
    setPriority('Medium');
    setStatus('not_started');
    setDeadline('');
    setResult('');
    setMustDo(false);
    setIsExpanded(false);

    onTaskAdded?.();
  };

  const budgetBarColor = budgetUsedPct >= 100 ? '#ef4444' : budgetUsedPct >= 80 ? '#f59e0b' : '#22c55e';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── Date Navigator ── */}
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

      {/* ── Focus Budget Bar ── */}
      <div className="v-card" style={{ padding: '16px 20px', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Target size={15} color="var(--accent-color)" />
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
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveBudget();
                  if (e.key === 'Escape') {
                    setEditingBudget(false);
                    editingBudgetRef.current = false;
                    setBudgetInput(String(dayFreeHours));
                  }
                }}
                min="0.1"
                step="0.5"
                placeholder="Hours"
                style={{
                  width: 68,
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
                onClick={event => { void withActionFeedback('Saving focus budget', handleSaveBudget, event.currentTarget); }}
                className="v-pill-btn"
                style={{ padding: '4px 12px', fontSize: 12, minHeight: 32 }}
              >
                ✓
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingBudget(false);
                  editingBudgetRef.current = false;
                  setBudgetInput(String(dayFreeHours));
                }}
                className="v-circle-btn"
                style={{ width: 28, height: 28 }}
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingBudget(true);
                editingBudgetRef.current = true;
                setBudgetInput(String(dayFreeHours));
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: 12,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Edit budget
            </button>
          )}
        </div>
        <div className="v-budget-bar">
          <div
            className="v-budget-bar-fill"
            style={{ width: `${budgetUsedPct}%`, background: budgetBarColor }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Total: <strong style={{ color: 'var(--text-secondary)' }}>{budget.totalHours}h</strong>
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Used: <strong style={{ color: budgetBarColor }}>{Math.round(budget.allocatedMinutes / 60 * 10) / 10}h</strong>
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Free: <strong style={{ color: remainingMinutes <= 0 ? '#ef4444' : '#22c55e' }}>
              {Math.max(0, Math.round(remainingMinutes / 60 * 10) / 10)}h
            </strong>
          </span>
        </div>
      </div>

      {/* ── Task Form ── */}
      <form onSubmit={event => { void withActionFeedback('Adding task', () => handleSubmit(event), event.currentTarget); }}>
        <div className="v-card" style={{ overflow: 'visible' }}>
          {/* Title — always visible / acts as collapsible header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '18px 20px',
              cursor: 'pointer',
              borderBottom: isExpanded ? '1.5px solid var(--v-glass-border-subtle)' : 'none',
            }}
            onClick={() => title.trim() && setIsExpanded(prev => !prev)}
          >
            <CheckSquare size={18} color="var(--accent-color)" style={{ flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Task title — click to expand details"
              value={title}
              onChange={e => {
                setTitle(e.target.value);
                if (e.target.value.trim()) setIsExpanded(true);
              }}
              onClick={e => e.stopPropagation()}
              className="v-input"
              style={{
                border: 'none',
                background: 'transparent',
                padding: 0,
                fontSize: isPhone ? 15 : 16,
                fontWeight: 600,
                flex: 1,
                minHeight: 'unset',
                boxShadow: 'none',
              }}
              autoComplete="off"
            />
            {title.trim() && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setIsExpanded(prev => !prev); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            )}
          </div>

          {/* Expanded Fields */}
          {isExpanded && (
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Time Slot Row */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    <Clock size={11} style={{ display: 'inline', marginRight: 4 }} />START TIME
                  </label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    className="v-input"
                    style={{ fontSize: 14 }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    <Clock size={11} style={{ display: 'inline', marginRight: 4 }} />END TIME
                  </label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                    className="v-input"
                    style={{ fontSize: 14 }}
                  />
                </div>
                {scheduledMinutes > 0 && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 14px',
                    borderRadius: 12,
                    background: 'var(--accent-glow)',
                    border: '1px solid var(--accent-color)',
                    fontSize: 12,
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                    gap: 6,
                    flexShrink: 0,
                    alignSelf: 'flex-end',
                  }}>
                    <Clock size={12} />
                    {scheduledMinutes >= 60
                      ? `${Math.floor(scheduledMinutes / 60)}h ${scheduledMinutes % 60 > 0 ? `${scheduledMinutes % 60}m` : ''}`
                      : `${scheduledMinutes}m`}
                  </div>
                )}
              </div>

              {/* Category, Priority, Status row */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 2, minWidth: 160 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    <Tag size={11} style={{ display: 'inline', marginRight: 4 }} />CATEGORY
                  </label>
                  <select
                    value={sectionId}
                    onChange={e => setSectionId(e.target.value)}
                    className="v-input"
                    style={{ fontSize: 14 }}
                  >
                    {sections.map(s => (
                      <option key={s.id} value={s.id}>{s.icon} {s.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 110 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    <Flag size={11} style={{ display: 'inline', marginRight: 4 }} />PRIORITY
                  </label>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value as PriorityLevel)}
                    className="v-input"
                    style={{ fontSize: 14 }}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
              </div>

              {/* Status & Deadline row */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    STATUS
                  </label>
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value as TaskStatus)}
                    className="v-input"
                    style={{ fontSize: 14 }}
                  >
                    <option value="not_started">Not Started</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    <Calendar size={11} style={{ display: 'inline', marginRight: 4 }} />DEADLINE
                  </label>
                  <input
                    type="date"
                    value={deadline}
                    onChange={e => setDeadline(e.target.value)}
                    className="v-input"
                    style={{ fontSize: 14 }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 100 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    ACTUAL (min)
                  </label>
                  <input
                    type="number"
                    value={actualMinutes}
                    onChange={e => setActualMinutes(e.target.value)}
                    min="0"
                    placeholder="e.g. 45"
                    className="v-input"
                    style={{ fontSize: 14 }}
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  <FileText size={11} style={{ display: 'inline', marginRight: 4 }} />DESCRIPTION
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What is this task about?"
                  rows={3}
                  className="v-input font-system"
                  style={{ resize: 'vertical', fontSize: 14, lineHeight: 1.5 }}
                />
              </div>

              {/* Strategy */}
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  <Layers size={11} style={{ display: 'inline', marginRight: 4 }} />STRATEGY / EXECUTION STEPS
                </label>
                <textarea
                  value={strategy}
                  onChange={e => setStrategy(e.target.value)}
                  placeholder="How will you execute this? Break it into steps."
                  rows={3}
                  className="v-input font-system"
                  style={{ resize: 'vertical', fontSize: 14, lineHeight: 1.5 }}
                />
              </div>

              {/* Done Means & Result */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    DONE MEANS
                  </label>
                  <input
                    type="text"
                    value={doneMeans}
                    onChange={e => setDoneMeans(e.target.value)}
                    placeholder="What does done look like?"
                    className="v-input font-system"
                    style={{ fontSize: 14 }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    RESULT / OUTCOME
                  </label>
                  <input
                    type="text"
                    value={result}
                    onChange={e => setResult(e.target.value)}
                    placeholder="What was the result?"
                    className="v-input font-system"
                    style={{ fontSize: 14 }}
                  />
                </div>
              </div>

              {/* Must Do toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <div
                  onClick={() => setMustDo(prev => !prev)}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 6,
                    border: `2px solid ${mustDo ? '#f59e0b' : 'var(--v-glass-border)'}`,
                    background: mustDo ? 'rgba(245,158,11,0.3)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s',
                    flexShrink: 0,
                  }}
                >
                  {mustDo && <span style={{ fontSize: 12 }}>⭐</span>}
                </div>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Must-Do (top priority — max 3 per day)
                </span>
              </label>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div style={{
              margin: '0 20px 16px',
              padding: '10px 14px',
              borderRadius: 10,
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: '#ef4444',
            }}>
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {/* Submit button */}
          <div style={{ padding: isExpanded ? '0 20px 20px' : '0 20px 18px', display: 'flex', gap: 10 }}>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="v-pill-btn v-pill-btn-primary"
              style={{ flex: 1, gap: 8 }}
            >
              {saving ? (
                <>⏳ Saving…</>
              ) : saved ? (
                <>✅ Task Added!</>
              ) : (
                <><Plus size={16} /> Add Task</>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* ── Today's scheduled tasks summary ── */}
      {dayTasks.filter(t => t.startTime).length > 0 && (
        <div className="v-card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 12 }}>
            TODAY'S SCHEDULE
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dayTasks
              .filter(t => t.startTime && !t.deleted)
              .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
              .map(t => {
                const sec = sections.find(s => s.id === t.sectionId);
                return (
                  <div
                    key={t.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: 'var(--v-glass-bg-subtle)',
                      border: '1px solid var(--v-glass-border-subtle)',
                    }}
                  >
                    <div
                      style={{
                        width: 3,
                        height: 36,
                        borderRadius: 2,
                        background: sec?.color || 'var(--accent-color)',
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.title}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {formatTime12(t.startTime!)} → {formatTime12(t.endTime!)}
                        {t.scheduledMinutes && ` · ${t.scheduledMinutes}m`}
                      </div>
                    </div>
                    <span
                      className="v-status-badge"
                      style={{
                        color: PRIORITY_COLORS[t.priority],
                        borderColor: PRIORITY_COLORS[t.priority] + '50',
                        background: PRIORITY_COLORS[t.priority] + '15',
                      }}
                    >
                      {t.priority}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
