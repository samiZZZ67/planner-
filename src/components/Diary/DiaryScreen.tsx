'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ImagePlus,
  LoaderCircle,
  NotebookPen,
  Save,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '@/lib/api/apiClient';
import { db } from '@/lib/db';
import { getTraditionalDayDate } from '@/lib/date/ethiopianTime';
import { syncEngine } from '@/lib/sync/syncEngine';
import type { Day, DayDiaryEntry, DayDiaryPhoto } from '@/types';

interface DiaryScreenProps {
  currentDate: string;
  onChangeDate: (date: string) => void;
  isPhone: boolean;
  onOpenLogin: () => void;
}

const MAX_DIARY_PHOTOS = 8;

function emptyEntry(date: string): DayDiaryEntry {
  return { date, text: '', photos: [], createdAt: 0, updatedAt: 0 };
}

function formatDiaryDate(date: string, options: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
}) {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function getDiaryFromDay(day: Day): DayDiaryEntry | null {
  const diary = day.sheetData?.diary;
  if (!diary || (!diary.text?.trim() && !diary.photos?.length)) return null;
  return {
    ...diary,
    date: diary.date || day.date,
    text: diary.text || '',
    photos: Array.isArray(diary.photos) ? diary.photos : [],
    createdAt: diary.createdAt || day.updatedAt,
    updatedAt: diary.updatedAt || day.updatedAt,
  };
}

export function DiaryScreen({ currentDate, onChangeDate, isPhone, onOpenLogin }: DiaryScreenProps) {
  const [entry, setEntry] = useState<DayDiaryEntry>(() => emptyEntry(currentDate));
  const [recentEntries, setRecentEntries] = useState<Day[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const versionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestDraftRef = useRef({ date: currentDate, entry, isDirty });
  const persistEntryRef = useRef<((date: string, draft: DayDiaryEntry, triggerSync: boolean, version: number) => Promise<boolean>) | null>(null);
  latestDraftRef.current = { date: currentDate, entry, isDirty };

  const refreshRecentEntries = useCallback(async () => {
    const days = await db.days.toArray();
    setRecentEntries(
      days
        .filter(day => Boolean(getDiaryFromDay(day)))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 12)
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setIsDirty(false);
    setError('');
    versionRef.current += 1;

    Promise.all([db.days.get(currentDate), db.days.toArray()])
      .then(([day, days]) => {
        if (cancelled) return;
        const savedEntry = day ? getDiaryFromDay(day) : null;
        setEntry(savedEntry || emptyEntry(currentDate));
        setLastSavedAt(savedEntry?.updatedAt || null);
        setRecentEntries(
          days
            .filter(item => Boolean(getDiaryFromDay(item)))
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 12)
        );
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this day’s diary entry.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [currentDate]);

  const persistEntry = useCallback((date: string, draft: DayDiaryEntry, triggerSync: boolean, version: number): Promise<boolean> => {
    const save = async (): Promise<boolean> => {
      setIsSaving(true);
      try {
        const existing = await db.days.get(date);
        const now = Date.now();
        const savedDiary: DayDiaryEntry = {
          ...draft,
          date,
          text: draft.text || '',
          photos: draft.photos || [],
          createdAt: draft.createdAt || now,
          updatedAt: now,
        };
        await db.days.put({
          id: date,
          date,
          freeHours: existing?.freeHours ?? 8,
          review: existing?.review || { worked: '', blocked: '', change: '' },
          sheetData: {
            ...(existing?.sheetData || {}),
            diary: savedDiary,
          },
          updatedAt: now,
          deleted: false,
          isSample: false,
          synced: 0,
        });

        if (date === currentDate && version === versionRef.current) {
          setEntry(previous => ({ ...previous, date, createdAt: savedDiary.createdAt, updatedAt: now }));
          setLastSavedAt(now);
          setIsDirty(false);
        }

        if (triggerSync) await syncEngine.triggerSync();
        else syncEngine.notifyLocalMutation();
        await refreshRecentEntries();
        return true;
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Could not save this diary entry.');
        return false;
      } finally {
        setIsSaving(false);
      }
    };

    const queuedSave = saveQueueRef.current.then(save);
    saveQueueRef.current = queuedSave.then(() => undefined, () => undefined);
    return queuedSave;
  }, [currentDate, refreshRecentEntries]);

  persistEntryRef.current = persistEntry;

  useEffect(() => () => {
    const latest = latestDraftRef.current;
    if (!latest.isDirty || !persistEntryRef.current) return;
    void persistEntryRef.current(latest.date, { ...latest.entry, photos: [...latest.entry.photos] }, false, versionRef.current);
  }, []);

  useEffect(() => {
    if (isLoading || !isDirty) return;
    const date = currentDate;
    const draft = { ...entry, photos: [...entry.photos] };
    const version = versionRef.current;
    const timer = setTimeout(() => {
      void persistEntry(date, draft, false, version);
    }, 650);
    return () => clearTimeout(timer);
  }, [currentDate, entry, isDirty, isLoading, persistEntry]);

  const updateEntry = (update: (current: DayDiaryEntry) => DayDiaryEntry) => {
    versionRef.current += 1;
    setIsDirty(true);
    setError('');
    setEntry(current => update(current));
  };

  const changeDate = async (date: string) => {
    if (!date || date === currentDate || isUploading) return;
    if (isDirty) {
      const saved = await persistEntry(currentDate, { ...entry, photos: [...entry.photos] }, false, versionRef.current);
      if (!saved) return;
    }
    onChangeDate(date);
  };

  const shiftDate = (offset: number) => {
    const [year, month, day] = currentDate.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day + offset, 12));
    void changeDate(shifted.toISOString().slice(0, 10));
  };

  const showToday = () => {
    const mode = typeof window === 'undefined' ? null : localStorage.getItem('np_calendar_mode');
    const today = mode === 'gregorian'
      ? new Date().toLocaleDateString('en-CA')
      : getTraditionalDayDate(new Date(), 'Africa/Addis_Ababa');
    void changeDate(today);
  };

  const saveNow = () => {
    if (!isDirty || isLoading) return;
    void persistEntry(currentDate, { ...entry, photos: [...entry.photos] }, true, versionRef.current);
  };

  const uploadPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    if (entry.photos.length + selectedFiles.length > MAX_DIARY_PHOTOS) {
      setError(`Keep up to ${MAX_DIARY_PHOTOS} photos on each day’s entry.`);
      if (photoInputRef.current) photoInputRef.current.value = '';
      return;
    }

    const hasSession = Boolean(localStorage.getItem('np_session_token'));
    if (!hasSession) {
      setError('Sign in to Cloud Sync to upload photos. Your written diary still saves on this device.');
      onOpenLogin();
      if (photoInputRef.current) photoInputRef.current.value = '';
      return;
    }

    setIsUploading(true);
    setError('');
    try {
      for (const file of selectedFiles) {
        if (!file.type.startsWith('image/')) {
          throw new Error(`${file.name} is not an image file.`);
        }

        const form = new FormData();
        form.append('file', file);
        form.append('folder', 'samsspace/diary');
        form.append('tags', 'samsspace,diary');
        const response = await apiFetch('/api/files', { method: 'POST', body: form });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.file?.secureUrl) {
          if (response.status === 401) {
            setError('Your Cloud Sync login expired. Sign in again, then upload the photo.');
            onOpenLogin();
            return;
          }
          throw new Error(data?.error || `Could not upload ${file.name}.`);
        }

        const photo: DayDiaryPhoto = {
          id: data.file.id,
          url: data.file.secureUrl,
          filename: data.file.originalFilename || file.name,
          uploadedAt: data.file.createdAt || Date.now(),
          width: data.file.width,
          height: data.file.height,
        };
        updateEntry(current => ({ ...current, photos: [...current.photos, photo] }));
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Photo upload failed.');
    } finally {
      setIsUploading(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const removePhoto = (photoId: string) => {
    updateEntry(current => ({
      ...current,
      photos: current.photos.filter(photo => photo.id !== photoId),
    }));
  };

  const statusText = isLoading
    ? 'Loading this day’s entry…'
    : isUploading
    ? 'Uploading photos…'
    : isSaving
    ? 'Saving entry…'
    : isDirty
    ? 'Changes will save automatically'
    : lastSavedAt
    ? `Saved on this device at ${new Date(lastSavedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : 'Your entry is filed under the date shown below';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <section className="v-card" style={{ padding: isPhone ? 16 : 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{ width: 42, height: 42, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--v-glass-bg-subtle)', border: '1px solid var(--v-glass-border)' }}>
            <NotebookPen size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="font-bloody" style={{ fontSize: isPhone ? 22 : 26, lineHeight: 1.1, margin: 0 }}>Diary</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 0' }}>Keep a dated record of your days.</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <button type="button" onClick={() => shiftDate(-1)} className="v-circle-btn" style={{ width: 40, height: 40, flexShrink: 0 }} aria-label="Previous day" disabled={isUploading}>
            <ChevronLeft size={18} />
          </button>
          <label style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', borderRadius: 13, border: '1px solid var(--v-glass-border)', background: 'var(--v-glass-bg-subtle)' }}>
            <CalendarDays size={17} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 700 }}>Entry date</span>
              <span style={{ fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatDiaryDate(currentDate)}</span>
            </span>
            <input
              aria-label="Choose diary date"
              type="date"
              value={currentDate}
              disabled={isUploading}
              onChange={event => void changeDate(event.target.value)}
              style={{ width: isPhone ? 38 : 140, maxWidth: '42%', color: 'var(--text-primary)', background: 'transparent', border: 0, fontSize: 12 }}
            />
          </label>
          <button type="button" onClick={() => shiftDate(1)} className="v-circle-btn" style={{ width: 40, height: 40, flexShrink: 0 }} aria-label="Next day" disabled={isUploading}>
            <ChevronRight size={18} />
          </button>
          <button type="button" onClick={showToday} className="v-pill-btn" style={{ minHeight: 40, padding: '0 12px', flexShrink: 0 }} disabled={isUploading}>Today</button>
        </div>

        <div style={{ borderRadius: 16, padding: isPhone ? 15 : 20, background: 'var(--v-glass-bg-subtle)', border: '1px solid var(--v-glass-border)' }}>
          <div style={{ marginBottom: 13 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Writing for</div>
            <div style={{ color: 'var(--text-primary)', fontSize: isPhone ? 17 : 19, fontWeight: 700, marginTop: 4 }}>{formatDiaryDate(currentDate)}</div>
          </div>

          <label htmlFor="diary-entry-text" style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>What do you want to remember about this day?</label>
          <textarea
            id="diary-entry-text"
            value={entry.text}
            disabled={isLoading}
            onChange={event => updateEntry(current => ({ ...current, text: event.target.value }))}
            placeholder="Write about what happened, what mattered, or how you felt…"
            style={{ width: '100%', minHeight: isPhone ? 220 : 290, resize: 'vertical', boxSizing: 'border-box', padding: 15, borderRadius: 13, border: '1px solid var(--v-glass-border)', outline: 'none', background: 'var(--v-glass-bg-card)', color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 15, lineHeight: 1.7 }}
          />

          <div style={{ display: 'flex', alignItems: isPhone ? 'stretch' : 'center', justifyContent: 'space-between', gap: 10, flexDirection: isPhone ? 'column' : 'row', marginTop: 12 }}>
            <div style={{ minHeight: 20, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 11 }}>
              {isSaving || isUploading ? <LoaderCircle size={13} className="animate-spin" /> : lastSavedAt && !isDirty ? <Check size={13} /> : <Clock3 size={13} />}
              <span>{statusText}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={event => void uploadPhotos(event.target.files)}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                className="v-pill-btn"
                onClick={() => photoInputRef.current?.click()}
                disabled={isLoading || isUploading || entry.photos.length >= MAX_DIARY_PHOTOS}
                style={{ minHeight: 40, padding: '0 13px', flex: isPhone ? 1 : undefined, justifyContent: 'center' }}
              >
                {isUploading ? <LoaderCircle size={15} className="animate-spin" /> : isPhone ? <Camera size={15} /> : <ImagePlus size={15} />}
                {isUploading ? 'Uploading…' : 'Add photos'}
              </button>
              <button
                type="button"
                className="v-pill-btn v-pill-btn-primary"
                onClick={saveNow}
                disabled={!isDirty || isSaving || isLoading}
                style={{ minHeight: 40, padding: '0 13px', flex: isPhone ? 1 : undefined, justifyContent: 'center', opacity: !isDirty || isSaving ? 0.6 : 1 }}
              >
                <Save size={14} /> Save now
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" style={{ marginTop: 12, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.08)', color: 'var(--text-primary)', fontSize: 12, lineHeight: 1.5 }}>
              {error}
              {error.toLowerCase().includes('sign in') && (
                <button type="button" onClick={onOpenLogin} style={{ display: 'block', marginTop: 6, padding: 0, border: 0, background: 'transparent', color: 'var(--text-primary)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>Open Cloud Sync login</button>
              )}
            </div>
          )}

          {entry.photos.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isPhone ? 2 : 3}, minmax(0, 1fr))`, gap: 10, marginTop: 16 }}>
              {entry.photos.map(photo => (
                <div key={photo.id} style={{ position: 'relative', minWidth: 0, overflow: 'hidden', aspectRatio: '1 / 1', borderRadius: 13, border: '1px solid var(--v-glass-border)', background: 'var(--v-glass-bg-card)' }}>
                  <a href={photo.url} target="_blank" rel="noreferrer" aria-label={`Open ${photo.filename}`} style={{ display: 'block', width: '100%', height: '100%' }}>
                    <img src={photo.url} alt={photo.filename} loading="lazy" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
                  </a>
                  <button type="button" onClick={() => removePhoto(photo.id)} className="v-circle-btn" aria-label={`Remove ${photo.filename} from this diary entry`} title="Remove from this entry" style={{ position: 'absolute', top: 7, right: 7, width: 30, height: 30, color: 'white', background: 'rgba(0,0,0,0.65)', borderColor: 'rgba(255,255,255,0.35)' }}>
                    <Trash2 size={13} />
                  </button>
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '18px 8px 7px', color: 'white', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'linear-gradient(transparent, rgba(0,0,0,0.72))' }}>
                    {photo.filename}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="v-card" style={{ padding: isPhone ? 16 : 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Past entries</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 11 }}>Each note and photo stays attached to its day.</p>
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{recentEntries.length} recent</span>
        </div>
        {recentEntries.length === 0 ? (
          <div style={{ padding: '18px 12px', borderRadius: 13, border: '1px dashed var(--v-glass-border)', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
            Your saved diary days will appear here.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {recentEntries.map(day => {
              const saved = getDiaryFromDay(day);
              if (!saved) return null;
              const active = day.date === currentDate;
              const preview = saved.text.trim().replace(/\s+/g, ' ').slice(0, 100);
              return (
                <button
                  type="button"
                  key={day.id}
                  onClick={() => void changeDate(day.date)}
                  disabled={isUploading}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '11px 12px', textAlign: 'left', borderRadius: 12, border: active ? '1px solid var(--accent-color)' : '1px solid var(--v-glass-border)', background: active ? 'var(--accent-glow)' : 'var(--v-glass-bg-subtle)', color: 'var(--text-primary)', cursor: 'pointer' }}
                >
                  <CalendarDays size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 750 }}>{formatDiaryDate(day.date, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                    <span style={{ display: 'block', marginTop: 3, color: 'var(--text-muted)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {preview || `${saved.photos.length} photo${saved.photos.length === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  {saved.photos.length > 0 && <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0 }}>{saved.photos.length} photo{saved.photos.length === 1 ? '' : 's'}</span>}
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
