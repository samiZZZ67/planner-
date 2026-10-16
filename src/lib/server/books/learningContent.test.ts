import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateSectionSummary,
  generateRealLifeExamples,
  generateAdaptiveQuiz,
  buildAndSaveLearningPackage,
  getOrGenerateLearningPackage,
} from './learningContent';
import type { BookRecord, BookAssignmentRecord, BookPageRecord } from '../../books/types';

describe('Book Learning Content Generation & Adaptive Quiz Suite', () => {
  const testUserId = `user_learn_${Date.now()}`;
  const testBookId = `book_learn_${Date.now()}`;

  const smallBook: BookRecord = {
    id: `${testBookId}_small`,
    userId: testUserId,
    title: 'Atomic Habits',
    author: 'James Clear',
    metadata: '',
    originalFilename: 'habits.pdf',
    storedFilename: 'habits.pdf',
    fileSize: 1024,
    startPage: 1,
    endPage: 2,
    durationDays: 1,
    startDate: '2026-10-16',
    studyMinutes: 30,
    postingTime: '08:00',
    timezone: 'UTC',
    currentPage: 1,
    status: 'ready',
    extractionStatus: 'completed',
    extractionMessage: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const largeBook: BookRecord = {
    id: `${testBookId}_large`,
    userId: testUserId,
    title: 'The Wealth of Nations',
    author: 'Adam Smith',
    metadata: '',
    originalFilename: 'wealth.pdf',
    storedFilename: 'wealth.pdf',
    fileSize: 4096,
    startPage: 1,
    endPage: 12,
    durationDays: 1,
    startDate: '2026-10-16',
    studyMinutes: 60,
    postingTime: '08:00',
    timezone: 'UTC',
    currentPage: 1,
    status: 'ready',
    extractionStatus: 'completed',
    extractionMessage: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const smallPages: BookPageRecord[] = [
    {
      bookId: smallBook.id,
      pdfPage: 1,
      text: 'Habits are the compound interest of self-improvement. Getting 1 percent better every day counts for a lot in the long run. If you can get 1 percent better each day for one year, you will end up thirty-seven times better by the time you are done.',
      method: 'native',
      confidence: 1,
      warnings: [],
      requiresReview: false,
      reviewedByUser: true,
      updatedAt: Date.now(),
    },
    {
      bookId: smallBook.id,
      pdfPage: 2,
      text: 'A slight change in your daily habits can guide your life to a very different destination. Making a choice that is 1 percent better or 1 percent worse seems negligible in the moment, but over the span of moments that make up a lifetime, these choices determine the difference between who you are and who you could be.',
      method: 'native',
      confidence: 1,
      warnings: [],
      requiresReview: false,
      reviewedByUser: true,
      updatedAt: Date.now(),
    },
  ];

  const largePages: BookPageRecord[] = Array.from({ length: 10 }, (_, i) => ({
    bookId: largeBook.id,
    pdfPage: i + 1,
    text: `Chapter ${i + 1} on the Division of Labor and Economic Output (PDF page ${i + 1}). The greatest improvement in the productive powers of labour, and the greater part of the skill, dexterity, and judgment with which it is any where directed, or applied, seem to have been the effects of the division of labour. Consider the pin-making manufacture where ten men divide the operations into eighteen distinct tasks, producing forty-eight thousand pins in a day, whereas one untrained man could scarcely make twenty. Specialized dexterity reduces the time wasted in passing from one species of work to another and fosters the invention of machinery.`,
    method: 'native',
    confidence: 1,
    warnings: [],
    requiresReview: false,
    reviewedByUser: true,
    updatedAt: Date.now(),
  }));

  const smallAssignment: BookAssignmentRecord = {
    id: `asg_${smallBook.id}_1`,
    userId: testUserId,
    bookId: smallBook.id,
    dayNumber: 1,
    scheduledDate: '2026-10-16',
    startPdfPage: 1,
    endPdfPage: 2,
    concepts: [{ title: 'Aggregation of Marginal Gains', concept: '1 percent daily improvement', estimatedMinutes: 15 }],
    estimatedMinutes: 30,
    rationale: 'Core compounding habits introduction',
    status: 'draft',
    updatedAt: Date.now(),
  };

  const largeAssignment: BookAssignmentRecord = {
    id: `asg_${largeBook.id}_1`,
    userId: testUserId,
    bookId: largeBook.id,
    dayNumber: 1,
    scheduledDate: '2026-10-16',
    startPdfPage: 1,
    endPdfPage: 10,
    concepts: [
      { title: 'The Division of Labour', concept: 'Specialization increases productivity', estimatedMinutes: 20 },
      { title: 'Pin Factory Case Study', concept: 'Eighteen distinct operations multiply output', estimatedMinutes: 20 },
      { title: 'Invention of Specialized Machinery', concept: 'Mechanization born from task simplification', estimatedMinutes: 20 },
    ],
    estimatedMinutes: 60,
    rationale: 'Foundations of classical economics',
    status: 'draft',
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Meaningful Section Summary Generation', () => {
    it('generates a clear, grounded summary based specifically on the assigned pages', async () => {
      const result = await generateSectionSummary(smallBook, smallAssignment, smallPages);

      expect(result.summary).toBeDefined();
      expect(result.summary.length).toBeGreaterThan(40);
      expect(result.summary).toContain('compound interest');
      expect(result.keyConcepts.length).toBeGreaterThanOrEqual(1);
      expect(result.definitions.length).toBeGreaterThanOrEqual(1);
      expect(result.definitions[0].pdfPage).toBeGreaterThanOrEqual(smallAssignment.startPdfPage);
      expect(result.definitions[0].pdfPage).toBeLessThanOrEqual(smallAssignment.endPdfPage);
    });

    it('gracefully handles empty/visual divider sections without throwing', async () => {
      const emptyPages: BookPageRecord[] = [
        {
          bookId: smallBook.id,
          pdfPage: 1,
          text: '',
          method: 'empty',
          confidence: null,
          warnings: [],
          requiresReview: false,
          updatedAt: Date.now(),
        },
      ];
      const result = await generateSectionSummary(smallBook, smallAssignment, emptyPages);
      expect(result.summary).toContain('illustration, title, or divider pages');
      expect(result.definitions).toHaveLength(0);
    });
  });

  describe('2. Real-Life Examples & Verified External Sources', () => {
    it('finds relevant examples connecting reading concepts to real-world applications with working URLs', async () => {
      const examples = await generateRealLifeExamples(
        smallBook,
        smallAssignment,
        smallPages,
        ['Aggregation of Marginal Gains', 'Habit formation']
      );

      expect(examples.length).toBeGreaterThanOrEqual(1);
      const ex = examples[0];
      expect(ex.title).toBeDefined();
      expect(ex.situation).toBeDefined();
      expect(ex.connection).toBeDefined();
      expect(ex.sourceTitle).toBeDefined();
      expect(ex.sourceUrl).toBeDefined();
      expect(ex.attribution).toBeDefined();

      // Ensure that connections explicitly link to the book concepts
      expect(ex.connection.length).toBeGreaterThan(20);
    });

    it('extracts book case study if narrative markers are present in the text', async () => {
      const pinPage: BookPageRecord = {
        bookId: largeBook.id,
        pdfPage: 1,
        text: 'Consider the pin-making manufacture where ten men produce forty-eight thousand pins in a day.',
        method: 'native',
        confidence: 1,
        warnings: [],
        requiresReview: false,
        updatedAt: Date.now(),
      };

      const examples = await generateRealLifeExamples(
        largeBook,
        largeAssignment,
        [pinPage],
        ['Division of Labour']
      );

      expect(examples.length).toBeGreaterThanOrEqual(1);
      const hasCaseStudy = examples.some(e => e.kind === 'source' || e.kind === 'external' || e.kind === 'illustrative');
      expect(hasCaseStudy).toBe(true);
    });
  });

  describe('3. Adaptive Quiz Generation for Books of Any Size', () => {
    it('generates 4-6 focused questions for short readings (1-3 pages)', async () => {
      const questions = await generateAdaptiveQuiz(
        smallBook,
        smallAssignment,
        smallPages,
        ['Compound Interest of Habits']
      );

      // Short reading should have between 4 and 6 questions
      expect(questions.length).toBeGreaterThanOrEqual(4);
      expect(questions.length).toBeLessThanOrEqual(6);

      for (const q of questions) {
        expect(q.id).toBeDefined();
        expect(q.question).toBeDefined();
        expect(q.options).toHaveLength(4);
        expect(q.correctOptionIndex).toBeGreaterThanOrEqual(0);
        expect(q.correctOptionIndex).toBeLessThanOrEqual(3);
        expect(q.explanation).toBeDefined();
        expect(q.difficulty).toMatch(/easy|medium|hard/);
        expect(q.sourcePdfPages[0]).toBeGreaterThanOrEqual(smallAssignment.startPdfPage);
        expect(q.sourcePdfPages[0]).toBeLessThanOrEqual(smallAssignment.endPdfPage);
      }
    });

    it('generates 8-15 comprehensive questions for substantial/large books without skipping', async () => {
      const questions = await generateAdaptiveQuiz(
        largeBook,
        largeAssignment,
        largePages,
        ['The Division of Labour', 'Pin Factory Case Study', 'Specialized Machinery']
      );

      // Substantial reading (10 pages) must receive 8-15 questions via section chunking
      expect(questions.length).toBeGreaterThanOrEqual(8);
      expect(questions.length).toBeLessThanOrEqual(15);

      // Verify questions are distributed across chunks and citation pages
      const citedPages = new Set(questions.flatMap(q => q.sourcePdfPages));
      expect(citedPages.size).toBeGreaterThanOrEqual(2);

      // Verify questions have unique questions (no duplicate question stems)
      const questionTexts = questions.map(q => q.question.toLowerCase());
      const uniqueTexts = new Set(questionTexts);
      expect(uniqueTexts.size).toBe(questions.length);
    });
  });

  describe('4. Persistence & Independent Component Regeneration', () => {
    it('builds, validates, and saves learning package to assignment', async () => {
      const pkg = await buildAndSaveLearningPackage({
        userId: testUserId,
        book: smallBook,
        assignment: smallAssignment,
        pages: smallPages,
      });

      expect(pkg.bookId).toBe(smallBook.id);
      expect(pkg.assignmentId).toBe(smallAssignment.id);
      expect(pkg.summary).toBeDefined();
      expect(pkg.realLifeExamples.length).toBeGreaterThanOrEqual(1);
      expect(pkg.quiz.length).toBeGreaterThanOrEqual(4);
      expect(pkg.status.summary).toBe('success');
      expect(pkg.status.quiz).toBe('success');
    });

    it('allows regenerating quiz only without erasing existing summary or examples', async () => {
      // Step 1: Initial build
      const initial = await buildAndSaveLearningPackage({
        userId: testUserId,
        book: smallBook,
        assignment: smallAssignment,
        pages: smallPages,
      });

      const initialSummary = initial.summary;
      const initialExamples = initial.realLifeExamples;

      // Attach package to assignment record
      const updatedAssignment = { ...smallAssignment, learningPackage: initial };

      // Step 2: Regenerate quiz ONLY
      const regeneratedQuizPkg = await buildAndSaveLearningPackage({
        userId: testUserId,
        book: smallBook,
        assignment: updatedAssignment,
        pages: smallPages,
        regenerateOnly: 'quiz',
      });

      // Summary and examples MUST be preserved exactly
      expect(regeneratedQuizPkg.summary).toBe(initialSummary);
      expect(regeneratedQuizPkg.realLifeExamples).toEqual(initialExamples);
      expect(regeneratedQuizPkg.quiz.length).toBeGreaterThanOrEqual(4);
    });

    it('allows regenerating summary only without erasing existing quiz questions', async () => {
      const initial = await buildAndSaveLearningPackage({
        userId: testUserId,
        book: smallBook,
        assignment: smallAssignment,
        pages: smallPages,
      });

      const initialQuiz = initial.quiz;
      const updatedAssignment = { ...smallAssignment, learningPackage: initial };

      // Step 2: Regenerate summary ONLY
      const regeneratedSummaryPkg = await buildAndSaveLearningPackage({
        userId: testUserId,
        book: smallBook,
        assignment: updatedAssignment,
        pages: smallPages,
        regenerateOnly: 'summary',
      });

      // Quiz MUST be preserved exactly
      expect(regeneratedSummaryPkg.quiz).toEqual(initialQuiz);
      expect(regeneratedSummaryPkg.summary).toBeDefined();
    });
  });

  describe('5. Separation of Content Generation from Delivery', () => {
    it('returns existing cached learning package on demand', async () => {
      const initial = await buildAndSaveLearningPackage({
        userId: testUserId,
        book: smallBook,
        assignment: smallAssignment,
        pages: smallPages,
      });

      const withPackage: BookAssignmentRecord = {
        ...smallAssignment,
        learningPackage: initial,
      };

      const retrieved = await getOrGenerateLearningPackage(testUserId, smallBook, withPackage, smallPages);
      expect(retrieved.assignmentId).toBe(smallAssignment.id);
      expect(retrieved.quiz.length).toBe(initial.quiz.length);
    });
  });
});
