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
