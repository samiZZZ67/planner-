import {
  formatEthiopianDate,
  formatEthiopianDateAmharic,
  gregorianToEthiopian,
} from './ethiopianCalendar';

export interface EthiopianClockInfo {
  internationalTime: string;      // e.g. "08:00 EAT" or "20:00 EAT"
  internationalTime12h: string;   // e.g. "8:00 AM EAT" or "8:00 PM EAT"
  ethiopianHour: number;          // 1 to 12
  ethiopianMinute: number;        // 0 to 59
  ethiopianMinuteStr: string;     // "00" to "59"
  ethiopianClock: string;         // e.g. "12:00", "1:00", "11:59"
  ethiopianTime12h: string;       // e.g. "2:00 am", "2:00 pm", "12:00 am"
  period: 'day' | 'night';        // 'day' (6:00 AM - 5:59 PM) or 'night' (6:00 PM - 5:59 AM)
  periodCycle: 'am' | 'pm';       // 'am' (daytime) or 'pm' (nighttime)
  periodNameEn: string;           // "Daytime (Qen)" or "Nighttime (Mata)"
  periodNameAm: string;           // "ጠዋት", "ከሰዓት", "ማታ", "ሌሊት"
  ethiopianTimeStr: string;       // e.g. "ጠዋት 2:00 (2:00 am)"
  fullDisplay: string;            // e.g. "08:00 EAT · ጠዋት 2:00 (2:00 am)"
  ethiopianDateStr: string;       // e.g. "Tikimt 8, 2019 E.C."
  ethiopianDateAmStr: string;     // e.g. "ጥቅምት 8, 2019 ዓ.ም."
  isNewTraditionalDay: boolean;    // true at 6:00 AM Addis Ababa time
}

/**
 * Normalizes user/system time strings into standard 24-hour "HH:mm" format.
 * Examples:
 *   "8:00" -> "08:00"
 *   "08:00" -> "08:00"
 *   "8:00 AM" -> "08:00"
 *   "8:00 PM" -> "20:00"
 *   "8pm" -> "20:00"
 *   "2:00 pm" -> "14:00"
 *   "20:00:00" -> "20:00"
 */
export function normalizeTimeString(raw: string): string {
  if (!raw || typeof raw !== 'string') return '08:00';
  const cleaned = raw.trim();

  // 12-hour format with AM/PM (e.g., "8:00 PM", "8:30pm", "2 pm", "12:15 am")
  const ampmMatch = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)$/i.exec(cleaned);
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const minute = ampmMatch[2] ? Number(ampmMatch[2]) : 0;
    const isPm = ampmMatch[3].toLowerCase() === 'pm';
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  // 24-hour format with or without seconds (e.g., "8:00", "08:00", "20:00:00")
  const timeMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(cleaned);
  if (timeMatch) {
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  return cleaned;
}

/**
 * Convert an International wall-clock time in East Africa Time (Africa/Addis_Ababa, UTC+3)
 * to traditional Ethiopian Clock time (12-hour cycle starting at dawn 6:00 AM).
 *
 * Traditional Ethiopian Clock rules:
 * - 6:00 AM international = 12:00 am Ethiopian (new traditional day begins)
 * - 7:00 AM international = 1:00 am Ethiopian
 * - 8:00 AM international = 2:00 am Ethiopian
 * - 12:00 PM international = 6:00 am Ethiopian
 * - 1:00 PM international = 7:00 am Ethiopian
 * - 5:00 PM international = 11:00 am Ethiopian
 * - 6:00 PM international = 12:00 pm Ethiopian
 * - 7:00 PM international = 1:00 pm Ethiopian
 * - 11:00 PM international = 5:00 pm Ethiopian
 * - 12:00 AM international = 6:00 pm Ethiopian
 * - 5:59 AM international = 11:59 pm Ethiopian
 * - 6:00 AM international = 12:00 am Ethiopian (beginning the next traditional Ethiopian day)
 */
export function getEthiopianClock(
  timeOrDate: string | Date = new Date(),
  timezone = 'Africa/Addis_Ababa',
  isoDateOverride?: string
): EthiopianClockInfo {
  let hour = 8;
  let minute = 0;
  let isoDate = isoDateOverride || '';

  if (typeof timeOrDate === 'string') {
    if (/^\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm))?$/i.test(timeOrDate.trim())) {
      const normalized = normalizeTimeString(timeOrDate);
      const [h, m] = normalized.split(':').map(Number);
      hour = h;
      minute = m;
      if (!isoDate) {
        const now = new Date();
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(now);
        const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
        isoDate = `${map.year}-${map.month}-${map.day}`;
      }
    } else {
      const d = new Date(timeOrDate);
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(d);
      const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
      hour = Number(map.hour);
      minute = Number(map.minute);
      isoDate = `${map.year}-${map.month}-${map.day}`;
    }
  } else {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(timeOrDate);
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    hour = Number(map.hour);
    minute = Number(map.minute);
    isoDate = `${map.year}-${map.month}-${map.day}`;
  }

  // Calculate traditional Ethiopian clock hour:
  // Daytime cycle (6:00 AM - 5:59 PM international, i.e., hours 6..17) -> 'am'
  // Nighttime cycle (6:00 PM - 5:59 AM international, i.e., hours 18..23 and 0..5) -> 'pm'
  const isDaytime = hour >= 6 && hour < 18;
  const rawEthHour = isDaytime ? hour - 6 : (hour >= 18 ? hour - 18 : hour + 6);
  const ethiopianHour = rawEthHour === 0 ? 12 : rawEthHour;
  const ethiopianMinute = minute;
  const ethiopianMinuteStr = String(minute).padStart(2, '0');
  const periodCycle: 'am' | 'pm' = isDaytime ? 'am' : 'pm';
  const ethiopianClock = `${ethiopianHour}:${ethiopianMinuteStr}`;
  const ethiopianTime12h = `${ethiopianHour}:${ethiopianMinuteStr} ${periodCycle}`;

  // Amharic time-of-day period name:
  // ጠዋት (Morning): 06:00 - 11:59 intl (12:00 am - 5:59 am Ethiopian)
  // ከሰዓት (Afternoon): 12:00 - 17:59 intl (6:00 am - 11:59 am Ethiopian)
  // ማታ (Evening): 18:00 - 23:59 intl (12:00 pm - 5:59 pm Ethiopian)
  // ሌሊት (Night/Dawn): 00:00 - 05:59 intl (6:00 pm - 11:59 pm Ethiopian)
  let periodNameAm = 'ጠዋት';
  if (hour >= 6 && hour < 12) {
    periodNameAm = 'ጠዋት';
  } else if (hour >= 12 && hour < 18) {
    periodNameAm = 'ከሰዓት';
  } else if (hour >= 18 && hour < 24) {
    periodNameAm = 'ማታ';
  } else {
    periodNameAm = 'ሌሊት';
  }

  const period: 'day' | 'night' = isDaytime ? 'day' : 'night';
  const periodNameEn = isDaytime ? 'Daytime (Qen)' : 'Nighttime (Mata)';
  const isNewTraditionalDay = hour === 6 && minute === 0;

  const intlH24 = `${String(hour).padStart(2, '0')}:${ethiopianMinuteStr}`;
  const intlH12Hour = hour % 12 === 0 ? 12 : hour % 12;
  const intlH12 = `${intlH12Hour}:${ethiopianMinuteStr} ${hour >= 12 ? 'PM' : 'AM'} EAT`;

  const qenLabel = isDaytime ? 'Qen' : 'Mata';
  const ethiopianTimeStr = `${periodNameAm} ${ethiopianHour}:${ethiopianMinuteStr} (${ethiopianHour}:${ethiopianMinuteStr} ${qenLabel})`;
  const fullDisplay = `${intlH24} EAT · ${ethiopianTimeStr}`;
  const ethiopianDateStr = formatEthiopianDate(isoDate);
  const ethiopianDateAmStr = formatEthiopianDateAmharic(isoDate);

  return {
    internationalTime: `${intlH24} EAT`,
    internationalTime12h: intlH12,
    ethiopianHour,
    ethiopianMinute,
    ethiopianMinuteStr,
    ethiopianClock,
    ethiopianTime12h,
    period,
    periodCycle,
    periodNameEn,
    periodNameAm,
    ethiopianTimeStr,
    fullDisplay,
    ethiopianDateStr,
    ethiopianDateAmStr,
    isNewTraditionalDay,
  };
}

/**
 * Converts a traditional Ethiopian clock time to 24-hour International time (HH:mm) in East Africa Time.
 * 
 * Rules:
 * - Daytime (am / qen / ጠዋት / ከሰዓት):
 *   12:00 am -> 06:00
 *   1:00 am -> 07:00
 *   6:00 am -> 12:00
 *   11:00 am -> 17:00
 * - Nighttime (pm / mata / lelit / ማታ / ሌሊት):
 *   12:00 pm -> 18:00
 *   1:00 pm -> 19:00
 *   5:00 pm -> 23:00
 *   6:00 pm -> 00:00 (midnight international)
 *   7:00 pm -> 01:00
 *   11:00 pm -> 05:00
 *   11:59 pm -> 05:59
 */
export function ethiopianToInternationalTime(
  ethHour: number,
  ethMinute: number = 0,
  periodCycle: 'am' | 'pm' | 'day' | 'night' | 'ጠዋት' | 'ከሰዓት' | 'ማታ' | 'ሌሊት' = 'am'
): { hour24: number; minute: number; time24: string; time12: string } {
  const normEthHour = ethHour === 0 ? 12 : ethHour;
  const isNight =
    periodCycle === 'pm' ||
    periodCycle === 'night' ||
    periodCycle === 'ማታ' ||
    periodCycle === 'ሌሊት';

  let hour24 = 6;
  if (!isNight) {
    // Daytime: 12 is 6:00, 1..11 is 7..17
    hour24 = normEthHour === 12 ? 6 : 6 + normEthHour;
  } else {
    // Nighttime:
    // 12 -> 18:00
    // 1..5 -> 19:00 .. 23:00
    // 6 -> 00:00 (midnight)
    // 7..11 -> 01:00 .. 05:00
    if (normEthHour === 12) {
      hour24 = 18;
    } else if (normEthHour >= 1 && normEthHour <= 5) {
      hour24 = 18 + normEthHour;
    } else if (normEthHour === 6) {
      hour24 = 0;
    } else {
      hour24 = normEthHour - 6;
    }
  }

  const minute = Math.min(59, Math.max(0, ethMinute));
  const time24 = `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const time12 = `${h12}:${String(minute).padStart(2, '0')} ${hour24 >= 12 ? 'PM' : 'AM'} EAT`;

  return {
    hour24,
    minute,
    time24,
    time12,
  };
}

/**
 * Parses user-entered traditional Ethiopian clock strings into 24-hour time.
 * Supports:
 * - "12:00 am", "1:00 am", "2:00 am", "6:00 am", "11:00 am"
 * - "12:00 pm", "1:00 pm", "5:00 pm", "6:00 pm", "11:59 pm"
 * - "ጠዋት 2:00", "ጠዋት 2", "ከሰዓት 3:30", "ማታ 2:00", "ሌሊት 6:00"
 * - "2:00 am ethiopian", "2:00 habesha", "2:00 qen", "2:00 mata"
 */
export function parseEthiopianTimeInput(
  rawInput: string
): { hour24: number; minute: number; time24: string } | null {
  if (!rawInput || typeof rawInput !== 'string') return null;
  const cleaned = rawInput.trim().toLowerCase();

  // 1. Amharic prefix formats (e.g. "ጠዋት 2:00", "ጠዋት 2", "ማታ 8:30")
  const amharicMatch = /^(ጠዋት|ከሰዓት|ማታ|ሌሊት)\s*(\d{1,2})(?::(\d{2}))?(?:\s*ሰዓት)?$/i.exec(cleaned);
  if (amharicMatch) {
    const period = amharicMatch[1] as 'ጠዋት' | 'ከሰዓት' | 'ማታ' | 'ሌሊት';
    const ethH = Number(amharicMatch[2]);
    const ethM = amharicMatch[3] ? Number(amharicMatch[3]) : 0;
    if (ethH >= 1 && ethH <= 12) {
      return ethiopianToInternationalTime(ethH, ethM, period);
    }
  }

  // 2. Ethiopian AM/PM format (e.g., "12:00 am", "2:00 am ethiopian", "6:00 pm habesha")
  const ethMatch = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*(?:ethiopian|habesha|qen|mata))?$/i.exec(cleaned);
  if (ethMatch) {
    const ethH = Number(ethMatch[1]);
    const ethM = ethMatch[2] ? Number(ethMatch[2]) : 0;
    const cycle = ethMatch[3] as 'am' | 'pm';
    if (ethH >= 1 && ethH <= 12) {
      return ethiopianToInternationalTime(ethH, ethM, cycle);
    }
  }

  // 3. Named Qen / Mata suffix (e.g. "2:00 qen", "2:00 mata")
  const namedMatch = /^(\d{1,2})(?::(\d{2}))?\s*(qen|mata)$/i.exec(cleaned);
  if (namedMatch) {
    const ethH = Number(namedMatch[1]);
    const ethM = namedMatch[2] ? Number(namedMatch[2]) : 0;
    const period = namedMatch[3] === 'qen' ? 'am' : 'pm';
    if (ethH >= 1 && ethH <= 12) {
      return ethiopianToInternationalTime(ethH, ethM, period);
    }
  }

  return null;
}

/**
 * Returns the Gregorian ISO date (YYYY-MM-DD) corresponding to the active traditional Ethiopian day.
 * 
 * Traditional Ethiopian Day Boundary Rule:
 * - A traditional Ethiopian day begins at 6:00 AM (dawn) Addis Ababa time (03:00 UTC).
 * - From 6:00 AM until 5:59:59 AM the following international day, it is the SAME traditional day.
 * - Tasks between 12:00 AM and 5:59 AM international time belong to the Ethiopian day that began at 6:00 AM yesterday.
 * - At 6:00 AM international time, the new Ethiopian day begins.
 */
export function getTraditionalDayDate(
  now: Date = new Date(),
  timezone = 'Africa/Addis_Ababa'
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour);

  if (hour < 6) {
    // Before 6:00 AM Addis Ababa time: active traditional day started yesterday at 6:00 AM
    const yesterday = new Date(Date.UTC(year, month - 1, day - 1));
    return yesterday.toISOString().slice(0, 10);
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Format dual calendar date and time for Telegram headers, UI displays, or summaries.
 * Example output:
 * "Thursday, Oct 15, 2026 · 08:00 EAT | Tikimt 5, 2019 E.C. · ጠዋት 2:00 (2:00 am)"
 */
export function formatDualDateTimeHeader(
  isoDate: string,
  timeStr: string,
  timezone = 'Africa/Addis_Ababa'
): {
  gregorianHeader: string;
  ethiopianHeader: string;
  combinedLine: string;
} {
  const normTime = normalizeTimeString(timeStr);
  const clock = getEthiopianClock(normTime, timezone, isoDate);

  const [year, month, day] = isoDate.split('-').map(Number);
  const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const gregFormatted = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  const gregorianHeader = `${weekday}, ${gregFormatted} · ${clock.internationalTime}`;
  const ethiopianHeader = `${clock.ethiopianDateStr} · ${clock.ethiopianTimeStr}`;
  const combinedLine = `${gregorianHeader}\n🇪🇹 ${ethiopianHeader}`;

  return {
    gregorianHeader,
    ethiopianHeader,
    combinedLine,
  };
}
