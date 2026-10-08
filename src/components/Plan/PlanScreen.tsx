'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { getPreviousDayData } from '@/lib/plan/autoPlan';
import {
  Calendar,
  Clock,
  Sparkles,
  Star,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Edit2,
  Trash2,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
} from 'lucide-react';
import type { Task, Section, Day } from '@/types';

interface PlanScreenProps {
  currentDate: string;
  onChangeDate: (date: string) => void;
  sections: Section[];
  onOpenTaskModal: (task?: Task | null) => void;
  onPreviewImage: (url: string, title: string) => void;
  onOpenAutoPlan: (previousDate: string, candidateTasks: Task[]) => void;
  isPhone: boolean;
}

export function PlanScreen({
  currentDate,
  onChangeDate,
  sections,
  onOpenTaskModal,
  onPreviewImage,
  onOpenAutoPlan,
  isPhone,
}: PlanScreenProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dayRecord, setDayRecord] = useState<Day | null>(null);
  const [freeHours, setFreeHours] = useState<number>(8);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedSectionFilter, setSelectedSectionFilter] = useState<string | null>(null);
  const [yesterdayChange, setYesterdayChange] = useState<string | null>(null);
  const [prevUnfinishedTasks, setPrevUnfinishedTasks] = useState<Task[]>([]);
  const [prevDate, setPrevDate] = useState<string>('');

  // Load tasks for current date and previous day's review & carry-over data
  useEffect(() => {
    let mounted = true;

    async function loadData() {
      const dayTasks = await db.tasks
        .filter(t => t.date === currentDate && !t.deleted)
        .toArray();
      dayTasks.sort((a, b) => a.order - b.order);

      const d = await db.days.get(currentDate);

      // Check last known freeHours from another day if current day is new
      if (d?.freeHours !== undefined) {
        if (mounted) setFreeHours(d.freeHours);
      } else {
        const lastDay = await db.days.orderBy('date').last();
        if (mounted && lastDay?.freeHours) {
          setFreeHours(lastDay.freeHours);
        }
      }

      // Check yesterday's review change and unfinished tasks
      const prevData = await getPreviousDayData(currentDate);

      if (mounted) {
        setTasks(dayTasks);
        setDayRecord(d || null);
        setYesterdayChange(prevData.previousReviewChange);
        setPrevUnfinishedTasks(prevData.unfinishedTasks);
        setPrevDate(prevData.previousDate);
      }
    }

    loadData();

    // Listen to Dexie updates
    const interval = setInterval(loadData, 2000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [currentDate]);

  // Update Free Hours and save to Day record
  const handleUpdateFreeHours = async (newVal: number) => {
    const val = Math.max(0, Math.min(24, newVal));
    setFreeHours(val);
    const now = Date.now();
    const existing = await db.days.get(currentDate);
    const updated: Day = {
      id: currentDate,
      date: currentDate,
      freeHours: val,
      review: existing?.review || { worked: '', blocked: '', change: '' },
      updatedAt: now,
      deleted: false,
      isSample: false,
      synced: 0,
    };
    await db.days.put(updated);
    syncEngine.notifyLocalMutation();
  };

  // Reorder task up / down
  const moveTaskOrder = async (task: Task, direction: 'up' | 'down') => {
    const sectionTasks = tasks.filter(t => t.sectionId === task.sectionId);
    const currentIndex = sectionTasks.findIndex(t => t.id === task.id);
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

    if (targetIndex < 0 || targetIndex >= sectionTasks.length) return;

    const swapTask = sectionTasks[targetIndex];
    const now = Date.now();

    await db.transaction('rw', db.tasks, async () => {
      await db.tasks.update(task.id, { order: swapTask.order, updatedAt: now, synced: 0 });
      await db.tasks.update(swapTask.id, { order: task.order, updatedAt: now, synced: 0 });
    });

    syncEngine.notifyLocalMutation();
  };

  // Move task to different section (for PC drag/drop or board move)
  const moveTaskSection = async (taskId: string, targetSectionId: string) => {
    const now = Date.now();
    await db.tasks.update(taskId, {
      sectionId: targetSectionId,
      updatedAt: now,
      synced: 0,
    });
    syncEngine.notifyLocalMutation();
  };

  // Soft delete task
  const handleDeleteTask = async (taskId: string) => {
    const now = Date.now();
    await db.tasks.update(taskId, {
      deleted: true,
      updatedAt: now,
      synced: 0,
    });
    syncEngine.notifyLocalMutation();
  };

  // Date Navigation
  const shiftDate = (days: number) => {
    const [y, m, d] = currentDate.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + days);
    onChangeDate(date.toISOString().split('T')[0]);
  };

  // Computations
  const totalPlannedMinutes = useMemo(() => {
    return tasks.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
  }, [tasks]);

  const totalPlannedHours = Math.round((totalPlannedMinutes / 60) * 10) / 10;
  const isOverBudget = totalPlannedHours > freeHours;

  const topThreeMustDos = useMemo(() => {
    return tasks.filter(t => t.mustDo).slice(0, 3);
  }, [tasks]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    tasks.forEach(t => t.tags?.forEach(tag => tagSet.add(tag)));
    return Array.from(tagSet);
  }, [tasks]);

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (selectedTag && !t.tags?.includes(selectedTag)) return false;
      if (isPhone && selectedSectionFilter && t.sectionId !== selectedSectionFilter) return false;
      return true;
    });
  }, [tasks, selectedTag, selectedSectionFilter, isPhone]);

  return (
    <div className="space-y-6 pb-20">
      {/* 1. Date Switcher & Budget Bar Header */}
      <div className="bg-bg-card border border-border-color rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Date Picker */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => shiftDate(-1)}
              className="p-2 rounded-xl bg-bg-secondary border border-border-color text-text-muted hover:text-text-primary transition-colors"
              aria-label="Previous day"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 bg-bg-secondary border border-border-color px-3.5 py-1.5 rounded-xl">
              <Calendar className="w-4 h-4 text-accent-primary shrink-0" />
              <input
                type="date"
                value={currentDate}
                onChange={e => onChangeDate(e.target.value)}
                className="bg-transparent text-text-primary font-semibold text-sm focus:outline-none cursor-pointer"
              />
            </div>

            <button
              onClick={() => shiftDate(1)}
              className="p-2 rounded-xl bg-bg-secondary border border-border-color text-text-muted hover:text-text-primary transition-colors"
              aria-label="Next day"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Free Hours Input */}
          <div className="flex items-center gap-2.5">
            <span className="text-xs text-text-muted font-medium">Free Hours:</span>
            <div className="flex items-center gap-1.5 bg-bg-secondary border border-border-color px-2.5 py-1 rounded-xl">
              <input
                type="number"
                min="1"
                max="24"
                step="0.5"
                value={freeHours}
                onChange={e => handleUpdateFreeHours(parseFloat(e.target.value) || 0)}
                className="w-14 bg-transparent text-text-primary font-bold text-sm text-center focus:outline-none"
              />
              <span className="text-xs text-text-muted font-mono">hrs</span>
            </div>
          </div>
        </div>

        {/* Time Budget Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-text-secondary flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>Planned: <b>{totalPlannedHours}h</b> / Budget: <b>{freeHours}h</b></span>
            </span>
            <span
              className={`font-bold font-mono ${
                isOverBudget ? 'text-red-400' : 'text-emerald-400'
              }`}
            >
              {isOverBudget
                ? `⚠️ Over by ${(totalPlannedHours - freeHours).toFixed(1)}h`
                : `${(freeHours - totalPlannedHours).toFixed(1)}h available`}
            </span>
          </div>

          <div className="w-full h-3 rounded-full bg-bg-secondary overflow-hidden p-0.5 border border-border-color">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isOverBudget
                  ? 'bg-red-500 shadow-sm shadow-red-500/50'
                  : 'bg-gradient-to-r from-purple-500 to-indigo-500'
              }`}
              style={{
                width: `${Math.min(100, freeHours > 0 ? (totalPlannedHours / freeHours) * 100 : 100)}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* 2. Yesterday's Review Change Reminder Banner */}
      {yesterdayChange && (
        <div className="bg-amber-950/40 border border-amber-800/80 rounded-2xl p-4 flex items-start gap-3 text-amber-300 animate-in fade-in">
          <Lightbulb className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
          <div className="text-xs space-y-0.5">
            <p className="font-semibold uppercase tracking-wider text-amber-400">
              One Change for Tomorrow (From Yesterday&apos;s Review):
            </p>
            <p className="text-amber-200/90 leading-relaxed italic">
              &ldquo;{yesterdayChange}&rdquo;
            </p>
          </div>
        </div>
      )}

      {/* 3. Automated Plan from Previous Day Banner */}
      {prevUnfinishedTasks.length > 0 && tasks.length === 0 && (
        <div className="bg-purple-950/40 border border-purple-800/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-900/60 border border-purple-700 flex items-center justify-center text-purple-300">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">
                Auto-Plan from Yesterday?
              </p>
              <p className="text-xs text-text-muted">
                You have {prevUnfinishedTasks.length} unfinished tasks from {prevDate}.
              </p>
            </div>
          </div>

          <button
            onClick={() => onOpenAutoPlan(prevDate, prevUnfinishedTasks)}
            className="px-4 py-2 bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-purple-900/30 transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Review & Import Tasks</span>
          </button>
        </div>
      )}

      {/* Tag Filter Chips */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="text-xs text-text-muted font-medium shrink-0">Tags:</span>
          <button
            onClick={() => setSelectedTag(null)}
            className={`px-2.5 py-1 rounded-full text-xs transition-colors shrink-0 ${
              selectedTag === null
                ? 'bg-accent-primary text-white font-medium'
                : 'bg-bg-card border border-border-color text-text-muted hover:text-text-primary'
            }`}
          >
            All
          </button>
          {allTags.map(tag => (
            <button
              key={tag}
              onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
              className={`px-2.5 py-1 rounded-full text-xs transition-colors shrink-0 ${
                selectedTag === tag
                  ? 'bg-accent-primary text-white font-medium'
                  : 'bg-bg-card border border-border-color text-text-muted hover:text-text-primary'
              }`}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {/* 4. PHONE UI: Scrollable Section Tabs + Vertical Cards */}
      {isPhone && (
        <div className="space-y-4">
          {/* Scrollable Section Chips at Top */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setSelectedSectionFilter(null)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-colors ${
                selectedSectionFilter === null
                  ? 'bg-accent-primary text-white'
                  : 'bg-bg-card border border-border-color text-text-muted'
              }`}
            >
              All Sections ({tasks.length})
            </button>
            {sections.map(s => {
              const count = tasks.filter(t => t.sectionId === s.id).length;
              const isSelected = selectedSectionFilter === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedSectionFilter(isSelected ? null : s.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 flex items-center gap-1.5 border transition-colors ${
                    isSelected
                      ? 'border-transparent text-white'
                      : 'bg-bg-card border-border-color text-text-muted hover:text-text-primary'
                  }`}
                  style={{
                    backgroundColor: isSelected ? s.color : undefined,
                  }}
                >
                  <span>{s.icon}</span>
                  <span>{s.name}</span>
                  <span className="opacity-75">({count})</span>
                </button>
              );
            })}
          </div>

          {/* Task Cards */}
          <div className="space-y-3">
            {filteredTasks.length === 0 ? (
              <div className="text-center py-12 px-4 bg-bg-card border border-border-color rounded-2xl">
                <p className="font-bloody text-lg text-text-primary mb-1">
                  No plans scheduled yet
                </p>
                <p className="text-xs text-text-muted mb-4">
                  Tap the + button below to plan with clear intention.
                </p>
                {prevUnfinishedTasks.length > 0 && (
                  <button
                    onClick={() => onOpenAutoPlan(prevDate, prevUnfinishedTasks)}
                    className="px-4 py-2 bg-bg-secondary border border-border-color text-xs text-accent-primary font-medium rounded-xl inline-flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Auto-fill from yesterday ({prevUnfinishedTasks.length} tasks)</span>
                  </button>
                )}
              </div>
            ) : (
              filteredTasks.map(task => {
                const sec = sections.find(s => s.id === task.sectionId);
                return (
                  <div
                    key={task.id}
                    className="p-4 rounded-2xl bg-bg-card border border-border-color shadow-sm space-y-2.5 relative"
                  >
                    {/* Top Row: Section Badge, Star, Actions */}
                    <div className="flex items-center justify-between gap-2">
                      <div
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border"
                        style={{
                          backgroundColor: `${sec?.color || '#a855f7'}15`,
                          color: sec?.color || '#a855f7',
                          borderColor: `${sec?.color || '#a855f7'}40`,
                        }}
                      >
                        <span>{task.icon || sec?.icon || '📌'}</span>
                        <span>{sec?.name || 'Section'}</span>
                      </div>

                      <div className="flex items-center gap-1">
                        {task.mustDo && (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-950/70 border border-amber-700 text-amber-300 text-[10px] font-bold">
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            <span>Must-Do</span>
                          </div>
                        )}
                        <button
                          onClick={() => moveTaskOrder(task, 'up')}
                          className="p-1 text-text-muted hover:text-text-primary"
                          aria-label="Move task up"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => moveTaskOrder(task, 'down')}
                          className="p-1 text-text-muted hover:text-text-primary"
                          aria-label="Move task down"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onOpenTaskModal(task)}
                          className="p-1 text-text-muted hover:text-text-primary"
                          aria-label="Edit task"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteTask(task.id)}
                          className="p-1 text-text-muted hover:text-red-400"
                          aria-label="Delete task"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Task Title */}
                    <h3
                      className="font-bold text-base text-text-primary leading-snug cursor-pointer hover:text-accent-primary"
                      style={{ color: task.textColor || undefined }}
                      onClick={() => onOpenTaskModal(task)}
                    >
                      {task.title}
                    </h3>

                    {/* Strategy & Done Means Preview */}
                    {task.strategy && (
                      <div className="text-xs text-text-secondary bg-bg-secondary p-2.5 rounded-xl border border-border-color">
                        <span className="font-semibold text-text-muted block text-[10px] uppercase mb-0.5">
                          Strategy:
                        </span>
                        <div
                          dangerouslySetInnerHTML={{ __html: task.strategy }}
                          className="prose prose-invert prose-xs max-w-none line-clamp-2"
                        />
                      </div>
                    )}

                    {task.doneMeans && (
                      <p className="text-xs text-text-muted italic flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-accent-primary shrink-0" />
                        <span>Done means: {task.doneMeans}</span>
                      </p>
                    )}

                    {/* Metadata Footer */}
                    <div className="flex items-center justify-between pt-1 border-t border-border-color/60 text-xs text-text-muted">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-text-secondary">
                          {task.estimatedMinutes}m
                        </span>
                        <span>•</span>
                        <span className="font-medium">{task.priority} Priority</span>
                      </div>

                      {task.tags && task.tags.length > 0 && (
                        <div className="flex items-center gap-1">
                          {task.tags.slice(0, 2).map(tag => (
                            <span key={tag} className="text-[10px] bg-bg-secondary px-1.5 py-0.5 rounded text-text-muted">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 5. PC UI: Board Style Columns + Right Day Summary Panel */}
      {!isPhone && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Main Board Columns (3 Columns on PC) */}
          <div className="xl:col-span-3 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sections.map(sec => {
                const secTasks = tasks.filter(t => t.sectionId === sec.id);
                const secPlannedMins = secTasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
                const targetMins = sec.dailyTargetMinutes;

                return (
                  <div
                    key={sec.id}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      const taskId = e.dataTransfer.getData('text/plain');
                      if (taskId) moveTaskSection(taskId, sec.id);
                    }}
                    className="bg-bg-card border border-border-color rounded-2xl flex flex-col min-h-[400px] shadow-sm overflow-hidden"
                  >
                    {/* Section Header */}
                    <div
                      className="p-3.5 border-b border-border-color flex items-center justify-between"
                      style={{ borderTop: `4px solid ${sec.color}` }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{sec.icon}</span>
                        <div>
                          <h4 className="font-bold text-sm text-text-primary leading-tight">
                            {sec.name}
                          </h4>
                          <span className="text-[11px] text-text-muted font-mono">
                            {Math.round((secPlannedMins / 60) * 10) / 10}h planned
                            {targetMins ? ` / ${Math.round((targetMins / 60) * 10) / 10}h target` : ''}
                          </span>
                        </div>
                      </div>

                      <span className="text-xs font-bold text-text-muted bg-bg-secondary px-2 py-0.5 rounded-full border border-border-color">
                        {secTasks.length}
                      </span>
                    </div>

                    {/* Section Tasks */}
                    <div className="p-3 space-y-2.5 flex-1 overflow-y-auto">
                      {secTasks.length === 0 ? (
                        <div className="h-32 flex items-center justify-center text-xs text-text-muted/60 border border-dashed border-border-color/60 rounded-xl">
                          Drop tasks here
                        </div>
                      ) : (
                        secTasks.map(task => (
                          <div
                            key={task.id}
                            draggable
                            onDragStart={e => {
                              e.dataTransfer.setData('text/plain', task.id);
                            }}
                            className="p-3 rounded-xl bg-bg-secondary border border-border-color hover:border-accent-primary/60 shadow-sm cursor-grab active:cursor-grabbing transition-all space-y-2 group"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <h5
                                className="font-semibold text-sm text-text-primary leading-tight cursor-pointer hover:text-accent-primary"
                                style={{ color: task.textColor || undefined }}
                                onClick={() => onOpenTaskModal(task)}
                              >
                                {task.title}
                              </h5>
                              {task.mustDo && (
                                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 shrink-0 mt-0.5" />
                              )}
                            </div>

                            {task.strategy && (
                              <div
                                dangerouslySetInnerHTML={{ __html: task.strategy }}
                                className="text-xs text-text-secondary/90 line-clamp-2"
                              />
                            )}

                            <div className="flex items-center justify-between text-[11px] text-text-muted pt-1 border-t border-border-color/60">
                              <span className="font-mono font-medium text-text-secondary">
                                {task.estimatedMinutes}m
                              </span>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => onOpenTaskModal(task)}
                                  className="p-1 hover:text-text-primary"
                                  title="Edit"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => handleDeleteTask(task.id)}
                                  className="p-1 hover:text-red-400"
                                  title="Delete"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Day Summary Panel on PC */}
          <div className="space-y-5">
            {/* Top 3 Must-Dos Card */}
            <div className="p-4 rounded-2xl bg-bg-card border border-border-color shadow-sm space-y-3">
              <div className="flex items-center gap-2 text-text-primary font-bold text-sm">
                <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                <span>Top 3 Must-Dos (Daily Focus)</span>
              </div>

              {topThreeMustDos.length === 0 ? (
                <p className="text-xs text-text-muted italic">
                  No must-do tasks starred yet. Star up to 3 tasks to define your daily non-negotiables.
                </p>
              ) : (
                <div className="space-y-2">
                  {topThreeMustDos.map((t, idx) => (
                    <div
                      key={t.id}
                      className="p-2.5 rounded-xl bg-bg-secondary border border-border-color flex items-center gap-2.5"
                    >
                      <span className="w-5 h-5 rounded-full bg-amber-950 text-amber-400 border border-amber-700 text-xs font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <span className="text-xs font-medium text-text-primary truncate">
                        {t.title}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Section Targets Breakdown */}
            <div className="p-4 rounded-2xl bg-bg-card border border-border-color shadow-sm space-y-3">
              <h4 className="font-bold text-sm text-text-primary">
                Section Time Targets
              </h4>

              <div className="space-y-2.5">
                {sections.map(s => {
                  const secTasks = tasks.filter(t => t.sectionId === s.id);
                  const planned = secTasks.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
                  const target = s.dailyTargetMinutes;

                  return (
                    <div key={s.id} className="text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-text-secondary flex items-center gap-1.5">
                          <span>{s.icon}</span>
                          <span>{s.name}</span>
                        </span>
                        <span className="font-mono text-text-muted">
                          {planned}m {target ? `/ ${target}m` : ''}
                        </span>
                      </div>
                      {target && (
                        <div className="w-full h-1.5 rounded-full bg-bg-secondary overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              backgroundColor: s.color,
                              width: `${Math.min(100, (planned / target) * 100)}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
