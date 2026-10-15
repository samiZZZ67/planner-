'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlarmClock,
  AlertTriangle,
  ArrowRight,
  Bell,
  BellOff,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  CornerDownRight,
  Edit3,
  FastForward,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { apiFetch } from '@/lib/api/apiClient';
import { notifyFeedback } from '@/lib/utils/actionFeedback';
import type { BookAssignmentRecord, BookRecord } from '@/lib/books/types';
import {
  calculateDeliveryCountdown,
  describeScheduleRemaining,
  getDeliveryZonedTimestamp,
  getZonedDateString,
  resolveNextBookDelivery,
  type DeliveryCountdown,
  type NextBookDelivery,
} from '@/lib/date/bookDeliverySchedule';

interface LiveBookDeliveryCountdownProps {
  books: BookRecord[];
  assignmentsByBook: Record<string, BookAssignmentRecord[]>;
  onAssignmentsUpdated: (bookId: string, assignments: BookAssignmentRecord[]) => void;
  onBookUpdated: (book: BookRecord) => void;
  onSendNow?: (assignment: BookAssignmentRecord, book: BookRecord) => Promise<void>;
  onOpenBookAnalytics?: (book: BookRecord) => void;
}

export function LiveBookDeliveryCountdown({
  books,
  assignmentsByBook,
  onAssignmentsUpdated,
  onBookUpdated,
  onSendNow,
  onOpenBookAnalytics,
}: LiveBookDeliveryCountdownProps) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [isEditingSchedule, setIsEditingSchedule] = useState(false);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [skippingDelivery, setSkippingDelivery] = useState(false);
  const [cancellingDelivery, setCancellingDelivery] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [actionNotice, setActionNotice] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');

  const alarmedRef = useRef(false);

  // 1. Live second tick + visibility/focus listener to prevent sleep drift
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const interval = setInterval(tick, 1000);

    const onResume = () => setNowMs(Date.now());
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onResume);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onResume);
    };
  }, []);

  // 2. Resolve the next delivery across all active books
  const nextDelivery = useMemo<NextBookDelivery | null>(() => {
    return resolveNextBookDelivery(books, assignmentsByBook, nowMs);
  }, [books, assignmentsByBook, nowMs]);

  // 3. Compute live countdown against next delivery
  const countdown = useMemo<DeliveryCountdown | null>(() => {
    if (!nextDelivery) return null;
    return calculateDeliveryCountdown(nextDelivery.scheduledAt, nowMs);
  }, [nextDelivery, nowMs]);

  // 4. Subtle chime when alarm reaches zero (optional, user toggleable, soft sine wave)
  const playSoftChime = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } catch {}
  }, [soundEnabled]);

  useEffect(() => {
    if (countdown?.isZero && !alarmedRef.current) {
      alarmedRef.current = true;
      playSoftChime();
    } else if (countdown && !countdown.isZero) {
      alarmedRef.current = false;
    }
  }, [countdown?.isZero, playSoftChime]);

  // Sync edit draft when opening reschedule editor
  useEffect(() => {
    if (nextDelivery && !isEditingSchedule) {
      setEditDate(nextDelivery.scheduledDate);
      setEditTime(nextDelivery.postingTime);
    }
  }, [nextDelivery, isEditingSchedule]);

  // Live remaining time calculation as user edits the schedule
  const liveEditPreview = useMemo(() => {
    if (!isEditingSchedule || !editTime) return null;
    return describeScheduleRemaining(
      editTime,
      editDate || undefined,
      nextDelivery?.timezone,
      nowMs
    );
  }, [isEditingSchedule, editTime, editDate, nextDelivery?.timezone, nowMs]);

  const showFeedback = (noticeMsg: string, errorMsg?: string) => {
    if (noticeMsg) {
      setActionNotice(noticeMsg);
      notifyFeedback('success', noticeMsg);
      setTimeout(() => setActionNotice(''), 6000);
    }
    if (errorMsg) {
      setActionError(errorMsg);
      notifyFeedback('error', errorMsg);
      setTimeout(() => setActionError(''), 7000);
    }
  };

  // ── Action Handlers ────────────────────────────────────────────────

  // Immediate delivery
  const handleSendNow = async () => {
    if (!nextDelivery || sendingNow) return;
    setSendingNow(true);
    setActionError('');
    try {
      if (onSendNow && nextDelivery.assignment) {
        await onSendNow(nextDelivery.assignment, nextDelivery.book);
      } else if (nextDelivery.assignmentId) {
        const response = await apiFetch(
          `/api/books/${encodeURIComponent(nextDelivery.bookId)}/assignments/${encodeURIComponent(nextDelivery.assignmentId)}/publish`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sendNow: true, override: true }),
          }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to dispatch section now.');

        if (data.book) onBookUpdated(data.book);
        if (data.assignment) {
          const list = assignmentsByBook[nextDelivery.bookId] || [];
          onAssignmentsUpdated(
            nextDelivery.bookId,
            list.map(a => (a.id === data.assignment.id ? data.assignment : a))
          );
        }
      }
      showFeedback(`🚀 Successfully delivered "${nextDelivery.bookTitle}" to Telegram!`);
    } catch (err: any) {
      showFeedback('', err.message || 'Immediate delivery failed.');
    } finally {
      setSendingNow(false);
    }
  };

  // Reschedule
  const handleSaveReschedule = async () => {
    if (!nextDelivery?.assignmentId || savingSchedule) return;
    setSavingSchedule(true);
    setActionError('');
    try {
      const response = await apiFetch(
        `/api/books/${encodeURIComponent(nextDelivery.bookId)}/assignments/${encodeURIComponent(nextDelivery.assignmentId)}/schedule`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'reschedule',
            date: editDate,
            time: editTime,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to reschedule delivery.');

      if (data.assignment) {
        const list = assignmentsByBook[nextDelivery.bookId] || [];
        onAssignmentsUpdated(
          nextDelivery.bookId,
          list.map(a => (a.id === data.assignment.id ? data.assignment : a))
        );
      }
      setIsEditingSchedule(false);
      showFeedback(`Updated delivery time for ${nextDelivery.bookTitle} to ${editDate} at ${editTime}!`);
    } catch (err: any) {
      showFeedback('', err.message || 'Could not reschedule delivery.');
    } finally {
      setSavingSchedule(false);
    }
  };

  // Skip next delivery (postpone by 1 day)
  const handleSkipNext = async () => {
    if (!nextDelivery?.assignmentId || skippingDelivery) return;
    setSkippingDelivery(true);
    setActionError('');
    try {
      const response = await apiFetch(
        `/api/books/${encodeURIComponent(nextDelivery.bookId)}/assignments/${encodeURIComponent(nextDelivery.assignmentId)}/schedule`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'skip' }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to skip next delivery.');

      if (data.assignment) {
        const list = assignmentsByBook[nextDelivery.bookId] || [];
        onAssignmentsUpdated(
          nextDelivery.bookId,
          list.map(a => (a.id === data.assignment.id ? data.assignment : a))
        );
      }
      showFeedback(`Skipped delivery for today! Advanced section to ${data.assignment?.scheduledDate}.`);
    } catch (err: any) {
      showFeedback('', err.message || 'Could not skip delivery.');
    } finally {
      setSkippingDelivery(false);
    }
  };

  // Cancel scheduled delivery
  const handleCancelDelivery = async () => {
    if (!nextDelivery?.assignmentId || cancellingDelivery) return;
    if (!window.confirm('Cancel this scheduled Telegram delivery? The reading section will return to draft.')) return;
    setCancellingDelivery(true);
    setActionError('');
    try {
      const response = await apiFetch(
        `/api/books/${encodeURIComponent(nextDelivery.bookId)}/assignments/${encodeURIComponent(nextDelivery.assignmentId)}/schedule`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel' }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to cancel scheduled delivery.');

      if (data.assignment) {
        const list = assignmentsByBook[nextDelivery.bookId] || [];
        onAssignmentsUpdated(
          nextDelivery.bookId,
          list.map(a => (a.id === data.assignment.id ? data.assignment : a))
        );
      }
      showFeedback(`Cancelled scheduled delivery for "${nextDelivery.bookTitle}".`);
    } catch (err: any) {
      showFeedback('', err.message || 'Could not cancel delivery.');
    } finally {
      setCancellingDelivery(false);
    }
  };

  if (!nextDelivery || !countdown) {
    return (
      <div
        className="v-card"
        style={{
          padding: '16px 20px',
          borderRadius: 16,
          background: 'var(--v-glass-bg-subtle)',
          border: '1px solid var(--v-glass-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#a5b4fc',
            }}
          >
            <AlarmClock size={20} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: 0.5 }}>
              NEXT BOOK DELIVERY
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              No pending book deliveries scheduled. Generate a reading plan or add a book to activate the live alarm.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Determine status color and label
  const isUrgent = !countdown.isZero && countdown.days === 0 && countdown.hours === 0 && countdown.minutes < 15;
  const isSubMinute = !countdown.isZero && countdown.days === 0 && countdown.hours === 0 && countdown.minutes === 0;

  const statusConfig = {
    scheduled: {
      label: countdown.isZero ? (countdown.isOverdue ? 'Overdue' : 'Due Now') : 'Scheduled',
      bg: countdown.isZero ? 'rgba(245, 158, 11, 0.2)' : 'rgba(59, 130, 246, 0.2)',
      color: countdown.isZero ? '#fcd34d' : '#93c5fd',
      border: countdown.isZero ? 'rgba(245, 158, 11, 0.4)' : 'rgba(59, 130, 246, 0.35)',
    },
    sending: {
      label: 'Sending Now…',
      bg: 'rgba(168, 85, 247, 0.25)',
      color: '#d8b4fe',
      border: 'rgba(168, 85, 247, 0.45)',
    },
    sent: {
      label: 'Sent to Telegram',
      bg: 'rgba(34, 197, 94, 0.2)',
      color: '#86efac',
      border: 'rgba(34, 197, 94, 0.35)',
    },
    failed: {
      label: 'Delivery Failed',
      bg: 'rgba(239, 68, 68, 0.2)',
      color: '#fca5a5',
      border: 'rgba(239, 68, 68, 0.4)',
    },
    cancelled: {
      label: 'Cancelled',
      bg: 'rgba(148, 163, 184, 0.2)',
      color: '#cbd5e1',
      border: 'rgba(148, 163, 184, 0.3)',
    },
    overdue: {
      label: 'Overdue · Awaiting Dispatch',
      bg: 'rgba(245, 158, 11, 0.25)',
      color: '#fbbf24',
      border: 'rgba(245, 158, 11, 0.45)',
    },
    draft: {
      label: 'Draft · Not Queued',
      bg: 'rgba(148, 163, 184, 0.2)',
      color: '#94a3b8',
      border: 'rgba(148, 163, 184, 0.3)',
    },
  }[nextDelivery.status];

  return (
    <section
      className="v-card"
      style={{
        padding: '18px 20px',
        borderRadius: 16,
        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.45), rgba(15, 23, 42, 0.65))',
        border: `1px solid ${isSubMinute ? 'rgba(96, 165, 250, 0.6)' : isUrgent ? 'rgba(245, 158, 11, 0.4)' : 'var(--v-glass-border)'}`,
        boxShadow: isSubMinute ? '0 0 20px rgba(59, 130, 246, 0.2)' : 'none',
        display: 'grid',
        gap: 14,
        position: 'relative',
        overflow: 'hidden',
        transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
      }}
      aria-label="Next Scheduled Book Delivery Countdown"
    >
      {/* Top Bar: Title, Status Badge, and Sound Toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: isUrgent ? 'rgba(245, 158, 11, 0.2)' : 'rgba(99, 102, 241, 0.2)',
              border: `1px solid ${isUrgent ? 'rgba(245, 158, 11, 0.4)' : 'rgba(99, 102, 241, 0.4)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isUrgent ? '#fbbf24' : '#a5b4fc',
            }}
          >
            <AlarmClock
              size={18}
              style={{
                animation: isSubMinute ? 'sams-action-spin 3s ease-in-out infinite' : 'none',
              }}
            />
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: 'var(--text-muted)',
                letterSpacing: 1.2,
                textTransform: 'uppercase',
              }}
            >
              NEXT BOOK DELIVERY
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              {nextDelivery.bookTitle}{' '}
              <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>
                by {nextDelivery.bookAuthor}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              padding: '3px 10px',
              borderRadius: 999,
              fontWeight: 700,
              background: statusConfig.bg,
              color: statusConfig.color,
              border: `1px solid ${statusConfig.border}`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            {nextDelivery.status === 'sending' ? (
              <Loader2 size={12} style={{ animation: 'sams-action-spin .8s linear infinite' }} />
            ) : nextDelivery.status === 'sent' ? (
              <CheckCircle2 size={12} />
            ) : nextDelivery.status === 'failed' ? (
              <AlertTriangle size={12} />
            ) : (
              <Clock size={12} />
            )}
            <span>{statusConfig.label}</span>
          </span>

          <button
            type="button"
            className="v-circle-btn"
            onClick={() => setSoundEnabled(s => !s)}
            style={{ width: 30, height: 30 }}
            title={soundEnabled ? 'Alarm chime is enabled (click to mute)' : 'Alarm chime is muted (click to enable)'}
            aria-label={soundEnabled ? 'Mute alarm chime' : 'Enable alarm chime'}
          >
            {soundEnabled ? <Volume2 size={14} color="#60a5fa" /> : <VolumeX size={14} color="var(--text-muted)" />}
          </button>
        </div>
      </div>

      {/* Alarm-Clock Digital Display Block */}
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.35)',
          borderRadius: 14,
          padding: '16px 20px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {countdown.days > 0 && (
            <>
              <div style={{ display: 'grid', justifyItems: 'center', gap: 3 }}>
                <span
                  style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                    fontSize: 28,
                    fontWeight: 800,
                    lineHeight: 1,
                    padding: '6px 10px',
                    borderRadius: 8,
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: '#f8fafc',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  {countdown.digits.days}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Days
                </span>
              </div>
              <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 14 }}>:</span>
            </>
          )}

          <div style={{ display: 'grid', justifyItems: 'center', gap: 3 }}>
            <span
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                fontSize: 28,
                fontWeight: 800,
                lineHeight: 1,
                padding: '6px 10px',
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.06)',
                color: '#f8fafc',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              {countdown.digits.hours}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Hours
            </span>
          </div>

          <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 14 }}>:</span>

          <div style={{ display: 'grid', justifyItems: 'center', gap: 3 }}>
            <span
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                fontSize: 28,
                fontWeight: 800,
                lineHeight: 1,
                padding: '6px 10px',
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.06)',
                color: '#f8fafc',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              {countdown.digits.minutes}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Minutes
            </span>
          </div>

          <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 14 }}>:</span>

          <div style={{ display: 'grid', justifyItems: 'center', gap: 3 }}>
            <span
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                fontSize: 28,
                fontWeight: 800,
                lineHeight: 1,
                padding: '6px 10px',
                borderRadius: 8,
                background: isSubMinute ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.06)',
                color: isSubMinute ? '#93c5fd' : '#f8fafc',
                border: isSubMinute ? '1px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.1)',
                transition: 'all 0.2s ease',
              }}
            >
              {countdown.digits.seconds}
            </span>
            <span style={{ fontSize: 10, color: isSubMinute ? '#93c5fd' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Seconds
            </span>
          </div>
        </div>

        {/* Textual summary & next occurrence indicator */}
        <div style={{ display: 'grid', gap: 4, minWidth: 220 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {countdown.humanRemaining}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Scheduled delivery:{' '}
            <strong style={{ color: 'var(--text-secondary)' }}>
              {nextDelivery.formattedTime12h}
            </strong>{' '}
            <span style={{ fontSize: 11 }}>({nextDelivery.scheduledDate})</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Habesha Clock: {nextDelivery.ethiopianTimeStr}
          </div>
        </div>
      </div>

      {/* Details Row: Next Section & Concept */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          fontSize: 12,
          padding: '2px 4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-muted)' }}>Next section:</span>
          <strong style={{ color: 'var(--accent-color, #60a5fa)' }}>
            {nextDelivery.dayNumber ? `Day ${nextDelivery.dayNumber}` : ''}
            {nextDelivery.sectionNumber ? ` · Part ${nextDelivery.sectionNumber}` : ''}{' '}
            (pp. {nextDelivery.startPdfPage}–{nextDelivery.endPdfPage})
          </strong>
          <span style={{ color: 'var(--text-secondary)' }}>
            — {nextDelivery.conceptTitle}
          </span>
        </div>

        {onOpenBookAnalytics && (
          <button
            type="button"
            className="v-pill-btn"
            onClick={() => onOpenBookAnalytics(nextDelivery.book)}
            style={{ padding: '4px 10px', fontSize: 11 }}
          >
            Open in BA →
          </button>
        )}
      </div>

      {/* Error or Notice Banners */}
      {actionNotice && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.35)',
            color: '#86efac',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{actionNotice}</span>
          <button type="button" onClick={() => setActionNotice('')} style={{ background: 'none', border: 'none', color: '#86efac', cursor: 'pointer' }}>
            <X size={12} />
          </button>
        </div>
      )}
      {actionError && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            color: '#fca5a5',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError('')} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* Interactive Controls Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          borderTop: '1px solid var(--v-glass-border-subtle)',
          paddingTop: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Send Now Button */}
          <button
            type="button"
            className="v-pill-btn v-pill-btn-accent"
            disabled={sendingNow}
            onClick={() => void handleSendNow()}
            style={{
              padding: '7px 14px',
              fontWeight: 600,
              fontSize: 12,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {sendingNow ? (
              <>
                <Loader2 size={13} style={{ animation: 'sams-action-spin .8s linear infinite' }} />
                <span>Sending to Telegram…</span>
              </>
            ) : (
              <>
                <Send size={13} />
                <span>Send Now (Override Time)</span>
              </>
            )}
          </button>

          {/* Reschedule Button */}
          {nextDelivery.assignmentId && (
            <button
              type="button"
              className="v-pill-btn"
              onClick={() => setIsEditingSchedule(c => !c)}
              style={{
                padding: '7px 12px',
                fontSize: 12,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Edit3 size={13} />
              <span>{isEditingSchedule ? 'Close Editor' : 'Edit Schedule'}</span>
            </button>
          )}

          {/* Skip Next Delivery Button */}
          {nextDelivery.assignmentId && (
            <button
              type="button"
              className="v-pill-btn"
              disabled={skippingDelivery}
              onClick={() => void handleSkipNext()}
              style={{
                padding: '7px 12px',
                fontSize: 12,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
              title="Postpone this upcoming reading section to tomorrow without losing progress"
            >
              {skippingDelivery ? (
                <Loader2 size={13} style={{ animation: 'sams-action-spin .8s linear infinite' }} />
              ) : (
                <FastForward size={13} />
              )}
              <span>Skip Next Delivery (Move to Tomorrow)</span>
            </button>
          )}

          {/* Cancel Scheduled Delivery Button */}
          {nextDelivery.assignmentId && nextDelivery.status !== 'draft' && (
            <button
              type="button"
              className="v-pill-btn"
              disabled={cancellingDelivery}
              onClick={() => void handleCancelDelivery()}
              style={{
                padding: '7px 12px',
                fontSize: 12,
                color: '#fca5a5',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
              title="Cancel automatic publishing for this section and return it to draft"
            >
              {cancellingDelivery ? (
                <Loader2 size={13} style={{ animation: 'sams-action-spin .8s linear infinite' }} />
              ) : (
                <X size={13} />
              )}
              <span>Cancel</span>
            </button>
          )}
        </div>

        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Timezone: {nextDelivery.timezone}
        </span>
      </div>

      {/* Inline Reschedule / Time Editor Drawer */}
      {isEditingSchedule && nextDelivery.assignmentId && (
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid var(--v-glass-border)',
            display: 'grid',
            gap: 12,
            marginTop: 4,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>
              Reschedule Next Book Delivery
            </strong>
            <button
              type="button"
              className="v-circle-btn"
              onClick={() => setIsEditingSchedule(false)}
              style={{ width: 24, height: 24 }}
            >
              <X size={12} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'grid', gap: 4 }}>
              Delivery Date:
              <input
                type="date"
                value={editDate}
                onChange={e => setEditDate(e.target.value)}
                style={{
                  padding: '7px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--v-glass-border)',
                  background: 'var(--v-glass-bg-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                }}
              />
            </label>

            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'grid', gap: 4 }}>
              Posting Time ({nextDelivery.timezone}):
              <input
                type="time"
                value={editTime}
                onChange={e => setEditTime(e.target.value)}
                style={{
                  padding: '7px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--v-glass-border)',
                  background: 'var(--v-glass-bg-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                }}
              />
            </label>
          </div>

          {/* Live Remaining Time Feedback */}
          {liveEditPreview && (
            <div
              style={{
                fontSize: 12,
                padding: '6px 12px',
                borderRadius: 8,
                background: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                color: '#93c5fd',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Clock size={13} />
              <span>
                <strong>Remaining duration: </strong>
                {liveEditPreview.remainingText}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              className="v-pill-btn"
              onClick={() => setIsEditingSchedule(false)}
              style={{ padding: '6px 12px', fontSize: 12 }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="v-pill-btn v-pill-btn-accent"
              disabled={savingSchedule || !editDate || !editTime}
              onClick={() => void handleSaveReschedule()}
              style={{
                padding: '6px 16px',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {savingSchedule ? 'Saving…' : 'Save New Schedule'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
