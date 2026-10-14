'use client';

import React, { useState } from 'react';
import { copyTasksToDate } from '@/lib/plan/autoPlan';
import { Sparkles, X, ArrowRight, Star, CheckSquare } from 'lucide-react';
import type { Task, Section } from '@/types';

interface AutoPlanReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetDate: string;
  previousDate: string;
  candidateTasks: Task[];
  sections: Section[];
  onTasksImported: () => void;
}

export function AutoPlanReviewModal({
  isOpen,
  onClose,
  targetDate,
  previousDate,
  candidateTasks,
  sections,
  onTasksImported,
}: AutoPlanReviewModalProps) {
  const [isImporting, setIsImporting] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => {
    return new Set(candidateTasks.map(t => t.id));
  });

  if (!isOpen) return null;

  const toggleTask = (id: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (isImporting) return;
    const tasksToCopy = candidateTasks.filter(t => selectedTaskIds.has(t.id));
    if (tasksToCopy.length > 0) {
      setIsImporting(true);
      try {
        await copyTasksToDate(tasksToCopy, targetDate);
        onTasksImported();
      } finally {
        setIsImporting(false);
      }
    }
    onClose();
  };

  const getSection = (sectionId: string) => sections.find(s => s.id === sectionId);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="autoplan-title"
    >
      <div
        className="g-card"
        style={{
          width: '100%',
          maxWidth: 520,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 24,
          position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          className="g-icon-btn"
          style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30 }}
          aria-label="Close dialog"
        >
          <X size={14} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              background: 'rgba(234,179,8,0.12)',
              border: '1px solid rgba(234,179,8,0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Sparkles size={18} style={{ color: 'rgba(234,179,8,0.9)' }} />
          </div>
          <div>
            <h2 id="autoplan-title" className="font-bloody" style={{ fontSize: 20, margin: 0, color: 'rgba(255,255,255,0.9)' }}>
              Auto-Plan from Yesterday
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
              <span>{previousDate}</span>
              <ArrowRight size={11} style={{ color: 'rgba(139,92,246,0.8)' }} />
              <span style={{ color: 'rgba(139,92,246,0.9)', fontWeight: 600 }}>{targetDate}</span>
            </div>
          </div>
        </div>

        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
          Select tasks from yesterday to roll over into your plan for <b>{targetDate}</b>. You can adjust times, edit strategies, and refine each task.
        </p>

        {/* Task List */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0', paddingRight: 4 }}>
          {candidateTasks.length === 0 ? (
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: '24px 0' }}>
              No tasks found from yesterday ({previousDate}).
            </p>
          ) : (
            candidateTasks.map(task => {
              const sec = getSection(task.sectionId);
              const isChecked = selectedTaskIds.has(task.id);
              return (
                <div
                  key={task.id}
                  onClick={() => toggleTask(task.id)}
                  className="g-task-row"
                  style={{
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    cursor: 'pointer',
                    background: isChecked ? 'rgba(139,92,246,0.08)' : 'var(--glass-bg)',
                    borderColor: isChecked ? 'rgba(139,92,246,0.35)' : 'rgba(255,255,255,0.06)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}}
                    style={{ marginTop: 2, cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.88)' }}>
                      <span>{task.icon || sec?.icon || '📌'}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
                      {task.mustDo && <Star size={11} style={{ fill: '#eab308', color: '#eab308', flexShrink: 0 }} />}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                      <span style={{ color: sec?.color || '#a855f7' }}>{sec?.name || 'Section'}</span>
                      <span>{task.estimatedMinutes}m est</span>
                      <span>{task.priority} Priority</span>
                      {task.isCompleted ? (
                        <span style={{ color: 'rgba(34,197,94,0.8)' }}>(Completed)</span>
                      ) : (
                        <span style={{ color: 'rgba(234,179,8,0.8)' }}>(Unfinished)</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 8 }}>
          <button
            type="button"
            onClick={() => {
              if (selectedTaskIds.size === candidateTasks.length) {
                setSelectedTaskIds(new Set());
              } else {
                setSelectedTaskIds(new Set(candidateTasks.map(t => t.id)));
              }
            }}
            style={{ background: 'none', border: 'none', fontSize: 12, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 0 }}
          >
            {selectedTaskIds.size === candidateTasks.length ? 'Deselect All' : 'Select All'}
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} className="g-btn" style={{ padding: '7px 14px', fontSize: 12 }}>
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedTaskIds.size === 0 || isImporting}
              className="g-btn g-btn-primary"
              style={{
                padding: '7px 16px',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                opacity: (selectedTaskIds.size === 0 || isImporting) ? 0.45 : 1,
                cursor: isImporting ? 'wait' : selectedTaskIds.size === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              <CheckSquare size={13} />
              <span>{isImporting ? 'Importing…' : `Import ${selectedTaskIds.size} Tasks`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
