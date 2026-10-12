import Dexie, { type Table } from 'dexie';
import type { Section, Task, TimeLog, Day, DraftTask, ActiveTimer, WeeklyPlan, MonthlyPlan, AIConversation, AIMessageItem } from '@/types';

export class SamsSpaceDB extends Dexie {
  sections!: Table<Section, string>;
  tasks!: Table<Task, string>;
  timeLogs!: Table<TimeLog, string>;
  days!: Table<Day, string>;
  weeklyPlans!: Table<WeeklyPlan, string>;
  monthlyPlans!: Table<MonthlyPlan, string>;
  aiConversations!: Table<AIConversation, string>;
  aiMessages!: Table<AIMessageItem, string>;
  meta!: Table<{ key: string; value: any }, string>;

  constructor() {
    // Retain underlying IndexedDB identifier to preserve user offline data
    super('NightPlannerDB');
    this.version(1).stores({
      sections: 'id, order, updatedAt, deleted, synced, isSample',
      tasks: 'id, date, sectionId, order, isCompleted, updatedAt, deleted, synced, isSample, mustDo',
      timeLogs: 'id, taskId, date, updatedAt, deleted, synced, isSample',
      days: 'id, date, updatedAt, deleted, synced, isSample',
      meta: 'key',
    });
    this.version(2).stores({
      weeklyPlans: 'id, startDate, endDate, monthId, status, updatedAt, deleted, synced',
      monthlyPlans: 'id, month, status, updatedAt, deleted, synced',
    });
    this.version(3).stores({
      aiConversations: 'id, title, createdAt, updatedAt, userId',
      aiMessages: 'id, conversationId, role, timestamp, userId',
    });
  }
}

export type NightPlannerDB = SamsSpaceDB;
export const db = new SamsSpaceDB();

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
  weeklyPlans: WeeklyPlan[];
  monthlyPlans: MonthlyPlan[];
}> {
  const [sections, tasks, timeLogs, days, weeklyPlans, monthlyPlans] = await Promise.all([
    db.sections.filter(s => s.synced === 0).toArray(),
    db.tasks.filter(t => t.synced === 0).toArray(),
    db.timeLogs.filter(tl => tl.synced === 0).toArray(),
    db.days.filter(d => d.synced === 0).toArray(),
    db.weeklyPlans.filter(w => w.synced === 0).toArray(),
    db.monthlyPlans.filter(m => m.synced === 0).toArray(),
  ]);

  return { sections, tasks, timeLogs, days, weeklyPlans, monthlyPlans };
}

/**
 * Get count of unsynced records
 */
export async function getUnsyncedCount(): Promise<number> {
  const changes = await getUnsyncedChanges();
  return (
    changes.sections.length +
    changes.tasks.length +
    changes.timeLogs.length +
    changes.days.length +
    changes.weeklyPlans.length +
    changes.monthlyPlans.length
  );
}

/**
 * Sam's AI Persistent Chat Storage
 */
export async function getAIConversations(userId: string = 'owner'): Promise<AIConversation[]> {
  try {
    const list = await db.aiConversations.toArray();
    return list
      .filter(c => !c.userId || c.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function createAIConversation(title: string, userId: string = 'owner'): Promise<AIConversation> {
  const now = Date.now();
  const conv: AIConversation = {
    id: `conv_${now}_${Math.random().toString(36).substring(2, 7)}`,
    title: title || 'New Conversation',
    createdAt: now,
    updatedAt: now,
    userId,
  };
  try {
    await db.aiConversations.put(conv);
  } catch {}
  return conv;
}

export async function updateAIConversationTitle(id: string, title: string): Promise<AIConversation | null> {
  try {
    const conv = await db.aiConversations.get(id);
    if (conv) {
      conv.title = title;
      conv.updatedAt = Date.now();
      await db.aiConversations.put(conv);
      return conv;
    }
  } catch {}
  return null;
}

export async function touchAIConversation(id: string): Promise<void> {
  try {
    const conv = await db.aiConversations.get(id);
    if (conv) {
      conv.updatedAt = Date.now();
      await db.aiConversations.put(conv);
    }
  } catch {}
}

export async function deleteAIConversation(id: string): Promise<void> {
  try {
    await db.aiConversations.delete(id);
    await db.aiMessages.where('conversationId').equals(id).delete();
  } catch {}
}

export async function getAIMessages(conversationId: string): Promise<AIMessageItem[]> {
  try {
    const msgs = await db.aiMessages.where('conversationId').equals(conversationId).toArray();
    return msgs.sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

export async function saveAIMessage(msg: AIMessageItem): Promise<void> {
  try {
    await db.aiMessages.put(msg);
    await touchAIConversation(msg.conversationId);
  } catch {}
}
