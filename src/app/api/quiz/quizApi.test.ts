import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GET as quizGet, POST as quizPost } from './route';
import { GET as lookupGet } from '../books/assignment-lookup/route';
import type { BookRecord, BookAssignmentRecord, BookPageRecord } from '@/lib/books/types';
import { saveBook, saveBookPages, deleteBook } from '@/lib/server/books';
import { updateBookAssignment, replaceDraftAssignments } from '@/lib/server/bookAssignments';

describe('Quiz API & Dedicated Practice Integration Suite', () => {
  const testUserId = `user_quiz_${Date.now()}`;
  const testBookId = `book_quiz_${Date.now()}`;
  const assignmentId = `asg_quiz_${Date.now()}`;

  const book: BookRecord = {
    id: testBookId,
    userId: testUserId,
    title: 'Atomic Habits',
    author: 'James Clear',
    metadata: '',
    originalFilename: 'habits.pdf',
    storedFilename: `${testBookId}.pdf`,
    fileSize: 2048,
    startPage: 10,
    endPage: 15,
    durationDays: 2,
    startDate: '2026-10-25',
    studyMinutes: 30,
    postingTime: '08:00',
    timezone: 'Africa/Addis_Ababa',
    currentPage: 10,
    status: 'ready',
    extractionStatus: 'completed',
    extractionMessage: 'Extracted successfully',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const pages: BookPageRecord[] = [
    {
      bookId: testBookId,
      pdfPage: 10,
      text: 'Habits are the compound interest of self-improvement. The effects of your habits multiply as you repeat them.',
      method: 'native',
      confidence: 1,
      warnings: [],
      requiresReview: false,
      reviewedByUser: true,
      updatedAt: Date.now(),
    },
    {
      bookId: testBookId,
      pdfPage: 11,
      text: 'If you can get 1 percent better each day for one year, you will end up thirty-seven times better by the time you are done.',
      method: 'native',
      confidence: 1,
      warnings: [],
      requiresReview: false,
      reviewedByUser: true,
      updatedAt: Date.now(),
    },
  ];

  const assignment: BookAssignmentRecord = {
    id: assignmentId,
    userId: testUserId,
    bookId: testBookId,
    dayNumber: 1,
    scheduledDate: '2026-10-25',
    startPdfPage: 10,
    endPdfPage: 11,
    concepts: [{ title: 'Aggregation of Marginal Gains', concept: '1% daily improvement', estimatedMinutes: 15 }],
    estimatedMinutes: 30,
    rationale: 'Core compounding habits',
    status: 'approved',
    postingTime: '08:00',
    studyNotes: {
      summary: 'Small daily changes compound into massive long-term results.',
      keyConcepts: ['Aggregation of Marginal Gains', '1% Better Every Day'],
      definitions: [
        { term: 'Habit', explanation: 'A routine or behavior performed regularly and automatically.', pdfPage: 10 },
      ],
      example: {
        kind: 'source',
        situation: 'British Cycling redesigned every tiny detail by 1 percent.',
        conceptInAction: 'Aggregation of marginal gains across bike maintenance and rider ergonomics.',
        lesson: 'Tiny improvements accumulate into world championship results.',
        sourceDisclosure: 'PDF page 11',
        pdfPage: 11,
      },
      questions: [
        { question: 'What is the compounding effect of 1% improvement daily for a year?', answer: '37 times better.', pdfPages: [11] },
      ],
      notes: 'Focus on systems over goals.',
      generatedByModel: 'test',
      generatedAt: Date.now(),
    },
    learningPackage: {
      bookId: testBookId,
      assignmentId,
      startPdfPage: 10,
      endPdfPage: 11,
      summary: 'Small daily changes compound into massive long-term results.',
      keyConcepts: ['Aggregation of Marginal Gains', '1% Better Every Day'],
      definitions: [
        { term: 'Habit', explanation: 'A routine or behavior performed regularly.', pdfPage: 10 },
      ],
      realLifeExamples: [],
      quiz: [
        {
          id: 'q_0',
          question: 'According to PDF page 10, how does the author define habits?',
          options: [
            'The compound interest of self-improvement',
            'Rigid schedules that restrict creativity',
            'Random tasks done intermittently',
          ],
          correctOptionIndex: 0,
          explanation: 'James Clear defines habits as the compound interest of self-improvement on PDF page 10.',
          difficulty: 'easy',
          sourcePdfPages: [10],
        },
        {
          id: 'q_1',
          question: 'What is the mathematical result of getting 1% better each day for one year?',
          options: [
            'You become 2 times better',
            'You end up thirty-seven times better',
            'You improve linearly by 365%',
          ],
          correctOptionIndex: 1,
          explanation: '1.01 to the power of 365 equals approximately 37.78, or 37 times better (PDF p. 11).',
          difficulty: 'medium',
          sourcePdfPages: [11],
        },
      ],
      status: { summary: 'success', examples: 'success', quiz: 'success' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    updatedAt: Date.now(),
  };

  beforeAll(async () => {
    await saveBook(book, new Uint8Array([1, 2, 3]));
    await saveBookPages(book, pages);
    await replaceDraftAssignments(testUserId, testBookId, [assignment]);
    await updateBookAssignment(assignment);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      await deleteBook(testUserId, testBookId);
    } catch {}
  });

  describe('1. GET /api/quiz (Public Dedicated Quiz Retrieval)', () => {
    it('retrieves quiz questions for unauthenticated Telegram users without returning 401', async () => {
      const req = new Request(`http://localhost:3000/api/quiz?assignmentId=${encodeURIComponent(assignmentId)}`);
      const response = await quizGet(req);

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.book.title).toBe('Atomic Habits');
      expect(data.assignment.dayNumber).toBe(1);
      expect(data.assignment.startPdfPage).toBe(10);
      expect(data.assignment.endPdfPage).toBe(11);

      expect(data.questions.length).toBe(2);
      expect(data.questions[0].id).toBe('q_0');
      expect(data.questions[0].question).toContain('According to PDF page 10');
      expect(data.questions[0].options.length).toBe(3);
      expect(data.questions[0].sourcePdfPages).toEqual([10]);
    });

    it('returns 404 for unknown assignment IDs', async () => {
      const req = new Request(`http://localhost:3000/api/quiz?assignmentId=non_existent_asg_12345`);
      const response = await quizGet(req);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('Reading assignment not found');
    });

    it('returns 400 when missing assignmentId and sessionId', async () => {
      const req = new Request(`http://localhost:3000/api/quiz`);
      const response = await quizGet(req);

      expect(response.status).toBe(400);
    });
  });

  describe('2. POST /api/quiz (Grading & Score Calculation)', () => {
    it('accurately grades submitted answers and provides PDF page grounded explanations', async () => {
      const req = new Request('http://localhost:3000/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId,
          answers: {
            q_0: 0, // Correct (choice 0)
            q_1: 0, // Incorrect (selected 0, correct is 1)
          },
        }),
      });

      const response = await quizPost(req);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.totalQuestions).toBe(2);
      expect(data.correctCount).toBe(1);
      expect(data.score).toBe(50); // 1/2 = 50%
      expect(data.passed).toBe(false); // < 70%

      expect(data.results[0].isCorrect).toBe(true);
      expect(data.results[0].explanation).toContain('PDF page 10');

      expect(data.results[1].isCorrect).toBe(false);
      expect(data.results[1].correctOptionIndex).toBe(1);
      expect(data.results[1].explanation).toContain('PDF p. 11');
    });

    it('returns 100% score and passed=true when all answers are correct', async () => {
      const req = new Request('http://localhost:3000/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId,
          answers: {
            q_0: 0,
            q_1: 1,
          },
        }),
      });

      const response = await quizPost(req);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.score).toBe(100);
      expect(data.correctCount).toBe(2);
      expect(data.passed).toBe(true);
    });
  });

  describe('3. Assignment Lookup & Dedicated Public Access', () => {
    it('resolves assignment and book metadata publicly via /api/quiz without requiring a session cookie', async () => {
      const req = new Request(`http://localhost:3000/api/quiz?assignmentId=${encodeURIComponent(assignmentId)}`);
      const response = await quizGet(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.book.title).toBe('Atomic Habits');
      expect(data.assignment.id).toBe(assignmentId);
    });
  });

  describe('4. Question Persistence on Reload/Refresh', () => {
    it('returns the exact same saved questions across multiple GET reloads', async () => {
      const req1 = new Request(`http://localhost:3000/api/quiz?assignmentId=${encodeURIComponent(assignmentId)}`);
      const res1 = await quizGet(req1);
      const data1 = await res1.json();

      const req2 = new Request(`http://localhost:3000/api/quiz?assignmentId=${encodeURIComponent(assignmentId)}`);
      const res2 = await quizGet(req2);
      const data2 = await res2.json();

      expect(data1.questions).toEqual(data2.questions);
      expect(data1.questions[0].question).toBe(data2.questions[0].question);
    });
  });
});
