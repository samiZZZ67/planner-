'use client';

import React, { useState, useRef } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { useSync } from '@/lib/sync/useSync';
import {
  addFourteenDaysSampleData,
  removeSampleData,
  exportAllDataToJson,
  importDataFromJson,
} from '@/lib/data/sampleData';
import { PRESET_SECTION_COLORS } from '@/lib/utils/colors';
import {
  Moon,
  Sun,
  Download,
  Upload,
  Database,
  Trash2,
  Plus,
  RefreshCw,
  LogOut,
  AlertTriangle,
  Check,
  Edit2,
  FolderKanban,
} from 'lucide-react';
import type { Section, TargetType } from '@/types';

interface SettingsScreenProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  sections: Section[];
  onOpenLogin: () => void;
  isPhone: boolean;
}

export function SettingsScreen({
  theme,
  onToggleTheme,
  sections,
  onOpenLogin,
  isPhone,
}: SettingsScreenProps) {
  const sync = useSync();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Section editor state
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [secName, setSecName] = useState('');
  const [secColor, setSecColor] = useState('#8b5cf6');
  const [secIcon, setSecIcon] = useState('📌');
  const [secTargetMinutes, setSecTargetMinutes] = useState<number | ''>(60);
  const [secTargetType, setSecTargetType] = useState<TargetType>('at least');

  // Status feedback messages
  const [feedback, setFeedback] = useState<string | null>(null);
  const [logoutWarning, setLogoutWarning] = useState(false);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3000);
  };

  // Add / Edit Section
  const handleSaveSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secName.trim()) return;

    const now = Date.now();
    if (editingSection) {
      await db.sections.update(editingSection.id, {
        name: secName.trim(),
        color: secColor,
        icon: secIcon.trim() || '📌',
        dailyTargetMinutes: secTargetMinutes === '' ? null : Number(secTargetMinutes),
        targetType: secTargetType,
        updatedAt: now,
        synced: 0,
      });
      showFeedback(`Section "${secName}" updated.`);
    } else {
      const newSec: Section = {
        id: crypto.randomUUID(),
        name: secName.trim(),
        color: secColor,
        icon: secIcon.trim() || '📌',
        order: sections.length,
        dailyTargetMinutes: secTargetMinutes === '' ? null : Number(secTargetMinutes),
        targetType: secTargetType,
        updatedAt: now,
        deleted: false,
        isSample: false,
        synced: 0,
      };
      await db.sections.put(newSec);
      showFeedback(`Section "${secName}" added.`);
    }

    syncEngine.notifyLocalMutation();
    resetSectionForm();
  };

  const startEditSection = (sec: Section) => {
    setEditingSection(sec);
    setSecName(sec.name);
    setSecColor(sec.color);
    setSecIcon(sec.icon);
    setSecTargetMinutes(sec.dailyTargetMinutes ?? '');
    setSecTargetType(sec.targetType || 'at least');
    setIsAddingSection(true);
  };

  const resetSectionForm = () => {
    setEditingSection(null);
    setIsAddingSection(false);
    setSecName('');
    setSecColor('#8b5cf6');
    setSecIcon('📌');
    setSecTargetMinutes(60);
    setSecTargetType('at least');
  };

  // Delete Section (moves its tasks to 'Other')
  const handleDeleteSection = async (sec: Section) => {
    if (sec.name.toLowerCase() === 'other') {
      alert('The "Other" section is the fallback section and cannot be deleted.');
      return;
    }

    if (!confirm(`Delete section "${sec.name}"? All its tasks will be safely moved to "Other".`)) {
      return;
    }

    const now = Date.now();
    const otherSec = sections.find(s => s.name.toLowerCase() === 'other') || sections[0];

    await db.transaction('rw', [db.sections, db.tasks], async () => {
      // 1. Move tasks to other
      const tasksInSec = await db.tasks.filter(t => t.sectionId === sec.id).toArray();
      for (const t of tasksInSec) {
        await db.tasks.update(t.id, {
          sectionId: otherSec.id,
          updatedAt: now,
          synced: 0,
        });
      }

      // 2. Soft-delete section
      await db.sections.update(sec.id, {
        deleted: true,
        updatedAt: now,
        synced: 0,
      });
    });

    syncEngine.notifyLocalMutation();
    showFeedback(`Section "${sec.name}" deleted. Tasks moved to "${otherSec.name}".`);
  };

  // Sample Data Handlers
  const handleAddSample = async () => {
    await addFourteenDaysSampleData();
    showFeedback('14 days of realistic sample data added.');
  };

  const handleRemoveSample = async () => {
    await removeSampleData();
    showFeedback('All sample data removed.');
  };

  // JSON Import
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const res = await importDataFromJson(text);
      showFeedback(`Successfully restored ${res.count} records.`);
    } catch (err: any) {
      alert(`Import error: ${err.message}`);
    }
  };

  // Logout handler with unsynced changes check
  const handleLogout = async () => {
    if (sync.unsyncedCount > 0 && !logoutWarning) {
      setLogoutWarning(true);
      return;
    }

    await fetch('/api/logout', { method: 'POST' });
    syncEngine.triggerSync();
    setLogoutWarning(false);
    showFeedback('Logged out. Your local on-device data remains completely intact.');
  };

  return (
    <div className="space-y-6 max-w-4xl pb-24">
      {/* Settings Header */}
      <div className="bg-bg-card border border-border-color rounded-2xl p-5 shadow-sm">
        <h2 className="font-bloody text-2xl font-bold text-text-primary">
          Settings & Preferences
        </h2>
        <p className="text-xs text-text-muted mt-1">
          Customize themes, manage planning sections, export backups, and cloud sync.
        </p>

        {feedback && (
          <div className="mt-3 p-3 rounded-xl bg-emerald-950/70 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
            <Check className="w-4 h-4 shrink-0" />
            <span>{feedback}</span>
          </div>
        )}
      </div>

      {/* 1. Theme Setting */}
      <div className="bg-bg-card border border-border-color rounded-2xl p-5 shadow-sm space-y-4">
        <h3 className="font-bold text-base text-text-primary flex items-center gap-2">
          {theme === 'dark' ? <Moon className="w-4 h-4 text-purple-400" /> : <Sun className="w-4 h-4 text-amber-400" />}
          <span>Appearance & Theme</span>
        </h3>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-text-primary">
              {theme === 'dark' ? 'Dark Mode (Night)' : 'Light Mode (Day)'}
            </p>
            <p className="text-xs text-text-muted">
              Designed for late-night planning with optimal WCAG contrast.
            </p>
          </div>

          <button
            onClick={onToggleTheme}
            className="px-4 py-2 rounded-xl bg-bg-secondary border border-border-color text-xs font-semibold text-text-primary hover:bg-bg-tertiary transition-colors flex items-center gap-2"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span>Switch to {theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </div>

      {/* 2. Manage Sections */}
      <div className="bg-bg-card border border-border-color rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderKanban className="w-5 h-5 text-accent-primary" />
            <h3 className="font-bold text-base text-text-primary">
              Manage Sections
            </h3>
          </div>

          {!isAddingSection && (
            <button
              onClick={() => setIsAddingSection(true)}
              className="px-3 py-1.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Section</span>
            </button>
          )}
        </div>

        {/* Section Editor Form */}
        {isAddingSection && (
          <form onSubmit={handleSaveSection} className="p-4 rounded-xl bg-bg-secondary border border-border-color space-y-3 animate-in fade-in">
            <h4 className="text-xs font-bold text-text-primary uppercase tracking-wider">
              {editingSection ? `Edit "${editingSection.name}"` : 'New Section'}
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={secName}
                  onChange={e => setSecName(e.target.value)}
                  placeholder="e.g. Creative Flow"
                  className="w-full px-3 py-1.5 rounded-lg bg-bg-card border border-border-color text-xs text-text-primary focus:outline-none focus:border-accent-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  Emoji Icon
                </label>
                <input
                  type="text"
                  value={secIcon}
                  onChange={e => setSecIcon(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-bg-card border border-border-color text-xs text-text-primary text-center focus:outline-none focus:border-accent-primary"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  Daily Target (Minutes)
                </label>
                <input
                  type="number"
                  value={secTargetMinutes}
                  onChange={e => setSecTargetMinutes(e.target.value === '' ? '' : parseInt(e.target.value))}
                  placeholder="Optional"
                  className="w-full px-3 py-1.5 rounded-lg bg-bg-card border border-border-color text-xs text-text-primary focus:outline-none focus:border-accent-primary"
                />
              </div>
            </div>

            {/* Target Type & Color Picker */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  Target Rule
                </label>
                <div className="flex gap-2">
                  {(['at least', 'at most'] as TargetType[]).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSecTargetType(t)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize border ${
                        secTargetType === t
                          ? 'bg-accent-primary text-white border-accent-primary'
                          : 'bg-bg-card border-border-color text-text-muted'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  Section Color
                </label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {PRESET_SECTION_COLORS.map(c => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => setSecColor(c.dark)}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${
                        secColor === c.dark ? 'scale-125 border-white' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c.dark }}
                      title={c.name}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={resetSectionForm}
                className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-accent-primary text-white text-xs font-semibold"
              >
                Save Section
              </button>
            </div>
          </form>
        )}

        {/* Existing Sections List */}
        <div className="space-y-2">
          {sections.map(sec => (
            <div
              key={sec.id}
              className="p-3 rounded-xl bg-bg-secondary border border-border-color flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">{sec.icon}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-text-primary">{sec.name}</span>
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: sec.color }}
                    />
                  </div>
                  <span className="text-[11px] text-text-muted">
                    {sec.dailyTargetMinutes
                      ? `Target: ${sec.targetType} ${sec.dailyTargetMinutes}m daily`
                      : 'No daily time target'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => startEditSection(sec)}
                  className="p-1.5 text-text-muted hover:text-text-primary"
                  title="Edit section"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDeleteSection(sec)}
                  className="p-1.5 text-text-muted hover:text-red-400"
                  title="Delete section"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Sample Data Controls */}
      <div className="bg-bg-card border border-border-color rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-accent-primary" />
          <h3 className="font-bold text-base text-text-primary">
            Sample Data
          </h3>
        </div>
        <p className="text-xs text-text-muted">
          Add 14 realistic sample days with Entertainment, Deep Work, and Learning plans to explore graphs and analytics immediately.
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleAddSample}
            className="px-4 py-2 rounded-xl bg-bg-secondary border border-border-color text-xs font-semibold text-text-primary hover:bg-bg-tertiary transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4 text-accent-primary" />
            <span>Add 14 Days Sample Data</span>
          </button>

          <button
            onClick={handleRemoveSample}
            className="px-4 py-2 rounded-xl bg-red-950/40 border border-red-800 text-xs font-semibold text-red-300 hover:bg-red-900/60 transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            <span>Remove Sample Data</span>
          </button>
        </div>
      </div>

      {/* 4. Export & Import JSON Backup */}
      <div className="bg-bg-card border border-border-color rounded-2xl p-5 shadow-sm space-y-3">
        <h3 className="font-bold text-base text-text-primary flex items-center gap-2">
          <Download className="w-5 h-5 text-accent-primary" />
          <span>Local Backup & Restore</span>
        </h3>
        <p className="text-xs text-text-muted">
          Export your complete database into a portable JSON backup file, or restore it on any device.
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={exportAllDataToJson}
            className="px-4 py-2 rounded-xl bg-bg-secondary border border-border-color text-xs font-semibold text-text-primary hover:bg-bg-tertiary transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            <span>Export JSON File</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 rounded-xl bg-bg-secondary border border-border-color text-xs font-semibold text-text-primary hover:bg-bg-tertiary transition-colors flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            <span>Import JSON File</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileImport}
            className="hidden"
          />
        </div>
      </div>

      {/* 5. Cloud Sync & Account */}
      <div className="bg-bg-card border border-border-color rounded-2xl p-5 shadow-sm space-y-4">
        <h3 className="font-bold text-base text-text-primary flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-accent-primary" />
          <span>Cloud Synchronization</span>
        </h3>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-text-primary">
              Status: <span className="capitalize">{sync.status.replace('_', ' ')}</span>
            </p>
            <p className="text-xs text-text-muted">
              {sync.unsyncedCount} unsynced changes waiting.
            </p>
          </div>

          <button
            onClick={() => sync.triggerSync()}
            className="px-3.5 py-1.5 rounded-xl bg-bg-secondary border border-border-color text-xs font-semibold hover:bg-bg-tertiary"
          >
            Force Sync Now
          </button>
        </div>

        {logoutWarning && (
          <div className="p-3.5 rounded-xl bg-amber-950/70 border border-amber-800 text-amber-300 text-xs space-y-2">
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle className="w-4 h-4" />
              <span>Unsynced changes waiting!</span>
            </div>
            <p>
              You have {sync.unsyncedCount} changes saved on this device that have not synced to the cloud yet. Local data is never deleted, but other devices won&apos;t have these changes until you log in and sync.
            </p>
          </div>
        )}

        <div className="pt-2 border-t border-border-color flex items-center justify-between">
          <button
            onClick={onOpenLogin}
            className="px-4 py-2 rounded-xl bg-purple-950/60 border border-purple-800 text-purple-300 text-xs font-semibold hover:bg-purple-900/80"
          >
            Login / Re-authenticate
          </button>

          <button
            onClick={handleLogout}
            className="px-4 py-2 rounded-xl bg-red-950/60 border border-red-800 text-red-300 text-xs font-semibold hover:bg-red-900/80 flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            <span>{logoutWarning ? 'Confirm Logout' : 'Log Out'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
