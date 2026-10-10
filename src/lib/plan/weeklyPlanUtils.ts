/**
 * Utilities for weekly planning date calculations and word validation
 */

export function countWords(text: string): number {
  if (!text || !text.trim()) return 0;
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

export function getWeekBounds(dateStr: string): {
  startDate: string;
  endDate: string;
  weekLabel: string;
  weekId: string;
  monthId: string;
} {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay(); // 0 is Sun, 1 is Mon...
  const diffToMon = day === 0 ? -6 : 1 - day;

  const mon = new Date(date);
  mon.setUTCDate(date.getUTCDate() + diffToMon);

  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);

  const startDate = mon.toISOString().split('T')[0];
  const endDate = sun.toISOString().split('T')[0];
  const monthId = startDate.slice(0, 7); // YYYY-MM

  const startMonth = mon.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const endMonth = sun.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const weekLabel = `${startMonth} ${mon.getUTCDate()} – ${endMonth} ${sun.getUTCDate()}, ${sun.getUTCFullYear()}`;
  const weekId = `week-${startDate}_${endDate}`;

  return { startDate, endDate, weekLabel, weekId, monthId };
}

export interface WeekOption {
  startDate: string;
  endDate: string;
  weekLabel: string;
  weekId: string;
  isCurrentWeek: boolean;
  offset: number;
}

/**
 * Returns array of 7 consecutive dates (YYYY-MM-DD) from Monday to Sunday for given Monday start date
 */
export function getDaysInWeek(mondayStartDate: string): string[] {
  const [y, m, d] = mondayStartDate.split('-').map(Number);
  const mon = new Date(Date.UTC(y, m - 1, d));
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(mon);
    dt.setUTCDate(mon.getUTCDate() + i);
    days.push(dt.toISOString().split('T')[0]);
  }
  return days;
}

/**
 * Generates all weeks with data from earliest recorded date up to current week
 */
export function getAvailableWeeks(recordedDates: string[]): WeekOption[] {
  const todayStr = new Date().toISOString().split('T')[0];
  const currentBounds = getWeekBounds(todayStr);

  const sortedDates = [...recordedDates].filter(Boolean).sort();
  const earliestDateStr = sortedDates[0] || todayStr;
  const earliestBounds = getWeekBounds(earliestDateStr);

  const weeks: WeekOption[] = [];
  const currMonday = new Date(currentBounds.startDate + 'T00:00:00Z');
  const earliestMonday = new Date(earliestBounds.startDate + 'T00:00:00Z');

  let offset = 0;
  while (currMonday >= earliestMonday || offset === 0) {
    const mondayStr = currMonday.toISOString().split('T')[0];
    const bounds = getWeekBounds(mondayStr);
    weeks.push({
      startDate: bounds.startDate,
      endDate: bounds.endDate,
      weekLabel: bounds.weekLabel,
      weekId: bounds.weekId,
      isCurrentWeek: offset === 0,
      offset,
    });
    currMonday.setUTCDate(currMonday.getUTCDate() - 7);
    offset--;
    if (offset < -104) break; // Maximum 2 years history
  }

  return weeks;
}
