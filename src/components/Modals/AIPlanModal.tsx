'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import {
  Sparkles, X, Check, Clock, AlertTriangle, ShieldCheck,
  Calendar, Layers, Star, ChevronRight, ArrowLeft, MessageSquare,
  HelpCircle, RefreshCw
} from 'lucide-react';
import type { Task, Section, WeeklyPlan, MonthlyPlan, ProposedTask, AIPlanGenerationResult } from '@/types';
import { apiFetch } from '@/lib/api/apiClient';

interface AIPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetDate: string;
  focusBudgetHours: number;
  onTasksScheduled: () => void;
}

interface AdaptiveQuestionItem {
  id: string;
  question: string;
  options: string[];
  defaultAnswer?: string;
  category?: string;
}

function formatTime12(t?: string): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function AIPlanModal({
  isOpen,
  onClose,
  targetDate,
  focusBudgetHours,
  onTasksScheduled,
}: AIPlanModalProps) {
  const [stage, setStage] = useState<'interview' | 'review'>('interview');
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [interviewSummary, setInterviewSummary] = useState('');
  const [questions, setQuestions] = useState<AdaptiveQuestionItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  
  const [generating, setGenerating] = useState(false);
  const [planResult, setPlanResult] = useState<AIPlanGenerationResult | null>(null);
  const [selectedTaskIndices, setSelectedTaskIndices] = useState<Set<number>>(new Set());
  const [sections, setSections] = useState<Section[]>([]);
  const [error, setError] = useState('');
  const [budgetInput, setBudgetInput] = useState(String(focusBudgetHours || 8));

  // Initialize and load context when modal opens
  useEffect(() => {
    if (isOpen) {
      db.sections.filter(s => !s.deleted).toArray().then(setSections);
      setBudgetInput(String(focusBudgetHours || 8));
      setStage('interview');
      setPlanResult(null);
      setError('');
      loadInterview();
    } else {
      setPlanResult(null);
      setError('');
      setStage('interview');
    }
  }, [isOpen, targetDate]);

  const loadInterview = async () => {
    setInterviewLoading(true);
    setError('');

    try {
      const targetMonthId = targetDate.slice(0, 7);
      const monthlyPlan = await db.monthlyPlans.get(targetMonthId);

      const allWeeks = await db.weeklyPlans.filter(w => !w.deleted).toArray();
      const weeklyPlan = allWeeks.find(w => targetDate >= w.startDate && targetDate <= w.endDate) || null;

      const [y, m, d] = targetDate.split('-').map(Number);
      const prevDateObj = new Date(Date.UTC(y, m - 1, d - 1));
      const prevDateStr = prevDateObj.toISOString().split('T')[0];

      const previousDayTasks = await db.tasks.filter(t => t.date === prevDateStr && !t.deleted).toArray();
      const existingDayTasks = await db.tasks.filter(t => t.date === targetDate && !t.deleted).toArray();
      const secs = await db.sections.filter(s => !s.deleted).toArray();

      const res = await apiFetch('/api/ai/plan-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDate,
          focusBudgetHours: parseFloat(budgetInput) || 8,
          monthlyPlan: monthlyPlan && !monthlyPlan.deleted ? monthlyPlan : null,
          weeklyPlan: weeklyPlan && !weeklyPlan.deleted ? weeklyPlan : null,
          previousDayTasks,
          existingDayTasks,
          sections: secs,
        }),
      });

      if (!res.ok) {
        throw new Error('Could not load smart planning interview.');
      }

      const data = await res.json();
      setInterviewSummary(data.summary || '');
      setQuestions(data.questions || []);

      // Pre-fill answers with defaults
      const initialAnswers: Record<string, string> = {};
      for (const q of data.questions || []) {
        initialAnswers[q.id] = q.defaultAnswer || (q.options && q.options[0]) || '';
      }
      setAnswers(initialAnswers);
    } catch (err: any) {
      console.warn('Smart interview load notice:', err);
      // Graceful local fallback questions
      const fallbackQuestions: AdaptiveQuestionItem[] = [
        {
          id: 'q_goal',
          question: 'What is your primary goal and biggest priority for today?',
          options: [
            'Deep work & academic study block',
            'Finish urgent assignments and video deliverables',
            'Balanced steady progress across all categories',
          ],
          defaultAnswer: 'Deep work & academic study block',
        },
        {
          id: 'q_hours',
          question: 'How many hours of focused deep work can you realistically spend today?',
          options: [
            `${budgetInput} hours (planned budget)`,
            '6 hours (moderate sprint)',
            '4 hours (light day)',
          ],
          defaultAnswer: `${budgetInput} hours (planned budget)`,
        },
        {
          id: 'q_obstacle',
          question: 'Are there any unexpected roadblocks or constraints today?',
          options: [
            'Clear day, full uninterrupted focus',
            'Need regular breaks / low energy',
            'Fixed meetings or classes today',
          ],
          defaultAnswer: 'Clear day, full uninterrupted focus',
        },
      ];
      setInterviewSummary(`Reviewed your connected planning context for ${targetDate}.`);
      setQuestions(fallbackQuestions);
      setAnswers({
        q_goal: fallbackQuestions[0].defaultAnswer!,
        q_hours: fallbackQuestions[1].defaultAnswer!,
        q_obstacle: fallbackQuestions[2].defaultAnswer!,
      });
    } finally {
      setInterviewLoading(false);
    }
  };

  const handleGenerate = async (useDefaultAnswers = false) => {
    setGenerating(true);
    setError('');

    try {
      const targetMonthId = targetDate.slice(0, 7);
      const monthlyPlan = await db.monthlyPlans.get(targetMonthId);

      const allWeeks = await db.weeklyPlans.filter(w => !w.deleted).toArray();
      const weeklyPlan = allWeeks.find(w => targetDate >= w.startDate && targetDate <= w.endDate) || null;

      const [y, m, d] = targetDate.split('-').map(Number);
      const prevDateObj = new Date(Date.UTC(y, m - 1, d - 1));
      const prevDateStr = prevDateObj.toISOString().split('T')[0];

      const previousDayTasks = await db.tasks.filter(t => t.date === prevDateStr && !t.deleted).toArray();
      const existingDayTasks = await db.tasks.filter(t => t.date === targetDate && !t.deleted).toArray();
      const secs = await db.sections.filter(s => !s.deleted).toArray();

      const interviewAnswersList = questions.map(q => ({
        question: q.question,
        answer: useDefaultAnswers ? (q.defaultAnswer || q.options[0] || '') : (answers[q.id] || q.defaultAnswer || ''),
      }));

      const res = await apiFetch('/api/ai/generate-day-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDate,
          focusBudgetHours: parseFloat(budgetInput) || 8,
          monthlyPlan: monthlyPlan && !monthlyPlan.deleted ? monthlyPlan : null,
          weeklyPlan: weeklyPlan && !weeklyPlan.deleted ? weeklyPlan : null,
          previousDayTasks,
          existingDayTasks,
          sections: secs,
          interviewAnswers: interviewAnswersList,
        }),
      });

      if (!res.ok) {
        throw new Error(`Generation failed: ${res.statusText}`);
      }

      const data: AIPlanGenerationResult = await res.json();
      setPlanResult(data);
      setSelectedTaskIndices(new Set(data.proposedTasks.map((_, idx) => idx)));
      setStage('review');
    } catch (err: any) {
      setError(err.message || 'Failed to generate schedule.');
    } finally {
      setGenerating(false);
    }
  };

  const toggleTaskSelection = (idx: number) => {
    setSelectedTaskIndices(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const handleApprove = async () => {
    if (!planResult) return;

    const approvedTasks = planResult.proposedTasks.filter((_, idx) => selectedTaskIndices.has(idx));
    if (approvedTasks.length === 0) {
      setError('Please select at least one task to schedule.');
      return;
    }

    const now = Date.now();
    const newTasks: Task[] = approvedTasks.map((pt, idx) => ({
      id: crypto.randomUUID(),
      date: targetDate,
      sectionId: pt.sectionId || sections[0]?.id || 'default-sec-1',
      title: pt.title,
      description: pt.description || '',
      strategy: pt.strategy || '',
      doneMeans: '',
      estimatedMinutes: pt.scheduledMinutes,
      priority: pt.priority || 'Medium',
      mustDo: pt.mustDo || false,
      tags: [],
      icon: '🎯',
      isCompleted: false,
      completedAt: null,
      order: idx,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      isSample: false,
      synced: 0,
      startTime: pt.startTime,
      endTime: pt.endTime,
      scheduledMinutes: pt.scheduledMinutes,
      status: 'not_started',
    }));

    await db.tasks.bulkPut(newTasks);
    syncEngine.notifyLocalMutation();

    onTasksScheduled();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="v-card"
        style={{
          width: '100%',
          maxWidth: 680,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
        }}
      >
        {/* ── Modal Header ── */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1.5px solid var(--v-glass-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'var(--accent-glow)',
                border: '1.5px solid var(--accent-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Sparkles size={18} color="var(--accent-color)" />
            </div>
            <div>
              <div className="font-bloody" style={{ fontSize: 17, fontWeight: 700 }}>
                {stage === 'interview' ? 'AI Smart Planning Interview' : 'AI Proposed Daily Schedule'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Target Date: <strong style={{ color: 'var(--text-primary)' }}>{targetDate}</strong> · Connected to Monthly & Weekly Goals
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Step Indicator Badges */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                borderRadius: 20,
                background: 'var(--v-glass-bg-subtle)',
                border: '1px solid var(--v-glass-border-subtle)',
                fontSize: 11,
              }}
            >
              <span style={{ color: stage === 'interview' ? 'var(--accent-color)' : 'var(--text-muted)', fontWeight: 600 }}>
                1. Interview
              </span>
              <span style={{ color: 'var(--text-muted)' }}>→</span>
              <span style={{ color: stage === 'review' ? 'var(--accent-color)' : 'var(--text-muted)', fontWeight: 600 }}>
                2. Review & Confirm
              </span>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="v-circle-btn"
              style={{ width: 32, height: 32 }}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── Scrollable Body ── */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Loading Indicator for Generation */}
          {generating && (
            <div style={{ padding: '48px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  border: '3px solid var(--v-glass-border)',
                  borderTopColor: 'var(--accent-color)',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                Synthesizing Your Goals & Hierarchy Commitments…
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 440 }}>
                Applying your interview answers to balance AASTU coursework, video editing deliverables, and focus budget buffers.
              </div>
            </div>
          )}

          {/* Loading Indicator for Interview Preparation */}
          {interviewLoading && !generating && (
            <div style={{ padding: '36px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  border: '2.5px solid var(--v-glass-border)',
                  borderTopColor: 'var(--accent-color)',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Reviewing monthly goals, weekly commitments, and yesterday&apos;s results…
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && !generating && (
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
              <AlertTriangle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* STAGE 1: SMART PLANNING INTERVIEW                               */}
          {/* ════════════════════════════════════════════════════════════════ */}
          {stage === 'interview' && !generating && !interviewLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Context Summary Briefing */}
              {interviewSummary && (
                <div
                  className="v-card"
                  style={{
                    padding: '12px 16px',
                    background: 'rgba(56, 189, 248, 0.06)',
                    borderColor: 'rgba(56, 189, 248, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <MessageSquare size={16} color="var(--accent-color)" style={{ flexShrink: 0 }} />
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {interviewSummary}
                  </div>
                </div>
              )}

              {/* Questions List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                  ADAPTIVE PLANNING QUESTIONS ({questions.length})
                </div>

                {questions.map((q, idx) => {
                  const currentAnswer = answers[q.id] || '';

                  return (
                    <div
                      key={q.id}
                      className="v-card"
                      style={{
                        padding: '14px 16px',
                        background: 'var(--v-glass-bg-subtle)',
                        border: '1px solid var(--v-glass-border-subtle)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <span
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            background: 'var(--accent-glow)',
                            color: 'var(--accent-color)',
                            fontSize: 11,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            marginTop: 1,
                          }}
                        >
                          {idx + 1}
                        </span>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                          {q.question}
                        </span>
                      </div>

                      {/* Suggested Options Chips */}
                      {q.options && q.options.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginLeft: 28 }}>
                          {q.options.map((opt, optIdx) => {
                            const isSelected = currentAnswer === opt;
                            return (
                              <button
                                key={optIdx}
                                type="button"
                                onClick={() => setAnswers(prev => ({ ...prev, [q.id]: opt }))}
                                className="v-pill-btn"
                                style={{
                                  padding: '4px 10px',
                                  fontSize: 11.5,
                                  background: isSelected ? 'var(--accent-glow)' : 'transparent',
                                  borderColor: isSelected ? 'var(--accent-color)' : 'var(--v-glass-border-subtle)',
                                  color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                                  fontWeight: isSelected ? 600 : 400,
                                }}
                              >
                                {isSelected && <Check size={11} color="var(--accent-color)" />}
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Custom Answer Input */}
                      <div style={{ marginLeft: 28 }}>
                        <input
                          type="text"
                          value={currentAnswer}
                          onChange={e => {
                            const val = e.target.value;
                            setAnswers(prev => ({ ...prev, [q.id]: val }));
                          }}
                          placeholder="Type or customize your response..."
                          className="v-input font-system"
                          style={{ fontSize: 12.5, padding: '7px 12px', width: '100%' }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Focus Budget Setting */}
              <div
                className="v-card"
                style={{
                  padding: '12px 16px',
                  background: 'var(--v-glass-bg-subtle)',
                  border: '1px solid var(--v-glass-border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    Daily Focus Budget (Hours)
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Total available deep-work and study time for today
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="number"
                    min="1"
                    max="16"
                    step="0.5"
                    value={budgetInput}
                    onChange={e => setBudgetInput(e.target.value)}
                    className="v-input font-system"
                    style={{ width: 70, textAlign: 'center', padding: '6px 10px', fontSize: 13 }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>hrs</span>
                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* STAGE 2: REVIEW & CONFIRM PROPOSED SCHEDULE                    */}
          {/* ════════════════════════════════════════════════════════════════ */}
          {stage === 'review' && planResult && !generating && (
            <>
              {/* Provider Badge Strip */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 14px',
                  borderRadius: 12,
                  background: 'var(--v-glass-bg-subtle)',
                  border: '1px solid var(--v-glass-border-subtle)',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldCheck size={13} color="#22c55e" />
                  <span>Provider: <strong style={{ color: 'var(--text-primary)' }}>{planResult.provider}</strong></span>
                  <span>· {planResult.model}</span>
                </div>
                <div>
                  {planResult.tokensUsed?.total && <span>{planResult.tokensUsed.total} tokens · </span>}
                  <span>{planResult.latencyMs}ms</span>
                </div>
              </div>

              {/* Rationale */}
              <div
                className="v-card"
                style={{
                  padding: '14px 16px',
                  background: 'rgba(56, 189, 248, 0.05)',
                  borderColor: 'rgba(56, 189, 248, 0.25)',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-color)', letterSpacing: '0.04em', marginBottom: 4 }}>
                  STRATEGIC RATIONALE & INTERVIEW SYNTHESIS
                </div>
                <div className="font-system" style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {planResult.rationale}
                </div>
              </div>

              {/* Conflict Warnings if any */}
              {planResult.conflicts && planResult.conflicts.length > 0 && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={12} /> POTENTIAL CONFLICTS RESOLVED
                  </div>
                  {planResult.conflicts.map((c, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      • {c}
                    </div>
                  ))}
                </div>
              )}

              {/* Proposed Tasks Checklist */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                    PROPOSED TASKS ({selectedTaskIndices.size} / {planResult.proposedTasks.length} SELECTED)
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Toggle tasks to include or exclude
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {planResult.proposedTasks.map((task, idx) => {
                    const isSelected = selectedTaskIndices.has(idx);
                    const sec = sections.find(s => s.id === task.sectionId);

                    return (
                      <div
                        key={idx}
                        onClick={() => toggleTaskSelection(idx)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '12px 14px',
                          borderRadius: 12,
                          background: isSelected ? 'var(--v-glass-bg-subtle)' : 'transparent',
                          border: `1.5px solid ${isSelected ? 'var(--accent-color)' : 'var(--v-glass-border-subtle)'}`,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          opacity: isSelected ? 1 : 0.6,
                        }}
                      >
                        {/* Checkbox */}
                        <div
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            border: `2px solid ${isSelected ? 'var(--accent-color)' : 'var(--v-glass-border)'}`,
                            background: isSelected ? 'var(--accent-color)' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {isSelected && <Check size={13} color="#0d0d11" strokeWidth={3} />}
                        </div>

                        {/* Color pip */}
                        <div
                          style={{
                            width: 3,
                            height: 32,
                            borderRadius: 2,
                            background: sec?.color || 'var(--accent-color)',
                            flexShrink: 0,
                          }}
                        />

                        {/* Title & Details */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                              {task.title}
                            </span>
                            {task.mustDo && <span title="Top Priority Must-Do">⭐</span>}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            <span style={{ color: 'var(--accent-color)', fontWeight: 600 }}>
                              {formatTime12(task.startTime)} → {formatTime12(task.endTime)}
                            </span>
                            <span> · {task.scheduledMinutes}m</span>
                            {sec && <span> · {sec.name}</span>}
                          </div>
                        </div>

                        <span
                          className="v-status-badge"
                          style={{
                            color: task.priority === 'High' ? '#ef4444' : task.priority === 'Low' ? '#22c55e' : '#f59e0b',
                            borderColor: 'transparent',
                            background: 'var(--v-glass-bg-subtle)',
                          }}
                        >
                          {task.priority}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Modal Footer ── */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1.5px solid var(--v-glass-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          {stage === 'interview' ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="v-pill-btn"
                style={{ padding: '8px 18px' }}
              >
                Cancel
              </button>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => handleGenerate(true)}
                  disabled={generating || interviewLoading}
                  className="v-pill-btn"
                  style={{ padding: '8px 16px', gap: 6 }}
                  title="Generate plan immediately using default recommended choices"
                >
                  ⚡ Quick Plan (Defaults)
                </button>

                <button
                  type="button"
                  onClick={() => handleGenerate(false)}
                  disabled={generating || interviewLoading}
                  className="v-pill-btn v-pill-btn-primary"
                  style={{ padding: '8px 22px', gap: 6 }}
                >
                  <Sparkles size={15} /> Generate Goal-Aligned Plan
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setStage('interview')}
                className="v-pill-btn"
                style={{ padding: '8px 16px', gap: 6 }}
              >
                <ArrowLeft size={14} /> Adjust Answers
              </button>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => handleGenerate(false)}
                  disabled={generating}
                  className="v-pill-btn"
                  style={{ padding: '8px 16px', gap: 6 }}
                >
                  <RefreshCw size={14} color="var(--accent-color)" /> Re-generate
                </button>

                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={generating || !planResult || selectedTaskIndices.size === 0}
                  className="v-pill-btn v-pill-btn-primary"
                  style={{ padding: '8px 22px', gap: 6 }}
                >
                  <Check size={15} /> Approve & Apply ({selectedTaskIndices.size} Tasks)
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
