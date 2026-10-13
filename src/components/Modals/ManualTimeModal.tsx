'use client';

import React, { useState } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { withActionFeedback } from '@/lib/utils/actionFeedback';
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
      aria-labelledby="manual-time-title"
    >
      <div
        className="g-card"
        style={{
          width: '100%',
          maxWidth: 380,
          padding: 24,
          position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          className="g-icon-btn"
          style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30 }}
          aria-label="Close manual time dialog"
        >
          <X size={14} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'rgba(139,92,246,0.15)',
              border: '1px solid rgba(139,92,246,0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Clock size={16} style={{ color: 'rgba(139,92,246,0.9)' }} />
          </div>
          <div>
            <h2 id="manual-time-title" className="font-bloody" style={{ fontSize: 18, margin: 0, color: 'rgba(255,255,255,0.9)' }}>
              Log Time Manually
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.4)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {taskTitle}
            </p>
          </div>
        </div>

        {/* Quick Add Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, margin: '16px 0' }}>
          {[15, 30, 45, 60, 90, 120].map(m => (
            <button
              key={m}
              onClick={event => { void withActionFeedback('Logging time', () => handleAdd(m), event.currentTarget); }}
              className="g-btn"
              style={{ padding: '8px 0', textAlign: 'center', fontSize: 12, fontWeight: 600 }}
            >
              +{m >= 60 ? `${m / 60}h` : `${m}m`}
            </button>
          ))}
        </div>

        {/* Custom Input */}
        <div style={{ paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <label htmlFor="custom-minutes" className="g-label">
            Or exact minutes:
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="custom-minutes"
              type="number"
              min="1"
              max="1440"
              value={minutes}
              onChange={e => setMinutes(Math.max(1, parseInt(e.target.value) || 0))}
              className="g-input"
              style={{ flex: 1 }}
            />
            <button
              onClick={event => { void withActionFeedback('Logging time', () => handleAdd(minutes), event.currentTarget); }}
              className="g-btn g-btn-primary"
              style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}
            >
              <Plus size={14} />
              <span>Add</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
