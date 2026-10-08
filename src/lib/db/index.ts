import Dexie, { type Table } from 'dexie';
import type { Section, Task, TimeLog, Day, DraftTask, ActiveTimer } from '@/types';

export class NightPlannerDB extends Dexie {
  sections!: Table<Section, string>;
  tasks!: Table<Task, string>;
  timeLogs!: Table<TimeLog, string>;
  days!: Table<Day, string>;
  meta!: Table<{ key: string; value: any }, string>;

  constructor() {
    super('NightPlannerDB');
    this.version(1).stores({
      sections: 'id, order, updatedAt, deleted, synced, isSample',
      tasks: 'id, date, sectionId, order, isCompleted, updatedAt, deleted, synced, isSample, mustDo',
      timeLogs: 'id, taskId, date, updatedAt, deleted, synced, isSample',
      days: 'id, date, updatedAt, deleted, synced, isSample',
      meta: 'key',
    });
  }
}

export const db = new NightPlannerDB();

// Initial Default Sections
export const DEFAULT_SECTIONS: Omit<Section, 'id' | 'updatedAt' | 'synced' | 'deleted' | 'isSample'>[] = [
  { name: 'Entertainment', color: '#a855f7', icon: '🎮', order: 0, dailyTargetMinutes: 120, targetType: 'at most' },
  { name: 'Deep Work', color: '#f59e0b', icon: '⚡', order: 1, dailyTargetMinutes: 180, targetType: 'at least' },
  { name: 'Learning', color: '#3b82f6', icon: '📚', order: 2, dailyTargetMinutes: 60, targetType: 'at least' },
  { name: 'Health', color: '#10b981', icon: '🏃', order: 3, dailyTargetMinutes: 45, targetType: 'at least' },
  { name: 'Rest', color: '#6366f1', icon: '🌙', order: 4, dailyTargetMinutes: 60, targetType: 'at least' },
  { name: 'Other', color: '#64748b', icon: '📌', order: 5, dailyTargetMinutes: null, targetType: 'at least' },
];

/**
 * Seed default sections if database is empty
 */
export async function seedDefaultSectionsIfEmpty(): Promise<void> {
  const count = await db.sections.count();
  if (count === 0) {
    const now = Date.now();
    const seeds: Section[] = DEFAULT_SECTIONS.map((sec, idx) => ({
      ...sec,
      id: `default-sec-${idx + 1}`,
      order: idx,
      updatedAt: now,
      deleted: false,
      isSample: false,
      synced: 0,
    }));
    await db.sections.bulkPut(seeds);
  }
}

/**
 * Request persistent browser storage so Safari/Chrome won't purge data under storage pressure
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof window !== 'undefined' && navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        return await navigator.storage.persist();
      }
      return isPersisted;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Get or set last server sequence
 */
export async function getLastServerSeq(): Promise<number> {
  const meta = await db.meta.get('lastServerSeq');
  return meta?.value ? Number(meta.value) : 0;
}

export async function setLastServerSeq(seq: number): Promise<void> {
  await db.meta.put({ key: 'lastServerSeq', value: seq });
}

export async function getLastSyncedTime(): Promise<number | null> {
  const meta = await db.meta.get('lastSyncedTime');
  return meta?.value ? Number(meta.value) : null;
}

export async function setLastSyncedTime(time: number): Promise<void> {
  await db.meta.put({ key: 'lastSyncedTime', value: time });
}

/**
 * Draft task persistence
 */
export async function saveTaskDraft(draft: DraftTask): Promise<void> {
  await db.meta.put({ key: 'draftTask', value: draft });
}

export async function getTaskDraft(): Promise<DraftTask | null> {
  const record = await db.meta.get('draftTask');
  return record?.value ?? null;
}

export async function clearTaskDraft(): Promise<void> {
  await db.meta.delete('draftTask');
}

/**
 * Active timer persistence
 */
export async function saveActiveTimer(timer: ActiveTimer | null): Promise<void> {
  if (!timer) {
    await db.meta.delete('activeTimer');
  } else {
    await db.meta.put({ key: 'activeTimer', value: timer });
  }
}

export async function getActiveTimer(): Promise<ActiveTimer | null> {
  const record = await db.meta.get('activeTimer');
  return record?.value ?? null;
}

/**
 * Retrieve all local unsynced records
 */
export async function getUnsyncedChanges(): Promise<{
  sections: Section[];
  tasks: Task[];
  timeLogs: TimeLog[];
  days: Day[];
}> {
  const [sections, tasks, timeLogs, days] = await Promise.all([
    db.sections.filter(s => s.synced === 0).toArray(),
    db.tasks.filter(t => t.synced === 0).toArray(),
    db.timeLogs.filter(tl => tl.synced === 0).toArray(),
    db.days.filter(d => d.synced === 0).toArray(),
  ]);

  return { sections, tasks, timeLogs, days };
}

/**
 * Get count of unsynced records
 */
export async function getUnsyncedCount(): Promise<number> {
  const changes = await getUnsyncedChanges();
  return changes.sections.length + changes.tasks.length + changes.timeLogs.length + changes.days.length;
}
