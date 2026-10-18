export interface EthiopianDateInfo {
  year: number;
  month: number;
  day: number;
  monthNameEn: string;
  monthNameAm: string;
  formattedEn: string;       // e.g. "Tikimt 8, 2019 E.C."
  formattedAm: string;       // e.g. "ጥቅምት 8, 2019 ዓ.ም."
  isLeapYear: boolean;
}

export interface GregorianDateInfo {
  year: number;
  month: number;
  day: number;
  isoDate: string;           // "YYYY-MM-DD"
  formatted: string;         // e.g. "Oct 18, 2026"
}

export interface EthiopianMonthMetadata {
  id: number;
  nameEn: string;
  nameAm: string;
}

export const ETHIOPIAN_MONTHS: EthiopianMonthMetadata[] = [
  { id: 1, nameEn: 'Meskerem', nameAm: 'መስከረም' },
  { id: 2, nameEn: 'Tikimt', nameAm: 'ጥቅምት' },
  { id: 3, nameEn: 'Hidar', nameAm: 'ኅዳር' },
  { id: 4, nameEn: 'Tahsas', nameAm: 'ታኅሣሥ' },
  { id: 5, nameEn: 'Tir', nameAm: 'ጥር' },
  { id: 6, nameEn: 'Yakatit', nameAm: 'የካቲት' },
  { id: 7, nameEn: 'Magabit', nameAm: 'መጋቢት' },
  { id: 8, nameEn: 'Miyazya', nameAm: 'ሚያዝያ' },
  { id: 9, nameEn: 'Ginbot', nameAm: 'ግንቦት' },
  { id: 10, nameEn: 'Sene', nameAm: 'ሰኔ' },
  { id: 11, nameEn: 'Hamle', nameAm: 'ሐምሌ' },
  { id: 12, nameEn: 'Nehase', nameAm: 'ነሐሴ' },
  { id: 13, nameEn: 'Pagume', nameAm: 'ጳጉሜ' },
];

/**
 * An Ethiopian leap year occurs when year % 4 === 3.
 * In a leap year, the 13th month (Pagume) has 6 days instead of 5 days.
 */
export function isEthiopianLeapYear(year: number): boolean {
  return ((year % 4) + 4) % 4 === 3;
}

/**
 * Returns number of days in an Ethiopian month (1-13).
 * Months 1-12 always have 30 days. Pagume (month 13) has 5 or 6 days.
 */
export function getDaysInEthiopianMonth(year: number, month: number): number {
  if (month < 1 || month > 13) {
    throw new Error(`Invalid Ethiopian month: ${month}. Must be 1 to 13.`);
  }
  if (month <= 12) return 30;
  return isEthiopianLeapYear(year) ? 6 : 5;
}

/**
 * Converts a Gregorian date (year, month 1-12, day 1-31) to Julian Day Number (JDN).
 */
export function gregorianToJdn(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/**
 * Converts a Julian Day Number (JDN) to Ethiopian date (year, month 1-13, day 1-30).
 * Ethiopian epoch is JDN 1723856 (Aug 29, 8 AD Julian).
 */
export function jdnToEthiopian(jdn: number): { year: number; month: number; day: number } {
  const r = (jdn - 1723856) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  const year =
    4 * Math.floor((jdn - 1723856) / 1461) +
    Math.floor(r / 365) -
    Math.floor(r / 1460);
  const month = Math.floor(n / 30) + 1;
  const day = (n % 30) + 1;
  return { year, month, day };
}

/**
 * Converts an Ethiopian date (year, month 1-13, day 1-30) to Julian Day Number (JDN).
 */
export function ethiopianToJdn(year: number, month: number, day: number): number {
  return 1723856 + 365 * year + Math.floor(year / 4) + 30 * (month - 1) + day - 1;
}

/**
 * Converts a Julian Day Number (JDN) to Gregorian date (year, month 1-12, day 1-31).
 */
export function jdnToGregorian(jdn: number): { year: number; month: number; day: number } {
  let l = jdn + 68569;
  const n = Math.floor((4 * l) / 146097);
  l = l - Math.floor((146097 * n + 3) / 4);
  const i = Math.floor((4000 * (l + 1)) / 1461001);
  l = l - Math.floor((1461 * i) / 4) + 31;
  const j = Math.floor((80 * l) / 2447);
  const day = l - Math.floor((2447 * j) / 80);
  l = Math.floor(j / 11);
  const month = j + 2 - 12 * l;
  const year = 100 * (n - 49) + i + l;
  return { year, month, day };
}

function parseDateInput(dateInput: string | Date): { year: number; month: number; day: number } | null {
  if (typeof dateInput === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateInput.trim());
    if (match) {
      return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
      };
    }
    const parsed = new Date(dateInput);
    if (!isNaN(parsed.getTime())) {
      return {
        year: parsed.getUTCFullYear(),
        month: parsed.getUTCMonth() + 1,
        day: parsed.getUTCDate(),
      };
    }
    return null;
  }
  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    return {
      year: dateInput.getUTCFullYear(),
      month: dateInput.getUTCMonth() + 1,
      day: dateInput.getUTCDate(),
    };
  }
  return null;
}

/**
 * Convert Gregorian date to Ethiopian calendar representation with English and Ge'ez/Amharic names.
 */
export function gregorianToEthiopian(dateInput: string | Date): EthiopianDateInfo {
  const parsed = parseDateInput(dateInput);
  if (!parsed) {
    // Fallback safe representation
    return {
      year: 2017,
      month: 1,
      day: 1,
      monthNameEn: 'Meskerem',
      monthNameAm: 'መስከረም',
      formattedEn: 'Meskerem 1, 2017 E.C.',
      formattedAm: 'መስከረም 1, 2017 ዓ.ም.',
      isLeapYear: false,
    };
  }

  const jdn = gregorianToJdn(parsed.year, parsed.month, parsed.day);
  const eth = jdnToEthiopian(jdn);
  const monthMeta = ETHIOPIAN_MONTHS[eth.month - 1] || ETHIOPIAN_MONTHS[0];
  const leap = isEthiopianLeapYear(eth.year);

  return {
    year: eth.year,
    month: eth.month,
    day: eth.day,
    monthNameEn: monthMeta.nameEn,
    monthNameAm: monthMeta.nameAm,
    formattedEn: `${monthMeta.nameEn} ${eth.day}, ${eth.year} E.C.`,
    formattedAm: `${monthMeta.nameAm} ${eth.day}, ${eth.year} ዓ.ም.`,
    isLeapYear: leap,
  };
}

/**
 * Convert an Ethiopian calendar date to Gregorian date with ISO date string (YYYY-MM-DD).
 */
export function ethiopianToGregorian(year: number, month: number, day: number): GregorianDateInfo {
  const maxDays = getDaysInEthiopianMonth(year, month);
  const safeDay = Math.min(Math.max(1, day), maxDays);
  const jdn = ethiopianToJdn(year, month, safeDay);
  const greg = jdnToGregorian(jdn);
  const isoDate = `${String(greg.year).padStart(4, '0')}-${String(greg.month).padStart(2, '0')}-${String(greg.day).padStart(2, '0')}`;
  
  const dObj = new Date(Date.UTC(greg.year, greg.month - 1, greg.day));
  const formatted = dObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return {
    year: greg.year,
    month: greg.month,
    day: greg.day,
    isoDate,
    formatted,
  };
}

/**
 * Preserved function: formats ISO date to English Ethiopian representation.
 * Example: "2026-10-18" -> "Tikimt 8, 2019 E.C."
 */
export function formatEthiopianDate(isoDate: string): string {
  if (!isoDate) return '';
  const eth = gregorianToEthiopian(isoDate);
  return eth.formattedEn;
}

/**
 * Formats ISO date to Amharic Ethiopian representation.
 * Example: "2026-10-18" -> "ጥቅምት 8, 2019 ዓ.ም."
 */
export function formatEthiopianDateAmharic(isoDate: string): string {
  if (!isoDate) return '';
  const eth = gregorianToEthiopian(isoDate);
  return eth.formattedAm;
}

export function formatEthiopianMonthRange(gregorianMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(gregorianMonth);
  if (!match) return gregorianMonth;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return gregorianMonth;
  const startIso = `${gregorianMonth}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endIso = `${gregorianMonth}-${String(lastDay).padStart(2, '0')}`;

  const first = gregorianToEthiopian(startIso);
  const last = gregorianToEthiopian(endIso);
  const firstLabel = `${first.monthNameEn} ${first.year}`;
  const lastLabel = `${last.monthNameEn} ${last.year}`;
  return `${firstLabel === lastLabel ? firstLabel : `${firstLabel} – ${lastLabel}`} E.C.`;
}

export function formatEthiopianDateRange(startIsoDate: string, endIsoDate: string): string {
  return `${formatEthiopianDate(startIsoDate)} – ${formatEthiopianDate(endIsoDate)}`;
}
