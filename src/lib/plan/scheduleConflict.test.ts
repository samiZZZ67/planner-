import { describe, it, expect } from 'vitest';
import {
  parseTimeToMinutes,
  formatMinutesToTime,
  detectScheduleConflicts,
  autoResolveScheduleConflicts,
} from './scheduleConflict';
import type { Task } from '@/types';

function makeTask(partial: Partial<Task> & { id: string; title: string }): Task {
  return {
    date: '2026-10-14',
    sectionId: 'sec-1',
    description: '',
    strategy: '',
    doneMeans: '',
    scheduledMinutes: 60,
    estimatedMinutes: 60,
    priority: 'Medium',
    mustDo: false,
    tags: [],
    icon: '🎯',
    isCompleted: false,
    completedAt: null,
    order: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false,
    isSample: false,
    status: 'not_started',
    synced: 1,
    ...partial,
  };
}

describe('Schedule Conflict & Timeline Overlap Engine', () => {
  it('should parse 24h and 12h time strings accurately', () => {
    expect(parseTimeToMinutes('14:30')).toBe(14 * 60 + 30);
    expect(parseTimeToMinutes('09:00')).toBe(9 * 60);
    expect(parseTimeToMinutes('2:30 PM')).toBe(14 * 60 + 30);
    expect(parseTimeToMinutes('9:00 AM')).toBe(9 * 60);
    expect(parseTimeToMinutes('12:00 AM')).toBe(0);
    expect(parseTimeToMinutes('12:00 PM')).toBe(12 * 60);
    expect(parseTimeToMinutes('invalid')).toBeNull();
  });

  it('should format minutes back to HH:mm string', () => {
    expect(formatMinutesToTime(14 * 60 + 30)).toBe('14:30');
    expect(formatMinutesToTime(9 * 60)).toBe('09:00');
    expect(formatMinutesToTime(0)).toBe('00:00');
  });

  it('should detect overlapping task time collisions', () => {
    const tasks: Task[] = [
      makeTask({
        id: 'task-a',
        title: 'Task Alpha',
        startTime: '14:00',
        endTime: '15:30', // 90 min
        scheduledMinutes: 90,
        estimatedMinutes: 90,
        priority: 'High',
        mustDo: true,
      }),
      makeTask({
        id: 'task-b',
        title: 'Task Beta',
        startTime: '15:00', // Collides with Task Alpha (15:00-15:30)
        endTime: '16:00',
        scheduledMinutes: 60,
        estimatedMinutes: 60,
        priority: 'Medium',
        mustDo: false,
      }),
    ];

    const analysis = detectScheduleConflicts(tasks, 8);
    expect(analysis.hasConflicts).toBe(true);
    expect(analysis.timeCollisions).toHaveLength(1);
    expect(analysis.timeCollisions[0].taskTitleA).toBe('Task Alpha');
    expect(analysis.timeCollisions[0].taskTitleB).toBe('Task Beta');
    expect(analysis.timeCollisions[0].overlapMinutes).toBe(30);
    expect(analysis.timeCollisions[0].timeWindow).toBe('15:00 – 15:30');
    expect(analysis.conflictingTaskIds.has('task-a')).toBe(true);
    expect(analysis.conflictingTaskIds.has('task-b')).toBe(true);
  });

  it('should detect when total planned hours exceed the focus budget', () => {
    const tasks: Task[] = [
      makeTask({
        id: 'task-c',
        title: 'Massive Project Block',
        scheduledMinutes: 600, // 10 hours
        estimatedMinutes: 600,
        priority: 'High',
        mustDo: true,
      }),
    ];

    const analysis = detectScheduleConflicts(tasks, 8); // 8h budget vs 10h planned
    expect(analysis.isOverBudget).toBe(true);
    expect(analysis.budgetOverflowMinutes).toBe(120);
  });

  it('should automatically resolve collisions by assigning sequential non-overlapping time slots', () => {
    const collidingTasks: Task[] = [
      makeTask({
        id: 'task-1',
        title: 'Deep Architecture',
        startTime: '10:00',
        endTime: '11:30',
        scheduledMinutes: 90,
        estimatedMinutes: 90,
        priority: 'High',
        mustDo: true,
      }),
      makeTask({
        id: 'task-2',
        title: 'Code Review',
        startTime: '10:30', // Collides
        endTime: '11:15',
        scheduledMinutes: 45,
        estimatedMinutes: 45,
        priority: 'Medium',
        mustDo: false,
      }),
    ];

    const result = autoResolveScheduleConflicts(collidingTasks, 8);
    expect(result.collisionsResolved).toBe(1);
    expect(result.changes.length).toBeGreaterThan(0);

    // Verify the resolved tasks have no time collision
    const reAnalysis = detectScheduleConflicts(result.updatedTasks, 8);
    expect(reAnalysis.timeCollisions).toHaveLength(0);
    expect(reAnalysis.hasConflicts).toBe(false);

    // Task 1 (MustDo) should start at 10:00 and end at 11:30
    const task1 = result.updatedTasks.find(t => t.id === 'task-1');
    expect(task1?.startTime).toBe('10:00');
    expect(task1?.endTime).toBe('11:30');

    // Task 2 should now start after Task 1 (with 5 min buffer at 11:35)
    const task2 = result.updatedTasks.find(t => t.id === 'task-2');
    expect(task2?.startTime).toBe('11:35');
    expect(task2?.endTime).toBe('12:20');
  });
});
