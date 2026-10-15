import { describe, expect, it } from 'vitest';
import {
  calculateDeliveryCountdown,
  describeScheduleRemaining,
  getDeliveryZonedTimestamp,
  getNextOccurrenceForDailyTime,
  getZonedDateString,
  resolveNextBookDelivery,
} from './bookDeliverySchedule';
import type { BookAssignmentRecord, BookRecord } from '../books/types';

describe('Book Delivery Schedule & Countdown Engine', () => {
  const tz = 'Africa/Addis_Ababa';

  it('1. calculates a delivery scheduled two hours from now', () => {
    const now = Date.now();
    const twoHoursLater = now + 2 * 3600 * 1000 + 3 * 60 * 1000 + 15 * 1000; // 2h 3m 15s
    const countdown = calculateDeliveryCountdown(twoHoursLater, now);

    expect(countdown.isZero).toBe(false);
    expect(countdown.isOverdue).toBe(false);
    expect(countdown.hours).toBe(2);
    expect(countdown.minutes).toBe(3);
    expect(countdown.seconds).toBe(15);
    expect(countdown.formattedAlarm).toBe('02 hours : 03 minutes : 15 seconds');
    expect(countdown.humanRemaining).toBe('2 hours, 3 minutes remaining');
  });

  it('2. calculates a delivery scheduled in three minutes', () => {
    const now = Date.now();
    const threeMinLater = now + 3 * 60 * 1000;
    const countdown = calculateDeliveryCountdown(threeMinLater, now);

    expect(countdown.isZero).toBe(false);
    expect(countdown.hours).toBe(0);
    expect(countdown.minutes).toBe(3);
    expect(countdown.seconds).toBe(0);
    expect(countdown.formattedAlarm).toBe('00 hours : 03 minutes : 00 seconds');
    expect(countdown.humanRemaining).toBe('3 minutes remaining');
  });

  it('3. calculates a delivery scheduled in less than one minute', () => {
    const now = Date.now();
    const fortyFiveSecLater = now + 45 * 1000;
    const countdown = calculateDeliveryCountdown(fortyFiveSecLater, now);

    expect(countdown.isZero).toBe(false);
    expect(countdown.hours).toBe(0);
    expect(countdown.minutes).toBe(0);
    expect(countdown.seconds).toBe(45);
    expect(countdown.formattedAlarm).toBe('00 hours : 00 minutes : 45 seconds');
    expect(countdown.humanRemaining).toBe('45 seconds remaining');
  });

  it('4. detects a selected daily time that has already passed and schedules for tomorrow', () => {
    // Current time: 14:00 EAT on 2026-10-15
    const todayStr = '2026-10-15';
    const now = getDeliveryZonedTimestamp(todayStr, '14:00', tz);

    // Selected time: 08:00 (which was 6 hours ago today)
    const occurrence = getNextOccurrenceForDailyTime('08:00', tz, now);
    expect(occurrence.isTomorrow).toBe(true);
    expect(occurrence.dateStr).toBe('2026-10-16');
    expect(occurrence.timeStr).toBe('08:00');
    // From 14:00 today to 08:00 tomorrow is 18 hours
    expect(occurrence.remainingMs).toBe(18 * 3600 * 1000);

    const desc = describeScheduleRemaining('08:00', undefined, tz, now);
    expect(desc.isTomorrow).toBe(true);
    expect(desc.remainingText).toContain('tomorrow at 8:00 AM EAT');
  });

  it('5. immediately describes remaining time when a time is selected today', () => {
    // Current time: 10:00 AM EAT
    const now = getDeliveryZonedTimestamp('2026-10-15', '10:00', tz);

    // Selected: 12:03 PM EAT
    const desc = describeScheduleRemaining('12:03', '2026-10-15', tz, now);
    expect(desc.remainingText).toBe('2 hours, 3 minutes remaining');

    // Selected: 10:15 AM
    const descShort = describeScheduleRemaining('10:15', '2026-10-15', tz, now);
    expect(descShort.remainingText).toBe('15 minutes remaining');
  });

  it('6. handles countdown reaching zero without displaying negative time', () => {
    const target = 1792000000000;
    const nowPast = target + 5000; // 5s past
    const countdown = calculateDeliveryCountdown(target, nowPast);

    expect(countdown.isZero).toBe(true);
    expect(countdown.days).toBe(0);
    expect(countdown.hours).toBe(0);
    expect(countdown.minutes).toBe(0);
    expect(countdown.seconds).toBe(0);
    expect(countdown.humanRemaining).toContain('Delivery due now');
  });

  it('7. detects overdue delivery when time passed by over 60 seconds without confirmation', () => {
    const target = 1792000000000;
    const nowOverdue = target + 90000; // 90s past
    const countdown = calculateDeliveryCountdown(target, nowOverdue);

    expect(countdown.isZero).toBe(true);
    expect(countdown.isOverdue).toBe(true);
    expect(countdown.humanRemaining).toContain('overdue');
  });

  it('8. prevents timer drift on computer sleep or tab suspension by computing from timestamps', () => {
    const now1 = 1792000000000;
    const target = now1 + 3600 * 1000; // 1 hour later
    const c1 = calculateDeliveryCountdown(target, now1);
    expect(c1.hours).toBe(1);

    // Simulate system sleep: time jumps ahead 45 minutes
    const now2 = now1 + 45 * 60 * 1000;
    const c2 = calculateDeliveryCountdown(target, now2);
    expect(c2.hours).toBe(0);
    expect(c2.minutes).toBe(15);
  });

  it('9. resolves the next book delivery across multiple books and sections', () => {
    const book1: BookRecord = {
      id: 'book-1', userId: 'user-1', title: 'Deep Work', author: 'Cal Newport', metadata: '',
      originalFilename: 'dw.pdf', storedFilename: 'dw.pdf', fileSize: 1000,
      startPage: 1, endPage: 50, durationDays: 10, startDate: '2026-10-15', studyMinutes: 30,
      postingTime: '08:00', timezone: tz, currentPage: 1, status: 'ready', extractionStatus: 'completed',
      extractionMessage: '', autoPublish: true, createdAt: 1, updatedAt: 1,
    };
    const book2: BookRecord = {
      id: 'book-2', userId: 'user-1', title: 'Atomic Habits', author: 'James Clear', metadata: '',
      originalFilename: 'ah.pdf', storedFilename: 'ah.pdf', fileSize: 1000,
      startPage: 1, endPage: 80, durationDays: 10, startDate: '2026-10-15', studyMinutes: 30,
      postingTime: '12:00', timezone: tz, currentPage: 1, status: 'ready', extractionStatus: 'completed',
      extractionMessage: '', autoPublish: true, createdAt: 1, updatedAt: 1,
    };

    const now = getDeliveryZonedTimestamp('2026-10-15', '07:00', tz);

    const a1: BookAssignmentRecord = {
      id: 'asg-1', userId: 'user-1', bookId: 'book-1', dayNumber: 1, scheduledDate: '2026-10-15',
      postingTime: '08:00', startPdfPage: 1, endPdfPage: 5,
      concepts: [{ title: 'Concept 1', concept: 'Focus without distraction', estimatedMinutes: 20 }],
      estimatedMinutes: 20, rationale: 'Intro', status: 'approved', updatedAt: 1,
    };

    const a2: BookAssignmentRecord = {
      id: 'asg-2', userId: 'user-1', bookId: 'book-2', dayNumber: 1, scheduledDate: '2026-10-15',
      postingTime: '12:00', startPdfPage: 1, endPdfPage: 8,
      concepts: [{ title: '1st Law', concept: 'Make it obvious', estimatedMinutes: 20 }],
      estimatedMinutes: 20, rationale: 'Intro', status: 'approved', updatedAt: 1,
    };

    const next = resolveNextBookDelivery([book1, book2], {
      'book-1': [a1],
      'book-2': [a2],
    }, now);

    expect(next).not.toBeNull();
    expect(next?.bookId).toBe('book-1');
    expect(next?.bookTitle).toBe('Deep Work');
    expect(next?.postingTime).toBe('08:00');
    expect(next?.conceptTitle).toBe('Concept 1');
    expect(next?.status).toBe('scheduled');
  });
});
