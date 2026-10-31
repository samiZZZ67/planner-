'use client';

import React, { useState, useEffect } from 'react';
import {
  X, Clock, Send, CheckCircle2, AlertTriangle, RefreshCw, Calendar,
  Bell, ChevronDown, ChevronUp, Edit3, SkipForward, FileText, Check, Shield,
  HelpCircle, Award, Sparkles, BookOpen
} from 'lucide-react';
import { apiFetch } from '@/lib/api/apiClient';
import type { BriefStatusInfo, BriefType } from '@/lib/server/scheduler/briefs';

interface BriefSchedulingModalProps {
  isOpen: boolean;
  onClose: () => void;
  isPhone?: boolean;
}

export function BriefSchedulingModal({
  isOpen,
  onClose,
  isPhone = false,
}: BriefSchedulingModalProps) {
  const [loading, setLoading] = useState(true);
  const [statusInfo, setStatusInfo] = useState<BriefStatusInfo | null>(null);
  const [channelInfo, setChannelInfo] = useState<any>(null);
  const [previews, setPreviews] = useState<{ morning: string; evening: string }>({ morning: '', evening: '' });

  // Action states
  const [sendingType, setSendingType] = useState<BriefType | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');

  // Editing state
  const [editingType, setEditingType] = useState<BriefType | null>(null);
  const [editTime, setEditTime] = useState<string>('');
  const [editNote, setEditNote] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Previews collapsible state
  const [showPreview, setShowPreview] = useState<'morning' | 'evening' | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Quiz Mode states
  const [quizSettings, setQuizSettings] = useState<{
    enabled: boolean;
    questionsPerSection: number;
    deliveryTiming: 'with_reading' | 'on_demand';
    revealExplanation: 'after_answer' | 'immediate';
  }>({
    enabled: true,
    questionsPerSection: 2,
    deliveryTiming: 'with_reading',
    revealExplanation: 'after_answer',
  });
  const [activeQuizSession, setActiveQuizSession] = useState<any>(null);
  const [syncingQuiz, setSyncingQuiz] = useState(false);
  const [savingQuiz, setSavingQuiz] = useState(false);
  const [showQuizSection, setShowQuizSection] = useState(true);

  const loadData = async () => {
    try {
      setLoading(true);
      setActionError('');
      const [briefRes, quizRes] = await Promise.all([
        apiFetch('/api/telegram/briefs'),
        apiFetch('/api/telegram/quiz').catch(() => null),
      ]);
      const data = await briefRes.json();
      if (!briefRes.ok) throw new Error(data.error || 'Failed to load brief schedule status.');
      setStatusInfo(data.status);
      setChannelInfo(data.channel);
      if (data.previews) setPreviews(data.previews);

      if (quizRes && quizRes.ok) {
        const quizData = await quizRes.json();
        if (quizData.settings) setQuizSettings(quizData.settings);
        if (quizData.activeSession) setActiveQuizSession(quizData.activeSession);
      }
    } catch (err: any) {
      setActionError(err.message || 'Could not fetch brief schedule.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveQuizSettings = async () => {
    setSavingQuiz(true);
    setActionSuccess('');
    setActionError('');
    try {
      const res = await apiFetch('/api/telegram/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_settings', ...quizSettings }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save quiz settings.');
      setQuizSettings(data.settings);
      setActionSuccess('🎯 Interactive Book Quiz settings saved!');
    } catch (err: any) {
      setActionError(err.message || 'Could not save quiz settings.');
    } finally {
      setSavingQuiz(false);
    }
  };

  const handleSyncQuizUpdates = async () => {
    setSyncingQuiz(true);
    setActionSuccess('');
    setActionError('');
    try {
      const res = await apiFetch('/api/telegram/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'process_updates' }),
      });
      const data = await res.json();
      if (data.ok) {
        setActionSuccess(`📬 Processed ${data.result?.processedCount || 0} Telegram update(s).`);
        await loadData();
      }
    } catch (err: any) {
      setActionError('Could not sync Telegram updates.');
    } finally {
      setSyncingQuiz(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const handleSendNow = async (briefType: BriefType) => {
    setSendingType(briefType);
    setActionSuccess('');
    setActionError('');
    try {
      const res = await apiFetch('/api/telegram/briefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_now', briefType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send brief now.');
      setActionSuccess(`🚀 ${briefType === 'morning' ? 'Morning Brief' : 'Evening Review'} delivered to Telegram channel ${data.channel}!`);
      await loadData();
    } catch (err: any) {
      setActionError(err.message || 'Send Now failed.');
    } finally {
      setSendingType(null);
    }
  };

  const handleToggleEnable = async (enabled: boolean) => {
    try {
      const res = await apiFetch('/api/telegram/briefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_config', enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update enable status.');
      setStatusInfo(data.status);
      setActionSuccess(`Automatic scheduling is now ${enabled ? 'Enabled' : 'Disabled'}.`);
    } catch (err: any) {
      setActionError(err.message || 'Failed to update schedule.');
    }
  };

  const handleSkipNext = async (briefType: BriefType) => {
    try {
      const res = await apiFetch('/api/telegram/briefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'override', briefType, skipNext: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to skip brief.');
      setStatusInfo(data.status);
      setActionSuccess(`Upcoming ${briefType} brief has been skipped for today.`);
    } catch (err: any) {
      setActionError(err.message || 'Failed to skip.');
    }
  };

  const handleUnskip = async (briefType: BriefType) => {
    try {
      const res = await apiFetch('/api/telegram/briefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'override', briefType, unskip: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to restore brief.');
      setStatusInfo(data.status);
      setActionSuccess(`Restored upcoming ${briefType} brief delivery.`);
    } catch (err: any) {
      setActionError(err.message || 'Failed to restore.');
    }
  };

  const handleSaveOverride = async (briefType: BriefType) => {
    setSavingEdit(true);
    try {
      const body: any = { action: 'override', briefType };
      if (editTime) body.overrideTime = editTime;
      if (editNote) body.temporaryContent = editNote;

      const res = await apiFetch('/api/telegram/briefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save override.');
      setStatusInfo(data.status);
      setEditingType(null);
      setEditTime('');
      setEditNote('');
      setActionSuccess(`Saved override for upcoming ${briefType} brief.`);
    } catch (err: any) {
      setActionError(err.message || 'Failed to save override.');
    } finally {
      setSavingEdit(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(5, 5, 12, 0.72)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        padding: 16,
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="v-card"
        style={{
          width: '100%',
          maxWidth: 680,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 24,
          padding: 0,
          overflow: 'hidden',
          background: 'var(--v-glass-bg-card)',
          border: '1.5px solid var(--v-glass-border)',
          boxShadow: 'var(--v-shadow-spatial)',
          color: 'var(--text-primary)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px',
            borderBottom: '1px solid var(--v-glass-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.25), rgba(59, 130, 246, 0.25))',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--accent-color)',
              }}
            >
              <Clock size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Automatic Brief Scheduling</h2>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Morning & Evening Telegram Briefings · East Africa Time (EAT) & Habesha Clock
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
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Notifications */}
          {actionSuccess && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                color: '#ffffff',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <CheckCircle2 size={16} />
              <span>{actionSuccess}</span>
            </div>
          )}

          {actionError && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                color: 'var(--text-secondary)',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <AlertTriangle size={16} />
              <span>{actionError}</span>
            </div>
          )}

          {/* Clock & Calendar Status Pill */}
          {statusInfo && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: 16,
                background: 'var(--v-glass-bg-subtle)',
                border: '1px solid var(--v-glass-border)',
                display: 'grid',
                gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr',
                gap: 12,
                fontSize: 12,
              }}
            >
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>🌍 INTERNATIONAL TIME</div>
                <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>
                  {statusInfo.currentLocalTime} · {statusInfo.currentLocalDate}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginTop: 2 }}>
                  Timezone: <b>{statusInfo.currentTimezone}</b> (UTC+3)
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>🇪🇹 TRADITIONAL ETHIOPIAN CLOCK</div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--accent-color)', marginTop: 2 }}>
                  {statusInfo.currentHabeshaTime}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginTop: 2 }}>
                  Ge'ez Calendar: <b>{statusInfo.currentHabeshaDate}</b>
                </div>
              </div>
            </div>
          )}

          {/* Master Enable / Telegram Channel Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              borderRadius: 14,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--v-glass-border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: channelInfo?.canPost ? '#ffffff' : '#71717a',
                }}
              />
              <span style={{ fontSize: 12 }}>
                Channel: <b>{channelInfo?.channel?.title || '@SamSpac'}</b> · Bot: <b>@{channelInfo?.bot?.username || 'SamISpace_bot'}</b>
              </span>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
              <span>Auto Delivery</span>
              <input
                type="checkbox"
                checked={statusInfo?.config.enabled ?? true}
                onChange={e => handleToggleEnable(e.target.checked)}
                style={{ accentColor: 'var(--accent-color)', cursor: 'pointer' }}
              />
            </label>
          </div>

          {/* Morning Brief Card */}
          <div
            style={{
              padding: 16,
              borderRadius: 18,
              background: 'var(--v-glass-bg-subtle)',
              border: '1.5px solid var(--v-glass-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>🌅</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Morning Brief</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Daily deep work priorities, scheduled focus slots, reading goals & focus budget
                  </div>
                </div>
              </div>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  background: statusInfo?.morning.isDeliveredToday
                    ? 'rgba(255, 255, 255, 0.15)'
                    : 'rgba(255, 255, 255, 0.06)',
                  color: statusInfo?.morning.isDeliveredToday
                    ? '#ffffff'
                    : 'var(--text-muted)',
                }}
              >
                {statusInfo?.morning.isDeliveredToday
                  ? 'Delivered Today'
                  : statusInfo?.morning.isSkippedToday
                  ? 'Skipped for Today'
                  : 'Scheduled'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : 'repeat(3, 1fr)', gap: 8, fontSize: 12 }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Default Time:</span>
                <div style={{ fontWeight: 600 }}>{statusInfo?.morning.configuredTime || '08:00'} EAT</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Habesha Clock:</span>
                <div style={{ fontWeight: 600, color: 'var(--accent-color)' }}>{statusInfo?.morning.habeshaTime || 'ጠዋት 2:00'}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Next Delivery:</span>
                <div style={{ fontWeight: 600 }}>{statusInfo?.morning.nextScheduledHabesha || 'Tomorrow 08:00'}</div>
              </div>
            </div>

            {/* Morning Actions */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                type="button"
                disabled={sendingType === 'morning'}
                onClick={() => handleSendNow('morning')}
                className="v-pill-btn v-pill-btn-primary"
                style={{ padding: '6px 14px', fontSize: 11, gap: 5 }}
              >
                <Send size={12} />
                <span>{sendingType === 'morning' ? 'Dispatching…' : 'Send Now'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEditingType(editingType === 'morning' ? null : 'morning');
                  setEditTime(statusInfo?.morning.effectiveTime || '08:00');
                  setEditNote(statusInfo?.config.temporaryMorningContent || '');
                }}
                className="v-pill-btn"
                style={{ padding: '6px 12px', fontSize: 11, gap: 5 }}
              >
                <Edit3 size={12} />
                <span>Edit Next / Note</span>
              </button>

              {statusInfo?.morning.isSkippedToday ? (
                <button
                  type="button"
                  onClick={() => handleUnskip('morning')}
                  className="v-pill-btn"
                  style={{ padding: '6px 12px', fontSize: 11, gap: 5, color: 'var(--text-secondary)' }}
                >
                  <RefreshCw size={12} />
                  <span>Unskip Today</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={statusInfo?.morning.isDeliveredToday}
                  onClick={() => handleSkipNext('morning')}
                  className="v-pill-btn"
                  style={{ padding: '6px 12px', fontSize: 11, gap: 5 }}
                >
                  <SkipForward size={12} />
                  <span>Skip Next</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowPreview(showPreview === 'morning' ? null : 'morning')}
                className="v-pill-btn"
                style={{ padding: '6px 12px', fontSize: 11, gap: 5, marginLeft: 'auto' }}
              >
                <FileText size={12} />
                <span>Preview</span>
              </button>
            </div>

            {/* Inline Editor for Morning */}
            {editingType === 'morning' && (
              <div style={{ marginTop: 8, padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid var(--v-glass-border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Temporary Override for Next Morning Brief</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Next Time:</label>
                  <input
                    type="time"
                    value={editTime}
                    onChange={e => setEditTime(e.target.value)}
                    style={{ padding: '4px 8px', borderRadius: 8, background: 'var(--v-glass-bg-card)', border: '1px solid var(--v-glass-border)', color: 'inherit', fontSize: 12 }}
                  />
                </div>
                <textarea
                  value={editNote}
                  onChange={e => setEditNote(e.target.value)}
                  placeholder="Attach a temporary custom note to tomorrow's brief..."
                  rows={2}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 8, background: 'var(--v-glass-bg-card)', border: '1px solid var(--v-glass-border)', color: 'inherit', fontSize: 11, resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setEditingType(null)} className="v-pill-btn" style={{ fontSize: 11, padding: '4px 10px' }}>Cancel</button>
                  <button type="button" disabled={savingEdit} onClick={() => handleSaveOverride('morning')} className="v-pill-btn v-pill-btn-primary" style={{ fontSize: 11, padding: '4px 12px' }}>
                    {savingEdit ? 'Saving…' : 'Save Override'}
                  </button>
                </div>
              </div>
            )}

            {/* Preview Box for Morning */}
            {showPreview === 'morning' && previews.morning && (
              <div style={{ marginTop: 6, padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--v-glass-border)', fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>
                <div dangerouslySetInnerHTML={{ __html: previews.morning.replace(/<b>/g, '<strong>').replace(/<\/b>/g, '</strong>').replace(/<i>/g, '<em>').replace(/<\/i>/g, '</em>') }} />
              </div>
            )}
          </div>

          {/* Evening Review Card */}
          <div
            style={{
              padding: 16,
              borderRadius: 18,
              background: 'var(--v-glass-bg-subtle)',
              border: '1.5px solid var(--v-glass-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>🌙</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Evening Review</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Task completion rates, rollover of incomplete tasks & psychological debrief
                  </div>
                </div>
              </div>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  background: statusInfo?.evening.isDeliveredToday
                    ? 'rgba(255, 255, 255, 0.15)'
                    : 'rgba(255, 255, 255, 0.06)',
                  color: statusInfo?.evening.isDeliveredToday
                    ? '#ffffff'
                    : 'var(--text-muted)',
                }}
              >
                {statusInfo?.evening.isDeliveredToday
                  ? 'Delivered Today'
                  : statusInfo?.evening.isSkippedToday
                  ? 'Skipped for Today'
                  : 'Scheduled'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : 'repeat(3, 1fr)', gap: 8, fontSize: 12 }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Default Time:</span>
                <div style={{ fontWeight: 600 }}>{statusInfo?.evening.configuredTime || '20:00'} EAT (8:00 PM)</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Habesha Clock:</span>
                <div style={{ fontWeight: 600, color: 'var(--accent-color)' }}>{statusInfo?.evening.habeshaTime || 'ማታ 2:00'}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Next Delivery:</span>
                <div style={{ fontWeight: 600 }}>{statusInfo?.evening.nextScheduledHabesha || 'Tonight 20:00'}</div>
              </div>
            </div>

            {/* Evening Actions */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                type="button"
                disabled={sendingType === 'evening'}
                onClick={() => handleSendNow('evening')}
                className="v-pill-btn v-pill-btn-primary"
                style={{ padding: '6px 14px', fontSize: 11, gap: 5 }}
              >
                <Send size={12} />
                <span>{sendingType === 'evening' ? 'Dispatching…' : 'Send Now'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEditingType(editingType === 'evening' ? null : 'evening');
                  setEditTime(statusInfo?.evening.effectiveTime || '20:00');
                  setEditNote(statusInfo?.config.temporaryEveningContent || '');
                }}
                className="v-pill-btn"
                style={{ padding: '6px 12px', fontSize: 11, gap: 5 }}
              >
                <Edit3 size={12} />
                <span>Edit Next / Note</span>
              </button>

              {statusInfo?.evening.isSkippedToday ? (
                <button
                  type="button"
                  onClick={() => handleUnskip('evening')}
                  className="v-pill-btn"
                  style={{ padding: '6px 12px', fontSize: 11, gap: 5, color: 'var(--text-secondary)' }}
                >
                  <RefreshCw size={12} />
                  <span>Unskip Today</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={statusInfo?.evening.isDeliveredToday}
                  onClick={() => handleSkipNext('evening')}
                  className="v-pill-btn"
                  style={{ padding: '6px 12px', fontSize: 11, gap: 5 }}
                >
                  <SkipForward size={12} />
                  <span>Skip Next</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowPreview(showPreview === 'evening' ? null : 'evening')}
                className="v-pill-btn"
                style={{ padding: '6px 12px', fontSize: 11, gap: 5, marginLeft: 'auto' }}
              >
                <FileText size={12} />
                <span>Preview</span>
              </button>
            </div>

            {/* Inline Editor for Evening */}
            {editingType === 'evening' && (
              <div style={{ marginTop: 8, padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid var(--v-glass-border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Temporary Override for Next Evening Review</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Next Time:</label>
                  <input
                    type="time"
                    value={editTime}
                    onChange={e => setEditTime(e.target.value)}
                    style={{ padding: '4px 8px', borderRadius: 8, background: 'var(--v-glass-bg-card)', border: '1px solid var(--v-glass-border)', color: 'inherit', fontSize: 12 }}
                  />
                </div>
                <textarea
                  value={editNote}
                  onChange={e => setEditNote(e.target.value)}
                  placeholder="Attach a temporary custom note to tonight's review..."
                  rows={2}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 8, background: 'var(--v-glass-bg-card)', border: '1px solid var(--v-glass-border)', color: 'inherit', fontSize: 11, resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setEditingType(null)} className="v-pill-btn" style={{ fontSize: 11, padding: '4px 10px' }}>Cancel</button>
                  <button type="button" disabled={savingEdit} onClick={() => handleSaveOverride('evening')} className="v-pill-btn v-pill-btn-primary" style={{ fontSize: 11, padding: '4px 12px' }}>
                    {savingEdit ? 'Saving…' : 'Save Override'}
                  </button>
                </div>
              </div>
            )}

            {/* Preview Box for Evening */}
            {showPreview === 'evening' && previews.evening && (
              <div style={{ marginTop: 6, padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--v-glass-border)', fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>
                <div dangerouslySetInnerHTML={{ __html: previews.evening.replace(/<b>/g, '<strong>').replace(/<\/b>/g, '</strong>').replace(/<i>/g, '<em>').replace(/<\/i>/g, '</em>') }} />
              </div>
            )}
          </div>

          {/* Interactive Telegram Book Quiz Mode Card */}
          <div
            style={{
              padding: 16,
              borderRadius: 18,
              background: 'var(--v-glass-bg-subtle)',
              border: '1.5px solid var(--v-glass-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>🎯</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Interactive Book Quiz Mode</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Native Telegram quiz polls, section navigation, learning feedback cards & answer tracking
                  </div>
                </div>
              </div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  color: quizSettings.enabled ? '#ffffff' : 'var(--text-muted)',
                }}
              >
                <input
                  type="checkbox"
                  checked={quizSettings.enabled}
                  onChange={e => setQuizSettings(s => ({ ...s, enabled: e.target.checked }))}
                  style={{ accentColor: 'var(--accent-color)', width: 16, height: 16 }}
                />
                <span>{quizSettings.enabled ? 'Active' : 'Disabled'}</span>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : 'repeat(3, 1fr)', gap: 10, fontSize: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Questions per Section:
                </label>
                <select
                  value={quizSettings.questionsPerSection}
                  onChange={e => setQuizSettings(s => ({ ...s, questionsPerSection: Number(e.target.value) }))}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: 8,
                    background: 'var(--v-glass-bg-card)',
                    border: '1px solid var(--v-glass-border)',
                    color: 'inherit',
                    fontSize: 12,
                  }}
                >
                  <option value={1}>1 Question</option>
                  <option value={2}>2 Questions (Recommended)</option>
                  <option value={3}>3 Questions</option>
                  <option value={4}>4 Questions</option>
                  <option value={5}>5 Questions</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Delivery Timing:
                </label>
                <select
                  value={quizSettings.deliveryTiming}
                  onChange={e => setQuizSettings(s => ({ ...s, deliveryTiming: e.target.value as any }))}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: 8,
                    background: 'var(--v-glass-bg-card)',
                    border: '1px solid var(--v-glass-border)',
                    color: 'inherit',
                    fontSize: 12,
                  }}
                >
                  <option value="with_reading">With Reading Excerpt</option>
                  <option value="on_demand">On-Demand Button</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Reveal Explanation:
                </label>
                <select
                  value={quizSettings.revealExplanation}
                  onChange={e => setQuizSettings(s => ({ ...s, revealExplanation: e.target.value as any }))}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: 8,
                    background: 'var(--v-glass-bg-card)',
                    border: '1px solid var(--v-glass-border)',
                    color: 'inherit',
                    fontSize: 12,
                  }}
                >
                  <option value="after_answer">After Answering / Tap</option>
                  <option value="immediate">Immediately with Card</option>
                </select>
              </div>
            </div>

            {/* Active Quiz Session Indicator */}
            {activeQuizSession && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <span style={{ fontWeight: 600 }}>Active Session:</span> {activeQuizSession.bookTitle} (Day {activeQuizSession.dayNumber})
                  <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                    Section {activeQuizSession.currentSectionIndex + 1}/{activeQuizSession.totalSections} · Score: {activeQuizSession.score}
                  </div>
                </div>
                <span style={{ color: '#ffffff', fontWeight: 600 }}>In Progress</span>
              </div>
            )}

            {/* Quiz Actions */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                type="button"
                disabled={savingQuiz}
                onClick={handleSaveQuizSettings}
                className="v-pill-btn v-pill-btn-primary"
                style={{ padding: '6px 14px', fontSize: 11, gap: 5 }}
              >
                <Check size={12} />
                <span>{savingQuiz ? 'Saving…' : 'Save Quiz Settings'}</span>
              </button>

              <button
                type="button"
                disabled={syncingQuiz}
                onClick={handleSyncQuizUpdates}
                className="v-pill-btn"
                style={{ padding: '6px 12px', fontSize: 11, gap: 5 }}
                title="Poll Telegram for new poll answers or callback clicks"
              >
                <RefreshCw size={12} className={syncingQuiz ? 'spin' : ''} />
                <span>{syncingQuiz ? 'Syncing…' : 'Sync Telegram Answers'}</span>
              </button>
            </div>
          </div>

          {/* Delivery History Toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowHistory(v => !v)}
              className="v-pill-btn"
              style={{ width: '100%', justifyContent: 'space-between', padding: '10px 16px', fontSize: 12 }}
            >
              <span>Recent Delivery History ({statusInfo?.recentDeliveries.length || 0})</span>
              {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showHistory && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {statusInfo?.recentDeliveries && statusInfo.recentDeliveries.length > 0 ? (
                  statusInfo.recentDeliveries.map(d => (
                    <div
                      key={d.id}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 10,
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid var(--v-glass-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 11,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{d.briefType === 'morning' ? '🌅' : '🌙'}</span>
                        <div>
                          <div style={{ fontWeight: 600 }}>
                            {d.briefType === 'morning' ? 'Morning Brief' : 'Evening Review'} · {d.targetDate}
                          </div>
                          <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                            {d.isManualSend ? 'Manual Send Now' : 'Automatic Schedule'}
                            {d.telegramMessageIds.length > 0 && ` · Msg ID: ${d.telegramMessageIds.join(', ')}`}
                          </div>
                        </div>
                      </div>
                      <span
                        style={{
                          padding: '2px 6px',
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: 600,
                          background: d.status === 'completed' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                          color: d.status === 'completed' ? '#ffffff' : 'var(--text-secondary)',
                        }}
                      >
                        {d.status}
                      </span>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                    No delivery history recorded yet.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 24px',
            borderTop: '1px solid var(--v-glass-border)',
            background: 'var(--v-glass-bg-subtle)',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Shield size={12} color="#ffffff" />
            <span>Persistent Node-Cron Scheduler Active (Runs even with browser closed)</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="v-pill-btn"
            style={{ padding: '6px 16px', fontSize: 12 }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
