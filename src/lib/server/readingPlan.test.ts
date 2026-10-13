import { describe, expect, it } from 'vitest';
import type { BookPageRecord } from '../books/types';
import { validateChunkSections, validateDayGroups } from './readingPlan';

function page(pdfPage: number): BookPageRecord {
  return { bookId: 'book', pdfPage, text: `Page ${pdfPage} original text`, method: 'native', confidence: null, warnings: [], requiresReview: false, updatedAt: 1 };
}

describe('concept reading plan validation', () => {
  it('requires concept sections to cover the supplied pages once, in order', () => {
    const sections = validateChunkSections({ sections: [
      { startPage: 25, endPage: 26, title: 'Principle', concept: 'A coherent opening concept.', estimatedMinutes: 25 },
      { startPage: 27, endPage: 27, title: 'Example', concept: 'The following worked example.', estimatedMinutes: 15 },
    ] }, [page(25), page(26), page(27)], 1);
    expect(sections.map(section => [section.id, section.startPage, section.endPage])).toEqual([
      ['section-1', 25, 26], ['section-2', 27, 27],
    ]);
    expect(() => validateChunkSections({ sections: [
      { startPage: 25, endPage: 25, title: 'First', concept: 'One.', estimatedMinutes: 10 },
      { startPage: 27, endPage: 27, title: 'Last', concept: 'Three.', estimatedMinutes: 10 },
    ] }, [page(25), page(26), page(27)], 1)).toThrow(/gap, overlap/);
  });

  it('groups contiguous concepts without losing, reordering, or duplicating page ranges', () => {
    const sections = validateChunkSections({ sections: [
      { startPage: 25, endPage: 26, title: 'Foundation', concept: 'Core definitions.', estimatedMinutes: 30 },
      { startPage: 27, endPage: 27, title: 'Application', concept: 'A distinct application.', estimatedMinutes: 20 },
    ] }, [page(25), page(26), page(27)], 1);
    const result = validateDayGroups({ days: [
      { dayNumber: 1, sectionIds: ['section-1'], rationale: 'The definitions form a complete first reading.' },
      { dayNumber: 2, sectionIds: ['section-2'], rationale: 'The application is a separate short concept.' },
    ] }, sections, 2, 60);
    expect(result.days.map((day: { dayNumber: number; sections: Array<{ startPage: number; endPage: number }> }) => [day.dayNumber, day.sections[0].startPage, day.sections[0].endPage])).toEqual([[1, 25, 26], [2, 27, 27]]);
    expect(result.issues).toEqual([]);
    expect(() => validateDayGroups({ days: [
      { dayNumber: 1, sectionIds: ['section-1'], rationale: 'Opening concept.' },
    ] }, sections, 2, 60)).toThrow(/did not include every concept section/);
  });
});
