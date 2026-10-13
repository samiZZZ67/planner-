const ethiopianDateFormatter = new Intl.DateTimeFormat('en-ET-u-ca-ethiopic-nu-latn', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const ethiopianMonthFormatter = new Intl.DateTimeFormat('en-ET-u-ca-ethiopic-nu-latn', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function partsMap(formatter: Intl.DateTimeFormat, date: Date) {
  return Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
}

export function formatEthiopianDate(isoDate: string) {
  const date = parseIsoDate(isoDate);
  if (!date) return isoDate;
  const parts = partsMap(ethiopianDateFormatter, date);
  return `${parts.month} ${parts.day}, ${parts.year} E.C.`;
}

export function formatEthiopianMonthRange(gregorianMonth: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(gregorianMonth);
  if (!match) return gregorianMonth;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return gregorianMonth;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const first = partsMap(ethiopianMonthFormatter, start);
  const last = partsMap(ethiopianMonthFormatter, end);
  const firstLabel = `${first.month} ${first.year}`;
  const lastLabel = `${last.month} ${last.year}`;
  return `${firstLabel === lastLabel ? firstLabel : `${firstLabel} – ${lastLabel}`} E.C.`;
}

export function formatEthiopianDateRange(startIsoDate: string, endIsoDate: string) {
  return `${formatEthiopianDate(startIsoDate)} – ${formatEthiopianDate(endIsoDate)}`;
}
