'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import {
  StickyNote, Sparkles, Clock, ChevronLeft, ChevronRight,
  Bold as BoldIcon, Underline as UnderlineIcon, Strikethrough as StrikethroughIcon,
  Palette, Save, Check
} from 'lucide-react';
import type { Day, DayReview } from '@/types';

interface NoteScreenProps {
  currentDate: string;
  onChangeDate: (date: string) => void;
  isPhone: boolean;
}

const COLOR_OPTIONS = [
  { label: 'Red', value: '#ef4444' },
  { label: 'Blue', value: '#38bdf8' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Default', value: '' },
];

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

  // Active focused input ref for formatting
  const activeInputRef = useRef<HTMLTextAreaElement | null>(null);

  const quickNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const obstaclesRef = useRef<HTMLTextAreaElement | null>(null);
  const happenedRef = useRef<HTMLTextAreaElement | null>(null);
  const solvedRef = useRef<HTMLTextAreaElement | null>(null);
  const betterRef = useRef<HTMLTextAreaElement | null>(null);

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

  const handleFormat = (type: 'bold' | 'underline' | 'strikethrough' | 'color', colorVal = '#ef4444') => {
    const el = activeInputRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const val = el.value;
    const selected = val.substring(start, end) || 'text';

    let prefix = '';
    let suffix = '';

    if (type === 'bold') {
      prefix = '<b>';
      suffix = '</b>';
    } else if (type === 'underline') {
      prefix = '<u>';
      suffix = '</u>';
    } else if (type === 'strikethrough') {
      prefix = '<s>';
      suffix = '</s>';
    } else if (type === 'color') {
      prefix = `<span style="color:${colorVal}">`;
      suffix = '</span>';
    }

    const nextVal = val.substring(0, start) + prefix + selected + suffix + val.substring(end);
    el.value = nextVal;

    // Trigger state update
    if (el === quickNoteRef.current) {
      handleQuickNoteChange(nextVal);
    } else if (el === obstaclesRef.current) {
      handleReviewChange('obstacles', nextVal);
    } else if (el === happenedRef.current) {
      handleReviewChange('happened', nextVal);
    } else if (el === solvedRef.current) {
      handleReviewChange('solved', nextVal);
    } else if (el === betterRef.current) {
      handleReviewChange('betterTomorrow', nextVal);
    }

    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 10);
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

      {/* ── Header with 30s countdown and tabs ── */}
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

        {/* 30s Save Countdown & Manual Save Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {countdown !== null && countdown > 0 ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={12} /> Saving in {countdown}s
            </span>
          ) : saved ? (
            <span style={{ fontSize: 12, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Check size={12} /> Saved locally
            </span>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Auto-saves in 30s</span>
          )}

          <button
            type="button"
            onClick={() => saveToDb(quickNote, review, true)}
            className="v-pill-btn"
            style={{ padding: '6px 12px', fontSize: 12, minHeight: 32, gap: 4 }}
            title="Save immediately without waiting 30 seconds"
          >
            <Save size={12} /> Save now
          </button>
        </div>
      </div>

      {/* ── Formatting Toolbar ── */}
      <div
        className="v-card"
        style={{
          padding: '8px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          background: 'var(--v-glass-bg-subtle)',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginRight: 6 }}>FORMAT:</span>
        <button
          type="button"
          onClick={() => handleFormat('bold')}
          className="v-circle-btn"
          style={{ width: 32, height: 32, fontWeight: 700 }}
          title="Bold"
        >
          <BoldIcon size={14} />
        </button>
        <button
          type="button"
          onClick={() => handleFormat('underline')}
          className="v-circle-btn"
          style={{ width: 32, height: 32 }}
          title="Underline"
        >
          <UnderlineIcon size={14} />
        </button>
        <button
          type="button"
          onClick={() => handleFormat('strikethrough')}
          className="v-circle-btn"
          style={{ width: 32, height: 32 }}
          title="Strikethrough"
        >
          <StrikethroughIcon size={14} />
        </button>

        <div style={{ width: 1, height: 18, background: 'var(--v-glass-border)', margin: '0 4px' }} />

        {COLOR_OPTIONS.map(opt => (
          <button
            key={opt.label}
            type="button"
            onClick={() => handleFormat('color', opt.value)}
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: opt.value || 'var(--text-primary)',
              border: '1.5px solid var(--v-glass-border)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            title={opt.label}
          />
        ))}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
          (Select text, then click formatting button)
        </span>
      </div>

      {/* ── Tab Content: Quick Notes ── */}
      {activeTab === 'quick' && (
        <div className="v-card" style={{ padding: '20px' }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', display: 'block', marginBottom: 10 }}>
            QUICK NOTES & THOUGHTS
          </label>
          <textarea
            ref={quickNoteRef}
            value={quickNote}
            onChange={e => handleQuickNoteChange(e.target.value)}
            onFocus={() => { activeInputRef.current = quickNoteRef.current; }}
            placeholder="Jot down anything — ideas, links, brainstorms, reminders... (Formatted with Handle font)"
            rows={14}
            className="v-input font-handle"
            style={{
              fontSize: 15,
              lineHeight: 1.6,
              resize: 'vertical',
              padding: '16px',
            }}
          />
        </div>
      )}

      {/* ── Tab Content: Daily Reflection Questions ── */}
      {activeTab === 'reflection' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Obstacles */}
          <div className="v-card" style={{ padding: '18px 20px' }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: '#f87171', display: 'block', marginBottom: 8 }}>
              What obstacles did I face today?
            </label>
            <textarea
              ref={obstaclesRef}
              value={review.obstacles || ''}
              onChange={e => handleReviewChange('obstacles', e.target.value)}
              onFocus={() => { activeInputRef.current = obstaclesRef.current; }}
              placeholder="Distractions, roadblocks, mental blocks, unforeseen delays..."
              rows={3}
              className="v-input font-handle"
              style={{ fontSize: 14, lineHeight: 1.5, resize: 'vertical' }}
            />
          </div>

          {/* Happened */}
          <div className="v-card" style={{ padding: '18px 20px' }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8', display: 'block', marginBottom: 8 }}>
              What happened?
            </label>
            <textarea
              ref={happenedRef}
              value={review.happened || ''}
              onChange={e => handleReviewChange('happened', e.target.value)}
              onFocus={() => { activeInputRef.current = happenedRef.current; }}
              placeholder="What took place during the day? Unexpected events, context changes..."
              rows={3}
              className="v-input font-handle"
              style={{ fontSize: 14, lineHeight: 1.5, resize: 'vertical' }}
            />
          </div>

          {/* Solved */}
          <div className="v-card" style={{ padding: '18px 20px' }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: '#22c55e', display: 'block', marginBottom: 8 }}>
              How did I solve it?
            </label>
            <textarea
              ref={solvedRef}
              value={review.solved || ''}
              onChange={e => handleReviewChange('solved', e.target.value)}
              onFocus={() => { activeInputRef.current = solvedRef.current; }}
              placeholder="What worked? How did you pivot, adapt, or overcome the issues?"
              rows={3}
              className="v-input font-handle"
              style={{ fontSize: 14, lineHeight: 1.5, resize: 'vertical' }}
            />
          </div>

          {/* Better Tomorrow */}
          <div className="v-card" style={{ padding: '18px 20px' }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', display: 'block', marginBottom: 8 }}>
              What could I do better tomorrow?
            </label>
            <textarea
              ref={betterRef}
              value={review.betterTomorrow || ''}
              onChange={e => handleReviewChange('betterTomorrow', e.target.value)}
              onFocus={() => { activeInputRef.current = betterRef.current; }}
              placeholder="What one adjustment will improve tomorrow's focus and outcome?"
              rows={3}
              className="v-input font-handle"
              style={{ fontSize: 14, lineHeight: 1.5, resize: 'vertical' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
