import { describe, expect, it } from 'vitest';
import type { BookAssignmentRecord } from '../books/types';
import { validateStudyNotes } from './studyNotes';

const assignment: BookAssignmentRecord = {
  id: 'assignment-1', userId: 'owner', bookId: 'book', dayNumber: 1, scheduledDate: '2026-01-01',
  startPdfPage: 25, endPdfPage: 28,
  concepts: [{ title: 'Decision making', concept: 'Compare choices under uncertainty.', estimatedMinutes: 30 }],
  estimatedMinutes: 30, rationale: 'A complete concept.', status: 'draft', updatedAt: 1,
};

describe('supplementary study notes validation', () => {
  it('accepts only disclosed hypothetical examples and citations inside assigned pages', () => {
    const notes = validateStudyNotes({
      summary: 'The section compares choices under uncertainty.',
      keyConcepts: ['Tradeoffs', 'Evidence'],
      definitions: [{ term: 'Tradeoff', explanation: 'A choice between competing outcomes.', pdfPage: 26 }],
      example: { situation: 'A student chooses a study schedule.', conceptInAction: 'They compare cost and benefit.', lesson: 'State the tradeoff before deciding.', sourceDisclosure: 'Hypothetical scenario, not a verified event.' },
      questions: [
        { question: 'What is a tradeoff?', answer: 'A choice between competing outcomes.', pdfPages: [26] },
        { question: 'What evidence supports the decision?', answer: 'The relevant facts on the page.', pdfPages: [27, 28] },
      ],
      notes: 'Compare options before choosing.',
    }, assignment);
    expect(notes.questions).toHaveLength(2);
    expect(() => validateStudyNotes({ ...notes, example: { ...notes.example, sourceDisclosure: 'A true story.' } }, assignment)).toThrow(/illustrative|hypothetical/i);
    expect(() => validateStudyNotes({ ...notes, questions: [{ ...notes.questions[0], pdfPages: [99] }, notes.questions[1]] }, assignment)).toThrow(/citations/);
  });

  it('generates safe study notes when all pages in assignment are empty/illustration pages', async () => {
    const { generateAssignmentStudyNotes } = await import('./studyNotes');
    const book = {
      id: 'book',
      userId: 'owner',
      title: 'Visual Book',
      author: 'Author',
      metadata: '',
      originalFilename: 'book.pdf',
      storedFilename: 'book.pdf',
      fileSize: 100,
      startPage: 1,
      endPage: 4,
      durationDays: 1,
      startDate: '2026-01-01',
      studyMinutes: 30,
      postingTime: '08:00',
      timezone: 'UTC',
      currentPage: 1,
      status: 'ready' as const,
      extractionStatus: 'completed' as const,
      extractionMessage: '',
      totalPdfPages: 4,
      createdAt: 1,
      updatedAt: 1,
    };
    const emptyPages = [
      { bookId: 'book', pdfPage: 25, text: '', method: 'empty' as const, confidence: null, warnings: [], requiresReview: false, reviewedByUser: false, updatedAt: 1 },
      { bookId: 'book', pdfPage: 26, text: '   ', method: 'empty' as const, confidence: null, warnings: [], requiresReview: false, reviewedByUser: false, updatedAt: 1 },
    ];
    const result = await generateAssignmentStudyNotes({ book, assignment, pages: emptyPages });
    expect(result.studyNotes).toBeDefined();
    expect(result.studyNotes.summary).toContain('illustration, cover, or blank divider pages');
    expect(result.studyNotes.questions).toHaveLength(2);
    expect(result.studyNotes.example.kind).toBe('illustrative');
  });
});
