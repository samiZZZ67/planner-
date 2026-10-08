import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import type { Task, Day } from '@/types';

/**
 * Calculates YYYY-MM-DD for the day prior to given date string
 */
export function getPreviousDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().split('T')[0];
}

/**
 * Calculates YYYY-MM-DD for tomorrow
 */
export function getTomorrowDate(): string {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  return now.toISOString().split('T')[0];
}

/**
 * Default date calculation:
 * Default date = tomorrow, but between 12:00 AM and 4:00 AM default to today.
 */
export function getDefaultPlanningDate(): string {
  const now = new Date();
  const currentHour = now.getHours();

  if (currentHour >= 0 && currentHour < 4) {
    // 12:00 AM - 3:59 AM: User is likely still planning for "today"
    return now.toISOString().split('T')[0];
  } else {
    // 4:00 AM onwards: Planning for tomorrow
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }
}

/**
 * Retrieve previous day's plan and review
 */
export async function getPreviousDayData(targetDate: string): Promise<{
  previousDate: string;
  unfinishedTasks: Task[];
  allTasks: Task[];
  previousReviewChange: string | null;
}> {
  const previousDate = getPreviousDate(targetDate);

  const prevTasks = await db.tasks
    .filter(t => t.date === previousDate && !t.deleted)
    .toArray();

  const unfinishedTasks = prevTasks.filter(t => !t.isCompleted);

  const prevDay = await db.days.get(previousDate);
  const previousReviewChange = prevDay?.review?.change || null;

  return {
    previousDate,
    unfinishedTasks,
    allTasks: prevTasks,
    previousReviewChange,
  };
}

/**
 * Auto-populate/carry-over selected tasks from previous day into targetDate
 */
export async function copyTasksToDate(
  tasksToCopy: Task[],
  targetDate: string
): Promise<Task[]> {
  const now = Date.now();
  const newTasks: Task[] = tasksToCopy.map((task, index) => ({
    ...task,
    id: crypto.randomUUID(),
    date: targetDate,
    isCompleted: false,
    completedAt: null,
    order: index,
    createdAt: now,
    updatedAt: now,
    synced: 0,
    isSample: false,
    // Keep top 3 must-do if index < 3, else false
    mustDo: index < 3 && task.mustDo,
  }));

  await db.tasks.bulkPut(newTasks);
  syncEngine.notifyLocalMutation();
  return newTasks;
}
