'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import {
  Sparkles, X, Check, Clock, AlertTriangle, ShieldCheck,
  Calendar, Layers, Star, ExternalLink, ChevronRight, Edit2
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
  const [loading, setLoading] = useState(false);
  const [planResult, setPlanResult] = useState<AIPlanGenerationResult | null>(null);
  const [selectedTaskIndices, setSelectedTaskIndices] = useState<Set<number>>(new Set());
  const [sections, setSections] = useState<Section[]>([]);
  const [error, setError] = useState('');
  const [budgetInput, setBudgetInput] = useState(String(focusBudgetHours || 8));

  // Load sections on open
  useEffect(() => {
    if (isOpen) {
      db.sections.filter(s => !s.deleted).toArray().then(setSections);
      setBudgetInput(String(focusBudgetHours || 8));
      handleGenerate();
    } else {
      setPlanResult(null);
      setError('');
    }
  }, [isOpen, targetDate]);

  const handleGenerate = async () => {
    setLoading(true);
    setError('');

    try {
      // 1. Gather connected hierarchy context from Dexie
      const targetMonthId = targetDate.slice(0, 7);
      const monthlyPlan = await db.monthlyPlans.get(targetMonthId);

      // Find week for targetDate
      const allWeeks = await db.weeklyPlans.filter(w => !w.deleted).toArray();
      const weeklyPlan = allWeeks.find(w => targetDate >= w.startDate && targetDate <= w.endDate) || null;

      // Previous date
      const [y, m, d] = targetDate.split('-').map(Number);
      const prevDateObj = new Date(Date.UTC(y, m - 1, d - 1));
      const prevDateStr = prevDateObj.toISOString().split('T')[0];

      const previousDayTasks = await db.tasks.filter(t => t.date === prevDateStr && !t.deleted).toArray();
      const existingDayTasks = await db.tasks.filter(t => t.date === targetDate && !t.deleted).toArray();
      const secs = await db.sections.filter(s => !s.deleted).toArray();

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
        }),
      });

      if (!res.ok) {
        throw new Error(`Generation failed: ${res.statusText}`);
      }

      const data: AIPlanGenerationResult = await res.json();
      setPlanResult(data);

      // Default all proposed tasks to selected
      setSelectedTaskIndices(new Set(data.proposedTasks.map((_, idx) => idx)));
    } catch (err: any) {
      setError(err.message || 'Failed to generate schedule.');
    } finally {
      setLoading(false);
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
          maxWidth: 640,
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
                width: 34,
                height: 34,
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
                AI Connected Schedule Generator
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Planning for <strong style={{ color: 'var(--text-primary)' }}>{targetDate}</strong> · Connected to Monthly & Weekly Goals
              </div>
            </div>
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

        {/* ── Scrollable Body ── */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Loading Indicator */}
          {loading && (
            <div style={{ padding: '40px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  border: '3px solid var(--v-glass-border)',
                  borderTopColor: 'var(--accent-color)',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                Synthesizing Monthly & Weekly Commitments…
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Balancing AASTU coursework, video editing targets, and your daily focus budget
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && !loading && (
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

          {/* AI Result Content */}
          {planResult && !loading && (
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
                  STRATEGIC RATIONALE
                </div>
                <div className="font-system" style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {planResult.rationale}
                </div>
              </div>

              {/* Conflict Warnings if any */}
              {planResult.conflicts.length > 0 && (
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
              onClick={handleGenerate}
              disabled={loading}
              className="v-pill-btn"
              style={{ padding: '8px 16px', gap: 6 }}
            >
              <Sparkles size={14} color="var(--accent-color)" /> Re-generate
            </button>

            <button
              type="button"
              onClick={handleApprove}
              disabled={loading || !planResult || selectedTaskIndices.size === 0}
              className="v-pill-btn v-pill-btn-primary"
              style={{ padding: '8px 22px', gap: 6 }}
            >
              <Check size={15} /> Approve & Apply ({selectedTaskIndices.size} Tasks)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
