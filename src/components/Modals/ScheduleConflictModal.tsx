'use client';

import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Sparkles, X, ArrowRight, ShieldCheck } from 'lucide-react';
import type { Task } from '@/types';
import {
  detectScheduleConflicts,
  autoResolveScheduleConflicts,
  ScheduleConflictAnalysis,
  AutoResolveResult,
} from '@/lib/plan/scheduleConflict';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';

interface ScheduleConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  freeHours?: number;
  onApplied?: (updatedTasks: Task[]) => void;
}

export function ScheduleConflictModal({
  isOpen,
  onClose,
  tasks,
  freeHours = 8,
  onApplied,
}: ScheduleConflictModalProps) {
  const [isApplying, setIsApplying] = useState(false);
  const [appliedSuccess, setAppliedSuccess] = useState(false);

  if (!isOpen) return null;

  const analysis: ScheduleConflictAnalysis = detectScheduleConflicts(tasks, freeHours);
  const resolveResult: AutoResolveResult = autoResolveScheduleConflicts(tasks, freeHours);

  const handleApplyResolution = async () => {
    setIsApplying(true);
    try {
      for (const t of resolveResult.updatedTasks) {
        await db.tasks.put({ ...t, synced: 0 });
      }
      syncEngine.notifyLocalMutation();
      setAppliedSuccess(true);
      if (onApplied) onApplied(resolveResult.updatedTasks);
      setTimeout(() => {
        setIsApplying(false);
        setAppliedSuccess(false);
        onClose();
      }, 1200);
    } catch (err) {
      console.error('Failed to apply schedule resolution:', err);
      setIsApplying(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 95,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 580,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 20,
          background: 'rgba(20, 20, 30, 0.95)',
          border: '1.5px solid rgba(245, 158, 11, 0.4)',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.8), 0 0 30px rgba(245, 158, 11, 0.2)',
          color: '#ffffff',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(245, 158, 11, 0.1)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: 'rgba(245, 158, 11, 0.2)',
                border: '1px solid #fbbf24',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fbbf24',
              }}
            >
              <AlertTriangle size={18} />
            </div>
            <div>
              <h2
                id="conflict-modal-title"
                style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#fef08a' }}
              >
                Schedule Conflict & Overlap Resolver
              </h2>
              <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.6)', marginTop: 2 }}>
                {analysis.timeCollisions.length} time collision(s) · Focus budget: {freeHours}h
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="v-circle-btn"
            style={{ width: 30, height: 30 }}
            aria-label="Close dialog"
          >
            <X size={15} />
          </button>
        </div>

        {/* Content Body */}
        <div
          style={{
            padding: '16px 20px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Status Banners */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {analysis.timeCollisions.length > 0 && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  fontSize: 12,
                  color: '#fca5a5',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={14} style={{ color: '#ef4444' }} />
                  <span>Time Collisions Detected:</span>
                </div>
                {analysis.timeCollisions.map((c, i) => (
                  <div key={i} style={{ paddingLeft: 20, fontSize: 11.5, color: '#fee2e2' }}>
                    • <strong>{c.taskTitleA}</strong> overlaps with <strong>{c.taskTitleB}</strong> by {c.overlapMinutes} mins ({c.timeWindow})
                  </div>
                ))}
              </div>
            )}

            {analysis.isOverBudget && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: 'rgba(245, 158, 11, 0.15)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  fontSize: 12,
                  color: '#fef08a',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Clock size={15} style={{ color: '#facc15', flexShrink: 0 }} />
                <span>
                  Planned tasks (<strong>{Math.round((analysis.totalPlannedMinutes / 60) * 10) / 10}h</strong>) exceed your daily budget (<strong>{freeHours}h</strong>) by {Math.round(analysis.budgetOverflowMinutes / 6) / 10}h.
                </span>
              </div>
            )}
          </div>

          {/* Proposed Auto-Resolution Preview */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#38bdf8' }}>
              <Sparkles size={14} />
              <span>Intelligent Sequential Schedule:</span>
            </div>

            <div
              style={{
                borderRadius: 12,
                border: '1px solid rgba(255, 255, 255, 0.12)',
                background: 'rgba(0, 0, 0, 0.35)',
                padding: '8px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                maxHeight: 220,
                overflowY: 'auto',
              }}
            >
              {resolveResult.changes.length === 0 ? (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: '12px 0' }}>
                  No schedule shifts needed. All tasks are sequentially aligned.
                </div>
              ) : (
                resolveResult.changes.map(ch => (
                  <div
                    key={ch.taskId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      borderRadius: 8,
                      background: 'rgba(255, 255, 255, 0.04)',
                      fontSize: 11.5,
                      gap: 8,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                      {ch.title}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, fontFamily: 'monospace', fontSize: 11 }}>
                      <span style={{ color: 'rgba(255, 255, 255, 0.4)', textDecoration: ch.oldStartTime ? 'line-through' : 'none' }}>
                        {ch.oldStartTime ? `${ch.oldStartTime}–${ch.oldEndTime}` : 'Unscheduled'}
                      </span>
                      <ArrowRight size={11} style={{ color: '#38bdf8' }} />
                      <span style={{ color: '#4ade80', fontWeight: 700 }}>
                        {ch.newStartTime}–{ch.newEndTime} ({ch.durationMinutes}m)
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
            background: 'rgba(0, 0, 0, 0.25)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="v-pill-btn"
            style={{ padding: '6px 14px', fontSize: 12 }}
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={isApplying || appliedSuccess}
            onClick={handleApplyResolution}
            className="v-pill-btn v-pill-btn-primary"
            style={{
              padding: '6px 18px',
              fontSize: 12,
              fontWeight: 700,
              gap: 6,
              background: appliedSuccess ? '#22c55e' : 'linear-gradient(135deg, #f59e0b, #d97706)',
              borderColor: appliedSuccess ? '#22c55e' : '#f59e0b',
            }}
          >
            {appliedSuccess ? (
              <>
                <CheckCircle2 size={14} />
                <span>Schedule Conflicts Cleared!</span>
              </>
            ) : isApplying ? (
              <span>Applying Schedule Updates...</span>
            ) : (
              <>
                <Sparkles size={14} />
                <span>Apply & Auto-Resolve All Conflicts</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
