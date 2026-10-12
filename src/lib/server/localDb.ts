import fs from 'fs';
import path from 'path';
import type { Section, Task, TimeLog, Day, WeeklyPlan, MonthlyPlan, UploadedFile } from '@/types';

interface ServerDbData {
  lastServerSeq: number;
  sections: Record<string, Section & { serverSeq: number }>;
  tasks: Record<string, Task & { serverSeq: number }>;
  timeLogs: Record<string, TimeLog & { serverSeq: number }>;
  days: Record<string, Day & { serverSeq: number }>;
  weeklyPlans: Record<string, WeeklyPlan & { serverSeq: number }>;
  monthlyPlans: Record<string, MonthlyPlan & { serverSeq: number }>;
  files?: Record<string, UploadedFile & { serverSeq: number }>;
  aiConversations?: Record<string, any>;
  aiMessages?: Record<string, any>;
  freellmConversations?: Record<string, any>;
}

const DATA_DIR = path.join(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'server_db.json');

function ensureDataFile(): ServerDbData {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed.weeklyPlans) parsed.weeklyPlans = {};
      if (!parsed.monthlyPlans) parsed.monthlyPlans = {};
      if (!parsed.files) parsed.files = {};
      if (!parsed.aiConversations) parsed.aiConversations = {};
      if (!parsed.aiMessages) parsed.aiMessages = {};
      if (!parsed.freellmConversations) parsed.freellmConversations = {};
      return parsed;
    }
  } catch {
    // Fallback to empty memory state
  }

  const initial: ServerDbData = {
    lastServerSeq: 0,
    sections: {},
    tasks: {},
    timeLogs: {},
    days: {},
    weeklyPlans: {},
    monthlyPlans: {},
    files: {},
    aiConversations: {},
    aiMessages: {},
    freellmConversations: {},
  };
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
  } catch {}
  return initial;
}

function saveDb(data: ServerDbData) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to persist server_db.json to disk (e.g. read-only serverless environment):', err);
  }
}

// In-memory cache to ensure speed and handle environments where disk writes might be restricted
let memoryDb: ServerDbData | null = null;

function getDb(): ServerDbData {
  if (!memoryDb) {
    memoryDb = ensureDataFile();
  }
  return memoryDb;
}

/**
 * Server batch synchronization for local server storage (fallback when Neon Postgres is not connected)
 * Uses deterministic sequence and "newest updatedAt wins" conflict resolution.
 */
export async function syncBatchLocal(incoming: {
  sections: Section[];
  tasks: Task[];
  timeLogs: TimeLog[];
  days: Day[];
  weeklyPlans?: WeeklyPlan[];
  monthlyPlans?: MonthlyPlan[];
  lastServerSeq: number;
}) {
  const db = getDb();
  let currentSeq = db.lastServerSeq;

  const ack = {
    sections: [] as string[],
    tasks: [] as string[],
    timeLogs: [] as string[],
    days: [] as string[],
    weeklyPlans: [] as string[],
    monthlyPlans: [] as string[],
  };

  // 1. Process Sections
  for (const s of incoming.sections) {
    const existing = db.sections[s.id];
    if (!existing || s.updatedAt >= existing.updatedAt) {
      currentSeq += 1;
      db.sections[s.id] = { ...s, serverSeq: currentSeq };
    }
    ack.sections.push(s.id);
  }

  // 2. Process Tasks
  for (const t of incoming.tasks) {
    const existing = db.tasks[t.id];
    if (!existing || t.updatedAt >= existing.updatedAt) {
      currentSeq += 1;
      db.tasks[t.id] = { ...t, serverSeq: currentSeq };
    }
    ack.tasks.push(t.id);
  }

  // 3. Process TimeLogs
  for (const tl of incoming.timeLogs) {
    const existing = db.timeLogs[tl.id];
    if (!existing || tl.updatedAt >= existing.updatedAt) {
      currentSeq += 1;
      db.timeLogs[tl.id] = { ...tl, serverSeq: currentSeq };
    }
    ack.timeLogs.push(tl.id);
  }

  // 4. Process Days
  for (const d of incoming.days) {
    const existing = db.days[d.id];
    if (!existing || d.updatedAt >= existing.updatedAt) {
      currentSeq += 1;
      db.days[d.id] = { ...d, serverSeq: currentSeq };
    }
    ack.days.push(d.id);
  }

  // 5. Process Weekly Plans
  if (incoming.weeklyPlans) {
    for (const w of incoming.weeklyPlans) {
      const existing = db.weeklyPlans[w.id];
      if (!existing || w.updatedAt >= existing.updatedAt) {
        currentSeq += 1;
        db.weeklyPlans[w.id] = { ...w, serverSeq: currentSeq };
      }
      ack.weeklyPlans.push(w.id);
    }
  }

  // 6. Process Monthly Plans
  if (incoming.monthlyPlans) {
    for (const m of incoming.monthlyPlans) {
      const existing = db.monthlyPlans[m.id];
      if (!existing || m.updatedAt >= existing.updatedAt) {
        currentSeq += 1;
        db.monthlyPlans[m.id] = { ...m, serverSeq: currentSeq };
      }
      ack.monthlyPlans.push(m.id);
    }
  }

  db.lastServerSeq = currentSeq;
  saveDb(db);

  // 7. Gather all server changes that have serverSeq > clientSeq
  const clientSeq = incoming.lastServerSeq || 0;

  const changedSections = Object.values(db.sections).filter(s => (s.serverSeq || 0) > clientSeq);
  const changedTasks = Object.values(db.tasks).filter(t => (t.serverSeq || 0) > clientSeq);
  const changedTimeLogs = Object.values(db.timeLogs).filter(tl => (tl.serverSeq || 0) > clientSeq);
  const changedDays = Object.values(db.days).filter(d => (d.serverSeq || 0) > clientSeq);
  const changedWeeklyPlans = Object.values(db.weeklyPlans).filter(w => (w.serverSeq || 0) > clientSeq);
  const changedMonthlyPlans = Object.values(db.monthlyPlans).filter(m => (m.serverSeq || 0) > clientSeq);

  return {
    currentServerSeq: currentSeq,
    ack,
    serverChanges: {
      sections: changedSections,
      tasks: changedTasks,
      timeLogs: changedTimeLogs,
      days: changedDays,
      weeklyPlans: changedWeeklyPlans,
      monthlyPlans: changedMonthlyPlans,
    },
  };
}

/**
 * Retrieve all sections stored in the local server DB
 */
export function getLocalSections(): Section[] {
  const db = getDb();
  return Object.values(db.sections).filter(s => !s.deleted);
}

/**
 * Retrieve tasks stored in the local server DB
 */
export function getLocalTasks(date?: string): Task[] {
  const db = getDb();
  let list = Object.values(db.tasks).filter(t => !t.deleted);
  if (date) {
    list = list.filter(t => t.date === date);
  }
  return list;
}

/**
 * Save or update a single task directly in the local server DB
 */
export function saveLocalTask(task: Task): Task & { serverSeq: number } {
  const db = getDb();
  db.lastServerSeq += 1;
  const saved = {
    ...task,
    serverSeq: db.lastServerSeq,
    updatedAt: task.updatedAt || Date.now(),
  };
  db.tasks[task.id] = saved;
  saveDb(db);
  return saved;
}

/**
 * Delete a single task directly in the local server DB (soft delete)
 */
export function deleteLocalTask(taskId: string): boolean {
  const db = getDb();
  const existing = db.tasks[taskId];
  if (!existing) return false;
  db.lastServerSeq += 1;
  db.tasks[taskId] = {
    ...existing,
    deleted: true,
    updatedAt: Date.now(),
    serverSeq: db.lastServerSeq,
  };
  saveDb(db);
  return true;
}

/**
 * Retrieve uploaded files from local DB (filtered by userId and resourceType)
 */
export function getLocalFiles(filter?: { userId?: string; resourceType?: string }): UploadedFile[] {
  const db = getDb();
  if (!db.files) return [];
  let list = Object.values(db.files).filter(f => !f.deleted);
  if (filter?.userId && filter.userId !== 'owner') {
    list = list.filter(f => f.userId === filter.userId);
  }
  if (filter?.resourceType) {
    list = list.filter(f => f.resourceType === filter.resourceType);
  }
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Retrieve a single file by internal ID
 */
export function getLocalFileById(fileId: string): UploadedFile | null {
  const db = getDb();
  if (!db.files) return null;
  const file = db.files[fileId];
  if (!file || file.deleted) return null;
  return file;
}

/**
 * Retrieve a single file by Cloudinary publicId
 */
export function getLocalFileByPublicId(publicId: string): UploadedFile | null {
  const db = getDb();
  if (!db.files) return null;
  const file = Object.values(db.files).find(f => f.publicId === publicId && !f.deleted);
  return file || null;
}

/**
 * Save or update file metadata in local DB
 */
export function saveLocalFile(file: UploadedFile): UploadedFile & { serverSeq: number } {
  const db = getDb();
  if (!db.files) db.files = {};
  db.lastServerSeq += 1;
  const saved = {
    ...file,
    serverSeq: db.lastServerSeq,
    updatedAt: file.updatedAt || Date.now(),
  };
  db.files[file.id] = saved;
  saveDb(db);
  return saved;
}

/**
 * Soft delete file metadata in local DB
 */
export function deleteLocalFile(fileId: string): boolean {
  const db = getDb();
  if (!db.files) return false;
  const existing = db.files[fileId];
  if (!existing) return false;
  db.lastServerSeq += 1;
  db.files[fileId] = {
    ...existing,
    deleted: true,
    updatedAt: Date.now(),
    serverSeq: db.lastServerSeq,
  };
  saveDb(db);
  return true;
}

// ── AI Conversation & Message Persistence ──

export function getAIConversationsLocal(userId: string = 'owner') {
  const db = getDb();
  if (!db.aiConversations) db.aiConversations = {};
  return Object.values(db.aiConversations)
    .filter((c: any) => !c.userId || c.userId === userId)
    .sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function saveAIConversationLocal(conv: any) {
  const db = getDb();
  if (!db.aiConversations) db.aiConversations = {};
  db.aiConversations[conv.id] = { ...conv, updatedAt: conv.updatedAt || Date.now() };
  saveDb(db);
  return db.aiConversations[conv.id];
}

export function deleteAIConversationLocal(id: string) {
  const db = getDb();
  if (db.aiConversations && db.aiConversations[id]) {
    delete db.aiConversations[id];
  }
  if (db.aiMessages) {
    for (const msgId of Object.keys(db.aiMessages)) {
      if (db.aiMessages[msgId].conversationId === id) {
        delete db.aiMessages[msgId];
      }
    }
  }
  saveDb(db);
  return true;
}

export function getAIMessagesLocal(conversationId: string) {
  const db = getDb();
  if (!db.aiMessages) db.aiMessages = {};
  return Object.values(db.aiMessages)
    .filter((m: any) => m.conversationId === conversationId)
    .sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
}

export function saveAIMessageLocal(msg: any) {
  const db = getDb();
  if (!db.aiMessages) db.aiMessages = {};
  db.aiMessages[msg.id] = msg;
  if (db.aiConversations && db.aiConversations[msg.conversationId]) {
    db.aiConversations[msg.conversationId].updatedAt = msg.timestamp || Date.now();
  }
  saveDb(db);
  return msg;
}

export function getFreeLLMConversationsLocal() {
  const db = getDb();
  if (!db.freellmConversations) db.freellmConversations = {};
  return Object.values(db.freellmConversations)
    .sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function saveFreeLLMConversationLocal(conv: any) {
  const db = getDb();
  if (!db.freellmConversations) db.freellmConversations = {};
  db.freellmConversations[conv.id] = { ...conv, updatedAt: conv.updatedAt || Date.now() };
  saveDb(db);
  return db.freellmConversations[conv.id];
}

export function deleteFreeLLMConversationLocal(id: string) {
  const db = getDb();
  if (db.freellmConversations && db.freellmConversations[id]) {
    delete db.freellmConversations[id];
    saveDb(db);
  }
  return true;
}


