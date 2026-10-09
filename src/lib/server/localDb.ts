import fs from 'fs';
import path from 'path';
import type { Section, Task, TimeLog, Day, WeeklyPlan, MonthlyPlan } from '@/types';

interface ServerDbData {
  lastServerSeq: number;
  sections: Record<string, Section & { serverSeq: number }>;
  tasks: Record<string, Task & { serverSeq: number }>;
  timeLogs: Record<string, TimeLog & { serverSeq: number }>;
  days: Record<string, Day & { serverSeq: number }>;
  weeklyPlans: Record<string, WeeklyPlan & { serverSeq: number }>;
  monthlyPlans: Record<string, MonthlyPlan & { serverSeq: number }>;
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
