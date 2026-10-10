'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import {
  StickyNote, Sparkles, Clock, Save, Check
} from 'lucide-react';
import type { DayReview } from '@/types';
import { VisualRichEditor } from './VisualRichEditor';

interface NoteScreenProps {
  currentDate: string;
  onChangeDate: (date: string) => void;
  isPhone: boolean;
}

export function NoteScreen({ currentDate, onChangeDate, isPhone }: NoteScreenProps) {
  const [quickNote, setQuickNote] = useState('');
  const [activeTab, setActiveTab] = useState<'quick' | 'reflection'>('quick');
  const [review, setReview] = useState<DayReview>({
    worked: '',
    blocked: '',
    change: '',
    obstacles: '',
    happened: '',
    solved: '',
    betterTomorrow: '',
  });

  const [saved, setSaved] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Subscribe to sync countdown
  useEffect(() => {
    const unsub = syncEngine.subscribe(state => {
      setCountdown(state.secondsUntilSync ?? null);
    });
    return () => unsub();
  }, []);

  // Load day note and reflection data
  const loadData = async () => {
    const day = await db.days.get(currentDate);
    if (day) {
      setQuickNote(day.sheetData?.notes || '');
      setReview({
        worked: day.review?.worked || '',
        blocked: day.review?.blocked || '',
        change: day.review?.change || '',
        obstacles: day.review?.obstacles || '',
        happened: day.review?.happened || '',
        solved: day.review?.solved || '',
        betterTomorrow: day.review?.betterTomorrow || '',
      });
    } else {
      setQuickNote('');
      setReview({
        worked: '',
        blocked: '',
        change: '',
        obstacles: '',
        happened: '',
        solved: '',
        betterTomorrow: '',
      });
    }
  };

  useEffect(() => {
    loadData();
  }, [currentDate]);

  const saveToDb = async (newNotes: string, newReview: DayReview, triggerSync = false) => {
    const existing = await db.days.get(currentDate);
    const now = Date.now();
    await db.days.put({
      id: currentDate,
      date: currentDate,
      freeHours: existing?.freeHours ?? 8,
      sheetData: {
        ...(existing?.sheetData || {}),
        notes: newNotes,
      },
      review: newReview,
      updatedAt: now,
      deleted: false,
      isSample: false,
      synced: 0,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);

    if (triggerSync) {
      await syncEngine.triggerSync();
    } else {
      syncEngine.notifyLocalMutation();
    }
  };

  const handleQuickNoteChange = (val: string) => {
    setQuickNote(val);
    saveToDb(val, review, false);
  };

  const handleReviewChange = (field: keyof DayReview, val: string) => {
    const next = { ...review, [field]: val };
    setReview(next);
    saveToDb(quickNote, next, false);
  };

  const shiftDate = (days: number) => {
    const [y, m, d] = currentDate.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + days);
    onChangeDate(date.toISOString().split('T')[0]);
  };

  const dayName = useMemo(() => {
    try {
      const [y, m, d] = currentDate.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toUpperCase();
    } catch {
      return 'TODAY';
    }
  }, [currentDate]);

  const formatCountdown = (sec: number | null) => {
    if (sec === null || sec <= 0) return '0s';
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    if (mins > 0) return `${mins}m ${rem}s`;
    return `${rem}s`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Date Navigation & Status Bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={() => shiftDate(-1)}
          className="v-circle-btn"
          style={{ width: 36, height: 36, flexShrink: 0 }}
          aria-label="Previous day"
        >
          ‹
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div className="font-bloody" style={{ fontSize: isPhone ? 18 : 22, fontWeight: 700, letterSpacing: '0.05em' }}>
            {dayName}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {currentDate}
          </div>
        </div>
        <button
          type="button"
          onClick={() => shiftDate(1)}
          className="v-circle-btn"
          style={{ width: 36, height: 36, flexShrink: 0 }}
          aria-label="Next day"
        >
          ›
        </button>
      </div>

      {/* ── Action Bar with 2-minute Countdown and Tabs ── */}
      <div className="v-card" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        {/* Sub-tabs */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setActiveTab('quick')}
            className={`v-pill-btn${activeTab === 'quick' ? ' v-pill-btn-primary' : ''}`}
            style={{ padding: '6px 14px', fontSize: 13, minHeight: 36 }}
          >
            <StickyNote size={14} /> Quick Notes
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('reflection')}
            className={`v-pill-btn${activeTab === 'reflection' ? ' v-pill-btn-primary' : ''}`}
            style={{ padding: '6px 14px', fontSize: 13, minHeight: 36 }}
          >
            <Sparkles size={14} /> Daily Reflection
          </button>
        </div>

        {/* 2-minute Save Countdown & Manual Save Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {countdown !== null && countdown > 0 ? (
            <span style={{ fontSize: 12, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Clock size={12} /> Unsaved changes ({formatCountdown(countdown)})
            </span>
          ) : saved ? (
            <span style={{ fontSize: 12, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Check size={12} /> Saved
            </span>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Auto-saves 2m after edit</span>
          )}

          <button
            type="button"
            onClick={() => saveToDb(quickNote, review, true)}
            className="v-pill-btn v-pill-btn-primary"
            style={{ padding: '6px 14px', fontSize: 12, minHeight: 32, gap: 5, fontWeight: 700 }}
            title="Save immediately without waiting for the 2-minute timer"
          >
            <Save size={12} /> Save Now
          </button>
        </div>
      </div>

      {/* ── Tab Content: Quick Notes ── */}
      {activeTab === 'quick' && (
        <div className="v-card" style={{ padding: '20px' }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', display: 'block', marginBottom: 12 }}>
            QUICK NOTES & THOUGHTS (VISUAL RICH TEXT)
          </label>
          <VisualRichEditor
            value={quickNote}
            onChange={handleQuickNoteChange}
            placeholder="Jot down anything — ideas, links, brainstorms, reminders... Format words with bold, colors, and highlights visually!"
            minHeight={320}
          />
        </div>
      )}

      {/* ── Tab Content: Daily Reflection Questions ── */}
      {activeTab === 'reflection' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Obstacles */}
          <div className="v-card" style={{ padding: '18px 20px' }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: '#f87171', display: 'block', marginBottom: 10 }}>
              What obstacles did I face today?
            </label>
            <VisualRichEditor
              value={review.obstacles || ''}
              onChange={val => handleReviewChange('obstacles', val)}
              placeholder="Distractions, roadblocks, mental blocks, unforeseen delays..."
              minHeight={100}
            />
          </div>

          {/* Happened */}
          <div className="v-card" style={{ padding: '18px 20px' }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8', display: 'block', marginBottom: 10 }}>
              What happened?
            </label>
            <VisualRichEditor
              value={review.happened || ''}
              onChange={val => handleReviewChange('happened', val)}
              placeholder="What took place during the day? Unexpected events, context changes..."
              minHeight={100}
            />
          </div>

          {/* Solved */}
          <div className="v-card" style={{ padding: '18px 20px' }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: '#22c55e', display: 'block', marginBottom: 10 }}>
              How did I solve it?
            </label>
            <VisualRichEditor
              value={review.solved || ''}
              onChange={val => handleReviewChange('solved', val)}
              placeholder="What worked? How did you pivot, adapt, or overcome the issues?"
              minHeight={100}
            />
          </div>

          {/* Better Tomorrow */}
          <div className="v-card" style={{ padding: '18px 20px' }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', display: 'block', marginBottom: 10 }}>
              What could I do better tomorrow?
            </label>
            <VisualRichEditor
              value={review.betterTomorrow || ''}
              onChange={val => handleReviewChange('betterTomorrow', val)}
              placeholder="What one adjustment will improve tomorrow's focus and outcome?"
              minHeight={100}
            />
          </div>
        </div>
      )}
    </div>
  );
}
