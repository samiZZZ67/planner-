'use client';

import React, { useState } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { X, Clock, Plus } from 'lucide-react';
import type { TimeLog } from '@/types';

interface ManualTimeModalProps {
  taskId: string | null;
  taskTitle: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ManualTimeModal({ taskId, taskTitle, isOpen, onClose }: ManualTimeModalProps) {
  const [minutes, setMinutes] = useState<number>(30);

  if (!isOpen || !taskId) return null;

  const handleAdd = async (addMinutes: number) => {
    if (addMinutes <= 0) return;

    const todayDate = new Date().toISOString().split('T')[0];
    const log: TimeLog = {
      id: crypto.randomUUID(),
      taskId,
      date: todayDate,
      minutes: addMinutes,
      source: 'manual',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      isSample: false,
      synced: 0,
    };

    await db.timeLogs.put(log);
    syncEngine.notifyLocalMutation();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-time-title"
    >
      <div className="w-full max-w-sm bg-bg-card border border-border-color rounded-2xl p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-text-muted hover:text-text-primary rounded-lg"
          aria-label="Close manual time dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-3 text-text-primary">
          <Clock className="w-5 h-5 text-accent-primary" />
          <h2 id="manual-time-title" className="text-lg font-bold">
            Log Time Manually
          </h2>
        </div>

        <p className="text-xs text-text-muted mb-4 truncate">
          Task: <span className="font-semibold text-text-secondary">{taskTitle}</span>
        </p>

        {/* Quick Add Buttons */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[15, 30, 45, 60, 90, 120].map(m => (
            <button
              key={m}
              onClick={() => handleAdd(m)}
              className="py-2 rounded-xl bg-bg-secondary border border-border-color text-text-secondary hover:text-white hover:bg-accent-primary hover:border-accent-primary transition-all text-xs font-semibold"
            >
              +{m >= 60 ? `${m / 60}h` : `${m}m`}
            </button>
          ))}
        </div>

        {/* Custom Input */}
        <div className="space-y-3 pt-2 border-t border-border-color">
          <label htmlFor="custom-minutes" className="block text-xs font-medium text-text-muted">
            Or enter exact minutes:
          </label>
          <div className="flex gap-2">
            <input
              id="custom-minutes"
              type="number"
              min="1"
              max="1440"
              value={minutes}
              onChange={e => setMinutes(Math.max(1, parseInt(e.target.value) || 0))}
              className="flex-1 px-3.5 py-2 rounded-xl bg-bg-secondary border border-border-color text-text-primary text-sm focus:outline-none focus:border-accent-primary"
            />
            <button
              onClick={() => handleAdd(minutes)}
              className="px-4 py-2 bg-accent-primary hover:bg-accent-hover text-white rounded-xl text-xs font-medium flex items-center gap-1.5 shadow-md shadow-purple-900/30"
            >
              <Plus className="w-4 h-4" />
              <span>Add</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
