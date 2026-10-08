'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { useTimer } from '@/lib/timer/useTimer';
import confetti from 'canvas-confetti';
import {
  CheckCircle2,
  Circle,
  Play,
  Pause,
  Square,
  Clock,
  Sparkles,
  Star,
  PlusCircle,
  Check,
  CheckCheck,
} from 'lucide-react';
import type { Task, Section, TimeLog, Day, DayReview } from '@/types';

interface TodayScreenProps {
  sections: Section[];
  onOpenManualTime: (taskId: string, title: string) => void;
  onPreviewImage: (url: string, title: string) => void;
  isPhone: boolean;
}

export function TodayScreen({
  sections,
  onOpenManualTime,
  onPreviewImage,
  isPhone,
}: TodayScreenProps) {
  const todayDate = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [review, setReview] = useState<DayReview>({ worked: '', blocked: '', change: '' });
  const [dayRecord, setDayRecord] = useState<Day | null>(null);
  const [reviewSavedMessage, setReviewSavedMessage] = useState(false);

  const {
    activeTimer,
    formattedTime,
    isTimerRunning,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
  } = useTimer();

  // Load today's tasks, time logs, and day review
  useEffect(() => {
    let mounted = true;

    async function loadData() {
      const todayTasks = await db.tasks
        .filter(t => t.date === todayDate && !t.deleted)
        .toArray();
      todayTasks.sort((a, b) => a.order - b.order);

      const logs = await db.timeLogs
        .filter(tl => tl.date === todayDate && !tl.deleted)
        .toArray();

      const day = await db.days.get(todayDate);

      if (mounted) {
        setTasks(todayTasks);
        setTimeLogs(logs);
        setDayRecord(day || null);
        if (day?.review) {
          setReview(day.review);
        }
      }
    }

    loadData();
    const interval = setInterval(loadData, 2000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [todayDate]);

  // Compute actual spent time per task from TimeLogs
  const taskActualMinutesMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const log of timeLogs) {
      const current = map.get(log.taskId) || 0;
      map.set(log.taskId, current + log.minutes);
    }
    return map;
  }, [timeLogs]);

  // Mark task completed / uncompleted
  const handleToggleTaskCompleted = async (task: Task) => {
    const newStatus = !task.isCompleted;
    const now = Date.now();

    if (newStatus) {
      try {
        confetti({
          particleCount: 60,
          spread: 60,
          origin: { y: 0.8 },
        });
      } catch {
        // Confetti fallback
      }
    }

    await db.tasks.update(task.id, {
      isCompleted: newStatus,
      completedAt: newStatus ? now : null,
      updatedAt: now,
      synced: 0,
    });

    syncEngine.notifyLocalMutation();
  };

  // Auto-save 1-Minute End-of-Day Review
  const handleSaveReview = async (field: keyof DayReview, value: string) => {
    const updatedReview: DayReview = { ...review, [field]: value };
    setReview(updatedReview);

    const now = Date.now();
    const updatedDay: Day = {
      id: todayDate,
      date: todayDate,
      freeHours: dayRecord?.freeHours || 8,
      review: updatedReview,
      updatedAt: now,
      deleted: false,
      isSample: false,
      synced: 0,
    };

    await db.days.put(updatedDay);
    setDayRecord(updatedDay);
    syncEngine.notifyLocalMutation();

    setReviewSavedMessage(true);
    setTimeout(() => setReviewSavedMessage(false), 2000);
  };

  // Group tasks by section
  const sectionTaskGroups = useMemo(() => {
    return sections
      .map(sec => ({
        section: sec,
        tasks: tasks.filter(t => t.sectionId === sec.id),
      }))
      .filter(g => g.tasks.length > 0);
  }, [sections, tasks]);

  const completedCount = tasks.filter(t => t.isCompleted).length;
  const totalActualMins = timeLogs.reduce((sum, l) => sum + l.minutes, 0);

  return (
    <div className="space-y-6 pb-24">
      {/* Today Header & Quick Progress Metric */}
      <div className="bg-bg-card border border-border-color rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-bloody text-2xl font-bold text-text-primary">
              Today&apos;s Execution
            </h2>
            <p className="text-xs text-text-muted mt-1">
              Focus on one task at a time. Strategy and definition of done are right in front of you.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="px-4 py-2 rounded-xl bg-bg-secondary border border-border-color text-center">
              <span className="block text-[10px] uppercase font-bold text-text-muted tracking-wider">
                Completed
              </span>
              <span className="font-mono text-base font-bold text-emerald-400">
                {completedCount} / {tasks.length}
              </span>
            </div>

            <div className="px-4 py-2 rounded-xl bg-bg-secondary border border-border-color text-center">
              <span className="block text-[10px] uppercase font-bold text-text-muted tracking-wider">
                Actual Time
              </span>
              <span className="font-mono text-base font-bold text-accent-primary">
                {Math.round((totalActualMins / 60) * 10) / 10}h
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Task Groups by Section */}
      {sectionTaskGroups.length === 0 ? (
        <div className="text-center py-16 px-4 bg-bg-card border border-border-color rounded-2xl">
          <p className="font-bloody text-xl text-text-primary mb-2">
            No tasks scheduled for today
          </p>
          <p className="text-xs text-text-muted">
            Head over to the Plan tab to organize your tasks.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {sectionTaskGroups.map(({ section, tasks: secTasks }) => (
            <div key={section.id} className="space-y-3">
              {/* Section Header */}
              <div className="flex items-center gap-2 px-1">
                <span className="text-xl">{section.icon}</span>
                <h3 className="font-bold text-base text-text-primary">
                  {section.name}
                </h3>
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: section.color }}
                />
              </div>

              {/* Task Cards */}
              <div className="space-y-3">
                {secTasks.map(task => {
                  const actualMins = taskActualMinutesMap.get(task.id) || 0;
                  const isCurrentTimer = activeTimer?.taskId === task.id;

                  return (
                    <div
                      key={task.id}
                      className={`p-4 sm:p-5 rounded-2xl border transition-all shadow-sm ${
                        task.isCompleted
                          ? 'bg-bg-card/60 border-border-color/60 opacity-80'
                          : isCurrentTimer
                          ? 'bg-purple-950/20 border-accent-primary shadow-purple-950/30'
                          : 'bg-bg-card border-border-color'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        {/* Checkbox & Title */}
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <button
                            onClick={() => handleToggleTaskCompleted(task)}
                            className="mt-0.5 text-text-muted hover:text-emerald-400 transition-colors shrink-0"
                            aria-label={task.isCompleted ? 'Mark uncompleted' : 'Mark completed'}
                          >
                            {task.isCompleted ? (
                              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                            ) : (
                              <Circle className="w-6 h-6 hover:text-accent-primary" />
                            )}
                          </button>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4
                                className={`font-bold text-base leading-snug ${
                                  task.isCompleted ? 'line-through text-text-muted' : 'text-text-primary'
                                }`}
                                style={{ color: !task.isCompleted && task.textColor ? task.textColor : undefined }}
                              >
                                {task.title}
                              </h4>
                              {task.mustDo && (
                                <Star className="w-4 h-4 fill-amber-400 text-amber-400 shrink-0" />
                              )}
                            </div>

                            {/* Strategy (How I will do it - prominently visible) */}
                            {task.strategy && (
                              <div className="mt-2 text-xs bg-bg-secondary p-3 rounded-xl border border-border-color text-text-secondary">
                                <span className="text-[10px] uppercase font-bold text-text-muted block mb-1">
                                  Strategy (How):
                                </span>
                                <div
                                  dangerouslySetInnerHTML={{ __html: task.strategy }}
                                  className="prose prose-invert prose-xs max-w-none"
                                />
                              </div>
                            )}

                            {/* Done Means (How I will know it is finished) */}
                            {task.doneMeans && (
                              <div className="mt-2 text-xs text-text-muted flex items-start gap-1.5 italic">
                                <span className="font-semibold text-accent-primary shrink-0 not-italic">
                                  Done means:
                                </span>
                                <span>{task.doneMeans}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Timer & Time Controls */}
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          {/* Timer Controls */}
                          <div className="flex items-center gap-1.5 bg-bg-secondary p-1 rounded-xl border border-border-color">
                            {isCurrentTimer ? (
                              <>
                                <span className="font-mono text-xs font-bold text-accent-primary px-1.5">
                                  {formattedTime}
                                </span>
                                {isTimerRunning ? (
                                  <button
                                    onClick={pauseTimer}
                                    className="p-1.5 rounded-lg bg-bg-card hover:bg-bg-tertiary text-text-primary"
                                    aria-label="Pause timer"
                                    title="Pause"
                                  >
                                    <Pause className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <button
                                    onClick={resumeTimer}
                                    className="p-1.5 rounded-lg bg-bg-card hover:bg-bg-tertiary text-text-primary"
                                    aria-label="Resume timer"
                                    title="Resume"
                                  >
                                    <Play className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={stopTimer}
                                  className="p-1.5 rounded-lg bg-red-950/60 hover:bg-red-900 text-red-300"
                                  aria-label="Stop timer and record log"
                                  title="Stop & Log"
                                >
                                  <Square className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => startTimer(task.id, task.title, section.color)}
                                className="px-2.5 py-1 rounded-lg text-xs font-semibold text-text-secondary hover:text-text-primary flex items-center gap-1 hover:bg-bg-tertiary transition-colors"
                                aria-label={`Start timer for ${task.title}`}
                              >
                                <Play className="w-3 h-3 text-accent-primary" />
                                <span>Timer</span>
                              </button>
                            )}

                            {/* Manual Time Add Button */}
                            <button
                              onClick={() => onOpenManualTime(task.id, task.title)}
                              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                              aria-label="Add time manually"
                              title="Manual time log"
                            >
                              <PlusCircle className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Est vs Actual comparison pill */}
                          <div className="text-[11px] font-mono text-text-muted flex items-center gap-1">
                            <span>{actualMins}m act</span>
                            <span>/</span>
                            <span>{task.estimatedMinutes}m est</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 1-Minute End-of-Day Review */}
      <div className="bg-bg-card border border-border-color rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h3 className="font-bloody text-lg font-bold text-text-primary">
              1-Minute Evening Review
            </h3>
          </div>
          {reviewSavedMessage && (
            <span className="text-xs text-emerald-400 flex items-center gap-1 animate-in fade-in">
              <Check className="w-3.5 h-3.5" />
              <span>Saved</span>
            </span>
          )}
        </div>

        <p className="text-xs text-text-muted">
          Answer in 3 concise bullet points before you sleep. Your &quot;One change for tomorrow&quot; will be automatically shown when planning tomorrow.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Box 1: What worked? */}
          <div className="space-y-1.5">
            <label htmlFor="review-worked" className="block text-xs font-semibold text-text-secondary uppercase tracking-wider">
              1. What worked?
            </label>
            <textarea
              id="review-worked"
              rows={3}
              value={review.worked}
              onChange={e => handleSaveReview('worked', e.target.value)}
              placeholder="e.g. Started Deep Work early, zero Slack distractions."
              className="w-full px-3 py-2 rounded-xl bg-bg-secondary border border-border-color text-text-primary text-xs focus:border-accent-primary focus:outline-none placeholder:text-text-muted/60"
            />
          </div>

          {/* Box 2: What blocked me? */}
          <div className="space-y-1.5">
            <label htmlFor="review-blocked" className="block text-xs font-semibold text-text-secondary uppercase tracking-wider">
              2. What blocked me?
            </label>
            <textarea
              id="review-blocked"
              rows={3}
              value={review.blocked}
              onChange={e => handleSaveReview('blocked', e.target.value)}
              placeholder="e.g. Overestimated stamina in the afternoon, checked phone."
              className="w-full px-3 py-2 rounded-xl bg-bg-secondary border border-border-color text-text-primary text-xs focus:border-accent-primary focus:outline-none placeholder:text-text-muted/60"
            />
          </div>

          {/* Box 3: One change for tomorrow? */}
          <div className="space-y-1.5">
            <label htmlFor="review-change" className="block text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1">
              <span>3. One change for tomorrow?</span>
            </label>
            <textarea
              id="review-change"
              rows={3}
              value={review.change}
              onChange={e => handleSaveReview('change', e.target.value)}
              placeholder="e.g. Schedule 20min walk after lunch before next coding block."
              className="w-full px-3 py-2 rounded-xl bg-amber-950/20 border border-amber-800/60 text-text-primary text-xs focus:border-amber-500 focus:outline-none placeholder:text-text-muted/60"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
