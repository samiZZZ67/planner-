'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { withActionFeedback } from '@/lib/utils/actionFeedback';
import {
  CalendarRange, CheckCircle2, AlertCircle, Sparkles, Clock, Save,
  ChevronLeft, ChevronRight, FileText, Target, BookOpen, Video, ShieldAlert,
  History, Check
} from 'lucide-react';
import type { WeeklyPlan, Task, TimeLog, MonthlyPlan } from '@/types';
import { countWords, getWeekBounds } from '@/lib/plan/weeklyPlanUtils';
import { apiFetch } from '@/lib/api/apiClient';
import { formatEthiopianDateRange } from '@/lib/date/ethiopianCalendar';

interface WeeklyPlanScreenProps {
  currentDate: string;
  isPhone: boolean;
}

export function WeeklyPlanScreen({ currentDate, isPhone }: WeeklyPlanScreenProps) {
  const [selectedDate, setSelectedDate] = useState<string>(currentDate);
  const weekInfo = useMemo(() => getWeekBounds(selectedDate), [selectedDate]);

  // Form State
  const [prompt, setPrompt] = useState('');
  const [goals, setGoals] = useState('');
  const [aastuCommitments, setAastuCommitments] = useState('');
  const [deepWorkTargets, setDeepWorkTargets] = useState('');
  const [constraints, setConstraints] = useState('');
  const [outcomes, setOutcomes] = useState('');
  const [aiReport, setAiReport] = useState<string | null>(null);

  // Status & Validation
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [validationError, setValidationError] = useState('');

  // History & Metrics
  const [allWeeklyPlans, setAllWeeklyPlans] = useState<WeeklyPlan[]>([]);
  const [weekTasks, setWeekTasks] = useState<Task[]>([]);
  const [weekTimeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [monthlyPlan, setMonthlyPlan] = useState<MonthlyPlan | null>(null);

  const wordCount = useMemo(() => countWords(prompt), [prompt]);
  const wordsNeeded = Math.max(0, 100 - wordCount);
  const isWordCountValid = wordCount >= 100;

  // Load weekly plan & metrics
  const loadWeekData = async () => {
    // 1. Load active plan for selected week
    const existing = await db.weeklyPlans.get(weekInfo.weekId);
    if (existing && !existing.deleted) {
      setPrompt(existing.prompt || '');
      setGoals(existing.goals || '');
      setAastuCommitments(existing.aastuCommitments || '');
      setDeepWorkTargets(existing.deepWorkTargets || '');
      setConstraints(existing.constraints || '');
      setOutcomes(existing.outcomes || '');
      setAiReport(existing.aiWeeklyReport || null);
    } else {
      // Clear form for new week
      setPrompt('');
      setGoals('');
      setAastuCommitments('');
      setDeepWorkTargets('');
      setConstraints('');
      setOutcomes('');
      setAiReport(null);
    }

    // 2. Load all weekly plans for history
    const all = await db.weeklyPlans.filter(w => !w.deleted).toArray();
    all.sort((a, b) => b.startDate.localeCompare(a.startDate));
    setAllWeeklyPlans(all);

    // 3. Load tasks in this week's date range
    const tasks = await db.tasks
      .filter(t => t.date >= weekInfo.startDate && t.date <= weekInfo.endDate && !t.deleted)
      .toArray();
    setWeekTasks(tasks);

    // 4. Load time logs for this week
    const logs = await db.timeLogs
      .filter(l => l.date >= weekInfo.startDate && l.date <= weekInfo.endDate && !l.deleted)
      .toArray();
    setTimeLogs(logs);

    // 5. Load associated monthly plan
    const mPlan = await db.monthlyPlans.get(weekInfo.monthId);
    setMonthlyPlan(mPlan || null);
  };

  useEffect(() => {
    loadWeekData();
  }, [weekInfo.weekId]);

  const shiftWeek = (deltaWeeks: number) => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + deltaWeeks * 7);
    setSelectedDate(date.toISOString().split('T')[0]);
  };

  const handleSaveWeeklyPlan = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isWordCountValid) {
      setValidationError(`The weekly planning prompt must contain at least 100 words (${wordsNeeded} more required). Please provide a thorough breakdown of your goals, AASTU academic deadlines, and deep-work targets.`);
      return;
    }

    setValidationError('');
    setSubmitting(true);
    const now = Date.now();

    const plan: WeeklyPlan = {
      id: weekInfo.weekId,
      startDate: weekInfo.startDate,
      endDate: weekInfo.endDate,
      monthId: weekInfo.monthId,
      prompt: prompt.trim(),
      wordCount,
      goals: goals.trim(),
      aastuCommitments: aastuCommitments.trim(),
      deepWorkTargets: deepWorkTargets.trim(),
      constraints: constraints.trim(),
      outcomes: outcomes.trim(),
      aiWeeklyReport: aiReport,
      status: 'active',
      completionPercentage: weekTasks.length > 0
        ? Math.round((weekTasks.filter(t => t.isCompleted).length / weekTasks.length) * 100)
        : 0,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      synced: 0,
    };

    await db.weeklyPlans.put(plan);
    syncEngine.notifyLocalMutation();

    setSubmitting(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    loadWeekData();
  };

  const handleGenerateReport = async () => {
    setGeneratingReport(true);
    try {
      const activePlan = await db.weeklyPlans.get(weekInfo.weekId);
      if (!activePlan) {
        setValidationError('Please save your weekly plan before generating a progress report.');
        setGeneratingReport(false);
        return;
      }

      const res = await apiFetch('/api/ai/weekly-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weeklyPlan: activePlan,
          tasks: weekTasks,
          timeLogs: weekTimeLogs,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to generate report');
      }

      const data = await res.json();
      setAiReport(data.report);

      // Save report to DB
      await db.weeklyPlans.update(weekInfo.weekId, {
        aiWeeklyReport: data.report,
        updatedAt: Date.now(),
        synced: 0,
      });
      syncEngine.notifyLocalMutation();
    } catch (err: any) {
      setValidationError('Could not generate weekly report: ' + (err.message || 'Unknown error'));
      throw err;
    } finally {
      setGeneratingReport(false);
    }
  };

  // Completion metrics
  const completedTasksCount = weekTasks.filter(t => t.isCompleted).length;
  const completionPct = weekTasks.length > 0 ? Math.round((completedTasksCount / weekTasks.length) * 100) : 0;
  const totalMinutesLogged = weekTimeLogs.reduce((acc, l) => acc + (l.minutes || 0), 0);
  const totalHoursLogged = Math.round((totalMinutesLogged / 60) * 10) / 10;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── 1. Week Navigator Bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={() => shiftWeek(-1)}
          className="v-circle-btn"
          style={{ width: 38, height: 38, flexShrink: 0 }}
          aria-label="Previous week"
        >
          ‹
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div className="font-bloody" style={{ fontSize: isPhone ? 18 : 22, fontWeight: 700, letterSpacing: '0.04em' }}>
            WEEKLY PLAN
          </div>
          <div style={{ fontSize: 13, color: 'var(--accent-color)', fontWeight: 600, marginTop: 2 }}>
            {formatEthiopianDateRange(weekInfo.startDate, weekInfo.endDate)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{weekInfo.weekLabel} Gregorian</div>
        </div>
        <button
          type="button"
          onClick={() => shiftWeek(1)}
          className="v-circle-btn"
          style={{ width: 38, height: 38, flexShrink: 0 }}
          aria-label="Next week"
        >
          ›
        </button>
      </div>

      {/* ── 2. Parent Monthly Plan Banner (if present) ── */}
      {monthlyPlan && (
        <div
          className="v-card"
          style={{
            padding: '12px 18px',
            background: 'rgba(56, 189, 248, 0.08)',
            borderColor: 'rgba(56, 189, 248, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Target size={16} color="var(--accent-color)" />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Guided by Monthly Plan: <strong style={{ color: 'var(--text-primary)' }}>{monthlyPlan.title}</strong>
            </span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {monthlyPlan.academicPriorities ? `Academic focus: ${monthlyPlan.academicPriorities.slice(0, 30)}…` : ''}
          </span>
        </div>
      )}

      {/* ── 3. Weekly Execution Metrics Strip ── */}
      <div
        className="v-card"
        style={{
          padding: '14px 20px',
          display: 'grid',
          gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>SCHEDULED TASKS</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
            {weekTasks.length}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>COMPLETED</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#22c55e', marginTop: 2 }}>
            {completedTasksCount} <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>({completionPct}%)</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>FOCUS HOURS</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-color)', marginTop: 2 }}>
            {totalHoursLogged}h
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>STATUS</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: wordCount >= 100 ? '#22c55e' : '#f59e0b', marginTop: 4 }}>
            {wordCount >= 100 ? '✅ Plan Defined' : '⚠️ Prompt Incomplete'}
          </div>
        </div>
      </div>

      {/* ── 4. Detailed Weekly Planning Form ── */}
      <form onSubmit={event => { void withActionFeedback('Saving weekly plan', () => handleSaveWeeklyPlan(event), event.currentTarget); }}>
        <div className="v-card" style={{ padding: '24px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Header with live word counter */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CalendarRange size={18} color="var(--accent-color)" />
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                Detailed Planning Prompt (100+ Words Required)
              </span>
            </div>

            {/* Live Word Count Badge */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 12px',
                borderRadius: 9999,
                fontSize: 12,
                fontWeight: 700,
                border: `1.5px solid ${isWordCountValid ? '#22c55e' : '#f59e0b'}`,
                background: isWordCountValid ? 'rgba(34, 197, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                color: isWordCountValid ? '#22c55e' : '#f59e0b',
                transition: 'all 0.2s',
              }}
            >
              {isWordCountValid ? <Check size={13} /> : <Clock size={13} />}
              <span>
                {wordCount} / 100 words {wordsNeeded > 0 ? `(${wordsNeeded} needed)` : '✓ Ready'}
              </span>
            </div>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            This prompt is exclusively for defining weekly high-level outcomes and constraints. It acts as the primary guiding context for daily AI scheduling.
          </p>

          {/* Detailed Prompt Textarea */}
          <div>
            <textarea
              value={prompt}
              onChange={e => {
                setPrompt(e.target.value);
                if (validationError && countWords(e.target.value) >= 100) setValidationError('');
              }}
              rows={7}
              placeholder="Describe your week in detail:
• Main goals and expected outcomes for the week.
• AASTU classes, lab assignments, homework, and submission deadlines.
• Deep-work and video-editing targets (milestones, exports, render schedules).
• Important priorities, fixed constraints, energy levels.
• Total available focus time and non-negotiables before the week ends..."
              className="v-input font-system"
              style={{
                fontSize: 14,
                lineHeight: 1.6,
                padding: '14px',
                borderColor: !isWordCountValid && prompt.length > 0 ? 'rgba(245, 158, 11, 0.4)' : undefined,
              }}
            />
          </div>

          {/* Structured Category Breakdown Inputs */}
          <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : 'repeat(2, 1fr)', gap: 14 }}>
            {/* Main Goals */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Target size={13} color="#22c55e" /> Main Goals & High Priorities
              </label>
              <textarea
                value={goals}
                onChange={e => setGoals(e.target.value)}
                rows={4}
                placeholder="Top essential milestones and focus outcomes for this week..."
                className="v-input font-system"
                style={{ fontSize: 13, lineHeight: 1.5 }}
              />
            </div>

            {/* Constraints & Non-negotiables */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <ShieldAlert size={13} color="#f59e0b" /> Constraints & Expected Outcomes
              </label>
              <textarea
                value={outcomes}
                onChange={e => setOutcomes(e.target.value)}
                rows={4}
                placeholder="What MUST be accomplished before Sunday night? Hard constraints & deadlines..."
                className="v-input font-system"
                style={{ fontSize: 13, lineHeight: 1.5 }}
              />
            </div>
          </div>

          {/* Validation Error Banner */}
          {validationError && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: 12,
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13,
                color: '#ef4444',
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{validationError}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="submit"
              disabled={submitting || !isWordCountValid}
              className="v-pill-btn v-pill-btn-primary"
              style={{
                flex: 1,
                minHeight: 44,
                opacity: isWordCountValid ? 1 : 0.6,
                cursor: isWordCountValid ? 'pointer' : 'not-allowed',
              }}
            >
              {submitting ? (
                <>⏳ Saving Plan…</>
              ) : saved ? (
                <>✅ Weekly Plan Saved!</>
              ) : (
                <><Save size={15} /> Save Weekly Plan ({weekInfo.weekLabel})</>
              )}
            </button>

            <button
              type="button"
              onClick={event => { void withActionFeedback('Generating weekly report', handleGenerateReport, event.currentTarget); }}
              disabled={generatingReport || !prompt.trim()}
              className="v-pill-btn"
              style={{ minHeight: 44, padding: '0 18px', gap: 6 }}
              title="Generate AI Weekly Progress Report"
            >
              <Sparkles size={15} color="var(--accent-color)" />
              {generatingReport ? 'Analyzing Week…' : 'Generate Progress Report'}
            </button>
          </div>
        </div>
      </form>

      {/* ── 5. AI Weekly Progress Report Display ── */}
      {aiReport && (
        <div className="v-card" style={{ padding: '22px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Sparkles size={18} color="var(--accent-color)" />
            <span className="font-bloody" style={{ fontSize: 16, fontWeight: 700 }}>
              AI Weekly Progress Report
            </span>
          </div>
          <div
            className="font-system"
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {aiReport}
          </div>
        </div>
      )}

      {/* ── 6. Previous Weeks History ── */}
      {allWeeklyPlans.length > 0 && (
        <div className="v-card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <History size={16} color="var(--text-muted)" />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
              SAVED WEEKLY HISTORY
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {allWeeklyPlans.map(w => {
              const isSelected = w.id === weekInfo.weekId;
              return (
                <div
                  key={w.id}
                  onClick={() => setSelectedDate(w.startDate)}
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
                    <CalendarRange size={14} color={isSelected ? 'var(--accent-color)' : 'var(--text-muted)'} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {formatEthiopianDateRange(w.startDate, w.endDate)}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>({w.startDate} → {w.endDate} Gregorian)</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      ({w.wordCount} words)
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>
                    {w.completionPercentage !== undefined ? `${w.completionPercentage}% completed` : 'Saved'}
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
