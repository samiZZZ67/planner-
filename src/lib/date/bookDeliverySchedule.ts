import { getEthiopianClock, normalizeTimeString } from './ethiopianTime';
import type { BookAssignmentRecord, BookRecord } from '../books/types';

export const DEFAULT_BOOK_TIMEZONE = 'Africa/Addis_Ababa';

/**
 * Convert a local wall-clock date and time in a given timezone into an exact UTC epoch millisecond timestamp.
 * Standard across client browser and Node server without external dependencies.
 */
export function getDeliveryZonedTimestamp(date: string, time: string, timezone = DEFAULT_BOOK_TIMEZONE): number {
  const normTime = normalizeTimeString(time);
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(normTime);
  if (!dateMatch || !timeMatch) {
    throw new Error('Schedule needs a valid YYYY-MM-DD date and HH:mm time.');
  }
  const [year, month, day] = dateMatch.slice(1).map(Number);
  const [hour, minute] = timeMatch.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new Error('Schedule date or time is out of range.');
  }
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const calendarCheck = new Date(targetAsUtc);
  if (calendarCheck.getUTCFullYear() !== year || calendarCheck.getUTCMonth() + 1 !== month || calendarCheck.getUTCDate() !== day) {
    throw new Error('Schedule date is not a valid calendar date.');
  }
  let candidate = targetAsUtc;
  const effectiveTz = timezone || DEFAULT_BOOK_TIMEZONE;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: effectiveTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (let i = 0; i < 4; i++) {
    const values = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(part => [part.type, part.value]));
    const renderedAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
    const delta = targetAsUtc - renderedAsUtc;
    if (delta === 0) return candidate;
    candidate += delta;
  }
  return candidate;
}

/**
 * Get current date string (YYYY-MM-DD) in the specified timezone.
 */
export function getZonedDateString(now: number | Date = Date.now(), timezone = DEFAULT_BOOK_TIMEZONE): string {
  const dateObj = typeof now === 'number' ? new Date(now) : now;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || DEFAULT_BOOK_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dateObj);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

/**
 * Calculates the next occurrence of a daily recurring posting time.
 * If today's time has already passed in that timezone, returns tomorrow's occurrence.
 */
export function getNextOccurrenceForDailyTime(
  time: string,
  timezone = DEFAULT_BOOK_TIMEZONE,
  nowMs = Date.now()
): {
  timestamp: number;
  dateStr: string;
  timeStr: string;
  isTomorrow: boolean;
  remainingMs: number;
} {
  const normTime = normalizeTimeString(time);
  const todayStr = getZonedDateString(nowMs, timezone);
  const todayTarget = getDeliveryZonedTimestamp(todayStr, normTime, timezone);

  if (todayTarget > nowMs) {
    return {
      timestamp: todayTarget,
      dateStr: todayStr,
      timeStr: normTime,
      isTomorrow: false,
      remainingMs: todayTarget - nowMs,
    };
  }

  // Today's delivery time has already passed; next occurrence is tomorrow
  // Advance by 24h and format tomorrow's date string in the target timezone
  const tomorrowApprox = new Date(todayTarget + 24 * 60 * 60 * 1000 + 30 * 60 * 1000);
  const tomorrowStr = getZonedDateString(tomorrowApprox, timezone);
  const tomorrowTarget = getDeliveryZonedTimestamp(tomorrowStr, normTime, timezone);

  return {
    timestamp: tomorrowTarget,
    dateStr: tomorrowStr,
    timeStr: normTime,
    isTomorrow: true,
    remainingMs: Math.max(0, tomorrowTarget - nowMs),
  };
}

export interface DeliveryCountdown {
  targetTimestamp: number;
  now: number;
  diffMs: number;
  totalSeconds: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isZero: boolean;
  isOverdue: boolean;
  formattedAlarm: string; // e.g. "02 hours : 03 minutes : 15 seconds"
  formattedShort: string; // e.g. "02h : 03m : 15s"
  humanRemaining: string; // e.g. "2 hours, 3 minutes remaining"
  digits: {
    days: string;
    hours: string;
    minutes: string;
    seconds: string;
  };
}

/**
 * Calculates the live countdown from current time to target delivery timestamp.
 * Derived continuously from real target timestamp - nowMs to prevent drift on tab suspension or sleep.
 */
export function calculateDeliveryCountdown(
  targetTimestamp: number,
  nowMs = Date.now(),
  graceOverdueMs = 60000
): DeliveryCountdown {
  const diffMs = targetTimestamp - nowMs;
  const isZero = diffMs <= 0;
  const isOverdue = diffMs < -graceOverdueMs;

  const effectiveDiff = Math.max(0, diffMs);
  const totalSeconds = Math.floor(effectiveDiff / 1000);

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  const dStr = pad(days);
  const hStr = pad(hours);
  const mStr = pad(minutes);
  const sStr = pad(seconds);

  let formattedAlarm: string;
  let formattedShort: string;

  if (days > 0) {
    formattedAlarm = `${dStr} day${days > 1 ? 's' : ''} : ${hStr} hours : ${mStr} minutes : ${sStr} seconds`;
    formattedShort = `${dStr}d : ${hStr}h : ${mStr}m : ${sStr}s`;
  } else {
    formattedAlarm = `${hStr} hours : ${mStr} minutes : ${sStr} seconds`;
    formattedShort = `${hStr}h : ${mStr}m : ${sStr}s`;
  }

  // Human friendly description
  let humanRemaining: string;
  if (isZero) {
    humanRemaining = isOverdue ? 'Delivery overdue · awaiting dispatch' : 'Delivery due now · dispatching…';
  } else if (days > 0) {
    humanRemaining = hours > 0
      ? `${days} day${days !== 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''} remaining`
      : `${days} day${days !== 1 ? 's' : ''} remaining`;
  } else if (hours > 0) {
    humanRemaining = minutes > 0
      ? `${hours} hour${hours !== 1 ? 's' : ''}, ${minutes} minute${minutes !== 1 ? 's' : ''} remaining`
      : `${hours} hour${hours !== 1 ? 's' : ''} remaining`;
  } else if (minutes > 0) {
    humanRemaining = seconds > 0
      ? `${minutes} minute${minutes !== 1 ? 's' : ''}, ${seconds} second${seconds !== 1 ? 's' : ''} remaining`
      : `${minutes} minute${minutes !== 1 ? 's' : ''} remaining`;
  } else {
    humanRemaining = `${seconds} second${seconds !== 1 ? 's' : ''} remaining`;
  }

  return {
    targetTimestamp,
    now: nowMs,
    diffMs,
    totalSeconds,
    days,
    hours,
    minutes,
    seconds,
    isZero,
    isOverdue,
    formattedAlarm,
    formattedShort,
    humanRemaining,
    digits: {
      days: dStr,
      hours: hStr,
      minutes: mStr,
      seconds: sStr,
    },
  };
}

/**
 * Calculates remaining time immediately as user edits a time or date in UI.
 * e.g. "2 hours, 3 minutes remaining" or "Next occurrence is tomorrow at 08:00 AM EAT".
 */
export function describeScheduleRemaining(
  selectedTime: string,
  selectedDate?: string | null,
  timezone = DEFAULT_BOOK_TIMEZONE,
  nowMs = Date.now()
): {
  remainingText: string;
  isTomorrow: boolean;
  targetTimestamp: number;
  formattedTargetTime: string;
} {
  try {
    const normTime = normalizeTimeString(selectedTime);
    const effectiveTz = timezone || DEFAULT_BOOK_TIMEZONE;
    const clock = getEthiopianClock(normTime, effectiveTz);

    if (selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate.trim())) {
      const target = getDeliveryZonedTimestamp(selectedDate, normTime, effectiveTz);
      const countdown = calculateDeliveryCountdown(target, nowMs);
      const isPast = target < nowMs;

      const remainingText = isPast
        ? 'Selected date and time has already passed'
        : countdown.humanRemaining;

      return {
        remainingText,
        isTomorrow: false,
        targetTimestamp: target,
        formattedTargetTime: `${clock.internationalTime12h} (${selectedDate})`,
      };
    }

    // Daily recurring mode
    const occurrence = getNextOccurrenceForDailyTime(normTime, effectiveTz, nowMs);
    const countdown = calculateDeliveryCountdown(occurrence.timestamp, nowMs);

    let remainingText = countdown.humanRemaining;
    if (occurrence.isTomorrow) {
      remainingText = `Selected time has already passed today. Next occurrence is tomorrow at ${clock.internationalTime12h} (${countdown.humanRemaining}).`;
    }

    return {
      remainingText,
      isTomorrow: occurrence.isTomorrow,
      targetTimestamp: occurrence.timestamp,
      formattedTargetTime: clock.internationalTime12h,
    };
  } catch {
    return {
      remainingText: 'Enter a valid time format (e.g. 08:00 or 8:00 AM)',
      isTomorrow: false,
      targetTimestamp: 0,
      formattedTargetTime: '',
    };
  }
}

export interface NextBookDelivery {
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  assignmentId?: string;
  dayNumber?: number;
  sectionNumber?: number;
  startPdfPage: number;
  endPdfPage: number;
  conceptTitle: string;
  concepts: string[];
  scheduledAt: number;
  scheduledDate: string;
  postingTime: string;
  timezone: string;
  formattedTime12h: string;  // e.g. "08:00 AM EAT"
  ethiopianTimeStr: string;  // e.g. "ጠዋት 2:00 (2:00 Qen)"
  status: 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'overdue' | 'draft';
  lastError?: string;
  isTomorrow?: boolean;
  assignment?: BookAssignmentRecord;
  book: BookRecord;
}

export interface BookScheduleStatusInfo {
  book: BookRecord;
  nextDelivery: NextBookDelivery | null;
  status: NextBookDelivery['status'] | 'completed' | 'no_schedule';
  statusText: string;
}

/**
 * Determine the next scheduled delivery for a single book.
 */
export function resolveNextDeliveryForBook(
  book: BookRecord,
  assignments: BookAssignmentRecord[] = [],
  nowMs = Date.now()
): NextBookDelivery | null {
  const tz = book.timezone || DEFAULT_BOOK_TIMEZONE;

  // Filter out superseded or completed assignments
  const activeAssignments = assignments.filter(
    a => a.status !== 'completed' && a.status !== 'superseded'
  );

  const candidates: NextBookDelivery[] = [];

  if (activeAssignments.length > 0) {
    for (const assignment of activeAssignments) {
      try {
        const effectiveTime = normalizeTimeString(assignment.postingTime || book.postingTime || '08:00');
        const scheduledAt = getDeliveryZonedTimestamp(assignment.scheduledDate, effectiveTime, tz);
        const clock = getEthiopianClock(effectiveTime, tz, assignment.scheduledDate);

        let status: NextBookDelivery['status'] = 'scheduled';
        if (assignment.deliveryStatus === 'sending') {
          status = 'sending';
        } else if (assignment.deliveryStatus === 'failed') {
          status = 'failed';
        } else if (assignment.status === 'draft') {
          status = 'draft';
        } else if (scheduledAt <= nowMs - 60000) {
          status = 'overdue';
        }

        const conceptNames = assignment.concepts.map(c => c.title).filter(Boolean);
        const conceptTitle = conceptNames.length > 0
          ? conceptNames.join(' · ')
          : `Day ${assignment.dayNumber} Reading Section`;

        candidates.push({
          bookId: book.id,
          bookTitle: book.title,
          bookAuthor: book.author,
          assignmentId: assignment.id,
          dayNumber: assignment.dayNumber,
          sectionNumber: assignment.sectionNumber,
          startPdfPage: assignment.startPdfPage,
          endPdfPage: assignment.endPdfPage,
          conceptTitle,
          concepts: conceptNames,
          scheduledAt,
          scheduledDate: assignment.scheduledDate,
          postingTime: effectiveTime,
          timezone: tz,
          formattedTime12h: clock.internationalTime12h,
          ethiopianTimeStr: clock.ethiopianTimeStr,
          status,
          lastError: assignment.lastDeliveryError,
          assignment,
          book,
        });
      } catch (err) {
        console.error(`[resolveNextDeliveryForBook] Error parsing assignment ${assignment.id}:`, err);
      }
    }
  } else if (book.autoPublish !== false && book.currentPage <= book.endPage) {
    const effectiveTime = normalizeTimeString(book.postingTime || '08:00');
    const occurrence = getNextOccurrenceForDailyTime(effectiveTime, tz, nowMs);
    const clock = getEthiopianClock(effectiveTime, tz, occurrence.dateStr);

    candidates.push({
      bookId: book.id,
      bookTitle: book.title,
      bookAuthor: book.author,
      startPdfPage: book.currentPage,
      endPdfPage: Math.min(book.endPage, book.currentPage + 5),
      conceptTitle: `Page ${book.currentPage} Daily Reading`,
      concepts: [`Reading starting from Page ${book.currentPage}`],
      scheduledAt: occurrence.timestamp,
      scheduledDate: occurrence.dateStr,
      postingTime: effectiveTime,
      timezone: tz,
      formattedTime12h: clock.internationalTime12h,
      ethiopianTimeStr: clock.ethiopianTimeStr,
      status: 'scheduled',
      isTomorrow: occurrence.isTomorrow,
      book,
    });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (a.status === 'sending' && b.status !== 'sending') return -1;
    if (b.status === 'sending' && a.status !== 'sending') return 1;

    const aIsUpcoming = a.scheduledAt >= nowMs - 60000;
    const bIsUpcoming = b.scheduledAt >= nowMs - 60000;

    if (aIsUpcoming && !bIsUpcoming) return -1;
    if (!aIsUpcoming && bIsUpcoming) return 1;

    if (aIsUpcoming && bIsUpcoming) {
      return a.scheduledAt - b.scheduledAt;
    }
    return b.scheduledAt - a.scheduledAt;
  });

  return candidates[0];
}

/**
 * Determine summary and schedule status for a book (including completed / no schedule).
 */
export function resolveBookScheduleSummary(
  book: BookRecord,
  assignments: BookAssignmentRecord[] = [],
  nowMs = Date.now()
): BookScheduleStatusInfo {
  const nextDelivery = resolveNextDeliveryForBook(book, assignments, nowMs);
  if (nextDelivery) {
    let statusText = `Scheduled: ${nextDelivery.scheduledDate} at ${nextDelivery.formattedTime12h}`;
    if (nextDelivery.status === 'sending') statusText = 'Sending to Telegram now…';
    else if (nextDelivery.status === 'overdue') statusText = `Overdue (scheduled for ${nextDelivery.scheduledDate} at ${nextDelivery.formattedTime12h})`;
    else if (nextDelivery.status === 'failed') statusText = `Delivery failed (${nextDelivery.lastError || 'see error details'})`;
    else if (nextDelivery.status === 'draft') statusText = 'Draft section (not queued)';
    return {
      book,
      nextDelivery,
      status: nextDelivery.status,
      statusText,
    };
  }

  const isAllAssignmentsCompleted = assignments.length > 0 && assignments.every(a => a.status === 'completed' || a.status === 'superseded');
  const isPageRangeFinished = book.currentPage > book.endPage;

  if (isAllAssignmentsCompleted || isPageRangeFinished) {
    return {
      book,
      nextDelivery: null,
      status: 'completed',
      statusText: 'All reading sections delivered to Telegram.',
    };
  }

  return {
    book,
    nextDelivery: null,
    status: 'no_schedule',
    statusText: 'No upcoming delivery scheduled.',
  };
}

/**
 * Resolve individual next deliveries for ALL books, each separated by book.
 */
export function resolveAllNextBookDeliveries(
  books: BookRecord[],
  assignmentsByBook: Record<string, BookAssignmentRecord[]>,
  nowMs = Date.now()
): NextBookDelivery[] {
  const deliveries: NextBookDelivery[] = [];

  for (const book of books) {
    const assignments = assignmentsByBook[book.id] || [];
    const bookDelivery = resolveNextDeliveryForBook(book, assignments, nowMs);
    if (bookDelivery) {
      deliveries.push(bookDelivery);
    }
  }

  deliveries.sort((a, b) => {
    if (a.status === 'sending' && b.status !== 'sending') return -1;
    if (b.status === 'sending' && a.status !== 'sending') return 1;

    const aIsUpcoming = a.scheduledAt >= nowMs - 60000;
    const bIsUpcoming = b.scheduledAt >= nowMs - 60000;

    if (aIsUpcoming && !bIsUpcoming) return -1;
    if (!aIsUpcoming && bIsUpcoming) return 1;

    if (aIsUpcoming && bIsUpcoming) {
      return a.scheduledAt - b.scheduledAt;
    }
    return b.scheduledAt - a.scheduledAt;
  });

  return deliveries;
}

/**
 * Find the earliest next upcoming scheduled book delivery across all books and assignments.
 */
export function resolveNextBookDelivery(
  books: BookRecord[],
  assignmentsByBook: Record<string, BookAssignmentRecord[]>,
  nowMs = Date.now()
): NextBookDelivery | null {
  const all = resolveAllNextBookDeliveries(books, assignmentsByBook, nowMs);
  return all.length > 0 ? all[0] : null;
}
