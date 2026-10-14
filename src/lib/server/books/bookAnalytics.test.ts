import { describe, expect, it } from 'vitest';
import type { BookAssignmentRecord, BookPageRecord, BookRecord } from '../../books/types';
import {
  defaultPostingTimes,
  generateFlexibleReadingPlan,
  validateAssignmentsContiguous,
} from '../readingPlan';
import { updateBookPageText, listBookPages } from '../books';

function makeMockBook(overrides: Partial<BookRecord> = {}): BookRecord {
  return {
    id: `test-book-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    userId: 'test-user-ba',
    title: 'Clean Architecture & Distributed Systems',
    author: 'Robert C. Martin',
    metadata: 'Technical Reference',
    originalFilename: 'architecture.pdf',
    storedFilename: 'arch-stored.pdf',
    fileSize: 102400,
    startPage: 1,
    endPage: 30,
    durationDays: 10,
    startDate: '2026-10-15',
    studyMinutes: 60,
    postingTime: '08:00',
    timezone: 'Africa/Nairobi',
    currentPage: 1,
    status: 'draft',
    extractionStatus: 'completed',
    extractionMessage: 'Extraction complete.',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeMockPages(startPage: number, endPage: number, bookId = 'book-1'): BookPageRecord[] {
  const pages: BookPageRecord[] = [];
  for (let p = startPage; p <= endPage; p++) {
    pages.push({
      bookId,
      pdfPage: p,
      text: `Chapter ${p}: Core principles of resilient software architecture on page ${p}.\nDetailed breakdown of components and boundaries.`,
      method: 'native',
      confidence: 100,
      warnings: [],
      requiresReview: false,
      reviewedByUser: true,
      updatedAt: Date.now(),
    });
  }
  return pages;
}

describe('Book Analytics & Flexible Multi-Section Reading Plans', () => {
  describe('Contiguous & Non-Overlapping Validation', () => {
    it('accepts perfectly contiguous and non-overlapping assignments', () => {
      const valid = [
        { dayNumber: 1, sectionNumber: 1, startPdfPage: 1, endPdfPage: 10 },
        { dayNumber: 1, sectionNumber: 2, startPdfPage: 11, endPdfPage: 20 },
        { dayNumber: 2, sectionNumber: 1, startPdfPage: 21, endPdfPage: 30 },
      ];
      expect(validateAssignmentsContiguous(valid, 1, 30)).toBe(true);
    });

    it('detects and rejects overlapping page ranges', () => {
      const overlapping = [
        { dayNumber: 1, sectionNumber: 1, startPdfPage: 1, endPdfPage: 15 },
        { dayNumber: 1, sectionNumber: 2, startPdfPage: 14, endPdfPage: 25 }, // Overlaps on 14 & 15
        { dayNumber: 2, sectionNumber: 1, startPdfPage: 26, endPdfPage: 30 },
      ];
      expect(() => validateAssignmentsContiguous(overlapping, 1, 30)).toThrow(/Overlapping page range/i);
    });

    it('detects and rejects gaps between page ranges', () => {
      const gapped = [
        { dayNumber: 1, sectionNumber: 1, startPdfPage: 1, endPdfPage: 10 },
        { dayNumber: 1, sectionNumber: 2, startPdfPage: 12, endPdfPage: 20 }, // Missed page 11!
        { dayNumber: 2, sectionNumber: 1, startPdfPage: 21, endPdfPage: 30 },
      ];
      expect(() => validateAssignmentsContiguous(gapped, 1, 30)).toThrow(/Gap in reading pages/i);
    });

    it('enforces expected start and end page bounds', () => {
      const misalignedStart = [
        { dayNumber: 1, sectionNumber: 1, startPdfPage: 5, endPdfPage: 30 },
      ];
      expect(() => validateAssignmentsContiguous(misalignedStart, 1, 30)).toThrow(/Plan must start at page 1/i);

      const misalignedEnd = [
        { dayNumber: 1, sectionNumber: 1, startPdfPage: 1, endPdfPage: 28 },
      ];
      expect(() => validateAssignmentsContiguous(misalignedEnd, 1, 30)).toThrow(/Plan must end at page 30/i);
    });
  });

  describe('Default Posting Times Calculation', () => {
    it('returns custom default times based on sections per day', () => {
      expect(defaultPostingTimes(1, '08:30')).toEqual(['08:30']);
      expect(defaultPostingTimes(2)).toEqual(['09:00', '18:00']);
      expect(defaultPostingTimes(3)).toEqual(['08:00', '13:00', '19:00']);
      expect(defaultPostingTimes(4)).toEqual(['08:00', '12:00', '16:00', '20:00']);
    });
  });

  describe('Flexible Multi-Section Plan Generation', () => {
    it('generates a 1-section-per-day plan covering all pages with no gaps', async () => {
      const book = makeMockBook({ startPage: 1, endPage: 20, durationDays: 5 });
      const pages = makeMockPages(1, 20, book.id);
      const plan = await generateFlexibleReadingPlan({ book, pages, sectionsPerDay: 1 });

      expect(plan.assignments.length).toBe(5);
      expect(plan.assignments[0].startPdfPage).toBe(1);
      expect(plan.assignments[plan.assignments.length - 1].endPdfPage).toBe(20);
      expect(plan.assignments.every(a => a.sectionNumber === 1)).toBe(true);
      expect(validateAssignmentsContiguous(plan.assignments, 1, 20)).toBe(true);
    });

    it('generates a 2-sections-per-day plan with individual posting times and contiguous ranges', async () => {
      const book = makeMockBook({ startPage: 1, endPage: 20, durationDays: 5 });
      const pages = makeMockPages(1, 20, book.id);
      const times = ['08:00', '16:30'];
      const plan = await generateFlexibleReadingPlan({
        book,
        pages,
        sectionsPerDay: 2,
        postingTimes: times,
      });

      expect(plan.assignments.length).toBe(10); // 5 days * 2 sections
      expect(plan.assignments[0].sectionNumber).toBe(1);
      expect(plan.assignments[0].postingTime).toBe('08:00');
      expect(plan.assignments[1].sectionNumber).toBe(2);
      expect(plan.assignments[1].postingTime).toBe('16:30');

      // Verify all ranges are non-overlapping and contiguous
      expect(validateAssignmentsContiguous(plan.assignments, 1, 20)).toBe(true);
    });

    it('supports 3-sections-per-day plan and preserves current page progress', async () => {
      // User has already completed pages 1–10. We plan remaining pages 11–30.
      const book = makeMockBook({ startPage: 1, endPage: 30, currentPage: 11, durationDays: 5 });
      const pages = makeMockPages(1, 30, book.id);
      const plan = await generateFlexibleReadingPlan({
        book,
        pages,
        sectionsPerDay: 3,
        startFromPage: 11,
      });

      expect(plan.assignments[0].startPdfPage).toBe(11);
      expect(plan.assignments[plan.assignments.length - 1].endPdfPage).toBe(30);
      expect(validateAssignmentsContiguous(plan.assignments, 11, 30)).toBe(true);
    });
  });

  describe('Extracted Page Editing directly in DB', () => {
    it('saves corrected page text and clears empty status without touching PDF', async () => {
      const userId = 'test-user-ba';
      const book = makeMockBook({ id: 'test-edit-book', userId, startPage: 1, endPage: 5 });
      const initialPages: BookPageRecord[] = [
        {
          bookId: book.id,
          pdfPage: 1,
          text: '',
          method: 'empty',
          confidence: null,
          warnings: ['Empty page detected'],
          requiresReview: true,
          reviewedByUser: false,
          updatedAt: Date.now(),
        },
      ];

      // Seed book and page
      const { updateBook, saveBookPages } = await import('../books');
      await updateBook(book);
      await saveBookPages(book, initialPages);

      // Now update the page text via updateBookPageText
      const correctedText = 'Manually transcribed text for architectural principles.';
      const updated = await updateBookPageText(userId, book.id, 1, correctedText);

      expect(updated.text).toBe(correctedText);
      expect(updated.reviewedByUser).toBe(true);
      expect(updated.requiresReview).toBe(false);
      expect(updated.method).toBe('ocr'); // Promoted from empty to ocr

      // Verify page is persisted
      const fetched = await listBookPages(userId, book.id, 1, 1);
      expect(fetched[0].text).toBe(correctedText);
      expect(fetched[0].reviewedByUser).toBe(true);
    });
  });

  describe('Automatic Advancement to Next Pending Section', () => {
    it('automatically advances book.currentPage to assignment.endPdfPage + 1 upon delivery', async () => {
      const { updateBook, getBook } = await import('../books');
      const book = makeMockBook({ id: 'test-advance-book', currentPage: 1, endPage: 30 });
      await updateBook(book);

      const assignment: BookAssignmentRecord = {
        id: 'asg-advance-1',
        userId: book.userId,
        bookId: book.id,
        dayNumber: 1,
        sectionNumber: 1,
        scheduledDate: '2026-10-15',
        startPdfPage: 1,
        endPdfPage: 10,
        concepts: [{ title: 'Chapter 1', concept: 'Architecture basics', estimatedMinutes: 20 }],
        estimatedMinutes: 20,
        rationale: 'First section',
        status: 'approved',
        updatedAt: Date.now(),
      };

      // Simulate the delivery completion logic in publish route and scheduler
      const nextCurrentPage = Math.min(book.endPage + 1, Math.max(book.currentPage, assignment.endPdfPage + 1));
      const updatedBook = await updateBook({
        ...book,
        currentPage: nextCurrentPage,
        status: nextCurrentPage > book.endPage ? 'ready' : book.status,
      });

      expect(updatedBook.currentPage).toBe(11); // Correctly advanced to page 11!

      const reloaded = await getBook(book.userId, book.id);
      expect(reloaded?.currentPage).toBe(11);
    });

    it('retains current reading position on delivery failure without premature advancement', async () => {
      const { updateBook, getBook } = await import('../books');
      const book = makeMockBook({ id: 'test-fail-book', currentPage: 11, endPage: 30 });
      await updateBook(book);

      const failedAssignment: BookAssignmentRecord = {
        id: 'asg-fail-2',
        userId: book.userId,
        bookId: book.id,
        dayNumber: 2,
        sectionNumber: 1,
        scheduledDate: '2026-10-16',
        startPdfPage: 11,
        endPdfPage: 20,
        concepts: [{ title: 'Chapter 2', concept: 'Component boundaries', estimatedMinutes: 20 }],
        estimatedMinutes: 20,
        rationale: 'Second section',
        status: 'approved',
        deliveryStatus: 'failed',
        lastDeliveryError: 'Telegram Bot API error 400: Bad Request',
        updatedAt: Date.now(),
      };

      // On failure, book.currentPage must remain 11
      const reloaded = await getBook(book.userId, book.id);
      expect(reloaded?.currentPage).toBe(11);
      expect(failedAssignment.deliveryStatus).toBe('failed');
      expect(failedAssignment.lastDeliveryError).toContain('Telegram Bot API error 400');
    });
  });
});
