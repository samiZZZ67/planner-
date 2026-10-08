'use client';

import React, { useState } from 'react';
import { exportAllDataToJson, importDataFromJson } from '@/lib/data/sampleData';
import { syncEngine } from '@/lib/sync/syncEngine';
import {
  Sun, Moon, Download, Upload, Shield, LogOut, Sparkles, Check, Bell, BellOff, Volume2
} from 'lucide-react';
import {
  getNotificationStatus,
  requestNotificationPermission,
  sendPomodoroNotification,
  type NotificationStatus
} from '@/lib/notifications/notificationManager';

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

  const showMsg = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleExport = async () => {
    try {
      await exportAllDataToJson();
      showMsg('Data exported successfully');
    } catch {
      showMsg('Export failed');
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = await importDataFromJson(text);
      syncEngine.notifyLocalMutation();
      showMsg(`Imported ${result.count} records`);
    } catch (err: any) {
      setImportError(err.message || 'Import failed');
    }
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
              onClick={async () => {
                const res = await requestNotificationPermission();
                setNotifStatus(res);
                if (res === 'granted') {
                  showMsg('Notifications enabled successfully!');
                  await sendPomodoroNotification('test', { taskTitle: 'Test Task' });
                } else if (res === 'denied') {
                  showMsg('Notifications were blocked. Please enable them in your browser site settings.');
                }
              }}
              className="v-pill-btn v-pill-btn-primary"
              style={{ padding: '8px 20px', fontSize: 13 }}
            >
              <Bell size={15} />
              <span>Enable Notifications</span>
            </button>
          )}

          <button
            type="button"
            onClick={async () => {
              await sendPomodoroNotification('test', { taskTitle: 'Sample Task' });
              showMsg('Played chime & sent test notification!');
            }}
            className="v-pill-btn"
            style={{ padding: '8px 18px', fontSize: 13 }}
          >
            <Volume2 size={15} />
            <span>Test Sound & Alert</span>
          </button>
        </div>
      </div>

      {/* ── 3. ACCOUNT & CLOUD DATABASE SYNC ── */}
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
          Night Planner stores everything on your device first in IndexedDB, and automatically synchronizes with your Neon Postgres cloud database when online.
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
            onClick={handleExport}
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

    </div>
  );
}
