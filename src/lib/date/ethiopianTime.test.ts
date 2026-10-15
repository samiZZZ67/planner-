import { describe, it, expect } from 'vitest';
import { getEthiopianClock, normalizeTimeString, formatDualDateTimeHeader } from './ethiopianTime';

describe('Ethiopian Time & Traditional Clock Conversion Suite', () => {
  describe('normalizeTimeString', () => {
    it('normalizes various input formats into 24-hour HH:mm', () => {
      expect(normalizeTimeString('8:00')).toBe('08:00');
      expect(normalizeTimeString('08:00')).toBe('08:00');
      expect(normalizeTimeString('8:00 AM')).toBe('08:00');
      expect(normalizeTimeString('8:00 PM')).toBe('20:00');
      expect(normalizeTimeString('8pm')).toBe('20:00');
      expect(normalizeTimeString('2:00 pm')).toBe('14:00');
      expect(normalizeTimeString('12:00 AM')).toBe('00:00');
      expect(normalizeTimeString('12:00 PM')).toBe('12:00');
      expect(normalizeTimeString('20:00:00')).toBe('20:00');
      expect(normalizeTimeString('08:30')).toBe('08:30');
    });
  });

  describe('Traditional Ethiopian 12-hour Clock Conversion', () => {
    it('accurately converts 08:00 EAT (Morning brief default) to 2:00 Qen (ጠዋት 2:00)', () => {
      const clock = getEthiopianClock('08:00', 'Africa/Addis_Ababa', '2026-10-15');
      expect(clock.internationalTime).toBe('08:00 EAT');
      expect(clock.internationalTime12h).toBe('8:00 AM EAT');
      expect(clock.ethiopianHour).toBe(2);
      expect(clock.ethiopianMinute).toBe(0);
      expect(clock.period).toBe('day');
      expect(clock.periodNameAm).toBe('ጠዋት');
      expect(clock.ethiopianTimeStr).toContain('ጠዋት 2:00 (2:00 Qen)');
    });

    it('accurately converts 20:00 EAT / 8:00 PM (Evening brief default) to 2:00 Mata (ማታ 2:00)', () => {
      const clock = getEthiopianClock('20:00', 'Africa/Addis_Ababa', '2026-10-15');
      expect(clock.internationalTime).toBe('20:00 EAT');
      expect(clock.internationalTime12h).toBe('8:00 PM EAT');
      expect(clock.ethiopianHour).toBe(2);
      expect(clock.ethiopianMinute).toBe(0);
      expect(clock.period).toBe('night');
      expect(clock.periodNameAm).toBe('ማታ');
      expect(clock.ethiopianTimeStr).toContain('ማታ 2:00 (2:00 Mata)');
    });

    it('accurately converts sunrise at 06:00 EAT to 12:00 Qen', () => {
      const clock = getEthiopianClock('06:00', 'Africa/Addis_Ababa', '2026-10-15');
      expect(clock.ethiopianHour).toBe(12);
      expect(clock.period).toBe('day');
      expect(clock.periodNameAm).toBe('ጠዋት');
    });

    it('accurately converts sunset at 18:00 EAT to 12:00 Mata', () => {
      const clock = getEthiopianClock('18:00', 'Africa/Addis_Ababa', '2026-10-15');
      expect(clock.ethiopianHour).toBe(12);
      expect(clock.period).toBe('night');
      expect(clock.periodNameAm).toBe('ማታ');
    });

    it('accurately converts 14:30 EAT (2:30 PM) to 8:30 Qen (ከሰዓት 8:30)', () => {
      const clock = getEthiopianClock('14:30', 'Africa/Addis_Ababa', '2026-10-15');
      expect(clock.ethiopianHour).toBe(8);
      expect(clock.ethiopianMinute).toBe(30);
      expect(clock.period).toBe('day');
      expect(clock.periodNameAm).toBe('ከሰዓት');
      expect(clock.ethiopianTimeStr).toContain('ከሰዓት 8:30 (8:30 Qen)');
    });

    it('accurately converts midnight 00:00 EAT to 6:00 Lelit (ሌሊት 6:00)', () => {
      const clock = getEthiopianClock('00:00', 'Africa/Addis_Ababa', '2026-10-15');
      expect(clock.ethiopianHour).toBe(6);
      expect(clock.period).toBe('night');
      expect(clock.periodNameAm).toBe('ሌሊት');
    });
  });

  describe('formatDualDateTimeHeader', () => {
    it('produces combined Gregorian and Ethiopian headers', () => {
      const result = formatDualDateTimeHeader('2026-10-15', '08:00', 'Africa/Addis_Ababa');
      expect(result.gregorianHeader).toContain('Thursday, Oct 15, 2026 · 08:00 EAT');
      expect(result.ethiopianHeader).toContain('E.C. · ጠዋት 2:00 (2:00 Qen)');
      expect(result.combinedLine).toContain('🇪🇹');
    });
  });
});
