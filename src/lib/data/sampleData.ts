import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import type { Task, TimeLog, Day, Section } from '@/types';

/**
 * Generates 14 days of realistic sample data
 */
export async function addFourteenDaysSampleData(): Promise<void> {
  const sections = await db.sections.toArray();
  const entertainmentSec = sections.find(s => s.name.toLowerCase().includes('entertainment')) || sections[0];
  const deepWorkSec = sections.find(s => s.name.toLowerCase().includes('deep work')) || sections[1] || sections[0];
  const learningSec = sections.find(s => s.name.toLowerCase().includes('learning')) || sections[2] || sections[0];

  const newTasks: Task[] = [];
  const newLogs: TimeLog[] = [];
  const newDays: Day[] = [];

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  for (let i = 14; i >= 1; i--) {
    const targetTimestamp = now - i * dayMs;
    const dateStr = new Date(targetTimestamp).toISOString().split('T')[0];

    // Day record
    const dayRecord: Day = {
      id: dateStr,
      date: dateStr,
      freeHours: 7.5 + ((i % 3) * 0.5),
      review: {
        worked: i % 2 === 0 ? 'Consistent morning flow without Slack checking' : 'Finished both Pomodoros before noon',
        blocked: i % 3 === 0 ? 'Unexpected meeting pushed study time' : 'Low energy in early afternoon',
        change: 'Protect first 2 hours of tomorrow for Deep Work only',
      },
      updatedAt: targetTimestamp,
      deleted: false,
      isSample: true,
      synced: 0,
    };
    newDays.push(dayRecord);

    // 1. Entertainment: "Watch Movie" (sci-fi film to relax; strategy: no distractions; 2h; Low; tags: fun, movie)
    const movieTaskId = crypto.randomUUID();
    const movieVariance = (i % 5 - 2) * 5; // -10 to +10 mins
    const movieMinutes = 120 + movieVariance;

    newTasks.push({
      id: movieTaskId,
      date: dateStr,
      sectionId: entertainmentSec?.id || 'default-sec-1',
      title: 'Watch Movie',
      description: 'sci-fi film to relax',
      strategy: '<b>Rule:</b> no distractions, phone in airplane mode',
      doneMeans: 'Full movie watched until end credits',
      estimatedMinutes: 120,
      priority: 'Low',
      mustDo: false,
      tags: ['fun', 'movie'],
      icon: '🍿',
      textColor: '#a855f7',
      image: null,
      isCompleted: true,
      completedAt: targetTimestamp + 4 * 3600 * 1000,
      order: 0,
      createdAt: targetTimestamp,
      updatedAt: targetTimestamp,
      deleted: false,
      isSample: true,
      synced: 0,
    });

    newLogs.push({
      id: crypto.randomUUID(),
      taskId: movieTaskId,
      date: dateStr,
      minutes: movieMinutes,
      source: 'timer',
      createdAt: targetTimestamp + 4 * 3600 * 1000,
      updatedAt: targetTimestamp + 4 * 3600 * 1000,
      deleted: false,
      isSample: true,
      synced: 0,
    });

    // 2. Deep Work: "Code Feature" (build a new app feature; strategy: 2 Pomodoro sessions; 1.5h; High; tags: coding, urgent)
    const codeTaskId = crypto.randomUUID();
    const codeVariance = ((i * 7) % 25) - 10; // -10 to +15 mins
    const codeMinutes = 90 + codeVariance;

    newTasks.push({
      id: codeTaskId,
      date: dateStr,
      sectionId: deepWorkSec?.id || 'default-sec-2',
      title: 'Code Feature',
      description: 'build a new app feature',
      strategy: '<span style="color:#fbbf24"><b>2 Pomodoro sessions</b></span> with noise cancelling audio',
      doneMeans: 'Feature branch merged and unit tests passing green',
      estimatedMinutes: 90,
      priority: 'High',
      mustDo: true,
      tags: ['coding', 'urgent'],
      icon: '⚡',
      textColor: '#f59e0b',
      image: null,
      isCompleted: true,
      completedAt: targetTimestamp + 2 * 3600 * 1000,
      order: 1,
      createdAt: targetTimestamp,
      updatedAt: targetTimestamp,
      deleted: false,
      isSample: true,
      synced: 0,
    });

    newLogs.push({
      id: crypto.randomUUID(),
      taskId: codeTaskId,
      date: dateStr,
      minutes: codeMinutes,
      source: 'timer',
      createdAt: targetTimestamp + 2 * 3600 * 1000,
      updatedAt: targetTimestamp + 2 * 3600 * 1000,
      deleted: false,
      isSample: true,
      synced: 0,
    });

    // 3. Learning: "Read Tutorial" (learn a new JS library; strategy: take notes; 1h; Medium; tags: learning, coding)
    const learnTaskId = crypto.randomUUID();
    const learnVariance = ((i * 3) % 15) - 5;
    const learnMinutes = 60 + learnVariance;

    newTasks.push({
      id: learnTaskId,
      date: dateStr,
      sectionId: learningSec?.id || 'default-sec-3',
      title: 'Read Tutorial',
      description: 'learn a new JS library',
      strategy: '<mark>Active learning</mark>: write cheat sheet and build sample test',
      doneMeans: 'Chapter 4 completed with notes in Obsidian',
      estimatedMinutes: 60,
      priority: 'Medium',
      mustDo: false,
      tags: ['learning', 'coding'],
      icon: '📚',
      textColor: '#3b82f6',
      image: null,
      isCompleted: true,
      completedAt: targetTimestamp + 3 * 3600 * 1000,
      order: 2,
      createdAt: targetTimestamp,
      updatedAt: targetTimestamp,
      deleted: false,
      isSample: true,
      synced: 0,
    });

    newLogs.push({
      id: crypto.randomUUID(),
      taskId: learnTaskId,
      date: dateStr,
      minutes: learnMinutes,
      source: 'manual',
      createdAt: targetTimestamp + 3 * 3600 * 1000,
      updatedAt: targetTimestamp + 3 * 3600 * 1000,
      deleted: false,
      isSample: true,
      synced: 0,
    });
  }

  await db.transaction('rw', [db.tasks, db.timeLogs, db.days], async () => {
    await db.tasks.bulkPut(newTasks);
    await db.timeLogs.bulkPut(newLogs);
    await db.days.bulkPut(newDays);
  });

  syncEngine.notifyLocalMutation();
}

/**
 * Removes all sample data flagged with isSample = true
 */
export async function removeSampleData(): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', [db.tasks, db.timeLogs, db.days], async () => {
    const sampleTasks = await db.tasks.filter(t => t.isSample).toArray();
    for (const t of sampleTasks) {
      await db.tasks.update(t.id, { deleted: true, updatedAt: now, synced: 0 });
    }

    const sampleLogs = await db.timeLogs.filter(tl => tl.isSample).toArray();
    for (const tl of sampleLogs) {
      await db.timeLogs.update(tl.id, { deleted: true, updatedAt: now, synced: 0 });
    }

    const sampleDays = await db.days.filter(d => d.isSample).toArray();
    for (const d of sampleDays) {
      await db.days.update(d.id, { deleted: true, updatedAt: now, synced: 0 });
    }
  });

  syncEngine.notifyLocalMutation();
}

/**
 * Export complete database state to downloadable JSON file
 */
export async function exportAllDataToJson(): Promise<void> {
  const [sections, tasks, timeLogs, days] = await Promise.all([
    db.sections.toArray(),
    db.tasks.toArray(),
    db.timeLogs.toArray(),
    db.days.toArray(),
  ]);

  const payload = {
    appName: "Sam'Space",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { sections, tasks, timeLogs, days },
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `night-planner-export-${new Date().toISOString().split('T')[0]}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Import data from JSON file into local database
 */
export async function importDataFromJson(jsonString: string): Promise<{ success: boolean; count: number }> {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed?.data) throw new Error('Invalid backup file format');

    const { sections, tasks, timeLogs, days } = parsed.data;
    const now = Date.now();

    await db.transaction('rw', [db.sections, db.tasks, db.timeLogs, db.days], async () => {
      if (Array.isArray(sections)) {
        for (const s of sections) {
          await db.sections.put({ ...s, updatedAt: now, synced: 0 });
        }
      }
      if (Array.isArray(tasks)) {
        for (const t of tasks) {
          await db.tasks.put({ ...t, updatedAt: now, synced: 0 });
        }
      }
      if (Array.isArray(timeLogs)) {
        for (const tl of timeLogs) {
          await db.timeLogs.put({ ...tl, updatedAt: now, synced: 0 });
        }
      }
      if (Array.isArray(days)) {
        for (const d of days) {
          await db.days.put({ ...d, updatedAt: now, synced: 0 });
        }
      }
    });

    syncEngine.notifyLocalMutation();
    return {
      success: true,
      count: (tasks?.length || 0) + (timeLogs?.length || 0) + (sections?.length || 0),
    };
  } catch (err: any) {
    throw new Error(`Failed to import data: ${err.message}`);
  }
}
