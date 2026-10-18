'use client';

import React, { useState, useEffect } from 'react';
import { exportAllDataToJson, importDataFromJson } from '@/lib/data/sampleData';
import { syncEngine } from '@/lib/sync/syncEngine';
import {
  Sun, Moon, Download, Upload, Shield, LogOut, Sparkles, Check, Bell, BellOff, Volume2, Clock, Send
} from 'lucide-react';
import { apiFetch } from '@/lib/api/apiClient';
import { withActionFeedback } from '@/lib/utils/actionFeedback';
import { BriefSchedulingModal } from '../Telegram/BriefSchedulingModal';
import {
  getNotificationStatus,
  requestNotificationPermission,
  sendPomodoroNotification,
  type NotificationStatus
} from '@/lib/notifications/notificationManager';
import { formatEthiopianDate, formatEthiopianDateAmharic } from '@/lib/date/ethiopianCalendar';
import { getEthiopianClock } from '@/lib/date/ethiopianTime';

interface SettingsScreenProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenLogin?: () => void;
  onLogout?: () => void;
  isPhone?: boolean;
}

export function SettingsScreen({
  theme,
  onToggleTheme,
  onOpenLogin,
  onLogout,
  isPhone,
}: SettingsScreenProps) {
  const [message, setMessage] = useState('');
  const [importError, setImportError] = useState('');
  const [notifStatus, setNotifStatus] = useState<NotificationStatus>(getNotificationStatus());
  const [isBriefModalOpen, setIsBriefModalOpen] = useState(false);
  const [calendarMode, setCalendarMode] = useState<'ethiopian' | 'gregorian'>('ethiopian');
  const [nowDate, setNowDate] = useState(() => new Date());

  useEffect(() => {
    const saved = (localStorage.getItem('np_calendar_mode') as 'ethiopian' | 'gregorian') || 'ethiopian';
    setCalendarMode(saved);

    const interval = setInterval(() => setNowDate(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const liveClock = getEthiopianClock(nowDate, 'Africa/Addis_Ababa');
  const todayGreg = nowDate.toLocaleDateString('en-US', {
    timeZone: 'Africa/Addis_Ababa',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const showMsg = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleExport = async (source?: HTMLElement | null) => {
    await withActionFeedback('Exporting backup', async () => {
      try {
        await exportAllDataToJson();
        showMsg('Data exported successfully');
      } catch (error) {
        showMsg('Export failed');
        throw error;
      }
    }, source);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const source = e.currentTarget;
    setImportError('');
    await withActionFeedback('Importing backup', async () => {
      try {
        const text = await file.text();
        const result = await importDataFromJson(text);
        syncEngine.notifyLocalMutation();
        showMsg(`Imported ${result.count} records`);
      } catch (err: any) {
        setImportError(err.message || 'Import failed');
        throw err;
      } finally {
        if (source.isConnected) source.value = '';
      }
    }, source);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%', maxWidth: 640 }}>

      {message && (
        <div
          className="v-card"
          style={{
            padding: '12px 18px',
            background: 'rgba(34, 197, 94, 0.15)',
            borderColor: 'rgba(34, 197, 94, 0.35)',
            color: '#22c55e',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Check size={16} />
          <span>{message}</span>
        </div>
      )}

      {/* Header */}
      <div
        className="v-card"
        style={{
          padding: isPhone ? '18px 16px' : '22px 28px',
        }}
      >
        <h1
          className="font-bloody"
          style={{
            fontSize: isPhone ? 28 : 36,
            margin: 0,
            lineHeight: 1,
            color: 'var(--text-primary)',
          }}
        >
          SETTINGS
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          Theme customization, cloud database sync, and data backup
        </p>
      </div>

      {/* ── 1. APPEARANCE (Glass Effect Mode) ── */}
      <div
        className="v-card"
        style={{
          padding: isPhone ? '18px 16px' : '22px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          APPEARANCE & GLASS EFFECT
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
              {theme === 'dark' ? 'Obsidian Dark Glass' : 'High-Contrast White Glass'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {theme === 'dark'
                ? 'Deep dark frosted glass with specular edge reflections'
                : 'Proper white frosted glass with visible borders and shadows'}
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleTheme}
            className="v-pill-btn"
            style={{
              padding: '8px 20px',
              fontSize: 13,
            }}
          >
            {theme === 'dark' ? (
              <>
                <Sun size={15} style={{ color: '#f59e0b' }} />
                <span>Switch to White Glass</span>
              </>
            ) : (
              <>
                <Moon size={15} style={{ color: '#38bdf8' }} />
                <span>Switch to Dark Glass</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── 2. POMODORO NOTIFICATIONS & AUDIO ALERTS ── */}
      <div
        className="v-card"
        style={{
          padding: isPhone ? '18px 16px' : '22px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
            POMODORO NOTIFICATIONS
          </div>

          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 6,
              background:
                notifStatus === 'granted'
                  ? 'rgba(34, 197, 94, 0.2)'
                  : notifStatus === 'denied'
                  ? 'rgba(239, 68, 68, 0.2)'
                  : 'rgba(56, 189, 248, 0.2)',
              color:
                notifStatus === 'granted'
                  ? '#22c55e'
                  : notifStatus === 'denied'
                  ? '#ef4444'
                  : 'var(--accent-color)',
            }}
          >
            {notifStatus === 'granted'
              ? 'Active (Online & Offline)'
              : notifStatus === 'denied'
              ? 'Blocked by Browser'
              : 'Permission Needed'}
          </span>
        </div>

        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Notifications alert you when 25-minute Pomodoro focus blocks begin, when it is time for a 5-minute break, and when your task goal is completed. Both online and offline devices are supported.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {notifStatus !== 'granted' && (
            <button
              type="button"
              onClick={event => { void withActionFeedback('Enabling notifications', async () => {
                const res = await requestNotificationPermission();
                setNotifStatus(res);
                if (res === 'granted') {
                  showMsg('Notifications enabled successfully!');
                  await sendPomodoroNotification('test', { taskTitle: 'Test Task' });
                } else if (res === 'denied') {
                  showMsg('Notifications were blocked. Please enable them in your browser site settings.');
                }
              }, event.currentTarget); }}
              className="v-pill-btn v-pill-btn-primary"
              style={{ padding: '8px 20px', fontSize: 13 }}
            >
              <Bell size={15} />
              <span>Enable Notifications</span>
            </button>
          )}

          <button
            type="button"
            onClick={event => { void withActionFeedback('Testing sound and alert', async () => {
              await sendPomodoroNotification('test', { taskTitle: 'Sample Task' });
              showMsg('Played chime & sent test notification!');
            }, event.currentTarget); }}
            className="v-pill-btn"
            style={{ padding: '8px 18px', fontSize: 13 }}
          >
            <Volume2 size={15} />
            <span>Test Sound & Alert</span>
          </button>
        </div>
      </div>

      {/* ── 3. AI PROVIDERS & MODEL CONFIGURATION ── */}
      <AIProviderSettingsSection showMsg={showMsg} isPhone={isPhone} />

      {/* ── 4. TELEGRAM AUTOMATION & DAILY BRIEFS ── */}
      <div
        className="v-card"
        style={{
          padding: isPhone ? '18px 16px' : '22px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
            TELEGRAM AUTOMATION & DAILY BRIEFS
          </div>
          <span style={{ fontSize: 11, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            Active (UTC+3 / EAT)
          </span>
        </div>

        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Automatically sends your morning daily focus plan (08:00 EAT / ጠዋት 2:00) and evening reflection review (20:00 EAT / ማታ 2:00) directly to your Telegram channel. Supports Ethiopian calendar & Habesha clock displays, manual overrides, content attachments, and schedule skips.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setIsBriefModalOpen(true)}
            className="v-pill-btn v-pill-btn-primary"
            style={{ padding: '8px 18px', fontSize: 13, gap: 6 }}
          >
            <Clock size={14} />
            <span>Manage Daily Brief Schedules & Overrides</span>
          </button>
        </div>
      </div>

      {/* ── 5. ETHIOPIAN CALENDAR & TRADITIONAL HABESHA CLOCK ── */}
      <div
        className="v-card"
        style={{
          padding: isPhone ? '18px 16px' : '22px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
            ETHIOPIAN CALENDAR & HABESHA CLOCK SYSTEM
          </div>
          <span style={{ fontSize: 11, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8', display: 'inline-block' }} />
            Africa/Addis_Ababa (UTC+3)
          </span>
        </div>

        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          NightPlanner supports the traditional Ethiopian clock (12-hour cycle starting at 6:00 AM dawn as 12:00 am) and full Ethiopian calendar (all 13 months including Pagume, leap years, and New Year transitions).
        </p>

        {/* Live dual clock pill */}
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--v-glass-bg-subtle)',
            borderRadius: 12,
            border: '1px solid var(--v-glass-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
            Live Addis Ababa Clock & Dual Calendar:
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            🕒 {liveClock.internationalTime} ({liveClock.internationalTime12h}) · <span style={{ color: 'var(--accent-color)' }}>🇪🇹 {liveClock.ethiopianTimeStr}</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            📅 {todayGreg} · <span style={{ color: 'var(--accent-color)', fontWeight: 600 }}>🇪🇹 {liveClock.ethiopianDateStr} ({liveClock.ethiopianDateAmStr})</span>
          </div>
        </div>

        {/* Boundary Selection */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
            Daily Task Grouping & Boundary Mode:
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => {
                setCalendarMode('ethiopian');
                localStorage.setItem('np_calendar_mode', 'ethiopian');
                showMsg('Ethiopian mode active: daily boundary is 6:00 AM dawn.');
              }}
              className={`v-pill-btn${calendarMode === 'ethiopian' ? ' v-pill-btn-primary' : ''}`}
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              <span>🇪🇹 Ethiopian Day Boundary (6:00 AM Dawn)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setCalendarMode('gregorian');
                localStorage.setItem('np_calendar_mode', 'gregorian');
                showMsg('Gregorian mode active: daily boundary is 12:00 AM midnight.');
              }}
              className={`v-pill-btn${calendarMode === 'gregorian' ? ' v-pill-btn-primary' : ''}`}
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              <span>Standard Gregorian Midnight (12:00 AM)</span>
            </button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
            {calendarMode === 'ethiopian'
              ? 'Tasks scheduled between 12:00 AM and 5:59 AM belong to the traditional Ethiopian day that started at 6:00 AM yesterday. At 6:00 AM, the new day starts.'
              : 'Tasks are grouped by standard midnight-to-midnight international calendar boundaries.'}
          </p>
        </div>
      </div>

      {/* ── 6. ACCOUNT & CLOUD DATABASE SYNC ── */}
      <div
        className="v-card"
        style={{
          padding: isPhone ? '18px 16px' : '22px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          CLOUD DATABASE SYNC
        </div>

        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Sam'Space stores everything on your device first in IndexedDB, and automatically synchronizes with your Neon Postgres cloud database when online.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {onOpenLogin && (
            <button
              type="button"
              onClick={onOpenLogin}
              className="v-pill-btn v-pill-btn-primary"
              style={{ padding: '8px 20px', fontSize: 13 }}
            >
              Sign In to Cloud
            </button>
          )}

          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="v-pill-btn"
              style={{ padding: '8px 18px', fontSize: 13, color: '#f87171' }}
            >
              <LogOut size={14} />
              <span>Sign Out</span>
            </button>
          )}
        </div>
      </div>

      {/* ── 3. BACKUP & RESTORE ── */}
      <div
        className="v-card"
        style={{
          padding: isPhone ? '18px 16px' : '22px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          DATA BACKUP & RESTORE
        </div>

        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Export all your tasks, strategies, and Pomodoro time logs into a single portable JSON file, or restore them anytime.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
              onClick={event => { void handleExport(event.currentTarget); }}
            className="v-pill-btn"
            style={{ padding: '8px 18px', fontSize: 13 }}
          >
            <Download size={14} />
            <span>Export JSON</span>
          </button>

          <label
            className="v-pill-btn"
            style={{ padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}
          >
            <Upload size={14} />
            <span>Import JSON</span>
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
        </div>

        {importError && (
          <div style={{ fontSize: 12, color: '#f87171' }}>
            {importError}
          </div>
        )}
      </div>

      <BriefSchedulingModal
        isOpen={isBriefModalOpen}
        onClose={() => setIsBriefModalOpen(false)}
        isPhone={isPhone}
      />
    </div>
  );
}

function AIProviderSettingsSection({ showMsg, isPhone }: { showMsg: (msg: string) => void; isPhone?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<any>(null);

  const [activeProvider, setActiveProvider] = useState('auto');
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [geminiModel, setGeminiModel] = useState('gemini-3.5-flash');
  const [groqModel, setGroqModel] = useState('openai/gpt-oss-20b');

  const loadConfig = async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/api/ai/config');
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        setActiveProvider(data.activeProviderId || 'auto');
        setFallbackEnabled(Boolean(data.fallbackEnabled));
        const g1 = data.providers?.find((p: any) => p.id === 'gemini-1');
        if (g1) setGeminiModel(g1.model || 'gemini-3.5-flash');
        const grq = data.providers?.find((p: any) => p.id === 'groq-1');
        if (grq) setGroqModel(grq.model || 'openai/gpt-oss-20b');
      }
    } catch {
      // Offline fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await apiFetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activeProviderId: activeProvider,
          fallbackEnabled,
          modelOverrides: {
            'gemini-1': geminiModel,
            'gemini-2': geminiModel,
            'gemini-3': geminiModel,
            'groq-1': groqModel,
            'groq-2': groqModel,
            'groq-3': groqModel,
          },
        }),
      });

      if (res.ok) {
        showMsg('AI provider configuration saved successfully!');
        loadConfig();
      } else {
        showMsg('Failed to save configuration.');
      }
    } catch {
      showMsg('Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="v-card"
      style={{
        padding: isPhone ? '18px 16px' : '22px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          AI PROVIDERS & MODEL CONFIGURATION
        </div>
        <button
          type="button"
          onClick={loadConfig}
          className="v-circle-btn"
          style={{ width: 28, height: 28 }}
          title="Refresh Provider Status"
        >
          <Sparkles size={12} color="var(--accent-color)" />
        </button>
      </div>

      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Configure Groq Cloud (up to 3 keys) and Google Gemini (up to 3 keys). Groq provides instant, ultra-fast inference to eliminate limits and delays. Keys are stored safely in server environment variables (<code style={{ color: 'var(--accent-color)' }}>.env.local</code>) and are never exposed to the client.
      </p>

      {/* Provider Slots Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : 'repeat(2, 1fr)', gap: 10 }}>
        {config?.providers?.map((p: any) => (
          <div
            key={p.id}
            style={{
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--v-glass-bg-subtle)',
              border: `1.5px solid ${p.configured ? 'rgba(34, 197, 94, 0.3)' : 'var(--v-glass-border-subtle)'}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                {p.name}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: p.configured ? '#22c55e' : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {p.configured ? '● Configured' : '○ Missing Key'}
              </span>
            </div>

            {p.id === 'groq-1' && (
              <div style={{ marginTop: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Model:</label>
                <select
                  value={groqModel}
                  onChange={e => setGroqModel(e.target.value)}
                  className="v-input"
                  style={{ fontSize: 12, minHeight: 32, padding: '4px 8px' }}
                >
                  <option value="openai/gpt-oss-20b">openai/gpt-oss-20b (Active & Free - Ultra Fast)</option>
                  <option value="openai/gpt-oss-120b">openai/gpt-oss-120b (Frontier 120B Reasoning)</option>
                  <option value="qwen/qwen3.8-27b">qwen/qwen3.8-27b</option>
                  <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile</option>
                  <option value="llama-3.1-8b-instant">llama-3.1-8b-instant</option>
                  <option value="mixtral-8x7b-32768">mixtral-8x7b-32768</option>
                </select>
              </div>
            )}

            {p.id === 'gemini-1' && (
              <div style={{ marginTop: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Model:</label>
                <select
                  value={geminiModel}
                  onChange={e => setGeminiModel(e.target.value)}
                  className="v-input"
                  style={{ fontSize: 12, minHeight: 32, padding: '4px 8px' }}
                >
                  <option value="gemini-3.5-flash">gemini-3.5-flash (Fast & Stable)</option>
                  <option value="gemini-3.8-flash">gemini-3.8-flash (Frontier Reasoning)</option>
                  <option value="gemini-flash-latest">gemini-flash-latest (Auto-Updating)</option>
                  <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Ultra-Lightweight)</option>
                  <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                  <option value="gemini-1.5-flash">gemini-1.5-flash (Legacy)</option>
                </select>
              </div>
            )}

            {p.isRateLimited && (
              <span style={{ fontSize: 11, color: '#f59e0b' }}>
                ⏳ Rate limit cooldown active
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Active Provider & Fallback Settings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
            Primary Active Provider
          </label>
          <select
            value={activeProvider}
            onChange={e => setActiveProvider(e.target.value)}
            className="v-input"
            style={{ fontSize: 13 }}
          >
            <option value="auto">Auto (Smart Fallback across Groq & Gemini keys)</option>
            <option value="groq-1">Groq Cloud (Key 1 - Ultra Fast)</option>
            <option value="groq-2">Groq Cloud (Key 2)</option>
            <option value="groq-3">Groq Cloud (Key 3)</option>
            <option value="gemini-1">Google Gemini (Key 1)</option>
            <option value="gemini-2">Google Gemini (Key 2)</option>
            <option value="gemini-3">Google Gemini (Key 3)</option>
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={fallbackEnabled}
            onChange={e => setFallbackEnabled(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: 'var(--accent-color)' }}
          />
          <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
            Automatic fallback to another provider if primary is rate-limited or fails
          </span>
        </label>
      </div>

      {/* Token Usage Stats */}
      {config?.totalTokensUsed && (
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)' }}>
          <span>Session Tokens: <strong style={{ color: 'var(--text-primary)' }}>{config.totalTokensUsed.total || 0}</strong></span>
          <span>(Prompt: {config.totalTokensUsed.prompt || 0} / Completion: {config.totalTokensUsed.completion || 0})</span>
        </div>
      )}

      {/* Save Button */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="v-pill-btn v-pill-btn-primary"
          style={{ padding: '8px 24px', fontSize: 13 }}
        >
          {saving ? 'Saving…' : 'Save AI Settings'}
        </button>
      </div>
    </div>
  );
}
