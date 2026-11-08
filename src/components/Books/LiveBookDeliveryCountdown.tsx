'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlarmClock,
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  FastForward,
  Loader2,
  Send,
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
  resolveBookScheduleSummary,
  type BookScheduleStatusInfo,
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

interface SingleBookDeliveryCardProps {
  book: BookRecord;
  assignments: BookAssignmentRecord[];
  nowMs: number;
  soundEnabled: boolean;
  onAssignmentsUpdated: (bookId: string, assignments: BookAssignmentRecord[]) => void;
  onBookUpdated: (book: BookRecord) => void;
  onSendNow?: (assignment: BookAssignmentRecord, book: BookRecord) => Promise<void>;
  onOpenBookAnalytics?: (book: BookRecord) => void;
  showFeedback: (noticeMsg: string, errorMsg?: string) => void;
}

function SingleBookDeliveryCard({
  book,
  assignments,
  nowMs,
  soundEnabled,
  onAssignmentsUpdated,
  onBookUpdated,
  onSendNow,
  onOpenBookAnalytics,
  showFeedback,
}: SingleBookDeliveryCardProps) {
  const [isEditingSchedule, setIsEditingSchedule] = useState(false);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [skippingDelivery, setSkippingDelivery] = useState(false);
  const [cancellingDelivery, setCancellingDelivery] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);

  const alarmedRef = useRef(false);

  // 1. Resolve schedule strictly for this book
  const scheduleInfo = useMemo<BookScheduleStatusInfo>(() => {
    return resolveBookScheduleSummary(book, assignments, nowMs);
  }, [book, assignments, nowMs]);

  const nextDelivery = scheduleInfo.nextDelivery;

  // 2. Compute countdown if an upcoming delivery exists for this book
  const countdown = useMemo<DeliveryCountdown | null>(() => {
    if (!nextDelivery) return null;
    return calculateDeliveryCountdown(nextDelivery.scheduledAt, nowMs);
  }, [nextDelivery, nowMs]);

  // 3. Audio chime on zero
  const playSoftChime = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
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

  // Live remaining preview
  const liveEditPreview = useMemo(() => {
    if (!isEditingSchedule || !editTime) return null;
    return describeScheduleRemaining(
      editTime,
      editDate || undefined,
      nextDelivery?.timezone || book.timezone,
      nowMs
    );
  }, [isEditingSchedule, editTime, editDate, nextDelivery?.timezone, book.timezone, nowMs]);

  // ── Action Handlers (strictly scoped to this book) ──
  const handleSendNow = async () => {
    if (!nextDelivery || sendingNow) return;
    setSendingNow(true);
    try {
      if (onSendNow && nextDelivery.assignment) {
        await onSendNow(nextDelivery.assignment, book);
      } else if (nextDelivery.assignmentId) {
        const response = await apiFetch(
          `/api/books/${encodeURIComponent(book.id)}/assignments/${encodeURIComponent(nextDelivery.assignmentId)}/publish`,
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
          onAssignmentsUpdated(
            book.id,
            assignments.map(a => (a.id === data.assignment.id ? data.assignment : a))
          );
        }
      }
      showFeedback(`🚀 Successfully delivered "${book.title}" to Telegram!`);
    } catch (err: any) {
      showFeedback('', err.message || 'Immediate delivery failed.');
    } finally {
      setSendingNow(false);
    }
  };

  const handleSaveReschedule = async () => {
    if (!nextDelivery?.assignmentId || savingSchedule) return;
    setSavingSchedule(true);
    try {
      const response = await apiFetch(
        `/api/books/${encodeURIComponent(book.id)}/assignments/${encodeURIComponent(nextDelivery.assignmentId)}/schedule`,
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
        onAssignmentsUpdated(
          book.id,
          assignments.map(a => (a.id === data.assignment.id ? data.assignment : a))
        );
      }
      setIsEditingSchedule(false);
      showFeedback(`Updated delivery time for "${book.title}" to ${editDate} at ${editTime}!`);
    } catch (err: any) {
      showFeedback('', err.message || 'Could not reschedule delivery.');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleSkipNext = async () => {
    if (!nextDelivery?.assignmentId || skippingDelivery) return;
    setSkippingDelivery(true);
    try {
      const response = await apiFetch(
        `/api/books/${encodeURIComponent(book.id)}/assignments/${encodeURIComponent(nextDelivery.assignmentId)}/schedule`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'skip' }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to skip next delivery.');

      if (data.assignment) {
        onAssignmentsUpdated(
          book.id,
          assignments.map(a => (a.id === data.assignment.id ? data.assignment : a))
        );
      }
      showFeedback(`Skipped delivery for today for "${book.title}". Advanced section to ${data.assignment?.scheduledDate}.`);
    } catch (err: any) {
      showFeedback('', err.message || 'Could not skip delivery.');
    } finally {
      setSkippingDelivery(false);
    }
  };

  const handleCancelDelivery = async () => {
    if (!nextDelivery?.assignmentId || cancellingDelivery) return;
    if (!window.confirm(`Cancel scheduled Telegram delivery for "${book.title}"? The section will return to draft.`)) return;
    setCancellingDelivery(true);
    try {
      const response = await apiFetch(
        `/api/books/${encodeURIComponent(book.id)}/assignments/${encodeURIComponent(nextDelivery.assignmentId)}/schedule`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel' }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to cancel scheduled delivery.');

      if (data.assignment) {
        onAssignmentsUpdated(
          book.id,
          assignments.map(a => (a.id === data.assignment.id ? data.assignment : a))
        );
      }
      showFeedback(`Cancelled scheduled delivery for "${book.title}".`);
    } catch (err: any) {
      showFeedback('', err.message || 'Could not cancel delivery.');
    } finally {
      setCancellingDelivery(false);
    }
  };

  // Card without upcoming delivery (e.g. all completed or no plan yet)
  if (!nextDelivery || !countdown) {
    const isCompleted = scheduleInfo.status === 'completed';
    return (
      <div
        className="v-card"
        style={{
          padding: '16px 20px',
          borderRadius: 14,
          background: 'rgba(30, 41, 59, 0.35)',
          border: '1px solid var(--v-glass-border)',
          display: 'grid',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
              }}
            >
              {isCompleted ? <CheckCircle2 size={18} /> : <BookOpen size={18} />}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                {book.title}
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                  by {book.author || 'Unknown'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: isCompleted ? '#ffffff' : 'var(--text-muted)', marginTop: 2 }}>
                {scheduleInfo.statusText}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 11,
                padding: '3px 10px',
                borderRadius: 999,
                fontWeight: 600,
                background: 'rgba(255, 255, 255, 0.1)',
                color: isCompleted ? '#ffffff' : 'var(--text-muted)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
              }}
            >
              {isCompleted ? 'Completed' : 'No Schedule'}
            </span>

            {onOpenBookAnalytics && (
              <button
                type="button"
                className="v-pill-btn"
                onClick={() => onOpenBookAnalytics(book)}
                style={{ padding: '4px 10px', fontSize: 11 }}
              >
                Open in BA →
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Active delivery card
  const isUrgent = !countdown.isZero && countdown.days === 0 && countdown.hours === 0 && countdown.minutes < 15;
  const isSubMinute = !countdown.isZero && countdown.days === 0 && countdown.hours === 0 && countdown.minutes === 0;

  const statusConfig = {
    scheduled: {
      label: countdown.isZero ? (countdown.isOverdue ? 'Overdue' : 'Due Now') : 'Scheduled',
      bg: 'var(--v-glass-bg-hover)',
      color: 'var(--text-primary)',
      border: 'var(--v-glass-border)',
    },
    sending: {
      label: 'Sending Now…',
      bg: 'var(--v-glass-bg-hover)',
      color: 'var(--text-primary)',
      border: 'var(--v-glass-border-bright)',
    },
    sent: {
      label: 'Sent to Telegram',
      bg: 'var(--v-glass-bg-hover)',
      color: 'var(--text-primary)',
      border: 'var(--v-glass-border)',
    },
    failed: {
      label: 'Delivery Failed',
      bg: 'var(--v-glass-bg-subtle)',
      color: 'var(--text-secondary)',
      border: 'var(--v-glass-border)',
    },
    cancelled: {
      label: 'Cancelled',
      bg: 'var(--v-glass-bg-subtle)',
      color: 'var(--text-muted)',
      border: 'var(--v-glass-border-subtle)',
    },
    overdue: {
      label: 'Overdue · Awaiting Dispatch',
      bg: 'var(--v-glass-bg-hover)',
      color: 'var(--text-primary)',
      border: 'var(--v-glass-border-bright)',
    },
    draft: {
      label: 'Draft · Not Queued',
      bg: 'var(--v-glass-bg-subtle)',
      color: 'var(--text-muted)',
      border: 'var(--v-glass-border-subtle)',
    },
  }[nextDelivery.status];

  return (
    <article
      className="v-card"
      style={{
        padding: '18px 20px',
        borderRadius: 16,
        background: 'var(--v-glass-bg-subtle)',
        border: `1px solid ${isSubMinute ? '#ffffff' : isUrgent ? 'rgba(255, 255, 255, 0.4)' : 'var(--v-glass-border)'}`,
        boxShadow: isSubMinute ? '0 0 20px rgba(255, 255, 255, 0.15)' : 'none',
        display: 'grid',
        gap: 14,
        position: 'relative',
        overflow: 'hidden',
        transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
      }}
      aria-label={`Scheduled delivery countdown for ${book.title}`}
    >
      {/* Top Header: Prominent Book Title & Author */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
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
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: -0.2 }}>
              {book.title}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              by {book.author || 'Unknown'} · Timezone: {nextDelivery.timezone}
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

          {onOpenBookAnalytics && (
            <button
              type="button"
              className="v-pill-btn"
              onClick={() => onOpenBookAnalytics(book)}
              style={{ padding: '4px 10px', fontSize: 11 }}
            >
              Open in BA →
            </button>
          )}
        </div>
      </div>

      {/* Alarm-Clock Digital Display Block */}
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.35)',
          borderRadius: 14,
          padding: '14px 18px',
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
                    fontSize: 26,
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
              <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 12 }}>:</span>
            </>
          )}

          <div style={{ display: 'grid', justifyItems: 'center', gap: 3 }}>
            <span
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                fontSize: 26,
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

          <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 12 }}>:</span>

          <div style={{ display: 'grid', justifyItems: 'center', gap: 3 }}>
            <span
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                fontSize: 26,
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

          <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 12 }}>:</span>

          <div style={{ display: 'grid', justifyItems: 'center', gap: 3 }}>
            <span
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                fontSize: 26,
                fontWeight: 800,
                lineHeight: 1,
                padding: '6px 10px',
                borderRadius: 8,
                background: isSubMinute ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                color: '#ffffff',
                border: isSubMinute ? '1px solid #ffffff' : '1px solid rgba(255, 255, 255, 0.1)',
                transition: 'all 0.2s ease',
              }}
            >
              {countdown.digits.seconds}
            </span>
            <span style={{ fontSize: 10, color: isSubMinute ? '#ffffff' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
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
            Next delivery:{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {nextDelivery.scheduledDate} at {nextDelivery.formattedTime12h}
            </strong>
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
          <strong style={{ color: 'var(--text-primary)' }}>
            {nextDelivery.dayNumber ? `Day ${nextDelivery.dayNumber}` : ''}
            {nextDelivery.sectionNumber ? ` · Part ${nextDelivery.sectionNumber}` : ''}{' '}
            (pp. {nextDelivery.startPdfPage}–{nextDelivery.endPdfPage})
          </strong>
          <span style={{ color: 'var(--text-secondary)' }}>
            — {nextDelivery.conceptTitle}
          </span>
        </div>
      </div>

      {/* Interactive Controls Bar for this book */}
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
              padding: '6px 13px',
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
                <span>Sending…</span>
              </>
            ) : (
              <>
                <Send size={13} />
                <span>Send Now</span>
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
                padding: '6px 12px',
                fontSize: 12,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Edit3 size={13} />
              <span>{isEditingSchedule ? 'Close Editor' : 'Reschedule'}</span>
            </button>
          )}

          {/* Skip Next Delivery */}
          {nextDelivery.assignmentId && (
            <button
              type="button"
              className="v-pill-btn"
              disabled={skippingDelivery}
              onClick={() => void handleSkipNext()}
              title="Postpone this section by 1 day"
              style={{
                padding: '6px 12px',
                fontSize: 12,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              {skippingDelivery ? (
                <Loader2 size={13} style={{ animation: 'sams-action-spin .8s linear infinite' }} />
              ) : (
                <FastForward size={13} />
              )}
              <span>Skip (+1 Day)</span>
            </button>
          )}

          {/* Cancel Delivery */}
          {nextDelivery.assignmentId && (
            <button
              type="button"
              className="v-pill-btn"
              disabled={cancellingDelivery}
              onClick={() => void handleCancelDelivery()}
              title="Cancel this scheduled delivery and return section to draft"
              style={{
                padding: '6px 12px',
                fontSize: 12,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                color: 'var(--text-secondary)',
              }}
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
          {nextDelivery.timezone}
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
              Reschedule Delivery for "{book.title}"
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

          {liveEditPreview && (
            <div
              style={{
                fontSize: 12,
                padding: '6px 12px',
                borderRadius: 8,
                background: 'var(--v-glass-bg-subtle)',
                border: '1px solid var(--v-glass-border)',
                color: 'var(--text-primary)',
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
    </article>
  );
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
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [actionNotice, setActionNotice] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');

  // Live second tick + visibility/focus listener
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

  const showFeedback = useCallback((noticeMsg: string, errorMsg?: string) => {
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
  }, []);

  if (books.length === 0) {
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
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
            }}
          >
            <AlarmClock size={20} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: 0.5 }}>
              SCHEDULED BOOK DELIVERIES
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              No books saved yet. Upload a PDF below to schedule automated Telegram lessons.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section style={{ display: 'grid', gap: 14 }}>
      {/* Global Header Bar for Scheduled Deliveries */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlarmClock size={16} color="var(--text-primary)" />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.5, color: 'var(--text-primary)' }}>
            SCHEDULED BOOK DELIVERIES ({books.length} {books.length === 1 ? 'Book' : 'Books'})
          </span>
        </div>

        <button
          type="button"
          className="v-circle-btn"
          onClick={() => setSoundEnabled(s => !s)}
          style={{ width: 28, height: 28 }}
          title={soundEnabled ? 'Alarm chime enabled (click to mute)' : 'Alarm chime muted (click to enable)'}
          aria-label={soundEnabled ? 'Mute alarm chime' : 'Enable alarm chime'}
        >
          {soundEnabled ? <Volume2 size={13} color="var(--text-primary)" /> : <VolumeX size={13} color="var(--text-muted)" />}
        </button>
      </div>

      {/* Global Notice / Error Banners */}
      {actionNotice && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            background: 'var(--v-glass-bg-subtle)',
            border: '1px solid var(--v-glass-border)',
            color: 'var(--text-primary)',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{actionNotice}</span>
          <button type="button" onClick={() => setActionNotice('')} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>
            <X size={12} />
          </button>
        </div>
      )}
      {actionError && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            background: 'var(--v-glass-bg-subtle)',
            border: '1px solid var(--v-glass-border)',
            color: 'var(--text-secondary)',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError('')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* Render each book's schedule independently */}
      <div style={{ display: 'grid', gap: 12 }}>
        {books.map(book => (
          <SingleBookDeliveryCard
            key={book.id}
            book={book}
            assignments={assignmentsByBook[book.id] || []}
            nowMs={nowMs}
            soundEnabled={soundEnabled}
            onAssignmentsUpdated={onAssignmentsUpdated}
            onBookUpdated={onBookUpdated}
            onSendNow={onSendNow}
            onOpenBookAnalytics={onOpenBookAnalytics}
            showFeedback={showFeedback}
          />
        ))}
      </div>
    </section>
  );
}
