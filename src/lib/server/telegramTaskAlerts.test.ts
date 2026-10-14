import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateMorningBriefingText,
  generateEveningReviewText,
  generateTaskReminderText,
  sendTelegramTaskAlert,
} from './telegramTaskAlerts';
import * as tasksModule from './tasks';
import * as telegramModule from './telegram';
import type { Task, Section } from '@/types';

describe('Telegram Task Alerts & Daily Digest Suite', () => {
  const mockTasks: Task[] = [
    {
      id: 'task-1',
      date: '2026-10-14',
      sectionId: 'sec-1',
      title: 'Architect Neural Voice System',
      description: 'Implement multi-model TTS integration',
      strategy: 'Focus in 90 min blocks',
      doneMeans: 'All tests pass',
      estimatedMinutes: 90,
      scheduledMinutes: 90,
      priority: 'High',
      mustDo: true,
      tags: ['deep-work'],
      icon: '🧠',
      isCompleted: true,
      completedAt: Date.now(),
      order: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      isSample: false,
      status: 'completed',
      startTime: '09:00',
      endTime: '10:30',
    },
    {
      id: 'task-2',
      date: '2026-10-14',
      sectionId: 'sec-2',
      title: 'Review Telegram Delivery Logs',
      description: 'Check book delivery receipts',
      strategy: '',
      doneMeans: '',
      estimatedMinutes: 30,
      scheduledMinutes: 30,
      priority: 'Medium',
      mustDo: false,
      tags: [],
      icon: '📊',
      isCompleted: false,
      completedAt: null,
      order: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      isSample: false,
      status: 'not_started',
      startTime: '11:00',
      endTime: '11:30',
    },
  ];

  const mockSections: Section[] = [
    {
      id: 'sec-1',
      name: 'Engineering',
      color: '#8b5cf6',
      icon: '💻',
      order: 1,
      dailyTargetMinutes: 180,
      targetType: 'at least',
      updatedAt: Date.now(),
      deleted: false,
      isSample: false,
    },
    {
      id: 'sec-2',
      name: 'Operations',
      color: '#38bdf8',
      icon: '⚡',
      order: 2,
      dailyTargetMinutes: 60,
      targetType: 'at least',
      updatedAt: Date.now(),
      deleted: false,
      isSample: false,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(tasksModule, 'getTasksFromDb').mockResolvedValue(mockTasks);
    vi.spyOn(tasksModule, 'getSectionsFromDb').mockResolvedValue(mockSections);
  });

  it('should format a comprehensive morning briefing with must-dos, planned hours, and focus budget', async () => {
    const text = await generateMorningBriefingText('2026-10-14');

    expect(text).toContain('NightPlanner Daily Briefing');
    expect(text).toContain('Architect Neural Voice System');
    expect(text).toContain('Top Goals & Must-Dos');
    expect(text).toContain('[09:00–10:30]');
    expect(text).toContain('Review Telegram Delivery Logs');
    expect(text).toContain('Planned: <b>2h</b>');
  });

  it('should format an accurate evening review with completed and remaining tasks', async () => {
    const text = await generateEveningReviewText('2026-10-14');

    expect(text).toContain('NightPlanner Evening Review');
    expect(text).toContain('Completion: <b>50%</b>');
    expect(text).toContain('Completed Today');
    expect(text).toContain('<s>Architect Neural Voice System</s>');
    expect(text).toContain('Carried Forward / Incomplete');
    expect(text).toContain('Review Telegram Delivery Logs');
  });

  it('should format a specific task reminder with time and priority', () => {
    const reminder = generateTaskReminderText(mockTasks[0]);

    expect(reminder).toContain('Upcoming Task Reminder');
    expect(reminder).toContain('Architect Neural Voice System');
    expect(reminder).toContain('Scheduled: <b>2026-10-14 at 09:00</b>');
    expect(reminder).toContain('High Priority Must-Do');
  });

  it('should dispatch alert to Telegram channel and return send confirmation', async () => {
    const sendSpy = vi.spyOn(telegramModule, 'sendTelegramTextToChannel').mockResolvedValue({
      channel: '@SamSpac',
      messageId: 1042,
      receiptId: 'receipt-1234',
    });

    const result = await sendTelegramTaskAlert('morning_briefing', { date: '2026-10-14' });

    expect(result.ok).toBe(true);
    expect(result.messageId).toBe(1042);
    expect(result.channel).toBe('@SamSpac');
    expect(result.preview).toContain('NightPlanner Daily Briefing');
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});
