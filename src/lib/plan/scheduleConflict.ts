import type { Task, PriorityLevel } from '@/types';

export interface TimeCollision {
  taskIdA: string;
  taskTitleA: string;
  taskIdB: string;
  taskTitleB: string;
  overlapMinutes: number;
  timeWindow: string; // e.g. "14:30 – 15:00"
}

export interface ScheduleConflictAnalysis {
  hasConflicts: boolean;
  timeCollisions: TimeCollision[];
  isOverBudget: boolean;
  totalPlannedMinutes: number;
  freeHours: number;
  budgetOverflowMinutes: number;
  conflictingTaskIds: Set<string>;
}

export interface TaskScheduleDiff {
  taskId: string;
  title: string;
  oldStartTime?: string;
  oldEndTime?: string;
  newStartTime: string;
  newEndTime: string;
  durationMinutes: number;
}

export interface AutoResolveResult {
  updatedTasks: Task[];
  changes: TaskScheduleDiff[];
  collisionsResolved: number;
  overflowResolved: boolean;
}

/**
 * Parse time string (24h or 12h AM/PM) into minutes from midnight (0..1439)
 */
export function parseTimeToMinutes(timeStr?: string): number | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const clean = timeStr.trim();
  if (!clean) return null;

  // Handle 12-hour format e.g. "2:30 PM", "9:00 AM"
  const ampmMatch = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = parseInt(ampmMatch[2], 10);
    const meridian = ampmMatch[3].toUpperCase();
    if (meridian === 'PM' && hours < 12) hours += 12;
    if (meridian === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  // Handle 24-hour format e.g. "14:30", "09:00"
  const m24 = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const hours = parseInt(m24[1], 10);
    const minutes = parseInt(m24[2], 10);
    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      return hours * 60 + minutes;
    }
  }

  return null;
}

/**
 * Convert minutes from midnight back to HH:mm string (24-hour)
 */
export function formatMinutesToTime(totalMinutes: number): string {
  const norm = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(norm / 60);
  const mins = norm % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Detect all time collisions and focus budget overflow for a set of tasks
 */
export function detectScheduleConflicts(
  tasks: Task[],
  freeHours = 8
): ScheduleConflictAnalysis {
  const activeTasks = tasks.filter(t => !t.deleted);
  const timeCollisions: TimeCollision[] = [];
  const conflictingTaskIds = new Set<string>();

  // Extract interval for tasks with startTime
  interface TimedTask {
    task: Task;
    startMins: number;
    endMins: number;
  }

  const timedTasks: TimedTask[] = [];

  for (const t of activeTasks) {
    const start = parseTimeToMinutes(t.startTime);
    if (start !== null) {
      let end = parseTimeToMinutes(t.endTime);
      const duration = t.scheduledMinutes || t.estimatedMinutes || 60;
      if (end === null || end <= start) {
        end = start + duration;
      }
      timedTasks.push({
        task: t,
        startMins: start,
        endMins: end,
      });
    }
  }

  // Check pairwise overlapping intervals: S_A < E_B && S_B < E_A
  for (let i = 0; i < timedTasks.length; i++) {
    for (let j = i + 1; j < timedTasks.length; j++) {
      const a = timedTasks[i];
      const b = timedTasks[j];

      const overlapStart = Math.max(a.startMins, b.startMins);
      const overlapEnd = Math.min(a.endMins, b.endMins);

      if (overlapStart < overlapEnd) {
        const overlapMinutes = overlapEnd - overlapStart;
        conflictingTaskIds.add(a.task.id);
        conflictingTaskIds.add(b.task.id);

        timeCollisions.push({
          taskIdA: a.task.id,
          taskTitleA: a.task.title,
          taskIdB: b.task.id,
          taskTitleB: b.task.title,
          overlapMinutes,
          timeWindow: `${formatMinutesToTime(overlapStart)} – ${formatMinutesToTime(overlapEnd)}`,
        });
      }
    }
  }

  const totalPlannedMinutes = activeTasks.reduce(
    (sum, t) => sum + (t.scheduledMinutes || t.estimatedMinutes || 60),
    0
  );
  const budgetMinutes = freeHours * 60;
  const isOverBudget = totalPlannedMinutes > budgetMinutes;
  const budgetOverflowMinutes = Math.max(0, totalPlannedMinutes - budgetMinutes);

  return {
    hasConflicts: timeCollisions.length > 0 || isOverBudget,
    timeCollisions,
    isOverBudget,
    totalPlannedMinutes,
    freeHours,
    budgetOverflowMinutes,
    conflictingTaskIds,
  };
}

/**
 * Priority weighting for intelligent re-ordering
 */
function getTaskPriorityScore(task: Task): number {
  let score = 0;
  if (task.mustDo) score += 1000;
  if (task.priority === 'High') score += 300;
  else if (task.priority === 'Medium') score += 200;
  else score += 100;
  return score;
}

/**
 * Auto-Resolve Schedule Conflicts:
 * Sequentially arranges tasks without overlap, prioritizing must-dos and higher priorities,
 * starting from the earliest scheduled task (defaulting to 09:00 AM).
 */
export function autoResolveScheduleConflicts(
  tasks: Task[],
  freeHours = 8
): AutoResolveResult {
  const activeTasks = tasks.filter(t => !t.deleted);
  const analysis = detectScheduleConflicts(activeTasks, freeHours);

  // If no time collisions and not over budget, return as is
  if (!analysis.hasConflicts) {
    return {
      updatedTasks: [...tasks],
      changes: [],
      collisionsResolved: 0,
      overflowResolved: true,
    };
  }

  // Preserve completed tasks at their current times
  const completedTasks = activeTasks.filter(t => t.isCompleted);
  const uncompletedTasks = activeTasks.filter(t => !t.isCompleted);

  // Determine starting point: earliest start time among timed tasks, or 09:00 (540 mins)
  const timedStarts = activeTasks
    .map(t => parseTimeToMinutes(t.startTime))
    .filter((m): m is number => m !== null);
  const earliestMins = timedStarts.length > 0 ? Math.min(...timedStarts) : 9 * 60;

  // Sort uncompleted tasks by priority: mustDo > High > Medium > Low
  const sortedUncompleted = [...uncompletedTasks].sort((a, b) => {
    return getTaskPriorityScore(b) - getTaskPriorityScore(a);
  });

  let currentSlotMins = earliestMins;
  const changes: TaskScheduleDiff[] = [];
  const updatedMap = new Map<string, Task>();

  // If over budget, scale non-must-do durations slightly to fit available hours
  const budgetMins = freeHours * 60;
  const totalMins = activeTasks.reduce((s, t) => s + (t.scheduledMinutes || t.estimatedMinutes || 60), 0);
  const scaleFactor = totalMins > budgetMins ? Math.max(0.7, budgetMins / totalMins) : 1.0;

  for (const t of sortedUncompleted) {
    const rawDuration = t.scheduledMinutes || t.estimatedMinutes || 60;
    // Scale duration if over budget, but never drop below 15 mins
    const duration = t.mustDo ? rawDuration : Math.max(15, Math.round((rawDuration * scaleFactor) / 5) * 5);

    const newStart = formatMinutesToTime(currentSlotMins);
    const newEnd = formatMinutesToTime(currentSlotMins + duration);

    if (t.startTime !== newStart || t.endTime !== newEnd || t.scheduledMinutes !== duration) {
      changes.push({
        taskId: t.id,
        title: t.title,
        oldStartTime: t.startTime,
        oldEndTime: t.endTime,
        newStartTime: newStart,
        newEndTime: newEnd,
        durationMinutes: duration,
      });
    }

    updatedMap.set(t.id, {
      ...t,
      startTime: newStart,
      endTime: newEnd,
      scheduledMinutes: duration,
      estimatedMinutes: duration,
      updatedAt: Date.now(),
      synced: 0,
    });

    // Advance cursor with 5-minute buffer between tasks
    currentSlotMins += duration + 5;
  }

  // Reassemble full task array preserving original IDs and deleted tasks
  const updatedTasks = tasks.map(t => updatedMap.get(t.id) || t);

  return {
    updatedTasks,
    changes,
    collisionsResolved: analysis.timeCollisions.length,
    overflowResolved: true,
  };
}
