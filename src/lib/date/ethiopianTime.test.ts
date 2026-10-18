import { describe, it, expect } from 'vitest';
import {
  getEthiopianClock,
  normalizeTimeString,
  formatDualDateTimeHeader,
  ethiopianToInternationalTime,
  parseEthiopianTimeInput,
  getTraditionalDayDate,
} from './ethiopianTime';
import {
  gregorianToEthiopian,
  ethiopianToGregorian,
  isEthiopianLeapYear,
  getDaysInEthiopianMonth,
  formatEthiopianDate,
  formatEthiopianDateAmharic,
  ETHIOPIAN_MONTHS,
} from './ethiopianCalendar';

describe('Ethiopian Time & Traditional Clock Conversion Suite', () => {
  describe('1. Mandatory User Table Verification in Africa/Addis_Ababa', () => {
    // | International time | Expected Ethiopian clock |
    // | 5:59 AM            | 11:59                    |
    // | 6:00 AM            | 12:00 — new traditional day |
    // | 7:00 AM            | 1:00                     |
    // | 12:00 PM           | 6:00                     |
    // | 1:00 PM            | 7:00                     |
    // | 5:00 PM            | 11:00                    |
    // | 6:00 PM            | 12:00                    |
    // | 11:00 PM           | 5:00                     |
    // | 12:00 AM           | 6:00                     |

    it('5:59 AM intl -> 11:59 (11:59 pm Ethiopian)', () => {
      const clock = getEthiopianClock('05:59', 'Africa/Addis_Ababa', '2026-10-18');
      expect(clock.ethiopianClock).toBe('11:59');
      expect(clock.ethiopianHour).toBe(11);
      expect(clock.ethiopianMinute).toBe(59);
      expect(clock.periodCycle).toBe('pm');
      expect(clock.period).toBe('night');
      expect(clock.periodNameAm).toBe('ሌሊት');
      expect(clock.isNewTraditionalDay).toBe(false);
    });

    it('6:00 AM intl -> 12:00 (12:00 am Ethiopian, begins new traditional day)', () => {
      const clock = getEthiopianClock('06:00', 'Africa/Addis_Ababa', '2026-10-18');
      expect(clock.ethiopianClock).toBe('12:00');
      expect(clock.ethiopianHour).toBe(12);
      expect(clock.ethiopianMinute).toBe(0);
      expect(clock.periodCycle).toBe('am');
      expect(clock.period).toBe('day');
      expect(clock.periodNameAm).toBe('ጠዋት');
      expect(clock.isNewTraditionalDay).toBe(true);
    });

    it('7:00 AM intl -> 1:00 (1:00 am Ethiopian)', () => {
      const clock = getEthiopianClock('07:00', 'Africa/Addis_Ababa', '2026-10-18');
      expect(clock.ethiopianClock).toBe('1:00');
      expect(clock.ethiopianHour).toBe(1);
      expect(clock.ethiopianMinute).toBe(0);
      expect(clock.periodCycle).toBe('am');
      expect(clock.period).toBe('day');
      expect(clock.periodNameAm).toBe('ጠዋት');
    });

    it('12:00 PM intl -> 6:00 (6:00 am Ethiopian)', () => {
      const clock = getEthiopianClock('12:00', 'Africa/Addis_Ababa', '2026-10-18');
      expect(clock.ethiopianClock).toBe('6:00');
      expect(clock.ethiopianHour).toBe(6);
      expect(clock.ethiopianMinute).toBe(0);
      expect(clock.periodCycle).toBe('am');
      expect(clock.period).toBe('day');
      expect(clock.periodNameAm).toBe('ከሰዓት');
    });

    it('1:00 PM intl -> 7:00 (7:00 am Ethiopian)', () => {
      const clock = getEthiopianClock('13:00', 'Africa/Addis_Ababa', '2026-10-18');
      expect(clock.ethiopianClock).toBe('7:00');
      expect(clock.ethiopianHour).toBe(7);
      expect(clock.ethiopianMinute).toBe(0);
      expect(clock.periodCycle).toBe('am');
      expect(clock.period).toBe('day');
      expect(clock.periodNameAm).toBe('ከሰዓት');
    });

    it('5:00 PM intl -> 11:00 (11:00 am Ethiopian)', () => {
      const clock = getEthiopianClock('17:00', 'Africa/Addis_Ababa', '2026-10-18');
      expect(clock.ethiopianClock).toBe('11:00');
      expect(clock.ethiopianHour).toBe(11);
      expect(clock.ethiopianMinute).toBe(0);
      expect(clock.periodCycle).toBe('am');
      expect(clock.period).toBe('day');
      expect(clock.periodNameAm).toBe('ከሰዓት');
    });

    it('6:00 PM intl -> 12:00 (12:00 pm Ethiopian)', () => {
      const clock = getEthiopianClock('18:00', 'Africa/Addis_Ababa', '2026-10-18');
      expect(clock.ethiopianClock).toBe('12:00');
      expect(clock.ethiopianHour).toBe(12);
      expect(clock.ethiopianMinute).toBe(0);
      expect(clock.periodCycle).toBe('pm');
      expect(clock.period).toBe('night');
      expect(clock.periodNameAm).toBe('ማታ');
    });

    it('11:00 PM intl -> 5:00 (5:00 pm Ethiopian)', () => {
      const clock = getEthiopianClock('23:00', 'Africa/Addis_Ababa', '2026-10-18');
      expect(clock.ethiopianClock).toBe('5:00');
      expect(clock.ethiopianHour).toBe(5);
      expect(clock.ethiopianMinute).toBe(0);
      expect(clock.periodCycle).toBe('pm');
      expect(clock.period).toBe('night');
      expect(clock.periodNameAm).toBe('ማታ');
    });

    it('12:00 AM intl -> 6:00 (6:00 pm Ethiopian)', () => {
      const clock = getEthiopianClock('00:00', 'Africa/Addis_Ababa', '2026-10-18');
      expect(clock.ethiopianClock).toBe('6:00');
      expect(clock.ethiopianHour).toBe(6);
      expect(clock.ethiopianMinute).toBe(0);
      expect(clock.periodCycle).toBe('pm');
      expect(clock.period).toBe('night');
      expect(clock.periodNameAm).toBe('ሌሊት');
    });
  });

  describe('2. Clock Continuity Across Midnight & Day Boundary', () => {
    it('seamlessly transitions across midnight', () => {
      const beforeMidnight = getEthiopianClock('23:59', 'Africa/Addis_Ababa', '2026-10-18');
      expect(beforeMidnight.ethiopianClock).toBe('5:59');
      expect(beforeMidnight.periodCycle).toBe('pm');

      const midnight = getEthiopianClock('00:00', 'Africa/Addis_Ababa', '2026-10-19');
      expect(midnight.ethiopianClock).toBe('6:00');
      expect(midnight.periodCycle).toBe('pm');

      const afterMidnight = getEthiopianClock('00:01', 'Africa/Addis_Ababa', '2026-10-19');
      expect(afterMidnight.ethiopianClock).toBe('6:01');
      expect(afterMidnight.periodCycle).toBe('pm');
    });

    it('transitions cleanly at dawn 6:00 AM day boundary', () => {
      const lastMinuteNight = getEthiopianClock('05:59', 'Africa/Addis_Ababa', '2026-10-18');
      expect(lastMinuteNight.ethiopianClock).toBe('11:59');
      expect(lastMinuteNight.periodCycle).toBe('pm');
      expect(lastMinuteNight.isNewTraditionalDay).toBe(false);

      const dawn = getEthiopianClock('06:00', 'Africa/Addis_Ababa', '2026-10-18');
      expect(dawn.ethiopianClock).toBe('12:00');
      expect(dawn.periodCycle).toBe('am');
      expect(dawn.isNewTraditionalDay).toBe(true);
    });
  });

  describe('3. Bidirectional Ethiopian Calendar Calculations', () => {
    it('has all 13 Ethiopian months defined with English and Amharic names', () => {
      expect(ETHIOPIAN_MONTHS.length).toBe(13);
      expect(ETHIOPIAN_MONTHS[0].nameEn).toBe('Meskerem');
      expect(ETHIOPIAN_MONTHS[0].nameAm).toBe('መስከረም');
      expect(ETHIOPIAN_MONTHS[12].nameEn).toBe('Pagume');
      expect(ETHIOPIAN_MONTHS[12].nameAm).toBe('ጳጉሜ');
    });

    it('identifies Ethiopian leap years correctly (year % 4 === 3)', () => {
      expect(isEthiopianLeapYear(2011)).toBe(true);
      expect(isEthiopianLeapYear(2012)).toBe(false);
      expect(isEthiopianLeapYear(2013)).toBe(false);
      expect(isEthiopianLeapYear(2014)).toBe(false);
      expect(isEthiopianLeapYear(2015)).toBe(true);
      expect(isEthiopianLeapYear(2016)).toBe(false);
      expect(isEthiopianLeapYear(2019)).toBe(true);
      expect(isEthiopianLeapYear(2023)).toBe(true);
    });

    it('calculates days in month: 30 days for months 1-12, 5 or 6 for Pagume', () => {
      for (let m = 1; m <= 12; m++) {
        expect(getDaysInEthiopianMonth(2019, m)).toBe(30);
      }
      expect(getDaysInEthiopianMonth(2018, 13)).toBe(5); // non-leap
      expect(getDaysInEthiopianMonth(2019, 13)).toBe(6); // leap (2019 % 4 === 3)
      expect(getDaysInEthiopianMonth(2015, 13)).toBe(6); // leap (2015 % 4 === 3)
      expect(getDaysInEthiopianMonth(2016, 13)).toBe(5); // non-leap
    });

    it('converts Ethiopian New Year transitions accurately', () => {
      // 2023: 2015 E.C. was leap year (Pagume has 6 days)
      const sept11_2023 = gregorianToEthiopian('2023-09-11');
      expect(sept11_2023.year).toBe(2015);
      expect(sept11_2023.month).toBe(13);
      expect(sept11_2023.day).toBe(6);

      const sept12_2023 = gregorianToEthiopian('2023-09-12');
      expect(sept12_2023.year).toBe(2016);
      expect(sept12_2023.month).toBe(1);
      expect(sept12_2023.day).toBe(1);

      // 2024: 2016 E.C. was non-leap year (Pagume has 5 days)
      const sept10_2024 = gregorianToEthiopian('2024-09-10');
      expect(sept10_2024.year).toBe(2016);
      expect(sept10_2024.month).toBe(13);
      expect(sept10_2024.day).toBe(5);

      const sept11_2024 = gregorianToEthiopian('2024-09-11');
      expect(sept11_2024.year).toBe(2017);
      expect(sept11_2024.month).toBe(1);
      expect(sept11_2024.day).toBe(1);

      // 2027: 2019 E.C. is leap year (Pagume has 6 days)
      const sept11_2027 = gregorianToEthiopian('2027-09-11');
      expect(sept11_2027.year).toBe(2019);
      expect(sept11_2027.month).toBe(13);
      expect(sept11_2027.day).toBe(6);

      const sept12_2027 = gregorianToEthiopian('2027-09-12');
      expect(sept12_2027.year).toBe(2020);
      expect(sept12_2027.month).toBe(1);
      expect(sept12_2027.day).toBe(1);
    });

    it('performs exact round-trip conversion between Gregorian and Ethiopian', () => {
      const dates = [
        '2026-10-18',
        '2024-01-01',
        '2024-02-29',
        '2025-09-11',
        '2027-09-11',
        '2030-12-31',
      ];
      for (const d of dates) {
        const eth = gregorianToEthiopian(d);
        const greg = ethiopianToGregorian(eth.year, eth.month, eth.day);
        expect(greg.isoDate).toBe(d);
      }
    });

    it('formats Ethiopian dates in English and Amharic', () => {
      const en = formatEthiopianDate('2026-10-18');
      const am = formatEthiopianDateAmharic('2026-10-18');
      expect(en).toBe('Tikimt 8, 2019 E.C.');
      expect(am).toBe('ጥቅምት 8, 2019 ዓ.ም.');
    });
  });

  describe('4. Daily Task Boundaries at 6:00 AM Addis Ababa Time', () => {
    it('preserves the previous traditional day between 12:00 AM and 5:59 AM', () => {
      // 2026-10-18 05:30 AM EAT (02:30 UTC): still belongs to traditional day 2026-10-17
      const earlyMorning = new Date('2026-10-18T02:30:00Z');
      const dayDate = getTraditionalDayDate(earlyMorning, 'Africa/Addis_Ababa');
      expect(dayDate).toBe('2026-10-17');
    });

    it('begins the new traditional day exactly at 6:00 AM EAT', () => {
      // 2026-10-18 06:00 AM EAT (03:00 UTC): begins traditional day 2026-10-18
      const dawn = new Date('2026-10-18T03:00:00Z');
      const dayDate = getTraditionalDayDate(dawn, 'Africa/Addis_Ababa');
      expect(dayDate).toBe('2026-10-18');
    });

    it('keeps tasks during the evening in the same traditional day', () => {
      // 2026-10-18 20:00 EAT (17:00 UTC)
      const evening = new Date('2026-10-18T17:00:00Z');
      const dayDate = getTraditionalDayDate(evening, 'Africa/Addis_Ababa');
      expect(dayDate).toBe('2026-10-18');
    });

    it('continues overnight tasks into the same traditional day until 5:59 AM', () => {
      // 2026-10-19 02:00 AM EAT (2026-10-18 23:00 UTC): still part of 2026-10-18 traditional day
      const nightOwlSession = new Date('2026-10-18T23:00:00Z');
      const dayDate = getTraditionalDayDate(nightOwlSession, 'Africa/Addis_Ababa');
      expect(dayDate).toBe('2026-10-18');
    });
  });

  describe('5. Input Parsing & Reverse Time Conversion', () => {
    it('converts Ethiopian time to 24-hour international time', () => {
      expect(ethiopianToInternationalTime(12, 0, 'am').time24).toBe('06:00');
      expect(ethiopianToInternationalTime(2, 0, 'am').time24).toBe('08:00');
      expect(ethiopianToInternationalTime(6, 0, 'am').time24).toBe('12:00');
      expect(ethiopianToInternationalTime(11, 0, 'am').time24).toBe('17:00');
      expect(ethiopianToInternationalTime(12, 0, 'pm').time24).toBe('18:00');
      expect(ethiopianToInternationalTime(2, 0, 'pm').time24).toBe('20:00');
      expect(ethiopianToInternationalTime(6, 0, 'pm').time24).toBe('00:00');
      expect(ethiopianToInternationalTime(11, 59, 'pm').time24).toBe('05:59');
    });

    it('parses user input strings in various Ethiopian formats', () => {
      expect(parseEthiopianTimeInput('12:00 am')?.time24).toBe('06:00');
      expect(parseEthiopianTimeInput('2:00 am')?.time24).toBe('08:00');
      expect(parseEthiopianTimeInput('2:00 am ethiopian')?.time24).toBe('08:00');
      expect(parseEthiopianTimeInput('6:00 am')?.time24).toBe('12:00');
      expect(parseEthiopianTimeInput('12:00 pm')?.time24).toBe('18:00');
      expect(parseEthiopianTimeInput('5:00 pm')?.time24).toBe('23:00');
      expect(parseEthiopianTimeInput('6:00 pm')?.time24).toBe('00:00');
      expect(parseEthiopianTimeInput('11:59 pm')?.time24).toBe('05:59');

      // Amharic phrases
      expect(parseEthiopianTimeInput('ጠዋት 2:00')?.time24).toBe('08:00');
      expect(parseEthiopianTimeInput('ከሰዓት 4:30')?.time24).toBe('10:30'); // 4:30 PM is 16:30
      expect(parseEthiopianTimeInput('ማታ 2:00')?.time24).toBe('20:00');
      expect(parseEthiopianTimeInput('ሌሊት 6:00')?.time24).toBe('00:00');
    });
  });

  describe('6. formatDualDateTimeHeader', () => {
    it('produces combined Gregorian and Ethiopian headers', () => {
      const result = formatDualDateTimeHeader('2026-10-18', '08:00', 'Africa/Addis_Ababa');
      expect(result.gregorianHeader).toContain('Oct 18, 2026 · 08:00 EAT');
      expect(result.ethiopianHeader).toContain('Tikimt 8, 2019 E.C. · ጠዋት 2:00 (2:00 Qen)');
      expect(result.combinedLine).toContain('🇪🇹');
    });
  });
});
