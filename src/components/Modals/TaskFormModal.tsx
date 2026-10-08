'use client';

import React, { useState, useEffect, useRef } from 'react';
import { db, saveTaskDraft, getTaskDraft, clearTaskDraft } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { compressImage } from '@/lib/utils/image';
import { STRATEGY_COLORS } from '@/lib/utils/colors';
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
          setDraftRestored(true);
          if (strategyEditorRef.current) {
            strategyEditorRef.current.innerHTML = draft.strategy || '';
          }
        } else {
          // Reset fresh
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
          setDraftRestored(false);
          if (strategyEditorRef.current) {
            strategyEditorRef.current.innerHTML = '';
          }
        }
      });
    }
  }, [isOpen, existingTask, defaultSectionId]);

  // Auto-save draft as user types (if creating new task)
  useEffect(() => {
    if (!isOpen || existingTask) return;

    const timeout = setTimeout(() => {
      if (title.trim() || description.trim() || strategy.trim()) {
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
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [title, sectionId, description, strategy, doneMeans, estimatedMinutes, priority, mustDo, tags, icon, textColor, image, isOpen, existingTask]);

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

  // Handle Strategy Editor Rich Formats
  const executeCommand = (cmd: string, val: string | undefined = undefined) => {
    document.execCommand(cmd, false, val);
    if (strategyEditorRef.current) {
      setStrategy(strategyEditorRef.current.innerHTML);
    }
  };

  const handleStrategyInput = () => {
    if (strategyEditorRef.current) {
      setStrategy(strategyEditorRef.current.innerHTML);
    }
  };

  // Must-do top 3 validation
  const handleToggleMustDo = async () => {
    if (!mustDo) {
      // Check existing must-do count for currentDate
      const currentMustDos = await db.tasks
        .filter(t => t.date === currentDate && !t.deleted && t.mustDo && t.id !== existingTask?.id)
        .count();

      if (currentMustDos >= 3) {
        setMustDoWarning('Max 3 Must-Do tasks allowed per day to keep your focus clear and sharp!');
        setTimeout(() => setMustDoWarning(null), 3500);
        return;
      }
    }
    setMustDo(!mustDo);
  };

  // Handle Image Upload & Paste
  const handleImageFile = async (file: File) => {
    try {
      const compressed = await compressImage(file);
      setImage(compressed);
    } catch (err: any) {
      console.error('Image compression error:', err);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          handleImageFile(file);
          break;
        }
      }
    }
  };

  // Tag Handling
  const addTag = () => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  // Save Task
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const now = Date.now();
    const taskToSave: Task = {
      id: existingTask ? existingTask.id : crypto.randomUUID(),
      date: existingTask ? existingTask.date : currentDate,
      sectionId,
      title: title.trim(),
      description: description.trim(),
      strategy: strategy.trim(),
      doneMeans: doneMeans.trim(),
      estimatedMinutes: Number(estimatedMinutes) || 0,
      priority,
      mustDo,
      tags,
      icon,
      textColor,
      image,
      isCompleted: existingTask ? existingTask.isCompleted : false,
      completedAt: existingTask ? existingTask.completedAt : null,
      order: existingTask ? existingTask.order : 0,
      createdAt: existingTask ? existingTask.createdAt : now,
      updatedAt: now,
      deleted: false,
      isSample: false,
      synced: 0,
    };

    await db.tasks.put(taskToSave);
    await clearTaskDraft();
    syncEngine.notifyLocalMutation();
    onClose();
  };

  // Delete Task (Soft Delete)
  const handleDelete = async () => {
    if (!existingTask) return;
    const now = Date.now();
    await db.tasks.update(existingTask.id, {
      deleted: true,
      updatedAt: now,
      synced: 0,
    });
    syncEngine.notifyLocalMutation();
    onClose();
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex ${
        isPhone ? 'items-end' : 'justify-end'
      } bg-black/75 backdrop-blur-sm animate-in fade-in duration-200`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-form-title"
      onPaste={handlePaste}
    >
      <div
        className={`bg-bg-card border-border-color shadow-2xl flex flex-col ${
          isPhone
            ? 'w-full h-full rounded-none overflow-y-auto'
            : 'w-[540px] h-full border-l rounded-none overflow-y-auto'
        }`}
      >
        {/* Top Header */}
        <div className="sticky top-0 z-10 bg-bg-secondary/95 backdrop-blur-md border-b border-border-color px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 id="task-form-title" className="font-bloody text-xl font-bold text-text-primary">
              {existingTask ? 'Edit Task' : 'New Clear Plan'}
            </h2>
            {draftRestored && !existingTask && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-950/70 text-amber-300 border border-amber-800">
                Draft Restored
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {existingTask && (
              <button
                type="button"
                onClick={handleDelete}
                className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/50 rounded-lg transition-colors"
                aria-label="Delete task"
              >
                Delete
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
              aria-label="Close task form (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-5 space-y-5 flex-1 overflow-y-auto">
          {mustDoWarning && (
            <div className="p-3 rounded-xl bg-amber-950/80 border border-amber-800 text-amber-300 text-xs flex items-center gap-2 animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{mustDoWarning}</span>
            </div>
          )}

          {/* Title & Emoji Icon */}
          <div>
            <label htmlFor="task-title" className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
              What Will You Do? (Title) *
            </label>
            <div className="flex gap-2">
              <div className="relative group">
                <button
                  type="button"
                  className="w-12 h-11 rounded-xl bg-bg-secondary border border-border-color text-xl flex items-center justify-center hover:bg-bg-tertiary transition-colors"
                  title="Choose Icon"
                >
                  {icon}
                </button>
                <div className="absolute top-12 left-0 z-20 hidden group-hover:grid grid-cols-4 gap-1 p-2 bg-bg-card border border-border-color rounded-xl shadow-xl">
                  {EMOJI_PRESETS.map(em => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => setIcon(em)}
                      className="p-1.5 text-lg hover:bg-bg-tertiary rounded-lg text-center"
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>

              <input
                id="task-title"
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Code database delta sync engine"
                style={{ color: textColor || undefined }}
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-bg-secondary border border-border-color text-text-primary font-medium text-base focus:border-accent-primary focus:outline-none placeholder:text-text-muted/60"
                required
                autoFocus={!isPhone}
              />
            </div>
          </div>

          {/* Section & Must-Do Star */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="task-section" className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                Section
              </label>
              <select
                id="task-section"
                value={sectionId}
                onChange={e => setSectionId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-bg-secondary border border-border-color text-text-primary text-sm focus:border-accent-primary focus:outline-none cursor-pointer"
              >
                {sections.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.icon} {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                Top 3 Must-Do?
              </span>
              <button
                type="button"
                onClick={handleToggleMustDo}
                className={`w-full py-2.5 px-3.5 rounded-xl border flex items-center justify-between text-sm font-medium transition-all ${
                  mustDo
                    ? 'bg-amber-950/40 border-amber-600/80 text-amber-300'
                    : 'bg-bg-secondary border-border-color text-text-muted hover:text-text-secondary'
                }`}
                aria-pressed={mustDo}
              >
                <div className="flex items-center gap-2">
                  <Star className={`w-4 h-4 ${mustDo ? 'fill-amber-400 text-amber-400' : 'text-text-muted'}`} />
                  <span>{mustDo ? 'Must-Do Priority (Starred)' : 'Normal Priority'}</span>
                </div>
                <span className="text-[10px] uppercase font-bold tracking-wider opacity-75">
                  Max 3
                </span>
              </button>
            </div>
          </div>

          {/* Estimated Time with Quick Buttons */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="task-est-minutes" className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>How Long Will It Take? *</span>
              </label>
              <span className="text-xs font-bold text-accent-primary font-mono">
                {estimatedMinutes} min ({Math.round((estimatedMinutes / 60) * 10) / 10}h)
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2 mb-2">
              {[15, 30, 60, 120].map(mins => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setEstimatedMinutes(mins)}
                  className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                    estimatedMinutes === mins
                      ? 'bg-accent-primary text-white border-accent-primary shadow-sm'
                      : 'bg-bg-secondary border-border-color text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
                  }`}
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
              className="w-full px-3.5 py-2 rounded-xl bg-bg-secondary border border-border-color text-text-primary text-sm focus:border-accent-primary focus:outline-none"
            />
          </div>

          {/* Strategy: How Exactly Will I Do It? (With Rich Toolbar) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Strategy: How Exactly Will I Do It?
              </label>

              {/* Formatting Toolbar */}
              <div className="flex items-center gap-1 bg-bg-secondary p-1 rounded-lg border border-border-color">
                <button
                  type="button"
                  onClick={() => executeCommand('bold')}
                  className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                  title="Bold (Ctrl+B)"
                  aria-label="Bold text"
                >
                  <Bold className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => executeCommand('hiliteColor', '#fde047')}
                  className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                  title="Highlight"
                  aria-label="Highlight text"
                >
                  <Highlighter className="w-3.5 h-3.5" />
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowColorPicker(!showColorPicker)}
                    className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                    title="8 High-Contrast Colors"
                    aria-label="Text color palette"
                  >
                    <Palette className="w-3.5 h-3.5" />
                  </button>
                  {showColorPicker && (
                    <div className="absolute right-0 top-8 z-30 p-2 bg-bg-card border border-border-color rounded-xl shadow-2xl grid grid-cols-4 gap-1.5 w-36">
                      {STRATEGY_COLORS.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            executeCommand('foreColor', c.darkHex);
                            setShowColorPicker(false);
                          }}
                          className="w-6 h-6 rounded-full border border-white/20 hover:scale-110 transition-transform"
                          style={{ backgroundColor: c.darkHex }}
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
              data-placeholder="Define the exact steps: 2 Pomodoros, phone away, open docs first..."
              className="w-full min-h-[85px] p-3 rounded-xl bg-bg-secondary border border-border-color text-text-primary text-sm focus:border-accent-primary focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-text-muted/60"
            />
          </div>

          {/* Done Means: How Will I Know It Is Finished? */}
          <div>
            <label htmlFor="task-done-means" className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
              Done Means: How Will I Know It Is Finished? *
            </label>
            <textarea
              id="task-done-means"
              rows={2}
              value={doneMeans}
              onChange={e => setDoneMeans(e.target.value)}
              placeholder="e.g. Commit pushed to GitHub, PR reviewed, and all 15 tests green."
              className="w-full px-3.5 py-2.5 rounded-xl bg-bg-secondary border border-border-color text-text-primary text-sm focus:border-accent-primary focus:outline-none placeholder:text-text-muted/60"
            />
          </div>

          {/* Priority (Text & Icon) */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
              Priority
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['Low', 'Medium', 'High'] as PriorityLevel[]).map(lvl => {
                const isSelected = priority === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setPriority(lvl)}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition-all ${
                      isSelected
                        ? lvl === 'High'
                          ? 'bg-red-950/70 border-red-700 text-red-300'
                          : lvl === 'Medium'
                          ? 'bg-amber-950/70 border-amber-700 text-amber-300'
                          : 'bg-emerald-950/70 border-emerald-700 text-emerald-300'
                        : 'bg-bg-secondary border-border-color text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {lvl === 'High' && <Flame className="w-3.5 h-3.5" />}
                    {lvl === 'Medium' && <Sparkles className="w-3.5 h-3.5" />}
                    {lvl === 'Low' && <Shield className="w-3.5 h-3.5" />}
                    <span>{lvl}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tags & Chips */}
          <div>
            <label htmlFor="task-tag-input" className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
              Tags
            </label>
            <div className="flex gap-2 mb-2">
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
                className="flex-1 px-3 py-1.5 rounded-xl bg-bg-secondary border border-border-color text-text-primary text-xs focus:border-accent-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={addTag}
                className="px-3 py-1.5 rounded-xl bg-bg-tertiary text-text-secondary text-xs hover:text-text-primary"
              >
                Add
              </button>
            </div>

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map(t => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-bg-tertiary text-text-secondary border border-border-color"
                  >
                    <Tag className="w-3 h-3 opacity-60" />
                    <span>{t}</span>
                    <button
                      type="button"
                      onClick={() => removeTag(t)}
                      className="ml-1 text-text-muted hover:text-red-400"
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
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5" />
                <span>Reference Image (Max 800px / ~150KB)</span>
              </label>
              {image && (
                <button
                  type="button"
                  onClick={() => setImage(null)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              )}
            </div>

            {image ? (
              <div className="relative group rounded-xl overflow-hidden border border-border-color bg-bg-secondary max-h-48 flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image}
                  alt={title || 'Task Attachment'}
                  className="max-h-48 object-contain cursor-pointer"
                  onClick={() => onPreviewImage(image, title || 'Task Reference')}
                />
                <button
                  type="button"
                  onClick={() => onPreviewImage(image, title || 'Task Reference')}
                  className="absolute inset-0 bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs font-medium"
                >
                  Click to enlarge
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="p-4 border-2 border-dashed border-border-color rounded-xl text-center cursor-pointer hover:border-accent-primary hover:bg-bg-secondary transition-all"
              >
                <ImageIcon className="w-6 h-6 text-text-muted mx-auto mb-1" />
                <p className="text-xs text-text-secondary">
                  Tap to upload or paste (Ctrl+V) reference screenshot
                </p>
                <p className="text-[10px] text-text-muted mt-0.5">
                  Automatically resized & compressed to ~150KB
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={e => {
                    if (e.target.files?.[0]) handleImageFile(e.target.files[0]);
                  }}
                  className="hidden"
                />
              </div>
            )}
          </div>
        </form>

        {/* Footer Actions */}
        <div className="sticky bottom-0 z-10 bg-bg-secondary/95 backdrop-blur-md border-t border-border-color p-4 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            Cancel
          </button>

          <button
            onClick={handleSave}
            disabled={!title.trim()}
            className="px-6 py-2.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white text-sm font-semibold disabled:opacity-50 transition-all flex items-center gap-2 shadow-lg shadow-purple-900/30"
          >
            <CheckCircle className="w-4 h-4" />
            <span>{existingTask ? 'Save Changes' : 'Confirm & Schedule'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
