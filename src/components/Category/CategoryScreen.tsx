'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { withActionFeedback } from '@/lib/utils/actionFeedback';
import { DEFAULT_SECTIONS } from '@/lib/db';
import {
  Tag, Plus, Trash2, Edit2, Check, ChevronDown, ChevronUp,
  Clock, Calendar, Flag, FileText, Layers, X, Save
} from 'lucide-react';
import type { Task, Section, PriorityLevel, TaskStatus } from '@/types';

interface CategoryScreenProps {
  currentDate: string;
  onChangeDate?: (date: string) => void;
  isPhone: boolean;
  focusTaskId?: string | null; // ID of task to scroll to / expand
  onClearFocus?: () => void;
}

const PRIORITY_COLORS: Record<PriorityLevel, string> = {
  Low: '#71717a',
  Medium: '#a1a1aa',
  High: '#ffffff',
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  not_started: 'var(--text-muted)',
  in_progress: '#ffffff',
  completed: '#d4d4d8',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
};

function formatTime12(t?: string): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

interface EditState {
  title: string;
  description: string;
  strategy: string;
  doneMeans: string;
  result: string;
  startTime: string;
  endTime: string;
  priority: PriorityLevel;
  status: TaskStatus;
  deadline: string;
  actualMinutes: string;
}

function getDefaultEdit(task: Task): EditState {
  return {
    title: task.title,
    description: task.description || '',
    strategy: task.strategy || '',
    doneMeans: task.doneMeans || '',
    result: task.result || '',
    startTime: task.startTime || '',
    endTime: task.endTime || '',
    priority: task.priority,
    status: task.status || 'not_started',
    deadline: task.deadline || '',
    actualMinutes: task.actualMinutes !== undefined ? String(task.actualMinutes) : '',
  };
}

export function CategoryScreen({ currentDate, onChangeDate, isPhone, focusTaskId, onClearFocus }: CategoryScreenProps) {
  const [selectedDate, setSelectedDate] = useState<string>(currentDate);
  const [viewMode, setViewMode] = useState<'day' | 'all'>('day'); // Default: day-specific tasks within categories
  const [sections, setSections] = useState<Section[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);

  // Synchronize when currentDate changes from parent
  useEffect(() => {
    setSelectedDate(currentDate);
  }, [currentDate]);

  const shiftDate = (days: number) => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + days);
    const nextDate = date.toISOString().split('T')[0];
    setSelectedDate(nextDate);
    onChangeDate?.(nextDate);
  };

  const setDateExplicit = (newDate: string) => {
    if (!newDate) return;
    setSelectedDate(newDate);
    onChangeDate?.(newDate);
  };

  const dayName = useMemo(() => {
    try {
      const [y, m, d] = selectedDate.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toUpperCase();
    } catch {
      return 'TODAY';
    }
  }, [selectedDate]);

  const todayStr = useMemo(() => new Date().toLocaleDateString('en-CA'), []);
  const isSelectedToday = selectedDate === todayStr;

  // Inline Add Task inside Category
  const [addingTaskSectionId, setAddingTaskSectionId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskMinutes, setNewTaskMinutes] = useState('30');
  const [newTaskPriority, setNewTaskPriority] = useState<PriorityLevel>('Medium');

  // New section form
  const [showNewSection, setShowNewSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [newSectionIcon, setNewSectionIcon] = useState('📁');
  const [newSectionColor, setNewSectionColor] = useState('#ffffff');

  const ICON_OPTIONS = ['📁', '⚡', '📚', '🏃', '🌙', '🎮', '💡', '🔬', '🎨', '🏋️', '💰', '🔧'];
  const COLOR_OPTIONS = ['#ffffff', '#e4e4e7', '#d4d4d8', '#a1a1aa', '#71717a', '#52525b', '#3f3f46', '#27272a', '#18181b', '#000000'];

  const load = async () => {
    const secs = await db.sections.filter(s => !s.deleted).toArray();
    secs.sort((a, b) => a.order - b.order);
    setSections(secs);

    const tasks = await db.tasks.filter(t => !t.deleted).toArray();
    setAllTasks(tasks);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    const unsub = syncEngine.subscribe(() => load());
    return () => { clearInterval(interval); unsub(); };
  }, []);

  // Auto-expand section, task, and switch to task date if focusTaskId is given
  useEffect(() => {
    if (!focusTaskId || allTasks.length === 0) return;
    const task = allTasks.find(t => t.id === focusTaskId);
    if (!task) return;
    if (task.date && task.date !== selectedDate) {
      setSelectedDate(task.date);
      onChangeDate?.(task.date);
    }
    setExpandedSections(prev => new Set([...prev, task.sectionId]));
    setExpandedTasks(prev => new Set([...prev, focusTaskId]));
    onClearFocus?.();
  }, [focusTaskId, allTasks, selectedDate, onChangeDate, onClearFocus]);

  // Organize tasks by both category and date/day
  const tasksBySection = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const sec of sections) {
      map[sec.id] = allTasks
        .filter(t => t.sectionId === sec.id && (viewMode === 'all' || (t.date || currentDate) === selectedDate))
        .sort((a, b) => a.order - b.order);
    }
    return map;
  }, [sections, allTasks, selectedDate, viewMode, currentDate]);

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(sectionId) ? next.delete(sectionId) : next.add(sectionId);
      return next;
    });
  };

  const toggleTask = (taskId: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
      return next;
    });
  };

  const startEditing = (task: Task) => {
    setEditingTaskId(task.id);
    setEditState(getDefaultEdit(task));
  };

  const cancelEditing = () => {
    setEditingTaskId(null);
    setEditState(null);
  };

  const saveTask = async (task: Task) => {
    if (!editState) return;
    const scheduledMins = editState.startTime && editState.endTime
      ? (() => {
          const [sh, sm] = editState.startTime.split(':').map(Number);
          const [eh, em] = editState.endTime.split(':').map(Number);
          const diff = (eh * 60 + em) - (sh * 60 + sm);
          return diff > 0 ? diff : 0;
        })()
      : task.scheduledMinutes;

    await db.tasks.update(task.id, {
      title: editState.title.trim() || task.title,
      description: editState.description,
      strategy: editState.strategy,
      doneMeans: editState.doneMeans,
      result: editState.result,
      startTime: editState.startTime || undefined,
      endTime: editState.endTime || undefined,
      scheduledMinutes: scheduledMins,
      actualMinutes: editState.actualMinutes ? parseInt(editState.actualMinutes) : undefined,
      priority: editState.priority,
      status: editState.status,
      deadline: editState.deadline || undefined,
      updatedAt: Date.now(),
      synced: 0,
    });
    syncEngine.notifyLocalMutation();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('samsspace:task-updated', { detail: task }));
      window.dispatchEvent(new CustomEvent('nightplanner:task-updated', { detail: task }));
    }
    setEditingTaskId(null);
    setEditState(null);
    load();
  };

  const deleteTask = async (taskId: string) => {
    if (!window.confirm('Delete this task? This cannot be undone.')) return;
    setAllTasks(prev => prev.filter(t => t.id !== taskId));
    await db.tasks.update(taskId, { deleted: true, updatedAt: Date.now(), synced: 0 });
    syncEngine.notifyLocalMutation();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('samsspace:task-deleted', { detail: taskId }));
      window.dispatchEvent(new CustomEvent('nightplanner:task-deleted', { detail: taskId }));
    }
    load();
  };

  const toggleComplete = async (task: Task) => {
    const next = !task.isCompleted;
    // Immediate optimistic state update
    setAllTasks(prev => prev.map(t => t.id === task.id ? {
      ...t,
      isCompleted: next,
      completedAt: next ? Date.now() : null,
      status: next ? 'completed' : 'not_started',
    } : t));

    await db.tasks.update(task.id, {
      isCompleted: next,
      completedAt: next ? Date.now() : null,
      status: next ? 'completed' : 'not_started',
      updatedAt: Date.now(),
      synced: 0,
    });
    syncEngine.notifyLocalMutation();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('samsspace:task-updated', { detail: { ...task, isCompleted: next } }));
      window.dispatchEvent(new CustomEvent('nightplanner:task-updated', { detail: { ...task, isCompleted: next } }));
    }
  };

  const handleCreateTaskInCategory = async (sectionId: string) => {
    if (!newTaskTitle.trim()) return;
    const now = Date.now();
    const mins = parseInt(newTaskMinutes) || 30;
    const newTask: Task = {
      id: crypto.randomUUID(),
      title: newTaskTitle.trim(),
      description: '',
      strategy: '',
      doneMeans: '',
      sectionId,
      date: selectedDate, // Day-specific to the day currently selected!
      priority: newTaskPriority,
      status: 'not_started',
      isCompleted: false,
      mustDo: false,
      tags: [],
      icon: '✓',
      estimatedMinutes: mins,
      scheduledMinutes: mins,
      order: (tasksBySection[sectionId] || []).length,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      isSample: false,
      synced: 0,
    };

    setAllTasks(prev => [...prev, newTask]);
    await db.tasks.put(newTask);
    syncEngine.notifyLocalMutation();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('samsspace:task-created', { detail: newTask }));
      window.dispatchEvent(new CustomEvent('nightplanner:task-created', { detail: newTask }));
    }
    setNewTaskTitle('');
    setNewTaskMinutes('30');
    setAddingTaskSectionId(null);
  };

  const addSection = async () => {
    if (!newSectionName.trim()) return;
    const now = Date.now();
    const newSec: Section = {
      id: crypto.randomUUID(),
      name: newSectionName.trim(),
      icon: newSectionIcon,
      color: newSectionColor,
      order: sections.length,
      dailyTargetMinutes: null,
      targetType: 'at least',
      updatedAt: now,
      deleted: false,
      isSample: false,
      synced: 0,
    };
    await db.sections.put(newSec);
    syncEngine.notifyLocalMutation();
    setNewSectionName('');
    setNewSectionIcon('📁');
    setShowNewSection(false);
    load();
  };

  const deleteSection = async (sectionId: string) => {
    if (!confirm('Delete this category? Tasks inside will be deleted too.')) return;
    await db.sections.update(sectionId, { deleted: true, updatedAt: Date.now(), synced: 0 });
    const allSecTasks = allTasks.filter(t => t.sectionId === sectionId);
    await Promise.all(allSecTasks.map(t => db.tasks.update(t.id, { deleted: true, updatedAt: Date.now(), synced: 0 })));
    syncEngine.notifyLocalMutation();
    load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Tag size={20} color="var(--accent-color)" />
          <span className="font-bloody" style={{ fontSize: isPhone ? 18 : 20, fontWeight: 700 }}>
            Categories
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowNewSection(prev => !prev)}
          className="v-pill-btn"
          style={{ padding: '8px 16px', fontSize: 13, gap: 6 }}
        >
          <Plus size={14} /> New Category
        </button>
      </div>

      {/* ── Day Navigator Header: Organizing tasks by both category and date/day ── */}
      <div
        className="v-card"
        style={{
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          {/* Day Stepper */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => shiftDate(-1)}
              className="v-circle-btn"
              style={{ width: 34, height: 34 }}
              aria-label="Previous day"
              title="Previous day"
            >
              ‹
            </button>
            <div>
              <div
                className="font-bloody"
                style={{ fontSize: isPhone ? 18 : 22, fontWeight: 700, letterSpacing: '0.04em' }}
              >
                {dayName}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {selectedDate}
              </div>
            </div>
            <button
              type="button"
              onClick={() => shiftDate(1)}
              className="v-circle-btn"
              style={{ width: 34, height: 34 }}
              aria-label="Next day"
              title="Next day"
            >
              ›
            </button>
          </div>

          {/* Quick Date Shortcuts & Picker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
            {!isSelectedToday && (
              <button
                type="button"
                onClick={() => setDateExplicit(todayStr)}
                className="v-pill-btn"
                style={{ padding: '6px 12px', fontSize: 12 }}
              >
                Today
              </button>
            )}
            <input
              type="date"
              value={selectedDate}
              onChange={e => setDateExplicit(e.target.value)}
              className="v-input"
              style={{
                width: 138,
                fontSize: 12,
                padding: '4px 8px',
                minHeight: 32,
              }}
              title="Select specific date"
            />
            {/* View Mode Toggle: Day vs All Days */}
            <div style={{ display: 'flex', background: 'var(--v-glass-bg-subtle)', borderRadius: 8, padding: 2, border: '1px solid var(--v-glass-border)' }}>
              <button
                type="button"
                onClick={() => setViewMode('day')}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: viewMode === 'day' ? 700 : 500,
                  borderRadius: 6,
                  border: 'none',
                  background: viewMode === 'day' ? 'var(--accent-glow)' : 'transparent',
                  color: viewMode === 'day' ? 'var(--text-primary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {dayName} Only
              </button>
              <button
                type="button"
                onClick={() => setViewMode('all')}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: viewMode === 'all' ? 700 : 500,
                  borderRadius: 6,
                  border: 'none',
                  background: viewMode === 'all' ? 'var(--accent-glow)' : 'transparent',
                  color: viewMode === 'all' ? 'var(--text-primary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                All Days
              </button>
            </div>
          </div>
        </div>

        {/* Informative indicator pill */}
        <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Calendar size={13} color="var(--accent-color)" />
          <span>
            {viewMode === 'day'
              ? `Categories are shared across days, displaying separate tasks for ${dayName} (${selectedDate}).`
              : 'Showing all tasks across all days in each category.'}
          </span>
        </div>
      </div>

      {/* New Category Form */}
      {showNewSection && (
        <div className="v-card" style={{ padding: '20px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 14 }}>
            NEW CATEGORY
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="text"
              value={newSectionName}
              onChange={e => setNewSectionName(e.target.value)}
              placeholder="Category name"
              className="v-input"
              autoFocus
            />
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>ICON</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {ICON_OPTIONS.map(icon => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => setNewSectionIcon(icon)}
                      style={{
                        width: 36, height: 36, fontSize: 18,
                        borderRadius: 8,
                        border: newSectionIcon === icon ? '2px solid var(--accent-color)' : '1.5px solid var(--v-glass-border)',
                        background: newSectionIcon === icon ? 'var(--accent-glow)' : 'var(--v-glass-bg-subtle)',
                        cursor: 'pointer',
                      }}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ minWidth: 160 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>COLOR</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {COLOR_OPTIONS.map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewSectionColor(color)}
                      style={{
                        width: 28, height: 28, borderRadius: '50%',
                        background: color,
                        border: newSectionColor === color ? '3px solid var(--text-primary)' : '2px solid transparent',
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={event => { void withActionFeedback('Adding category', addSection, event.currentTarget); }} className="v-pill-btn v-pill-btn-primary" style={{ flex: 1 }}>
                <Plus size={14} /> Create Category
              </button>
              <button type="button" onClick={() => setShowNewSection(false)} className="v-pill-btn" style={{ flex: 1 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sections List */}
      {sections.map(sec => {
        const tasks = tasksBySection[sec.id] || [];
        const isOpen = expandedSections.has(sec.id);
        const completedCount = tasks.filter(t => t.isCompleted).length;
        const remainingCount = tasks.length - completedCount;
        const remainingMinutes = tasks
          .filter(t => !t.isCompleted)
          .reduce((sum, t) => sum + (t.scheduledMinutes || t.estimatedMinutes || 0), 0);
        const remHrs = Math.floor(remainingMinutes / 60);
        const remMins = remainingMinutes % 60;

        return (
          <div key={sec.id} className="v-card" style={{ overflow: 'hidden' }}>
            {/* Section Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '16px 20px',
                cursor: 'pointer',
                borderBottom: isOpen && (tasks.length > 0 || addingTaskSectionId === sec.id) ? '1.5px solid var(--v-glass-border-subtle)' : 'none',
              }}
              onClick={() => toggleSection(sec.id)}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: sec.color + '25',
                  border: `1.5px solid ${sec.color}60`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                {sec.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {sec.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span>{completedCount}/{tasks.length} completed</span>
                  <span>•</span>
                  <span>{remainingCount} remaining</span>
                  <span>•</span>
                  <span style={{ color: remainingMinutes > 0 ? 'var(--accent-color)' : '#d4d4d8', fontWeight: 600 }}>
                    {remHrs > 0 ? `${remHrs}h ` : ''}{remMins}m focus left
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    setAddingTaskSectionId(sec.id);
                    if (!isOpen) toggleSection(sec.id);
                  }}
                  className="v-pill-btn"
                  style={{ padding: '4px 10px', fontSize: 11, minHeight: 30, gap: 4 }}
                  title="Add task directly in this category"
                >
                  <Plus size={12} /> Add Task
                </button>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); void withActionFeedback('Deleting category', () => deleteSection(sec.id), e.currentTarget); }}
                  className="v-circle-btn"
                  style={{ width: 30, height: 30, color: 'var(--text-secondary)' }}
                  aria-label="Delete category"
                >
                  <Trash2 size={13} />
                </button>
                {isOpen ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
              </div>
            </div>

            {/* Tasks List */}
            {isOpen && (
              <div style={{ padding: tasks.length === 0 && addingTaskSectionId !== sec.id ? '16px 20px' : '0' }}>
                {/* Inline Add Task Creator inside category */}
                {addingTaskSectionId === sec.id && (
                  <div
                    style={{
                      padding: '14px 20px',
                      background: 'var(--v-glass-bg-subtle)',
                      borderBottom: '1.5px solid var(--v-glass-border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Plus size={13} /> Add Task to {sec.name}
                    </div>
                    <input
                      type="text"
                      autoFocus
                      value={newTaskTitle}
                      onChange={e => setNewTaskTitle(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleCreateTaskInCategory(sec.id);
                        if (e.key === 'Escape') setAddingTaskSectionId(null);
                      }}
                      placeholder="Task title (e.g. Complete lab assignment)..."
                      className="v-input font-system"
                      style={{ fontSize: 13 }}
                    />
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Focus time:</span>
                        <input
                          type="number"
                          value={newTaskMinutes}
                          onChange={e => setNewTaskMinutes(e.target.value)}
                          min="5"
                          step="5"
                          placeholder="30"
                          className="v-input"
                          style={{ width: 68, padding: '4px 8px', minHeight: 32, fontSize: 12, textAlign: 'center' }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>min</span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Priority:</span>
                        <select
                          value={newTaskPriority}
                          onChange={e => setNewTaskPriority(e.target.value as PriorityLevel)}
                          className="v-input"
                          style={{ width: 100, padding: '4px 8px', minHeight: 32, fontSize: 12 }}
                        >
                          <option value="Low">Low</option>
                          <option value="Medium">Medium</option>
                          <option value="High">High</option>
                        </select>
                      </div>

                      <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                        <button
                          type="button"
                          onClick={event => { void withActionFeedback('Adding task', () => handleCreateTaskInCategory(sec.id), event.currentTarget); }}
                          className="v-pill-btn v-pill-btn-primary"
                          style={{ padding: '4px 14px', fontSize: 12, minHeight: 32 }}
                        >
                          Save Task
                        </button>
                        <button
                          type="button"
                          onClick={() => setAddingTaskSectionId(null)}
                          className="v-pill-btn"
                          style={{ padding: '4px 12px', fontSize: 12, minHeight: 32 }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {tasks.length === 0 && addingTaskSectionId !== sec.id ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
                    {viewMode === 'day' ? (
                      <span>
                        No tasks scheduled for <strong>{dayName}</strong> ({selectedDate}) in {sec.name} — click <strong>+ Add Task</strong> above to add one.
                      </span>
                    ) : (
                      <span>
                        No tasks recorded in {sec.name} across any days.
                      </span>
                    )}
                  </div>
                ) : (
                  tasks.map((task, idx) => {
                    const isTaskOpen = expandedTasks.has(task.id);
                    const isEditing = editingTaskId === task.id;

                    return (
                      <div
                        key={task.id}
                        style={{
                          borderBottom: idx < tasks.length - 1 ? '1px solid var(--v-glass-border-subtle)' : 'none',
                        }}
                      >
                        {/* Task Row */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '12px 20px',
                            cursor: 'pointer',
                            background: task.isCompleted ? 'rgba(34,197,94,0.04)' : 'transparent',
                          }}
                          onClick={() => !isEditing && toggleTask(task.id)}
                        >
                          {/* Checkbox */}
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); void withActionFeedback(task.isCompleted ? 'Updating task' : 'Completing task', () => toggleComplete(task), e.currentTarget); }}
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 6,
                              border: `2px solid ${task.isCompleted ? '#ffffff' : 'var(--v-glass-border)'}`,
                              background: task.isCompleted ? '#ffffff' : 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              flexShrink: 0,
                              transition: 'all 0.2s',
                            }}
                            aria-label="Toggle complete"
                          >
                            {task.isCompleted && <Check size={13} color="#000000" />}
                          </button>

                          <div
                            style={{
                              width: 3,
                              height: 20,
                              borderRadius: 2,
                              background: sec.color,
                              flexShrink: 0,
                            }}
                          />

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: task.isCompleted ? 'var(--text-muted)' : 'var(--text-primary)',
                              textDecoration: task.isCompleted ? 'line-through' : 'none',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                            }}>
                              <span>{task.title}</span>
                              {viewMode === 'all' && (
                                <span
                                  style={{
                                    fontSize: 10,
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    background: 'var(--v-glass-bg-subtle)',
                                    color: 'var(--text-muted)',
                                    border: '1px solid var(--v-glass-border)',
                                    flexShrink: 0,
                                  }}
                                >
                                  📅 {task.date || 'Undated'}
                                </span>
                              )}
                            </div>
                            {task.startTime && (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                {formatTime12(task.startTime)}
                                {task.endTime && ` → ${formatTime12(task.endTime)}`}
                                {task.scheduledMinutes && ` · ${task.scheduledMinutes}m`}
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            <span
                              className="v-status-badge"
                              style={{
                                color: PRIORITY_COLORS[task.priority],
                                borderColor: PRIORITY_COLORS[task.priority] + '50',
                                background: PRIORITY_COLORS[task.priority] + '15',
                              }}
                            >
                              {task.priority}
                            </span>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); isEditing ? cancelEditing() : startEditing(task); }}
                              className="v-circle-btn"
                              style={{ width: 28, height: 28 }}
                              aria-label="Edit task"
                            >
                              {isEditing ? <X size={12} /> : <Edit2 size={12} />}
                            </button>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); void withActionFeedback('Deleting task', () => deleteTask(task.id), e.currentTarget); }}
                              className="v-circle-btn"
                              style={{ width: 28, height: 28, color: 'var(--text-secondary)' }}
                              aria-label="Delete task"
                            >
                              <Trash2 size={12} />
                            </button>
                            {isTaskOpen ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
                          </div>
                        </div>

                        {/* Expanded Task Details / Edit form */}
                        {isTaskOpen && (
                          <div style={{
                            padding: '0 20px 16px 52px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12,
                          }}>
                            {isEditing && editState ? (
                              /* ── Edit Form ── */
                              <>
                                <input
                                  type="text"
                                  value={editState.title}
                                  onChange={e => setEditState(prev => prev ? { ...prev, title: e.target.value } : null)}
                                  className="v-input"
                                  placeholder="Task title"
                                  style={{ fontSize: 14 }}
                                />
                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                  <div style={{ flex: 1, minWidth: 100 }}>
                                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>START</label>
                                    <input type="time" value={editState.startTime} onChange={e => setEditState(prev => prev ? { ...prev, startTime: e.target.value } : null)} className="v-input" style={{ fontSize: 13 }} />
                                  </div>
                                  <div style={{ flex: 1, minWidth: 100 }}>
                                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>END</label>
                                    <input type="time" value={editState.endTime} onChange={e => setEditState(prev => prev ? { ...prev, endTime: e.target.value } : null)} className="v-input" style={{ fontSize: 13 }} />
                                  </div>
                                  <div style={{ flex: 1, minWidth: 100 }}>
                                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>PRIORITY</label>
                                    <select value={editState.priority} onChange={e => setEditState(prev => prev ? { ...prev, priority: e.target.value as PriorityLevel } : null)} className="v-input" style={{ fontSize: 13 }}>
                                      <option value="Low">Low</option>
                                      <option value="Medium">Medium</option>
                                      <option value="High">High</option>
                                    </select>
                                  </div>
                                  <div style={{ flex: 1, minWidth: 120 }}>
                                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>STATUS</label>
                                    <select value={editState.status} onChange={e => setEditState(prev => prev ? { ...prev, status: e.target.value as TaskStatus } : null)} className="v-input" style={{ fontSize: 13 }}>
                                      <option value="not_started">Not Started</option>
                                      <option value="in_progress">In Progress</option>
                                      <option value="completed">Completed</option>
                                    </select>
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                  <div style={{ flex: 1, minWidth: 140 }}>
                                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>DEADLINE</label>
                                    <input type="date" value={editState.deadline} onChange={e => setEditState(prev => prev ? { ...prev, deadline: e.target.value } : null)} className="v-input" style={{ fontSize: 13 }} />
                                  </div>
                                  <div style={{ flex: 1, minWidth: 100 }}>
                                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>ACTUAL (min)</label>
                                    <input type="number" value={editState.actualMinutes} onChange={e => setEditState(prev => prev ? { ...prev, actualMinutes: e.target.value } : null)} className="v-input" style={{ fontSize: 13 }} min="0" />
                                  </div>
                                </div>
                                <div>
                                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>DESCRIPTION</label>
                                  <textarea value={editState.description} onChange={e => setEditState(prev => prev ? { ...prev, description: e.target.value } : null)} className="v-input font-system" rows={2} style={{ resize: 'vertical', fontSize: 13 }} />
                                </div>
                                <div>
                                  <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>STRATEGY</label>
                                  <textarea value={editState.strategy} onChange={e => setEditState(prev => prev ? { ...prev, strategy: e.target.value } : null)} className="v-input font-system" rows={2} style={{ resize: 'vertical', fontSize: 13 }} />
                                </div>
                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                  <div style={{ flex: 1, minWidth: 160 }}>
                                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>DONE MEANS</label>
                                    <input type="text" value={editState.doneMeans} onChange={e => setEditState(prev => prev ? { ...prev, doneMeans: e.target.value } : null)} className="v-input font-system" style={{ fontSize: 13 }} />
                                  </div>
                                  <div style={{ flex: 1, minWidth: 160 }}>
                                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>RESULT</label>
                                    <input type="text" value={editState.result} onChange={e => setEditState(prev => prev ? { ...prev, result: e.target.value } : null)} className="v-input font-system" style={{ fontSize: 13 }} />
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: 10 }}>
                                  <button type="button" onClick={event => { void withActionFeedback('Saving task', () => saveTask(task), event.currentTarget); }} className="v-pill-btn v-pill-btn-primary" style={{ flex: 1, gap: 6 }}>
                                    <Save size={14} /> Save Changes
                                  </button>
                                  <button type="button" onClick={cancelEditing} className="v-pill-btn" style={{ flex: 1 }}>
                                    Cancel
                                  </button>
                                </div>
                              </>
                            ) : (
                              /* ── Read-only Detail View ── */
                              <>
                                {task.description && (
                                  <div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <FileText size={10} /> DESCRIPTION
                                    </div>
                                    <p className="font-system" style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                                      {task.description}
                                    </p>
                                  </div>
                                )}
                                {task.strategy && (
                                  <div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <Layers size={10} /> STRATEGY
                                    </div>
                                    <p className="font-system" style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                                      {task.strategy}
                                    </p>
                                  </div>
                                )}
                                {task.result && (
                                  <div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>RESULT</div>
                                    <p className="font-system" style={{ fontSize: 13, color: '#ffffff', margin: 0 }}>{task.result}</p>
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                  {task.deadline && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
                                      <Calendar size={11} />
                                      Deadline: <strong style={{ color: 'var(--text-secondary)' }}>{task.deadline}</strong>
                                    </div>
                                  )}
                                  {task.actualMinutes !== undefined && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
                                      <Clock size={11} />
                                      Actual: <strong style={{ color: 'var(--text-secondary)' }}>{task.actualMinutes}min</strong>
                                    </div>
                                  )}
                                  <div
                                    className="v-status-badge"
                                    style={{
                                      color: STATUS_COLORS[task.status || 'not_started'],
                                      borderColor: STATUS_COLORS[task.status || 'not_started'] + '60',
                                      background: STATUS_COLORS[task.status || 'not_started'] + '15',
                                    }}
                                  >
                                    {STATUS_LABELS[task.status || 'not_started']}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}

      {sections.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
          <Tag size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
          <p style={{ fontSize: 14 }}>No categories yet. Create one above!</p>
        </div>
      )}
    </div>
  );
}
