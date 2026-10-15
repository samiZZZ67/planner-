import { formatEthiopianDate } from './ethiopianCalendar';

export interface EthiopianClockInfo {
  internationalTime: string;   // e.g. "08:00 EAT" or "20:00 EAT"
  internationalTime12h: string;// e.g. "8:00 AM EAT" or "8:00 PM EAT"
  ethiopianHour: number;       // 1 to 12
  ethiopianMinute: number;     // 0 to 59
  ethiopianMinuteStr: string;  // "00" to "59"
  period: 'day' | 'night';     // 'day' (Qen) or 'night' (Mata)
  periodNameEn: string;        // "Daytime (Qen)" or "Nighttime (Mata)"
  periodNameAm: string;        // "ጠዋት", "ከሰዓት", "ማታ", "ሌሊት"
  ethiopianTimeStr: string;    // e.g. "ጠዋት 2:00 (2:00 Qen)"
  fullDisplay: string;         // e.g. "08:00 EAT · ጠዋት 2:00 (2:00 Qen)"
  ethiopianDateStr: string;    // e.g. "Tikimt 5, 2017 E.C."
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
 * to traditional Ethiopian Clock time (12-hour cycle starting at sunrise 6:00 AM).
 *
 * Traditional Ethiopian Clock rules:
 * - 06:00 EAT (Dawn) = 12:00 Qen / daytime (ጠዋት 12:00)
 * - 07:00 EAT = 1:00 Qen (ጠዋት 1:00)
 * - 08:00 EAT = 2:00 Qen (ጠዋት 2:00) -> Morning brief
 * - 12:00 EAT = 6:00 Qen (ቀትር 6:00 / Midday)
 * - 14:00 EAT = 8:00 Qen (ከሰዓት 8:00 / Afternoon)
 * - 18:00 EAT (Dusk) = 12:00 Mata / nighttime (ማታ 12:00)
 * - 19:00 EAT = 1:00 Mata (ማታ 1:00)
 * - 20:00 EAT = 2:00 Mata (ማታ 2:00) -> Evening brief
 * - 00:00 EAT = 6:00 Lelit (እኩለ ሌሊት 6:00 / Midnight)
 * - 05:00 EAT = 11:00 Lelit (ንጋት 11:00 / Dawn)
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
    // Could be "HH:mm", "YYYY-MM-DDTHH:mm:ssZ", or "YYYY-MM-DD HH:mm"
    if (/^\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm))?$/i.test(timeOrDate.trim())) {
      const normalized = normalizeTimeString(timeOrDate);
      const [h, m] = normalized.split(':').map(Number);
      hour = h;
      minute = m;
      if (!isoDate) {
        // Today in timezone
        const now = new Date();
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
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
  // Offset by 6 hours from 24-hour cycle.
  // E.g. hour 6 -> (6 - 6) = 0 -> 12:00
  //      hour 8 -> (8 - 6) = 2 -> 2:00
  //      hour 18 -> (18 - 18) = 0 -> 12:00
  //      hour 20 -> (20 - 18) = 2 -> 2:00
  //      hour 0 -> (0 + 6) = 6 -> 6:00
  const isDaytime = hour >= 6 && hour < 18;
  const rawEthHour = isDaytime ? hour - 6 : (hour >= 18 ? hour - 18 : hour + 6);
  const ethiopianHour = rawEthHour === 0 ? 12 : rawEthHour;
  const ethiopianMinute = minute;
  const ethiopianMinuteStr = String(minute).padStart(2, '0');

  // Amharic time-of-day period
  let periodNameAm = 'ጠዋት';
  if (hour >= 6 && hour < 12) {
    periodNameAm = 'ጠዋት';      // Morning (6 AM - 11:59 AM)
  } else if (hour >= 12 && hour < 18) {
    periodNameAm = 'ከሰዓት';     // Afternoon (12 PM - 5:59 PM)
  } else if (hour >= 18 && hour < 24) {
    periodNameAm = 'ማታ';       // Evening / Night (6 PM - 11:59 PM)
  } else {
    periodNameAm = 'ሌሊት';      // Late Night / Early Dawn (12 AM - 5:59 AM)
  }

  const period: 'day' | 'night' = isDaytime ? 'day' : 'night';
  const periodNameEn = isDaytime ? 'Daytime (Qen)' : 'Nighttime (Mata)';
  const qenLabel = isDaytime ? 'Qen' : 'Mata';

  const intlH24 = `${String(hour).padStart(2, '0')}:${ethiopianMinuteStr}`;
  const intlH12Hour = hour % 12 === 0 ? 12 : hour % 12;
  const intlH12 = `${intlH12Hour}:${ethiopianMinuteStr} ${hour >= 12 ? 'PM' : 'AM'} EAT`;

  const ethiopianTimeStr = `${periodNameAm} ${ethiopianHour}:${ethiopianMinuteStr} (${ethiopianHour}:${ethiopianMinuteStr} ${qenLabel})`;
  const fullDisplay = `${intlH24} EAT · ${ethiopianTimeStr}`;
  const ethiopianDateStr = formatEthiopianDate(isoDate);

  return {
    internationalTime: `${intlH24} EAT`,
    internationalTime12h: intlH12,
    ethiopianHour,
    ethiopianMinute,
    ethiopianMinuteStr,
    period,
    periodNameEn,
    periodNameAm,
    ethiopianTimeStr,
    fullDisplay,
    ethiopianDateStr,
  };
}

/**
 * Format dual calendar date and time for Telegram headers or UI displays.
 * Example output:
 * "Thursday, Oct 15, 2026 · 08:00 EAT | Tikimt 5, 2019 E.C. · ጠዋት 2:00 (2:00 Qen)"
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
