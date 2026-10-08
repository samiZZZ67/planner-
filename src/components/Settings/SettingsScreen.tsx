'use client';

import React, { useState } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { addFourteenDaysSampleData, removeSampleData, exportAllDataToJson, importDataFromJson } from '@/lib/data/sampleData';
import {
  Sun, Moon, Plus, Trash2, Edit2, LogOut, Download, Upload,
  Database, Shield, Sliders, Palette
} from 'lucide-react';
import type { Section } from '@/types';
import { SECTION_COLORS } from '@/lib/utils/colors';

interface SettingsScreenProps {
  sections: Section[];
  setSections?: (s: Section[]) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenLogin?: () => void;
  onLogout?: () => void;
  hasUnsyncedChanges?: boolean;
  isPhone?: boolean;
}

const DEFAULT_EMOJIS = ['💼', '📚', '🏃', '🎮', '💤', '🎨', '🔬', '💡', '🌿', '🎵', '✍️', '🛠️'];

export function SettingsScreen({
  sections,
  setSections,
  theme,
  onToggleTheme,
  onOpenLogin,
  onLogout,
  hasUnsyncedChanges = false,
}: SettingsScreenProps) {
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [newSec, setNewSec] = useState<Partial<Section>>({
    name: '',
    color: SECTION_COLORS[0],
    icon: '📌',
    targetType: 'at least',
    dailyTargetMinutes: undefined,
  });
  const [addingNew, setAddingNew] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [importError, setImportError] = useState('');
  const [message, setMessage] = useState('');

  const showMsg = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const loadSections = async () => {
    const all = await db.sections.filter(s => !s.deleted).toArray();
    all.sort((a, b) => a.order - b.order);
    if (setSections) setSections(all);
  };

  const saveSection = async (sec: Partial<Section>) => {
    if (!sec.name?.trim()) return;
    const now = Date.now();
    if (sec.id) {
      await db.sections.update(sec.id, { ...sec, updatedAt: now, synced: 0 });
    } else {
      const id = crypto.randomUUID();
      await db.sections.add({
        id,
        name: sec.name!,
        color: sec.color || '#8b5cf6',
        icon: sec.icon || '📌',
        order: sections.length,
        dailyTargetMinutes: sec.dailyTargetMinutes,
        targetType: sec.targetType || 'at least',
        updatedAt: now,
        deleted: false,
        isSample: false,
        synced: 0,
      } as Section);
    }
    syncEngine.notifyLocalMutation();
    loadSections();
    setEditingSection(null);
    setAddingNew(false);
    setNewSec({ name: '', color: SECTION_COLORS[0], icon: '📌', targetType: 'at least' });
  };

  const deleteSection = async (secId: string) => {
    if (!confirm('Move tasks in this section to Other and delete it?')) return;
    const other = sections.find(s => s.name === 'Other');
    if (!other) {
      showMsg('Error: Other section not found');
      return;
    }
    const now = Date.now();
    await db.transaction('rw', db.tasks, db.sections, async () => {
      const tasksInSec = await db.tasks.filter(t => t.sectionId === secId && !t.deleted).toArray();
      for (const t of tasksInSec) await db.tasks.update(t.id, { sectionId: other.id, updatedAt: now, synced: 0 });
      await db.sections.update(secId, { deleted: true, updatedAt: now, synced: 0 });
    });
    syncEngine.notifyLocalMutation();
    loadSections();
  };

  const handleExport = async () => {
    try {
      await exportAllDataToJson();
      showMsg('Export completed');
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
      showMsg(`Imported ${result.count} items`);
      loadSections();
    } catch (err: any) {
      setImportError(err.message || 'Import failed');
    }
  };

  const handleLogoutClick = async () => {
    if (onLogout) {
      onLogout();
    } else {
      try {
        await fetch('/api/logout', { method: 'POST' });
        showMsg('Signed out');
      } catch {
        showMsg('Sign out failed');
      }
    }
  };

  const SectionForm = ({
    sec,
    onSave,
    onCancel,
  }: {
    sec: Partial<Section>;
    onSave: (s: Partial<Section>) => void;
    onCancel: () => void;
  }) => {
    const [local, setLocal] = useState({ ...sec });
    return (
      <div className="g-card" style={{ padding: 18, marginBottom: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, marginBottom: 12 }}>
          <div>
            <label className="g-label">Section Name</label>
            <input
              className="g-input"
              value={local.name || ''}
              onChange={e => setLocal(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Deep Work"
            />
          </div>
          <div>
            <label className="g-label">Icon</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
              {DEFAULT_EMOJIS.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setLocal(p => ({ ...p, icon: emoji }))}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: `1px solid ${local.icon === emoji ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.07)'}`,
                    background: local.icon === emoji ? 'rgba(139,92,246,0.12)' : 'rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    fontSize: 15,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label className="g-label">Color</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {SECTION_COLORS.map((color: string) => (
              <button
                key={color}
                type="button"
                onClick={() => setLocal(p => ({ ...p, color }))}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: color,
                  border: `2px solid ${local.color === color ? 'white' : 'transparent'}`,
                  cursor: 'pointer',
                  boxShadow: local.color === color ? `0 0 10px ${color}80` : 'none',
                  transition: 'all 0.15s',
                }}
                aria-label={`Color ${color}`}
              />
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label className="g-label">Daily Target (min)</label>
            <input
              type="number"
              className="g-input"
              min={0}
              max={1440}
              value={local.dailyTargetMinutes ?? ''}
              onChange={e =>
                setLocal(p => ({ ...p, dailyTargetMinutes: e.target.value ? parseInt(e.target.value) : undefined }))
              }
              placeholder="Optional"
            />
          </div>
          <div>
            <label className="g-label">Target Type</label>
            <select
              className="g-input"
              value={local.targetType || 'at least'}
              onChange={e => setLocal(p => ({ ...p, targetType: e.target.value as any }))}
            >
              <option value="at least">At least</option>
              <option value="at most">At most</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="g-btn" onClick={onCancel} style={{ padding: '8px 16px' }}>
            Cancel
          </button>
          <button type="button" className="g-btn g-btn-primary" onClick={() => onSave(local)} style={{ padding: '8px 16px' }}>
            Save
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 640, paddingBottom: 80 }}>
      {message && (
        <div
          style={{
            padding: '12px 18px',
            background: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.25)',
            borderRadius: 12,
            fontSize: 13,
            color: 'rgba(34,197,94,0.9)',
          }}
        >
          {message}
        </div>
      )}

      {/* ── Appearance ── */}
      <div className="g-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Palette size={16} style={{ color: 'rgba(139,92,246,0.7)' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.08em' }}>
            APPEARANCE
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.8)', marginBottom: 2 }}>Theme</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
              {theme === 'dark' ? 'Dark mode active' : 'Light mode active'}
            </div>
          </div>
          <button
            onClick={onToggleTheme}
            className="g-pill"
            style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}
          >
            {theme === 'dark' ? (
              <>
                <Moon size={14} />
                <span>Dark</span>
              </>
            ) : (
              <>
                <Sun size={14} />
                <span>Light</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Sections ── */}
      <div className="g-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sliders size={16} style={{ color: 'rgba(99,102,241,0.7)' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.08em' }}>
              SECTIONS
            </span>
          </div>
          <button
            onClick={() => setAddingNew(true)}
            className="g-btn g-btn-primary"
            style={{ padding: '7px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <Plus size={13} />
            <span>Add</span>
          </button>
        </div>

        {addingNew && <SectionForm sec={newSec} onSave={saveSection} onCancel={() => setAddingNew(false)} />}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sections.map(sec => (
            <div key={sec.id}>
              {editingSection?.id === sec.id ? (
                <SectionForm sec={editingSection} onSave={saveSection} onCancel={() => setEditingSection(null)} />
              ) : (
                <div
                  className="g-task-row"
                  style={{ padding: '12px 14px 12px 18px', display: 'flex', alignItems: 'center', gap: 10 }}
                >
                  <div className="g-section-accent" style={{ background: sec.color, boxShadow: `0 0 6px ${sec.color}50` }} />
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      background: sec.color + '15',
                      border: `1px solid ${sec.color}30`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      flexShrink: 0,
                    }}
                  >
                    {sec.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'rgba(255,255,255,0.8)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      {sec.name}
                      {sec.dailyTargetMinutes && (
                        <span
                          style={{
                            fontSize: 10,
                            color: sec.color,
                            background: sec.color + '15',
                            padding: '1px 6px',
                            borderRadius: 999,
                            border: `1px solid ${sec.color}30`,
                          }}
                        >
                          {sec.targetType === 'at most' ? '≤' : '≥'} {sec.dailyTargetMinutes}m/day
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                    <button
                      onClick={() => setEditingSection(sec)}
                      className="g-icon-btn"
                      style={{ width: 30, height: 30 }}
                      aria-label="Edit section"
                    >
                      <Edit2 size={12} />
                    </button>
                    <button
                      onClick={() => deleteSection(sec.id)}
                      className="g-icon-btn"
                      style={{ width: 30, height: 30, color: 'rgba(239,68,68,0.5)', borderColor: 'rgba(239,68,68,0.12)' }}
                      aria-label="Delete section"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Sample Data ── */}
      <div className="g-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Database size={16} style={{ color: 'rgba(234,179,8,0.7)' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.08em' }}>
            SAMPLE DATA
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={async () => {
              setSampleLoading(true);
              await addFourteenDaysSampleData();
              setSampleLoading(false);
              showMsg('Added 14 days of sample data');
            }}
            disabled={sampleLoading}
            className="g-btn"
            style={{ padding: '9px 16px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={13} />
            {sampleLoading ? 'Adding...' : 'Add 14-Day Sample'}
          </button>
          <button
            onClick={async () => {
              await removeSampleData();
              syncEngine.notifyLocalMutation();
              showMsg('Sample data removed');
            }}
            className="g-btn"
            style={{
              padding: '9px 16px',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: 'rgba(239,68,68,0.6)',
              borderColor: 'rgba(239,68,68,0.15)',
            }}
          >
            <Trash2 size={13} />
            Remove Sample
          </button>
        </div>
      </div>

      {/* ── Backup ── */}
      <div className="g-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Shield size={16} style={{ color: 'rgba(34,197,94,0.7)' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.08em' }}>
            BACKUP & RESTORE
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: importError ? 10 : 0 }}>
          <button
            onClick={handleExport}
            className="g-btn"
            style={{ padding: '9px 16px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Download size={13} />
            Export JSON
          </button>
          <label
            className="g-btn"
            style={{
              padding: '9px 16px',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              margin: 0,
            }}
          >
            <Upload size={13} />
            Import JSON
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
        </div>
        {importError && <p style={{ margin: '8px 0 0', fontSize: 12, color: 'rgba(239,68,68,0.8)' }}>{importError}</p>}
      </div>

      {/* ── Account ── */}
      <div className="g-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <LogOut size={16} style={{ color: 'rgba(239,68,68,0.6)' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.08em' }}>
            ACCOUNT & CLOUD SYNC
          </span>
        </div>
        {hasUnsyncedChanges && (
          <div
            style={{
              padding: '10px 14px',
              background: 'rgba(234,179,8,0.08)',
              border: '1px solid rgba(234,179,8,0.2)',
              borderRadius: 10,
              marginBottom: 12,
              fontSize: 12,
              color: 'rgba(234,179,8,0.8)',
            }}
          >
            ⚠ You have unsynced changes. Signing out won&apos;t delete local data.
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {onOpenLogin && (
            <button
              onClick={onOpenLogin}
              className="g-btn g-btn-primary"
              style={{ padding: '9px 18px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 7 }}
            >
              Sign In to Cloud Sync
            </button>
          )}
          <button
            onClick={handleLogoutClick}
            className="g-btn"
            style={{
              padding: '9px 18px',
              fontSize: 13,
              color: 'rgba(239,68,68,0.7)',
              borderColor: 'rgba(239,68,68,0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
            }}
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
