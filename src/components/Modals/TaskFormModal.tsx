'use client';

import React, { useState, useEffect, useRef } from 'react';
import { db, saveTaskDraft, getTaskDraft, clearTaskDraft } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { withActionFeedback } from '@/lib/utils/actionFeedback';
import { compressImage } from '@/lib/utils/image';
import { STRATEGY_COLORS } from '@/lib/utils/colors';
import { formatEthiopianDate } from '@/lib/date/ethiopianCalendar';
import {
  X,
  Star,
  Clock,
  Tag,
  Image as ImageIcon,
  CheckCircle,
  Bold,
  Highlighter,
  Palette,
  AlertCircle,
  Sparkles,
  Shield,
  Flame,
  LoaderCircle,
} from 'lucide-react';
import type { Task, Section, PriorityLevel, DraftTask } from '@/types';

interface TaskFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentDate: string;
  sections: Section[];
  existingTask?: Task | null;
  onPreviewImage: (url: string, title: string) => void;
  isPhone: boolean;
}

const EMOJI_PRESETS = ['⚡', '📚', '🏃', '🌙', '🎮', '💻', '🧠', '🎯', '📝', '💡', '🔥', '🎨'];

export function TaskFormModal({
  isOpen,
  onClose,
  currentDate,
  sections,
  existingTask,
  onPreviewImage,
  isPhone,
}: TaskFormModalProps) {
  const defaultSectionId = sections[0]?.id || 'default-sec-1';

  const [title, setTitle] = useState('');
  const [sectionId, setSectionId] = useState(defaultSectionId);
  const [description, setDescription] = useState('');
  const [strategy, setStrategy] = useState('');
  const [doneMeans, setDoneMeans] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState(30);
  const [priority, setPriority] = useState<PriorityLevel>('Medium');
  const [mustDo, setMustDo] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [icon, setIcon] = useState('📌');
  const [textColor, setTextColor] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [mustDoWarning, setMustDoWarning] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const strategyEditorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize or restore draft
  useEffect(() => {
    if (!isOpen) return;

    if (existingTask) {
      setTitle(existingTask.title);
      setSectionId(existingTask.sectionId);
      setDescription(existingTask.description || '');
      setStrategy(existingTask.strategy || '');
      setDoneMeans(existingTask.doneMeans || '');
      setEstimatedMinutes(existingTask.estimatedMinutes || 30);
      setPriority(existingTask.priority || 'Medium');
      setMustDo(existingTask.mustDo || false);
      setTags(existingTask.tags || []);
      setIcon(existingTask.icon || '📌');
      setTextColor(existingTask.textColor || '');
      setImage(existingTask.image || null);
      if (strategyEditorRef.current) {
        strategyEditorRef.current.innerHTML = existingTask.strategy || '';
      }
    } else {
      // Check for saved draft
      getTaskDraft().then(draft => {
        if (draft && draft.title) {
          setTitle(draft.title);
          setSectionId(draft.sectionId || defaultSectionId);
          setDescription(draft.description || '');
          setStrategy(draft.strategy || '');
          setDoneMeans(draft.doneMeans || '');
          setEstimatedMinutes(draft.estimatedMinutes || 30);
          setPriority(draft.priority || 'Medium');
          setMustDo(draft.mustDo || false);
          setTags(draft.tags || []);
          setIcon(draft.icon || '📌');
          setTextColor(draft.textColor || '');
          setImage(draft.image || null);
          if (strategyEditorRef.current) {
            strategyEditorRef.current.innerHTML = draft.strategy || '';
          }
          setDraftRestored(true);
        } else {
          // Defaults for new task
          setTitle('');
          setSectionId(defaultSectionId);
          setDescription('');
          setStrategy('');
          setDoneMeans('');
          setEstimatedMinutes(30);
          setPriority('Medium');
          setMustDo(false);
          setTags([]);
          setIcon('📌');
          setTextColor('');
          setImage(null);
          if (strategyEditorRef.current) {
            strategyEditorRef.current.innerHTML = '';
          }
          setDraftRestored(false);
        }
      });
    }
  }, [isOpen, existingTask, defaultSectionId]);

  // Auto-save draft on every keystroke when creating a new task
  useEffect(() => {
    if (!isOpen || existingTask) return;

    const timeout = setTimeout(() => {
      const draft: DraftTask = {
        title,
        sectionId,
        description,
        strategy,
        doneMeans,
        estimatedMinutes,
        priority,
        mustDo,
        tags,
        icon,
        textColor,
        image,
        updatedAt: Date.now(),
      };
      saveTaskDraft(draft);
    }, 400);

    return () => clearTimeout(timeout);
  }, [
    isOpen,
    existingTask,
    title,
    sectionId,
    description,
    strategy,
    doneMeans,
    estimatedMinutes,
    priority,
    mustDo,
    tags,
    icon,
    textColor,
    image,
  ]);

  // Keyboard shortcut: Esc to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Handle Strategy Editor inputs
  const handleStrategyInput = () => {
    if (strategyEditorRef.current) {
      setStrategy(strategyEditorRef.current.innerHTML);
    }
  };

  const executeCommand = (command: string, value: string | undefined = undefined) => {
    document.execCommand(command, false, value);
    if (strategyEditorRef.current) {
      setStrategy(strategyEditorRef.current.innerHTML);
    }
  };

  // Must-Do Star enforcement (max 3 per day)
  const handleToggleMustDo = async () => {
    if (!mustDo) {
      const dayTasks = await db.tasks
        .filter(t => t.date === currentDate && !t.deleted && t.mustDo)
        .toArray();

      if (dayTasks.length >= 3 && (!existingTask || !existingTask.mustDo)) {
        setMustDoWarning('Max 3 Must-Do tasks allowed per day. Focus on your top 3 non-negotiables.');
        setTimeout(() => setMustDoWarning(null), 4000);
        return;
      }
    }
    setMustDo(!mustDo);
  };

  // Tags management
  const addTag = () => {
    const trimmed = tagInput.trim().replace(/^#/, '');
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  // Image Upload & Paste
  const handleImageFile = async (file: File) => {
    try {
      const compressedDataUrl = await compressImage(file);
      setImage(compressedDataUrl);
    } catch {
      alert('Failed to process image. Please try another.');
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          handleImageFile(file);
          break;
        }
      }
    }
  };

  // Save Task
  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!title.trim() || isSaving) return;

    setIsSaving(true);
    try {
      const now = Date.now();

      if (existingTask) {
        await db.tasks.update(existingTask.id, {
          title: title.trim(),
          sectionId,
          description: description.trim(),
          strategy,
          doneMeans: doneMeans.trim(),
          estimatedMinutes: Number(estimatedMinutes) || 30,
          priority,
          mustDo,
          tags,
          icon,
          textColor,
          image,
          updatedAt: now,
          synced: 0,
        });
      } else {
        const existingInDay = await db.tasks
          .filter(t => t.date === currentDate && !t.deleted)
          .count();

        const newTask: Task = {
          id: crypto.randomUUID(),
          date: currentDate,
          sectionId,
          title: title.trim(),
          description: description.trim(),
          strategy,
          doneMeans: doneMeans.trim(),
          estimatedMinutes: Number(estimatedMinutes) || 30,
          priority,
          mustDo,
          tags,
          icon,
          textColor,
          image,
          isCompleted: false,
          completedAt: null,
          order: existingInDay,
          createdAt: now,
          updatedAt: now,
          deleted: false,
          isSample: false,
          synced: 0,
        };

        await db.tasks.put(newTask);
        await clearTaskDraft();
      }

      syncEngine.notifyLocalMutation();
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existingTask || isDeleting) return;
    if (!confirm('Delete this task? This cannot be undone.')) return;

    setIsDeleting(true);
    try {
      await db.tasks.update(existingTask.id, {
        deleted: true,
        updatedAt: Date.now(),
        synced: 0,
      });
      syncEngine.notifyLocalMutation();
      onClose();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        justifyContent: isPhone ? 'center' : 'flex-end',
        alignItems: isPhone ? 'flex-end' : 'stretch',
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(12px) saturate(140%)',
        WebkitBackdropFilter: 'blur(12px) saturate(140%)',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-form-title"
      onPaste={handlePaste}
    >
      <div
        className="g-card"
        style={{
          width: isPhone ? '100%' : '540px',
          height: isPhone ? '92vh' : '100%',
          maxHeight: '100vh',
          borderRadius: isPhone ? '20px 20px 0 0' : '20px 0 0 20px',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--v-glass-bg-card)',
          boxShadow: 'var(--v-shadow-spatial)',
          overflow: 'hidden',
        }}
      >
        {/* Top Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--v-glass-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--v-glass-bg)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 id="task-form-title" className="font-bloody" style={{ fontSize: 20, margin: 0, color: 'var(--text-primary)' }}>
                {existingTask ? 'Edit Task' : 'New Clear Plan'}
              </h2>
              {draftRestored && !existingTask && (
                <span className="g-badge" style={{ borderColor: 'rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.08)', color: 'rgba(234,179,8,0.85)', fontSize: 10 }}>
                  Draft Restored
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--accent-color)', fontWeight: 600, marginTop: 2 }}>
              📅 {currentDate} · 🇪🇹 {formatEthiopianDate(currentDate)}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {existingTask && (
              <button
                type="button"
                disabled={isDeleting || isSaving}
                onClick={event => { void withActionFeedback('Deleting task', handleDelete, event.currentTarget); }}
                className="g-btn"
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  color: 'rgba(239,68,68,0.8)',
                  borderColor: 'rgba(239,68,68,0.2)',
                  opacity: isDeleting ? 0.5 : 1,
                  cursor: isDeleting ? 'wait' : 'pointer',
                }}
                aria-label="Delete task"
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
            <button
              onClick={onClose}
              disabled={isSaving || isDeleting}
              className="g-icon-btn"
              style={{ width: 32, height: 32 }}
              aria-label="Close task form (Esc)"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form
          id="task-form"
          onSubmit={event => { void withActionFeedback(existingTask ? 'Updating task' : 'Adding task', () => handleSave(event), event.currentTarget); }}
          style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 18, flex: 1, overflowY: 'auto' }}
        >
          {mustDoWarning && (
            <div style={{ padding: '10px 14px', background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)', borderRadius: 12, fontSize: 12, color: 'rgba(234,179,8,0.9)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{mustDoWarning}</span>
            </div>
          )}

          {/* Title & Emoji Icon */}
          <div>
            <label htmlFor="task-title" className="g-label">
              What Will You Do? (Title) *
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="g-btn"
                  style={{ width: 46, height: 44, padding: 0, fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12 }}
                  title="Choose Icon"
                >
                  {icon}
                </button>
              </div>

              <input
                id="task-title"
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Code database delta sync engine"
                style={{ color: textColor || undefined }}
                className="g-input"
                required
                autoFocus={!isPhone}
              />
            </div>
          </div>

          {/* Section & Must-Do Star */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label htmlFor="task-section" className="g-label">
                Section
              </label>
              <select
                id="task-section"
                value={sectionId}
                onChange={e => setSectionId(e.target.value)}
                className="g-input"
              >
                {sections.map(s => (
                  <option key={s.id} value={s.id} style={{ background: 'var(--v-app-bg)', color: 'var(--text-primary)' }}>
                    {s.icon} {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="g-label">Top 3 Must-Do?</span>
              <button
                type="button"
                onClick={handleToggleMustDo}
                className="g-btn"
                style={{
                  width: '100%',
                  height: 44,
                  padding: '0 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderRadius: 12,
                  borderColor: mustDo ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.08)',
                  background: mustDo ? 'rgba(255,255,255,0.12)' : 'var(--glass-bg-light)',
                  color: mustDo ? '#ffffff' : 'var(--text-muted)',
                }}
                aria-pressed={mustDo}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <Star size={14} style={{ color: mustDo ? '#ffffff' : 'currentColor', fill: mustDo ? '#ffffff' : 'none' }} />
                  <span>{mustDo ? 'Must-Do' : 'Normal'}</span>
                </div>
                <span style={{ fontSize: 10, opacity: 0.6 }}>Max 3</span>
              </button>
            </div>
          </div>

          {/* Estimated Time with Quick Buttons */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label htmlFor="task-est-minutes" className="g-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Clock size={12} />
                <span>How Long Will It Take? *</span>
              </label>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(139,92,246,0.9)', fontFamily: 'monospace' }}>
                {estimatedMinutes} min ({Math.round((estimatedMinutes / 60) * 10) / 10}h)
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
              {[15, 30, 60, 120].map(mins => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setEstimatedMinutes(mins)}
                  className="g-btn"
                  style={{
                    padding: '8px 0',
                    fontSize: 12,
                    textAlign: 'center',
                    background: estimatedMinutes === mins ? 'rgba(139,92,246,0.2)' : 'var(--glass-bg-light)',
                    borderColor: estimatedMinutes === mins ? 'rgba(139,92,246,0.45)' : 'rgba(255,255,255,0.08)',
                    color: estimatedMinutes === mins ? 'rgba(255,255,255,0.95)' : 'var(--text-muted)',
                  }}
                >
                  {mins >= 60 ? `${mins / 60}h` : `${mins}m`}
                </button>
              ))}
            </div>

            <input
              id="task-est-minutes"
              type="number"
              min="5"
              max="720"
              step="5"
              value={estimatedMinutes}
              onChange={e => setEstimatedMinutes(Math.max(5, parseInt(e.target.value) || 0))}
              className="g-input"
            />
          </div>

          {/* Strategy: How Exactly Will I Do It? (With Rich Toolbar) */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label className="g-label" style={{ margin: 0 }}>Strategy: How Exactly Will I Do It?</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 3, background: 'rgba(20,20,24,0.8)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
                <button
                  type="button"
                  onClick={() => executeCommand('bold')}
                  className="g-icon-btn"
                  style={{ width: 24, height: 24, border: 'none', background: 'transparent' }}
                  title="Bold (Ctrl+B)"
                  aria-label="Bold text"
                >
                  <Bold size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => executeCommand('hiliteColor', '#52525b')}
                  className="g-icon-btn"
                  style={{ width: 24, height: 24, border: 'none', background: 'transparent' }}
                  title="Highlight"
                  aria-label="Highlight text"
                >
                  <Highlighter size={12} />
                </button>
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => setShowColorPicker(!showColorPicker)}
                    className="g-icon-btn"
                    style={{ width: 24, height: 24, border: 'none', background: 'transparent' }}
                    title="8 High-Contrast Colors"
                    aria-label="Text color palette"
                  >
                    <Palette size={12} />
                  </button>
                  {showColorPicker && (
                    <div
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: 30,
                        zIndex: 30,
                        padding: 8,
                        background: 'rgba(20,20,24,0.98)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 12,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: 6,
                        width: 140,
                      }}
                    >
                      {STRATEGY_COLORS.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            executeCommand('foreColor', c.darkHex);
                            setShowColorPicker(false);
                          }}
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            border: '1px solid rgba(255,255,255,0.2)',
                            backgroundColor: c.darkHex,
                            cursor: 'pointer',
                          }}
                          title={c.label}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div
              ref={strategyEditorRef}
              contentEditable
              onInput={handleStrategyInput}
              role="textbox"
              aria-multiline="true"
              aria-label="Strategy description"
              style={{
                minHeight: 85,
                padding: '12px 14px',
                borderRadius: 12,
                background: 'rgba(10, 10, 12, 0.8)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.88)',
                fontSize: 13,
                outline: 'none',
              }}
            />
          </div>

          {/* Done Means: How Will I Know It Is Finished? */}
          <div>
            <label htmlFor="task-done-means" className="g-label">
              Done Means: How Will I Know It Is Finished? *
            </label>
            <textarea
              id="task-done-means"
              rows={2}
              value={doneMeans}
              onChange={e => setDoneMeans(e.target.value)}
              placeholder="e.g. Commit pushed to GitHub, PR reviewed, and all tests green."
              className="g-input"
              style={{ minHeight: 60 }}
            />
          </div>

          {/* Priority (Text & Icon) */}
          <div>
            <label className="g-label">Priority</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {(['Low', 'Medium', 'High'] as PriorityLevel[]).map(lvl => {
                const isSelected = priority === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setPriority(lvl)}
                    className="g-btn"
                    style={{
                      padding: '8px 0',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      background: isSelected
                        ? lvl === 'High'
                          ? 'rgba(239,68,68,0.15)'
                          : lvl === 'Medium'
                          ? 'rgba(234,179,8,0.15)'
                          : 'rgba(34,197,94,0.15)'
                        : 'var(--glass-bg-light)',
                      borderColor: isSelected
                        ? lvl === 'High'
                          ? 'rgba(239,68,68,0.5)'
                          : lvl === 'Medium'
                          ? 'rgba(234,179,8,0.5)'
                          : 'rgba(34,197,94,0.5)'
                        : 'rgba(255,255,255,0.08)',
                      color: isSelected
                        ? lvl === 'High'
                          ? 'rgba(239,68,68,0.95)'
                          : lvl === 'Medium'
                          ? 'rgba(234,179,8,0.95)'
                          : 'rgba(34,197,94,0.95)'
                        : 'var(--text-muted)',
                    }}
                  >
                    {lvl === 'High' && <Flame size={13} />}
                    {lvl === 'Medium' && <Sparkles size={13} />}
                    {lvl === 'Low' && <Shield size={13} />}
                    <span>{lvl}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label htmlFor="task-tag-input" className="g-label">Tags</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                id="task-tag-input"
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Add tag and press Enter..."
                className="g-input"
              />
              <button
                type="button"
                onClick={addTag}
                className="g-btn"
                style={{ padding: '0 16px', fontSize: 12 }}
              >
                Add
              </button>
            </div>

            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tags.map(t => (
                  <span
                    key={t}
                    className="g-pill"
                    style={{ padding: '3px 10px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5, color: 'rgba(255,255,255,0.7)' }}
                  >
                    <Tag size={10} style={{ opacity: 0.5 }} />
                    <span>{t}</span>
                    <button
                      type="button"
                      onClick={() => removeTag(t)}
                      style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 0, fontSize: 14 }}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Image Attachment (Upload or Paste) */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label className="g-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                <ImageIcon size={12} />
                <span>Reference Image (Max 800px / ~150KB)</span>
              </label>
              {image && (
                <button
                  type="button"
                  onClick={() => setImage(null)}
                  style={{ background: 'none', border: 'none', color: 'rgba(239,68,68,0.8)', fontSize: 11, cursor: 'pointer' }}
                >
                  Remove
                </button>
              )}
            </div>

            {image ? (
              <div
                style={{
                  position: 'relative',
                  borderRadius: 14,
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(10,10,12,0.8)',
                  maxHeight: 180,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <img
                  src={image}
                  alt={title || 'Task Attachment'}
                  style={{ maxHeight: 180, objectFit: 'contain', cursor: 'pointer' }}
                  onClick={() => onPreviewImage(image, title || 'Task Reference')}
                />
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: 20,
                  border: '1px dashed rgba(255,255,255,0.12)',
                  borderRadius: 14,
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: 'rgba(10,10,12,0.4)',
                }}
              >
                <ImageIcon size={22} style={{ color: 'rgba(255,255,255,0.3)', margin: '0 auto 6px' }} />
                <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                  Tap to upload or paste (Ctrl+V) reference screenshot
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
                  Automatically resized & compressed to ~150KB
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={e => {
                    if (e.target.files?.[0]) handleImageFile(e.target.files[0]);
                  }}
                  style={{ display: 'none' }}
                />
              </div>
            )}
          </div>
        </form>

        {/* Footer Actions */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--v-glass-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--v-glass-bg)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="g-btn"
            style={{ padding: '9px 18px' }}
          >
            Cancel
          </button>

          <button
            type="submit"
            form="task-form"
            onClick={e => {
              // Ensure clicking footer button submits even if browser form association fails
              if (!isSaving && title.trim()) {
                void withActionFeedback(existingTask ? 'Updating task' : 'Adding task', () => handleSave(e), e.currentTarget);
              }
            }}
            disabled={!title.trim() || isSaving}
            className="g-btn g-btn-primary"
            style={{
              padding: '9px 24px',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              opacity: (!title.trim() || isSaving) ? 0.45 : 1,
              cursor: isSaving ? 'wait' : !title.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {isSaving ? (
              <LoaderCircle size={15} style={{ animation: 'sams-action-spin .8s linear infinite' }} />
            ) : (
              <CheckCircle size={15} />
            )}
            <span>{isSaving ? (existingTask ? 'Saving…' : 'Scheduling…') : (existingTask ? 'Save Changes' : 'Confirm & Schedule')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
