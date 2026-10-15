import { describe, it, expect } from 'vitest';
import {
  parseVoiceIntent,
  parseDurationMinutes,
  parseNaturalTime,
  parseNaturalDate,
} from './voiceIntentParser';

describe('Voice Intent Parser & Entity Extractor', () => {
  describe('Duration & Time Parsing', () => {
    it('should parse various duration strings into minutes', () => {
      expect(parseDurationMinutes('for two hours')).toBe(120);
      expect(parseDurationMinutes('for 30 minutes')).toBe(30);
      expect(parseDurationMinutes('for 1 hour and 30 minutes')).toBe(90);
      expect(parseDurationMinutes('for four hours')).toBe(240);
    });

    it('should parse natural time expressions into HH:mm', () => {
      expect(parseNaturalTime('at 3 in the afternoon')).toBe('15:00');
      expect(parseNaturalTime('at 8:30 am')).toBe('08:30');
      expect(parseNaturalTime('at 8 pm')).toBe('20:00');
    });

    it('should resolve dates relative to today', () => {
      const today = '2026-10-15';
      expect(parseNaturalDate('what tasks do I have tomorrow?', today)).toBe('2026-10-16');
      expect(parseNaturalDate('what did I do yesterday?', today)).toBe('2026-10-14');
      expect(parseNaturalDate('what tasks do I have today?', today)).toBe('2026-10-15');
    });
  });

  describe('Task Operations', () => {
    it('should parse task querying with remaining filter', () => {
      const res = parseVoiceIntent('what do I have left to finish today?');
      expect(res.intent).toBe('tasks.query');
      expect(res.params.filter).toBe('remaining');
    });

    it('should parse task creation with title, duration, time and priority', () => {
      const res = parseVoiceIntent('create a task called Edit my next Short for 2 hours this afternoon high priority');
      expect(res.intent).toBe('tasks.create');
      expect(res.params.title).toBe('Edit my next Short');
      expect(res.params.scheduledMinutes).toBe(120);
      expect(res.params.priority).toBe('High');
    });

    it('should parse task completion', () => {
      const res = parseVoiceIntent('mark my current editing task as complete');
      expect(res.intent).toBe('tasks.complete');
      expect(res.params.taskQuery).toContain('editing');
    });

    it('should require confirmation for task deletion', () => {
      const res = parseVoiceIntent('delete the task named Watch tutorials');
      expect(res.intent).toBe('tasks.delete');
      expect(res.params.taskQuery).toBe('Watch tutorials');
      expect(res.requiresConfirmation).toBe(true);
      expect(res.confirmationPrompt).toContain('Watch tutorials');
    });

    it('should resolve pending confirmation on "yes"', () => {
      const context = {
        pendingConfirmation: {
          intent: 'tasks.delete' as const,
          targetId: 'task-123',
          targetTitle: 'Watch tutorials',
          expiresAt: Date.now() + 20000,
        },
      };
      const res = parseVoiceIntent('yes', context);
      expect(res.intent).toBe('assistant.confirm');
      expect(res.params.confirmedIntent).toBe('tasks.delete');
      expect(res.params.targetTitle).toBe('Watch tutorials');
    });

    it('should resolve pending confirmation on "cancel"', () => {
      const context = {
        pendingConfirmation: {
          intent: 'tasks.delete' as const,
          targetId: 'task-123',
          expiresAt: Date.now() + 20000,
        },
      };
      const res = parseVoiceIntent('cancel', context);
      expect(res.intent).toBe('assistant.reject');
    });

    it('should parse rescheduling task to 3 PM', () => {
      const res = parseVoiceIntent('move my deep-work session to three in the afternoon');
      expect(res.intent).toBe('tasks.reschedule');
      expect(res.params.newTime).toBe('15:00');
    });

    it('should parse budget check', () => {
      const res = parseVoiceIntent('explain available time and remaining daily budget');
      expect(res.intent).toBe('tasks.budget');
    });
  });

  describe('Books and Telegram Delivery', () => {
    it('should parse countdown inquiry for next book delivery', () => {
      const res = parseVoiceIntent('how much time is left before the next book section is sent?');
      expect(res.intent).toBe('books.next_delivery');
    });

    it('should parse immediate Telegram book post command', () => {
      const res = parseVoiceIntent('post the next assigned book section to Telegram now');
      expect(res.intent).toBe('books.send_now');
    });

    it('should parse morning brief commands', () => {
      const res1 = parseVoiceIntent('give me my morning brief');
      expect(res1.intent).toBe('briefs.read_morning');

      const res2 = parseVoiceIntent('send my morning brief to Telegram now');
      expect(res2.intent).toBe('briefs.send_morning_now');
    });

    it('should parse evening brief commands', () => {
      const res = parseVoiceIntent('what is scheduled for this evening?');
      expect(res.intent).toBe('briefs.read_evening');
    });

    it('should parse skip brief', () => {
      const res = parseVoiceIntent("skip today's evening brief");
      expect(res.intent).toBe('briefs.skip');
      expect(res.params.briefType).toBe('evening');
    });

    it('should parse navigation to book planner and settings', () => {
      const res1 = parseVoiceIntent('open book planner');
      expect(res1.intent).toBe('navigation.tab');
      expect(res1.navigationTab).toBe('books');

      const res2 = parseVoiceIntent('go to analytics');
      expect(res2.intent).toBe('navigation.tab');
      expect(res2.navigationTab).toBe('analytics');
    });

    it('should parse stop speaking control', () => {
      const res = parseVoiceIntent('stop speaking');
      expect(res.intent).toBe('assistant.stop_speaking');
    });
  });
});
