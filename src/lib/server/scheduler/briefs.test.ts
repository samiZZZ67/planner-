import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getBriefConfig,
  saveBriefConfig,
  getBriefStatus,
  sendBriefNow,
  processDueBriefs,
  generateEnrichedBriefContent,
  calculateNextScheduledUtc,
  getLocalTodayDate,
  defaultBriefConfig,
} from './briefs';
import * as telegramModule from '../telegram';
import * as telegramTaskAlerts from '../telegramTaskAlerts';

describe('Morning and Evening Brief Scheduler Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Default Configuration & Timezone', () => {
    it('initializes with Africa/Addis_Ababa, 08:00 morning and 20:00 evening by default', async () => {
      const userId = `user_cfg_init_${Date.now()}`;
      const config = await getBriefConfig(userId);
      expect(config.enabled).toBe(true);
      expect(config.morningTime).toBe('08:00');
      expect(config.eveningTime).toBe('20:00');
      expect(config.timezone).toBe('Africa/Addis_Ababa');
    });

    it('persists and updates configuration accurately', async () => {
      const userId = `user_cfg_update_${Date.now()}`;
      const updated = await saveBriefConfig({
        userId,
        morningTime: '8:30 AM', // 12-hour AM/PM normalization
        eveningTime: '8:30 PM', // 12-hour AM/PM normalization
        timezone: 'Africa/Addis_Ababa',
      });
      expect(updated.morningTime).toBe('08:30');
      expect(updated.eveningTime).toBe('20:30');

      const reloaded = await getBriefConfig(userId);
      expect(reloaded.morningTime).toBe('08:30');
      expect(reloaded.eveningTime).toBe('20:30');
    });
  });

  describe('2. Habesha Clock & Ethiopian Calendar Integration', () => {
    it('computes next scheduled delivery times with Ethiopian clock info', async () => {
      const userId = `user_habesha_${Date.now()}`;
      const status = await getBriefStatus(userId);

      expect(status.currentTimezone).toBe('Africa/Addis_Ababa');
      expect(status.morning.configuredTime).toBe('08:00');
      expect(status.evening.configuredTime).toBe('20:00');
      expect(status.morning.habeshaTime).toContain('ጠዋት 2:00 (2:00 Qen)');
      expect(status.evening.habeshaTime).toContain('ማታ 2:00 (2:00 Mata)');
      expect(status.currentHabeshaDate).toContain('E.C.');
    });
  });

  describe('3. Enriched Content Generation', () => {
    it('generates morning brief with Ethiopian calendar and clock headers', async () => {
      const userId = `user_gen_morn_${Date.now()}`;
      vi.spyOn(telegramTaskAlerts, 'generateMorningBriefingText').mockResolvedValue(
        `🌅 <b>NightPlanner Daily Briefing</b>\n📅 <b>Thursday, Oct 15, 2026</b>\n⏱ Focus Budget: <b>8h</b> | Planned: <b>6h</b> ✅`
      );

      const content = await generateEnrichedBriefContent('morning', '2026-10-15', userId);
      expect(content).toContain('NightPlanner Daily Briefing');
      expect(content).toContain('🇪🇹');
      expect(content).toContain('E.C.');
      expect(content).toContain('ጠዋት 2:00 (2:00 Qen)');
    });

    it('injects temporary custom content overrides into brief message', async () => {
      const userId = `user_gen_eve_${Date.now()}`;
      vi.spyOn(telegramTaskAlerts, 'generateEveningReviewText').mockResolvedValue(
        `🌙 <b>NightPlanner Evening Review</b>\n📅 <b>Thursday, Oct 15, 2026</b>\n📊 Completion: <b>100%</b>`
      );

      const content = await generateEnrichedBriefContent(
        'evening',
        '2026-10-15',
        userId,
        'Remember to review Chapter 4 flashcards!'
      );
      expect(content).toContain('Custom Scheduled Note:');
      expect(content).toContain('Remember to review Chapter 4 flashcards!');
    });
  });

  describe('4. Idempotency & Overlap Safeguards (Send Now vs Scheduled)', () => {
    it('executes manual Send Now and marks delivery completed', async () => {
      const userId = `user_send_now_${Date.now()}`;
      const sendSpy = vi.spyOn(telegramModule, 'sendTelegramTextToChannel').mockResolvedValue({
        channel: '@SamSpac',
        messageId: 1001,
        receiptId: 'rec_1001',
      });

      const res = await sendBriefNow(userId, 'morning');
      expect(res.success).toBe(true);
      expect(res.record.status).toBe('completed');
      expect(res.record.isManualSend).toBe(true);
      expect(res.record.telegramMessageIds).toContain(1001);
      expect(sendSpy).toHaveBeenCalledOnce();
    });

    it('prevents duplicate delivery when scheduled sweep runs after Send Now', async () => {
      const userId = `user_dup_check_${Date.now()}`;
      const sendSpy = vi.spyOn(telegramModule, 'sendTelegramTextToChannel').mockResolvedValue({
        channel: '@SamSpac',
        messageId: 1002,
        receiptId: 'rec_1002',
      });

      await sendBriefNow(userId, 'morning');
      sendSpy.mockClear();

      // Now background scheduler runs cycle specifically for this user
      await processDueBriefs(Date.now(), userId);
      // The morning brief for userId today was already completed, and evening brief is not due yet (20:00 > current time)
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe('5. Skip Upcoming Delivery', () => {
    it('skips delivery when skipNextMorningDate matches today', async () => {
      const userId = `user_skip_${Date.now()}`;
      const today = getLocalTodayDate('Africa/Addis_Ababa');
      await saveBriefConfig({
        userId,
        skipNextMorningDate: today,
        morningTime: '00:01', // Force due
      });

      const sendSpy = vi.spyOn(telegramModule, 'sendTelegramTextToChannel');
      await processDueBriefs(Date.now(), userId);

      // Should skip without sending to Telegram
      expect(sendSpy).not.toHaveBeenCalled();
      const status = await getBriefStatus(userId);
      expect(status.morning.isSkippedToday).toBe(true);
    });
  });

  describe('6. Calculation of Next Scheduled UTC Timestamps', () => {
    it('calculates future UTC timestamp in Africa/Addis_Ababa', () => {
      const userId = `user_calc_${Date.now()}`;
      const config = defaultBriefConfig(userId);
      config.morningTime = '08:00';
      const next = calculateNextScheduledUtc('morning', config);

      expect(next.localTime).toBe('08:00');
      const date = new Date(next.scheduledUtc);
      // Africa/Addis_Ababa is UTC+3, so 08:00 EAT is 05:00:00 UTC
      expect(date.getUTCHours()).toBe(5);
      expect(date.getUTCMinutes()).toBe(0);
    });
  });
});
