'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { withActionFeedback } from '@/lib/utils/actionFeedback';
import {
  CalendarDays, CheckCircle2, Plus, Trash2, Save,
  ChevronLeft, ChevronRight, Target, BookOpen, Video, Clock, History, Check,
  Edit2, X
} from 'lucide-react';
import type { MonthlyPlan, MonthlyGoalItem, WeeklyPlan, Task } from '@/types';
import { formatEthiopianMonthRange } from '@/lib/date/ethiopianCalendar';

interface MonthlyPlanScreenProps {
  currentDate: string;
  isPhone: boolean;
}

function getMonthString(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM
}

function formatMonthLabel(monthStr: string): string {
  try {
    const [y, m] = monthStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, 1));
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
  } catch {
    return monthStr;
  }
}

function formatGregorianMonthLabel(monthStr: string): string {
  const [year, month] = monthStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function EditablePriorityCard({
  title,
  icon,
  accentColor,
  value,
  onChange,
  onSaveDirect,
  placeholder,
  addPlaceholder,
}: {
  title: string;
  icon: React.ReactNode;
  accentColor: string;
  value: string;
  onChange: (v: string) => void;
  onSaveDirect: () => void;
  placeholder: string;
  addPlaceholder: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editItemText, setEditItemText] = useState('');

  const items = useMemo(() => {
    return value ? value.split('\n').map(s => s.trim()).filter(Boolean) : [];
  }, [value]);

  const handleAdd = () => {
    if (!newItem.trim()) return;
    const next = [...items, newItem.trim()];
    onChange(next.join('\n'));
    setNewItem('');
  };

  const handleStartEdit = (idx: number, currentText: string) => {
    setEditingIndex(idx);
    setEditItemText(currentText);
  };

  const handleSaveEdit = (idx: number) => {
    if (!editItemText.trim()) return;
    const next = [...items];
    next[idx] = editItemText.trim();
    onChange(next.join('\n'));
    setEditingIndex(null);
  };

  const handleDelete = (idx: number, itemText: string) => {
    const confirmed = window.confirm(`Are you sure you want to delete this priority item?\n\n"${itemText}"`);
    if (!confirmed) return;
    const next = items.filter((_, i) => i !== idx);
    onChange(next.join('\n'));
  };

  return (
    <div
      className="v-card"
      style={{
        padding: '16px 18px',
        border: `1.5px solid ${isEditing ? accentColor : 'var(--v-glass-border-subtle)'}`,
        background: 'var(--v-glass-bg-card)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Header with Title and Edit Button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {icon} <span>{title}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            if (isEditing) {
              onSaveDirect();
            }
            setIsEditing(prev => !prev);
          }}
          className={`v-pill-btn${isEditing ? ' v-pill-btn-primary' : ''}`}
          style={{ padding: '3px 10px', fontSize: 11, minHeight: 28, gap: 4 }}
          title={isEditing ? 'Save and close edit mode' : 'Edit priorities'}
        >
          {isEditing ? <Check size={12} /> : <Edit2 size={12} />}
          <span>{isEditing ? 'Done' : 'Edit'}</span>
        </button>
      </div>

      {/* Content */}
      {isEditing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Add item row */}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
              placeholder={addPlaceholder}
              className="v-input font-system"
              style={{ fontSize: 13, flex: 1, padding: '6px 12px', minHeight: 34 }}
            />
            <button
              type="button"
              onClick={handleAdd}
              className="v-pill-btn v-pill-btn-primary"
              style={{ padding: '0 12px', fontSize: 12, minHeight: 34 }}
            >
              <Plus size={12} /> Add
            </button>
          </div>

          {/* List of editable items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((item, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 10,
                  background: 'var(--v-glass-bg-subtle)',
                  border: '1px solid var(--v-glass-border-subtle)',
                }}
              >
                {editingIndex === idx ? (
                  <>
                    <input
                      type="text"
                      autoFocus
                      value={editItemText}
                      onChange={e => setEditItemText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(idx); if (e.key === 'Escape') setEditingIndex(null); }}
                      className="v-input font-system"
                      style={{ fontSize: 12, flex: 1, padding: '4px 8px', minHeight: 30 }}
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(idx)}
                      className="v-circle-btn"
                      style={{ width: 26, height: 26, color: '#22c55e' }}
                      title="Save item"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingIndex(null)}
                      className="v-circle-btn"
                      style={{ width: 26, height: 26 }}
                      title="Cancel"
                    >
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: accentColor, flexShrink: 0 }} />
                    <span className="font-system" style={{ fontSize: 13, flex: 1, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                      {item}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleStartEdit(idx, item)}
                      className="v-circle-btn"
                      style={{ width: 26, height: 26 }}
                      title="Edit this priority"
                    >
                      <Edit2 size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(idx, item)}
                      className="v-circle-btn"
                      style={{ width: 26, height: 26, color: '#f87171' }}
                      title="Delete this priority (requires confirmation)"
                    >
                      <Trash2 size={11} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Read-only view with bullets */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 48 }}>
          {items.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 0' }}>
              {placeholder} (Click <strong>Edit</strong> to add items)
            </div>
          ) : (
            items.map((item, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '6px 8px',
                  borderRadius: 8,
                  background: 'var(--v-glass-bg-subtle)',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: accentColor, marginTop: 6, flexShrink: 0 }} />
                <span className="font-system" style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {item}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function MonthlyPlanScreen({ currentDate, isPhone }: MonthlyPlanScreenProps) {
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getMonthString(currentDate));

  // Form State
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [academicPriorities, setAcademicPriorities] = useState('');
  const [editingTargets, setEditingTargets] = useState('');
  const [commitments, setCommitments] = useState('');
  const [goals, setGoals] = useState<MonthlyGoalItem[]>([]);
  const [newGoalInput, setNewGoalInput] = useState('');

  // Status & Saved State
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // History & Associated plans
  const [allMonthlyPlans, setAllMonthlyPlans] = useState<MonthlyPlan[]>([]);
  const [monthWeeklyPlans, setMonthWeeklyPlans] = useState<WeeklyPlan[]>([]);
  const [monthTasks, setMonthTasks] = useState<Task[]>([]);

  // Calculate completion percentage
  const completionPercentage = useMemo(() => {
    if (goals.length === 0) return 0;
    const completed = goals.filter(g => g.completed).length;
    return Math.round((completed / goals.length) * 100);
  }, [goals]);

  // Load monthly plan
  const loadMonthData = async () => {
    // 1. Active monthly plan
    const existing = await db.monthlyPlans.get(selectedMonth);
    if (existing && !existing.deleted) {
      setTitle(existing.title || '');
      setPrompt(existing.prompt || '');
      setAcademicPriorities(existing.academicPriorities || '');
      setEditingTargets(existing.editingTargets || '');
      setCommitments(existing.commitments || '');
      setGoals(Array.isArray(existing.goals) ? existing.goals : []);
    } else {
      setTitle(`${formatMonthLabel(selectedMonth)} Master Plan`);
      setPrompt('');
      setAcademicPriorities('');
      setEditingTargets('');
      setCommitments('');
      setGoals([]);
    }

    // 2. All monthly plans for history
    const all = await db.monthlyPlans.filter(m => !m.deleted).toArray();
    all.sort((a, b) => b.month.localeCompare(a.month));
    setAllMonthlyPlans(all);

    // 3. Weekly plans belonging to this month
    const weekly = await db.weeklyPlans
      .filter(w => w.monthId === selectedMonth && !w.deleted)
      .toArray();
    setMonthWeeklyPlans(weekly);

    // 4. Tasks in this month
    const tasks = await db.tasks
      .filter(t => t.date.startsWith(selectedMonth) && !t.deleted)
      .toArray();
    setMonthTasks(tasks);
  };

  useEffect(() => {
    loadMonthData();
  }, [selectedMonth]);

  const shiftMonth = (delta: number) => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1 + delta, 1));
    const nextStr = date.toISOString().slice(0, 7);
    setSelectedMonth(nextStr);
  };

  const handleAddGoal = () => {
    if (!newGoalInput.trim()) return;
    const item: MonthlyGoalItem = {
      id: crypto.randomUUID(),
      text: newGoalInput.trim(),
      completed: false,
    };
    setGoals(prev => [...prev, item]);
    setNewGoalInput('');
  };

  const handleToggleGoal = (id: string) => {
    setGoals(prev => prev.map(g => g.id === id ? { ...g, completed: !g.completed } : g));
  };

  const handleDeleteGoal = (id: string) => {
    setGoals(prev => prev.filter(g => g.id !== id));
  };

  const handleSaveMonthlyPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const now = Date.now();

    const plan: MonthlyPlan = {
      id: selectedMonth,
      month: selectedMonth,
      title: title.trim() || `${formatMonthLabel(selectedMonth)} Plan`,
      prompt: prompt.trim(),
      academicPriorities: academicPriorities.trim(),
      editingTargets: editingTargets.trim(),
      commitments: commitments.trim(),
      goals,
      completionPercentage,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deleted: false,
      synced: 0,
    };

    await db.monthlyPlans.put(plan);
    syncEngine.notifyLocalMutation();

    setSubmitting(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    loadMonthData();
  };

  const handleSaveDirect = async (overrideAcad?: string, overrideEdit?: string) => {
    const acad = overrideAcad !== undefined ? overrideAcad : academicPriorities;
    const edit = overrideEdit !== undefined ? overrideEdit : editingTargets;
    const now = Date.now();
    const plan: MonthlyPlan = {
      id: selectedMonth,
      month: selectedMonth,
      title: title.trim() || `${formatMonthLabel(selectedMonth)} Plan`,
      prompt: prompt.trim(),
      academicPriorities: acad.trim(),
      editingTargets: edit.trim(),
      commitments: commitments.trim(),
      goals,
      completionPercentage,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deleted: false,
      synced: 0,
    };
    await db.monthlyPlans.put(plan);
    syncEngine.notifyLocalMutation();
  };

  const completedTasksCount = monthTasks.filter(t => t.isCompleted).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── 1. Month Navigator Bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="v-circle-btn"
          style={{ width: 38, height: 38, flexShrink: 0 }}
          aria-label="Previous month"
        >
          ‹
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div className="font-bloody" style={{ fontSize: isPhone ? 18 : 22, fontWeight: 700, letterSpacing: '0.04em' }}>
            MONTHLY PLAN
          </div>
          <div style={{ fontSize: 13, color: 'var(--accent-color)', fontWeight: 600, marginTop: 2 }}>
            {formatEthiopianMonthRange(selectedMonth)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Gregorian month data: {formatGregorianMonthLabel(selectedMonth)}</div>
        </div>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="v-circle-btn"
          style={{ width: 38, height: 38, flexShrink: 0 }}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      {/* ── 2. Monthly Metrics Progress Bar ── */}
      <div className="v-card" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarDays size={16} color="var(--accent-color)" />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
              Monthly Deliverables Completion
            </span>
          </div>
          <span style={{ fontSize: 14, fontWeight: 800, color: completionPercentage === 100 ? '#22c55e' : 'var(--accent-color)' }}>
            {completionPercentage}%
          </span>
        </div>

        <div className="v-budget-bar">
          <div
            className="v-budget-bar-fill"
            style={{
              width: `${completionPercentage}%`,
              background: completionPercentage === 100 ? '#22c55e' : 'var(--accent-color)',
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
          <span>Goals: <strong>{goals.filter(g => g.completed).length} / {goals.length}</strong></span>
          <span>Connected Weeks: <strong>{monthWeeklyPlans.length}</strong></span>
          <span>Tasks Executed: <strong>{completedTasksCount} / {monthTasks.length}</strong></span>
        </div>
      </div>

      {/* ── 3. Monthly Planning Form ── */}
      <form onSubmit={event => { void withActionFeedback('Saving monthly plan', () => handleSaveMonthlyPlan(event), event.currentTarget); }}>
        <div className="v-card" style={{ padding: '24px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
              PLAN TITLE
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. October 2026 Academic & Deep Work Master Plan"
              className="v-input"
              style={{ fontSize: 15, fontWeight: 600 }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
              DETAILED MONTHLY PLANNING PROMPT & VISION
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={5}
              placeholder="Define high-level targets for this month:
• Overarching goals and academic themes.
• Key deliverables and personal growth commitments.
• Major milestones to achieve before month's end..."
              className="v-input font-system"
              style={{ fontSize: 14, lineHeight: 1.6 }}
            />
          </div>

          {/* Academic & Editing Columns — Dedicated Editable Priority Sections */}
          <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : 'repeat(2, 1fr)', gap: 14 }}>
            <EditablePriorityCard
              title="Academic Priorities & Coursework (AASTU)"
              icon={<BookOpen size={14} color="#38bdf8" />}
              accentColor="#38bdf8"
              value={academicPriorities}
              onChange={val => {
                setAcademicPriorities(val);
                handleSaveDirect(val, editingTargets);
              }}
              onSaveDirect={() => handleSaveDirect(academicPriorities, editingTargets)}
              placeholder="No academic priorities added yet."
              addPlaceholder="Add academic priority (e.g. Embedded Systems Project)..."
            />

            <EditablePriorityCard
              title="Video-Editing & Deep-Work Deliverables"
              icon={<Video size={14} color="#a855f7" />}
              accentColor="#a855f7"
              value={editingTargets}
              onChange={val => {
                setEditingTargets(val);
                handleSaveDirect(academicPriorities, val);
              }}
              onSaveDirect={() => handleSaveDirect(academicPriorities, editingTargets)}
              placeholder="No video-editing deliverables added yet."
              addPlaceholder="Add deliverable (e.g. Export 4K Documentary Cut)..."
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
              Personal Commitments & Fixed Deadlines
            </label>
            <textarea
              value={commitments}
              onChange={e => setCommitments(e.target.value)}
              rows={2}
              placeholder="Critical submission dates, events, health/fitness commitments..."
              className="v-input font-system"
              style={{ fontSize: 13, lineHeight: 1.5 }}
            />
          </div>

          {/* Interactive Goals Checklist */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em', marginBottom: 10 }}>
              KEY MONTHLY DELIVERABLES CHECKLIST
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                type="text"
                value={newGoalInput}
                onChange={e => setNewGoalInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddGoal(); } }}
                placeholder="Add a milestone (e.g. Complete AASTU Embedded Systems Project)..."
                className="v-input"
                style={{ fontSize: 13, flex: 1 }}
              />
              <button
                type="button"
                onClick={handleAddGoal}
                className="v-pill-btn v-pill-btn-primary"
                style={{ padding: '0 16px', fontSize: 13 }}
              >
                <Plus size={14} /> Add Goal
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {goals.map(g => (
                <div
                  key={g.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: g.completed ? 'rgba(34, 197, 94, 0.08)' : 'var(--v-glass-bg-subtle)',
                    border: '1px solid var(--v-glass-border-subtle)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleToggleGoal(g.id)}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      border: `2px solid ${g.completed ? '#22c55e' : 'var(--v-glass-border)'}`,
                      background: g.completed ? '#22c55e' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    {g.completed && <Check size={12} color="#0d0d11" strokeWidth={3} />}
                  </button>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      fontWeight: 500,
                      color: g.completed ? 'var(--text-muted)' : 'var(--text-primary)',
                      textDecoration: g.completed ? 'line-through' : 'none',
                    }}
                  >
                    {g.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteGoal(g.id)}
                    className="v-circle-btn"
                    style={{ width: 26, height: 26, color: '#f87171' }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="v-pill-btn v-pill-btn-primary"
            style={{ minHeight: 44 }}
          >
            {submitting ? '⏳ Saving Monthly Plan…' : saved ? '✅ Monthly Plan Saved!' : <><Save size={15} /> Save Monthly Plan</>}
          </button>
        </div>
      </form>

      {/* ── 4. Saved Monthly History ── */}
      {allMonthlyPlans.length > 0 && (
        <div className="v-card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <History size={16} color="var(--text-muted)" />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
              SAVED MONTHLY HISTORY
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {allMonthlyPlans.map(m => {
              const isSelected = m.month === selectedMonth;
              return (
                <div
                  key={m.id}
                  onClick={() => setSelectedMonth(m.month)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: 12,
                    background: isSelected ? 'var(--accent-glow)' : 'var(--v-glass-bg-subtle)',
                    border: `1.5px solid ${isSelected ? 'var(--accent-color)' : 'var(--v-glass-border-subtle)'}`,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <CalendarDays size={14} color={isSelected ? 'var(--accent-color)' : 'var(--text-muted)'} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {formatMonthLabel(m.month)}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {m.title}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>
                    {m.completionPercentage}% deliverables complete
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
