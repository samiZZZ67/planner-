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
});
