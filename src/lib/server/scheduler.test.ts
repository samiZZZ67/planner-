import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initScheduler,
  stopScheduler,
  getSchedulerStatus,
  runScheduledDeliveryCycle,
  createScheduledMessage,
  claimDueScheduledMessages,
  listScheduledMessages,
  deleteScheduledMessage,
  updateScheduledMessage,
} from './scheduler';
import { zonedDateTimeToTimestamp } from './bookScheduler';
import * as telegramModule from './telegram';

describe('Background Scheduler & Automatic Telegram Delivery Suite', () => {
  beforeEach(() => {
    stopScheduler();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    stopScheduler();
    vi.restoreAllMocks();
  });

  describe('1. Scheduler Lifecycle & Singleton Guard', () => {
    it('initializes the background scheduler exactly once per process', () => {
      const status1 = initScheduler({ runImmediately: false });
      expect(status1.initialized).toBe(true);
      expect(status1.running).toBe(true);
      expect(status1.cronExpression).toBe('* * * * *');

      // Calling initScheduler again returns the same running status without duplicating
      const status2 = initScheduler({ runImmediately: false });
      expect(status2.initialized).toBe(true);
      expect(status2.running).toBe(true);
      expect(status2.pid).toBe(status1.pid);

      stopScheduler();
      const status3 = getSchedulerStatus();
      expect(status3.running).toBe(false);
    });
  });

  describe('2. Timezone & Scheduling Timestamp Calculation', () => {
    it('accurately computes UTC timestamps for different timezones', () => {
      // Addis Ababa is UTC+3 all year round (no DST)
      const tsAddis = zonedDateTimeToTimestamp('2026-10-15', '09:00', 'Africa/Addis_Ababa');
      const dateAddis = new Date(tsAddis);
      expect(dateAddis.toISOString()).toBe('2026-10-15T06:00:00.000Z');

      // UTC
      const tsUtc = zonedDateTimeToTimestamp('2026-10-15', '09:00', 'UTC');
      const dateUtc = new Date(tsUtc);
      expect(dateUtc.toISOString()).toBe('2026-10-15T09:00:00.000Z');

      // Validation of invalid dates/times
      expect(() => zonedDateTimeToTimestamp('invalid-date', '09:00', 'UTC')).toThrow();
      expect(() => zonedDateTimeToTimestamp('2026-10-15', '25:00', 'UTC')).toThrow();
    });
  });

  describe('3. Scheduled Message Claiming & Overdue Recovery', () => {
    const testUserId = `user_test_${Date.now()}`;

    it('claims only due messages and skips future scheduled messages', async () => {
      const now = Date.now();

      // Message 1: Due in past (overdue)
      const overdueMsg = await createScheduledMessage({
        userId: testUserId,
        type: 'custom_message',
        content: 'Overdue message test',
        scheduledAt: now - 60000,
      });

      // Message 2: Scheduled in the future (not due)
      const futureMsg = await createScheduledMessage({
        userId: testUserId,
        type: 'custom_message',
        content: 'Future message test',
        scheduledAt: now + 3600000,
      });

      const claimed = await claimDueScheduledMessages(now);
      const claimedIds = claimed.map(c => c.id);

      expect(claimedIds).toContain(overdueMsg.id);
      expect(claimedIds).not.toContain(futureMsg.id);

      // Clean up
      await deleteScheduledMessage(overdueMsg.id, testUserId);
      await deleteScheduledMessage(futureMsg.id, testUserId);
    });

    it('recovers stale processing jobs interrupted by server restart', async () => {
      const now = Date.now();
      const staleTime = now - 15 * 60 * 1000; // 15 mins ago (stale > 10 mins)

      const interruptedMsg = await createScheduledMessage({
        userId: testUserId,
        type: 'custom_message',
        content: 'Interrupted message test',
        scheduledAt: staleTime,
      });

      // Simulate it was stuck in 'processing' before server restarted
      await updateScheduledMessage({
        ...interruptedMsg,
        status: 'processing',
        attemptCount: 1,
        updatedAt: staleTime,
      });

      // Running claimDueScheduledMessages should recover it
      const claimed = await claimDueScheduledMessages(now);
      const found = claimed.find(c => c.id === interruptedMsg.id);

      expect(found).toBeDefined();
      expect(found?.attemptCount).toBe(2);

      // Clean up
      await deleteScheduledMessage(interruptedMsg.id, testUserId);
    });
  });

  describe('4. Automatic Processing & Error Isolation', () => {
    const testUserId = `user_worker_${Date.now()}`;

    it('processes due messages, sends via Telegram, and isolates errors', async () => {
      const now = Date.now();

      // Mock Telegram sender
      const sendSpy = vi.spyOn(telegramModule, 'sendTelegramTextToChannel').mockImplementation(async (text: string) => {
        if (text.includes('FAIL_ME')) {
          throw new Error('Telegram network error');
        }
        return {
          channel: '@SamSpac',
          messageId: 999,
          receiptId: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
        };
      });

      // Message 1: Should succeed
      const goodMsg = await createScheduledMessage({
        userId: testUserId,
        type: 'custom_message',
        content: 'Good message to Telegram',
        scheduledAt: now - 5000,
      });

      // Message 2: Should fail but not stop Message 1 or cause crash
      const failMsg = await createScheduledMessage({
        userId: testUserId,
        type: 'custom_message',
        content: 'FAIL_ME error message',
        scheduledAt: now - 4000,
      });

      const cycleResult = await runScheduledDeliveryCycle(now);

      expect(cycleResult.scheduledMessages.claimed).toBeGreaterThanOrEqual(2);
      expect(cycleResult.scheduledMessages.completed).toBeGreaterThanOrEqual(1);
      expect(cycleResult.scheduledMessages.retried).toBeGreaterThanOrEqual(1);

      // Verify goodMsg is marked completed
      const all = await listScheduledMessages(testUserId);
      const updatedGood = all.find(m => m.id === goodMsg.id);
      expect(updatedGood?.status).toBe('completed');
      expect(updatedGood?.telegramMessageIds).toContain(999);

      // Verify failMsg was rescheduled for retry
      const updatedFail = all.find(m => m.id === failMsg.id);
      expect(updatedFail?.status).toBe('scheduled');
      expect(updatedFail?.attemptCount).toBe(1);
      expect(updatedFail?.lastError).toContain('Telegram network error');

      // Clean up
      await deleteScheduledMessage(goodMsg.id, testUserId);
      await deleteScheduledMessage(failMsg.id, testUserId);
    });
  });

  describe('5. Duplicate Delivery & Concurrency Safeguards', () => {
    it('prevents overlapping cycle executions', async () => {
      const now = Date.now();
      // Run first cycle
      const p1 = runScheduledDeliveryCycle(now);
      // Run second cycle simultaneously
      const p2 = runScheduledDeliveryCycle(now);

      const [r1, r2] = await Promise.all([p1, p2]);

      // One should run normally, and one should detect overlapping and skip
      const skipped = r1.durationMs === 0 || r2.durationMs === 0;
      expect(skipped).toBe(true);
    });
  });
});
