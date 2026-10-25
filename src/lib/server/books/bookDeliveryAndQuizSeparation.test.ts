import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BookRecord, BookAssignmentRecord, BookPageRecord } from '../../../lib/books/types';
import {
  resolveNextDeliveryForBook,
  resolveAllNextBookDeliveries,
  resolveBookScheduleSummary,
} from '../../date/bookDeliverySchedule';
import {
  shuffleOptionsWithKey,
  distributeOptionsBalanced,
} from './quizShuffle';
import { generateDeterministicQuestions } from './bookQuiz';
import { formatReadingAssignment, formatLoadPlanPages } from '../telegram';

describe('Book Delivery Separation, Quiz Exit, and Quiz Quality Suite', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const book1: BookRecord = {
    id: 'book-atomic-habits',
    userId: 'user-test',
    title: 'Atomic Habits',
    author: 'James Clear',
    metadata: '',
    originalFilename: 'atomic_habits.pdf',
    storedFilename: 'atomic_habits.pdf',
    fileSize: 10240,
    startPage: 1,
    endPage: 30,
    durationDays: 10,
    startDate: '2026-10-26',
    studyMinutes: 30,
    postingTime: '08:00',
    timezone: 'Africa/Addis_Ababa',
    currentPage: 1,
    status: 'ready',
    extractionStatus: 'completed',
    extractionMessage: '',
    autoPublish: true,
    automationStatus: 'ready',
    createdAt: 1729000000000,
    updatedAt: 1729000000000,
  };

  const book2: BookRecord = {
    id: 'book-deep-work',
    userId: 'user-test',
    title: 'Deep Work',
    author: 'Cal Newport',
    metadata: '',
    originalFilename: 'deep_work.pdf',
    storedFilename: 'deep_work.pdf',
    fileSize: 20480,
    startPage: 1,
    endPage: 50,
    durationDays: 10,
    startDate: '2026-10-26',
    studyMinutes: 45,
    postingTime: '18:00',
    timezone: 'Africa/Addis_Ababa',
    currentPage: 1,
    status: 'ready',
    extractionStatus: 'completed',
    extractionMessage: '',
    autoPublish: true,
    automationStatus: 'ready',
    createdAt: 1729000000000,
    updatedAt: 1729000000000,
  };

  const book1Assignments: BookAssignmentRecord[] = [
    {
      id: 'assign-ah-1',
      userId: 'user-test',
      bookId: book1.id,
      dayNumber: 1,
      sectionNumber: 1,
      startPdfPage: 1,
      endPdfPage: 15,
      scheduledDate: '2026-10-26',
      postingTime: '08:00',
      status: 'approved',
      deliveryStatus: 'scheduled',
      concepts: [{ title: 'The Aggregation of Marginal Gains', concept: '1% improvement', estimatedMinutes: 10 }],
      estimatedMinutes: 30,
      rationale: 'Core foundation',
      updatedAt: 1729000000000,
    },
  ];

  const book2Assignments: BookAssignmentRecord[] = [
    {
      id: 'assign-dw-1',
      userId: 'user-test',
      bookId: book2.id,
      dayNumber: 1,
      sectionNumber: 1,
      startPdfPage: 1,
      endPdfPage: 25,
      scheduledDate: '2026-10-26',
      postingTime: '18:00',
      status: 'approved',
      deliveryStatus: 'scheduled',
      concepts: [{ title: 'Deep Work Hypothesis', concept: 'Focus in a distracted world', estimatedMinutes: 15 }],
      estimatedMinutes: 45,
      rationale: 'Core hypothesis',
      updatedAt: 1729000000000,
    },
  ];

  describe('1. Multi-Book Schedule Separation', () => {
    it('resolves independent next deliveries for each book with correct titles, dates, and times', () => {
      const nowMs = new Date('2026-10-25T12:00:00Z').getTime();

      const deliveryBook1 = resolveNextDeliveryForBook(book1, book1Assignments, nowMs);
      const deliveryBook2 = resolveNextDeliveryForBook(book2, book2Assignments, nowMs);

      // Book 1: Atomic Habits at 8:00 AM
      expect(deliveryBook1).not.toBeNull();
      expect(deliveryBook1?.bookTitle).toBe('Atomic Habits');
      expect(deliveryBook1?.scheduledDate).toBe('2026-10-26');
      expect(deliveryBook1?.postingTime).toBe('08:00');
      expect(deliveryBook1?.formattedTime12h).toContain('8:00 AM');

      // Book 2: Deep Work at 6:00 PM
      expect(deliveryBook2).not.toBeNull();
      expect(deliveryBook2?.bookTitle).toBe('Deep Work');
      expect(deliveryBook2?.scheduledDate).toBe('2026-10-26');
      expect(deliveryBook2?.postingTime).toBe('18:00');
      expect(deliveryBook2?.formattedTime12h).toContain('6:00 PM');

      // All deliveries across books
      const allDeliveries = resolveAllNextBookDeliveries([book1, book2], {
        [book1.id]: book1Assignments,
        [book2.id]: book2Assignments,
      }, nowMs);

      expect(allDeliveries).toHaveLength(2);
      expect(allDeliveries[0].bookTitle).toBe('Atomic Habits');
      expect(allDeliveries[1].bookTitle).toBe('Deep Work');
    });

    it('modifying or rescheduling one book does not overwrite or affect the other book', () => {
      const nowMs = new Date('2026-10-25T12:00:00Z').getTime();

      // Reschedule Book 1 to October 28 at 09:30 AM
      const modifiedBook1Assignments: BookAssignmentRecord[] = [
        {
          ...book1Assignments[0],
          scheduledDate: '2026-10-28',
          postingTime: '09:30',
        },
      ];

      const deliveryBook1 = resolveNextDeliveryForBook(book1, modifiedBook1Assignments, nowMs);
      const deliveryBook2 = resolveNextDeliveryForBook(book2, book2Assignments, nowMs);

      expect(deliveryBook1?.scheduledDate).toBe('2026-10-28');
      expect(deliveryBook1?.postingTime).toBe('09:30');

      // Book 2 MUST remain completely intact at October 26, 18:00
      expect(deliveryBook2?.scheduledDate).toBe('2026-10-26');
      expect(deliveryBook2?.postingTime).toBe('18:00');
      expect(deliveryBook2?.bookTitle).toBe('Deep Work');
    });

    it('shows appropriate completed status when a book has finished, and never shows another books delivery', () => {
      const nowMs = new Date('2026-10-25T12:00:00Z').getTime();

      const completedBook1Assignments: BookAssignmentRecord[] = [
        {
          ...book1Assignments[0],
          status: 'completed',
          deliveryStatus: 'sent',
        },
      ];

      const summaryBook1 = resolveBookScheduleSummary(
        { ...book1, currentPage: 31 },
        completedBook1Assignments,
        nowMs
      );

      const summaryBook2 = resolveBookScheduleSummary(
        book2,
        book2Assignments,
        nowMs
      );

      expect(summaryBook1.nextDelivery).toBeNull();
      expect(summaryBook1.status).toBe('completed');
      expect(summaryBook1.statusText).toContain('All reading sections delivered');

      expect(summaryBook2.nextDelivery).not.toBeNull();
      expect(summaryBook2.nextDelivery?.bookTitle).toBe('Deep Work');
    });
  });

  describe('2. Telegram Zero-Quiz Rule', () => {
    it('ensures formatReadingAssignment contains zero quiz links, questions, options, or polls', () => {
      const samplePages: BookPageRecord[] = [
        {
          bookId: book2.id,
          pdfPage: 1,
          text: 'Deep work is the ability to focus without distraction on a cognitively demanding task.',
          method: 'native',
          confidence: 1,
          warnings: [],
          requiresReview: false,
          updatedAt: 1729000000000,
        },
      ];

      const singlePageAssignment: BookAssignmentRecord = {
        ...book2Assignments[0],
        startPdfPage: 1,
        endPdfPage: 1,
        status: 'approved',
        studyNotes: {
          summary: 'Deep work focus summary',
          keyConcepts: ['Deep Work Hypothesis'],
          definitions: [],
          example: {
            situation: 'Focusing on complex problem',
            conceptInAction: 'Eliminating notifications',
            lesson: 'Deep focus delivers breakthrough results',
            sourceDisclosure: 'PDF page 1',
          },
          questions: [],
          notes: '',
          generatedByModel: 'gpt-4o',
          generatedAt: 1729000000000,
        },
      };

      const parts = formatReadingAssignment(book2, singlePageAssignment, samplePages);
      const fullText = parts.join('\n');

      expect(fullText).not.toContain('/quiz');
      expect(fullText).not.toContain('🎯');
      expect(fullText).not.toContain('Interactive Practice Quiz');
      expect(fullText).not.toContain('Take Today\'s Reading Quiz');
      expect(fullText).not.toContain('Question 1:');
    });

    it('ensures formatLoadPlanPages contains zero quiz links, questions, options, or polls', () => {
      const samplePages: BookPageRecord[] = [
        {
          bookId: book2.id,
          pdfPage: 1,
          text: 'Deep work is the ability to focus without distraction on a cognitively demanding task.',
          method: 'native',
          confidence: 1,
          warnings: [],
          requiresReview: false,
          updatedAt: 1729000000000,
        },
      ];

      const parts = formatLoadPlanPages(book2, book2Assignments[0], samplePages);
      const fullText = parts.join('\n');

      expect(fullText).not.toContain('/quiz');
      expect(fullText).not.toContain('🎯');
      expect(fullText).not.toContain('Interactive Practice Quiz');
      expect(fullText).not.toContain('Take Today\'s Reading Quiz');
    });
  });

  describe('3. Quiz Option Shuffling & Balanced Answer Key Distribution', () => {
    it('distributes correct answers evenly across A (0), B (1), C (2), and D (3) across questions', () => {
      const correctCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
      const distractors = ['Distractor 1', 'Distractor 2', 'Distractor 3'];
      const correctAns = 'The Correct Answer';

      for (let i = 0; i < 100; i++) {
        const { options, correctIndex } = distributeOptionsBalanced(correctAns, distractors, i);

        expect(options[correctIndex]).toBe(correctAns);
        expect(correctIndex).toBeGreaterThanOrEqual(0);
        expect(correctIndex).toBeLessThanOrEqual(3);
        correctCounts[correctIndex as 0 | 1 | 2 | 3]++;
      }

      expect(correctCounts[0]).toBeGreaterThan(10);
      expect(correctCounts[1]).toBeGreaterThan(10);
      expect(correctCounts[2]).toBeGreaterThan(10);
      expect(correctCounts[3]).toBeGreaterThan(10);
    });

    it('maintains perfect synchronization between options and correctIndex during Fisher-Yates shuffle', () => {
      const initialOptions = ['Alpha', 'Beta', 'Gamma', 'Delta'];
      const initialCorrectIndex = 1;

      const answerDistribution = { 0: 0, 1: 0, 2: 0, 3: 0 };

      for (let i = 0; i < 200; i++) {
        const { options, correctIndex } = shuffleOptionsWithKey(initialOptions, initialCorrectIndex);

        expect(options[correctIndex]).toBe('Beta');
        expect(options).toHaveLength(4);
        expect(new Set(options).size).toBe(4);

        answerDistribution[correctIndex as 0 | 1 | 2 | 3]++;
      }

      expect(answerDistribution[0]).toBeGreaterThan(20);
      expect(answerDistribution[1]).toBeGreaterThan(20);
      expect(answerDistribution[2]).toBeGreaterThan(20);
      expect(answerDistribution[3]).toBeGreaterThan(20);
    });

    it('generates questions covering the whole range of book pages with balanced answers in deterministic mode', () => {
      const pages: BookPageRecord[] = [
        { bookId: book1.id, pdfPage: 1, text: 'Chapter 1: The foundation of habits starts here in deliberate awareness.', method: 'native', confidence: 1, warnings: [], requiresReview: false, updatedAt: 1729000000000 },
        { bookId: book1.id, pdfPage: 5, text: 'Chapter 2: The cue triggers a craving which motivates an action response.', method: 'native', confidence: 1, warnings: [], requiresReview: false, updatedAt: 1729000000000 },
        { bookId: book1.id, pdfPage: 10, text: 'Chapter 3: Make it obvious, make it attractive, make it easy, make it satisfying.', method: 'native', confidence: 1, warnings: [], requiresReview: false, updatedAt: 1729000000000 },
        { bookId: book1.id, pdfPage: 15, text: 'Chapter 4: The ultimate form of intrinsic motivation is when a habit becomes identity.', method: 'native', confidence: 1, warnings: [], requiresReview: false, updatedAt: 1729000000000 },
      ];

      const questions = generateDeterministicQuestions(
        book1,
        pages,
        1,
        15,
        4
      );

      expect(questions).toHaveLength(4);

      // Verify page coverage across the range
      const coveredPages = questions.map(q => q.definition.pdfPage);
      expect(coveredPages).toContain(1);
      expect(coveredPages.some(p => typeof p === 'number' && p > 1)).toBe(true);

      for (const q of questions) {
        expect(q.options[q.correctOptionId]).toBeDefined();
        expect(q.options[q.correctOptionId].length).toBeGreaterThan(0);
      }

      const indices = questions.map(q => q.correctOptionId);
      const uniqueIndices = new Set(indices);
      expect(uniqueIndices.size).toBeGreaterThan(1);
    });
  });
});
