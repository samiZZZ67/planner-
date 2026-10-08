'use client';

import React, { useState } from 'react';
import { copyTasksToDate } from '@/lib/plan/autoPlan';
import { Calendar, CheckSquare, Sparkles, X, ArrowRight, Star } from 'lucide-react';
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
  // Pre-select unfinished tasks
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
    const tasksToCopy = candidateTasks.filter(t => selectedTaskIds.has(t.id));
    if (tasksToCopy.length > 0) {
      await copyTasksToDate(tasksToCopy, targetDate);
      onTasksImported();
    }
    onClose();
  };

  const getSection = (sectionId: string) => sections.find(s => s.id === sectionId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="autoplan-title"
    >
      <div className="w-full max-w-lg bg-bg-card border border-border-color rounded-2xl shadow-2xl p-6 relative max-h-[90vh] flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-text-muted hover:text-text-primary rounded-lg transition-colors"
          aria-label="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-amber-950/70 border border-amber-700/60 flex items-center justify-center text-amber-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 id="autoplan-title" className="font-bloody text-xl font-bold text-text-primary">
              Auto-Plan from Yesterday
            </h2>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span>{previousDate}</span>
              <ArrowRight className="w-3 h-3 text-accent-primary" />
              <span className="text-accent-primary font-medium">{targetDate}</span>
            </div>
          </div>
        </div>

        <p className="text-xs text-text-secondary mb-4 leading-relaxed">
          Select tasks from yesterday to roll over into your plan for <b>{targetDate}</b>. You will be able to review, adjust times, edit strategies, and refine each task.
        </p>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 my-2">
          {candidateTasks.length === 0 ? (
            <p className="text-xs text-text-muted text-center py-6">
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
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                    isChecked
                      ? 'bg-purple-950/30 border-purple-800/80 text-text-primary'
                      : 'bg-bg-secondary border-border-color text-text-muted opacity-75'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}} // handled by div
                    className="mt-0.5 rounded border-border-color text-accent-primary focus:ring-accent-primary w-4 h-4 cursor-pointer"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{task.icon || sec?.icon || '📌'}</span>
                      <span className="font-medium text-sm truncate">{task.title}</span>
                      {task.mustDo && (
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 shrink-0" />
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-[11px] text-text-muted">
                      <span style={{ color: sec?.color || '#a855f7' }}>
                        {sec?.name || 'Section'}
                      </span>
                      <span>{task.estimatedMinutes}m est</span>
                      <span className="capitalize">{task.priority} Priority</span>
                      {task.isCompleted ? (
                        <span className="text-emerald-400">(Completed yesterday)</span>
                      ) : (
                        <span className="text-amber-400 font-medium">(Unfinished)</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-4 border-t border-border-color mt-2">
          <button
            type="button"
            onClick={() => {
              if (selectedTaskIds.size === candidateTasks.length) {
                setSelectedTaskIds(new Set());
              } else {
                setSelectedTaskIds(new Set(candidateTasks.map(t => t.id)));
              }
            }}
            className="text-xs text-text-muted hover:text-text-primary"
          >
            {selectedTaskIds.size === candidateTasks.length ? 'Deselect All' : 'Select All'}
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-2 text-xs rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedTaskIds.size === 0}
              className="px-4 py-2 text-xs rounded-xl bg-accent-primary hover:bg-accent-hover text-white font-medium disabled:opacity-40 transition-colors flex items-center gap-1.5 shadow-md shadow-purple-900/30"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>Import {selectedTaskIds.size} Tasks to Review</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
