import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as telegramModule from '../telegram';
import {
  generateDeterministicQuestions,
  buildQuizSectionsForAssignment,
  startQuizSessionForAssignment,
  sendQuizQuestion,
  sendSectionExcerpt,
  formatLearningFeedbackCard,
  makeNavigationKeyboard,
  handleQuizCallback,
  handlePollAnswer,
  getQuizSession,
  getBookQuizSettings,
  updateBookQuizSettings,
  type BookQuizSession,
} from './bookQuiz';
import type { BookRecord, BookPageRecord, BookAssignmentRecord } from '../../books/types';

describe('Interactive Telegram Book Quiz Mode Suite', () => {
  const testUserId = `user_quiz_${Date.now()}`;
  const testBookId = `book_quiz_${Date.now()}`;

  const sampleBook: BookRecord = {
    id: testBookId,
    userId: testUserId,
    title: 'Deep Work: Rules for Focused Success',
    author: 'Cal Newport',
    metadata: '',
    originalFilename: 'deep_work.pdf',
    storedFilename: `${testBookId}.pdf`,
    fileSize: 1024,
    startPage: 1,
    endPage: 4,
    durationDays: 2,
    startDate: '2026-10-15',
    studyMinutes: 30,
    postingTime: '08:00',
    timezone: 'Africa/Addis_Ababa',
    currentPage: 1,
    status: 'ready',
    extractionStatus: 'completed',
    extractionMessage: 'Extracted successfully',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const samplePages: BookPageRecord[] = [
    {
      bookId: testBookId,
      pdfPage: 1,
      text: 'Deep work is the ability to focus without distraction on a cognitively demanding task. Carl Jung built a stone tower in Bollingen to practice deep thinking.',
      method: 'native',
      confidence: 1,
      warnings: [],
      requiresReview: false,
      reviewedByUser: true,
      updatedAt: Date.now(),
    },
    {
      bookId: testBookId,
      pdfPage: 2,
      text: 'Shallow work consists of non-cognitively demanding, logistical tasks often performed while distracted. Network tools fragment attention across superficial duties.',
      method: 'native',
      confidence: 1,
      warnings: [],
      requiresReview: false,
      reviewedByUser: true,
      updatedAt: Date.now(),
    },
    {
      bookId: testBookId,
      pdfPage: 3,
      text: 'The Deep Work Hypothesis states that the ability to perform deep work is becoming increasingly rare at the exact same time it is becoming increasingly valuable in our economy.',
      method: 'native',
      confidence: 1,
      warnings: [],
      requiresReview: false,
      reviewedByUser: true,
      updatedAt: Date.now(),
    },
    {
      bookId: testBookId,
      pdfPage: 4,
      text: 'To thrive in the new economy, you must master two core abilities: the ability to quickly master hard things, and the ability to produce at an elite level.',
      method: 'native',
      confidence: 1,
      warnings: [],
      requiresReview: false,
      reviewedByUser: true,
      updatedAt: Date.now(),
    },
  ];

  const sampleAssignment: BookAssignmentRecord = {
    id: `asg_${testBookId}_1`,
    userId: testUserId,
    bookId: testBookId,
    dayNumber: 1,
    scheduledDate: '2026-10-15',
    startPdfPage: 1,
    endPdfPage: 4,
    concepts: [
      { title: 'Deep Work Defined', concept: 'Focus without distraction', estimatedMinutes: 15 },
      { title: 'The Deep Work Hypothesis', concept: 'Rarity and value', estimatedMinutes: 15 },
    ],
    estimatedMinutes: 30,
    rationale: 'Foundational framework',
    status: 'approved',
    postingTime: '08:00',
    studyNotes: {
      summary: 'Deep work requires distraction-free focus on cognitively demanding tasks.',
      keyConcepts: ['Deep Work', 'Shallow Work', 'The Deep Work Hypothesis'],
      definitions: [
        {
          term: 'Deep Work',
          explanation: 'Professional activities performed in a state of distraction-free concentration that push cognitive capabilities.',
          pdfPage: 1,
        },
      ],
      example: {
        kind: 'source',
        situation: 'Carl Jung retreating to his tower in Bollingen without electricity to write and think.',
        conceptInAction: 'Deliberate physical isolation to eliminate shallow distractions.',
        lesson: 'Deep environments accelerate breakthrough insights.',
        sourceDisclosure: 'PDF page 1',
        pdfPage: 1,
      },
      questions: [
        {
          question: 'What distinguishes deep work from shallow work according to Cal Newport?',
          answer: 'Deep work demands distraction-free concentration on cognitively demanding tasks.',
          pdfPages: [1, 2],
        },
      ],
      notes: 'Study notes on deep work framework.',
      generatedByModel: 'test-model',
      generatedAt: Date.now(),
    },
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = 'test_token';
    process.env.TELEGRAM_CHAT_ID = '@SamSpac';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Question Generation & Book Grounding', () => {
    it('generates book-specific quiz questions adhering strictly to Telegram limits', () => {
      const questions = generateDeterministicQuestions(
        sampleBook,
        samplePages,
        1,
        2,
        2,
        sampleAssignment.studyNotes
      );

      expect(questions).toHaveLength(2);
      for (const q of questions) {
        expect(q.question.length).toBeLessThanOrEqual(300);
        expect(q.options.length).toBeGreaterThanOrEqual(2);
        expect(q.options.length).toBeLessThanOrEqual(4);
        for (const opt of q.options) {
          expect(opt.length).toBeLessThanOrEqual(100);
        }
        expect(q.correctOptionId).toBeGreaterThanOrEqual(0);
        expect(q.correctOptionId).toBeLessThan(q.options.length);
        expect(q.conciseExplanation.length).toBeLessThanOrEqual(200);
        expect(q.definition.term).toBeDefined();
        expect(q.definition.explanation).toBeDefined();
        expect(q.practicalExample.situation).toBeDefined();
      }
    });

    it('organizes reading into numbered sections with preserved original unparaphrased text', async () => {
      const settings = {
        userId: testUserId,
        enabled: true,
        questionsPerSection: 2,
        deliveryTiming: 'with_reading' as const,
        revealExplanation: 'after_answer' as const,
        updatedAt: Date.now(),
      };

      const sections = await buildQuizSectionsForAssignment(
        sampleBook,
        sampleAssignment,
        samplePages,
        settings
      );

      expect(sections.length).toBeGreaterThanOrEqual(2);
      expect(sections[0].startPdfPage).toBe(1);
      expect(sections[0].endPdfPage).toBe(2);
      // Verify original excerpt is strictly preserved
      expect(sections[0].originalExcerpt).toContain('[PDF Page 1]');
      expect(sections[0].originalExcerpt).toContain('Carl Jung built a stone tower');
      expect(sections[0].questions).toHaveLength(2);
    });
  });

  describe('2. Navigation Keyboard & Feedback Formatting', () => {
    it('constructs correct inline navigation buttons for sections and questions', () => {
      const kbMiddle = makeNavigationKeyboard('sess_1', 0, 0, 2, 2);
      // Question 1 of 2: should have Next Question and Repeat Explanation
      const row1Texts = kbMiddle[0].map(b => b.text);
      expect(row1Texts).toContain('Next Question ➡️');
      expect(row1Texts).toContain('💡 Repeat Explanation');
      const row2Texts = kbMiddle[1].map(b => b.text);
      expect(row2Texts).toContain('📖 Next Section ⏩');
      expect(row2Texts).toContain('🏁 Finish Session');

      // Last question of last section
      const kbLast = makeNavigationKeyboard('sess_1', 1, 1, 2, 2);
      const lastRow1Texts = kbLast[0].map(b => b.text);
      expect(lastRow1Texts).not.toContain('Next Question ➡️');
      expect(lastRow1Texts).toContain('💡 Repeat Explanation');
    });

    it('formats a rich learning feedback card with correct answer, definition, and example', () => {
      const questions = generateDeterministicQuestions(
        sampleBook,
        samplePages,
        1,
        2,
        1,
        sampleAssignment.studyNotes
      );
      const q = questions[0];

      const card = formatLearningFeedbackCard(q, q.correctOptionId, true);
      expect(card).toContain('Correct Answer!');
      expect(card).toContain(q.definition.term);
      expect(card).toContain(q.definition.explanation);
      expect(card).toContain(q.practicalExample.situation);
      expect(card).toContain(q.practicalExample.lesson);

      const wrongCard = formatLearningFeedbackCard(q, (q.correctOptionId + 1) % q.options.length, false);
      expect(wrongCard).toContain('Incorrect!');
    });
  });

  describe('3. Website-only Quiz Session Lifecycle', () => {
    it('keeps quiz generation website-accessible and sends no Telegram poll or messages', async () => {
      const poll = vi.spyOn(telegramModule, 'sendTelegramQuizPoll');
      const keyboard = vi.spyOn(telegramModule, 'sendTelegramMessageWithKeyboard');
      const text = vi.spyOn(telegramModule, 'sendTelegramTextToChannel');

      const session = await startQuizSessionForAssignment(
        testUserId,
        sampleBook,
        sampleAssignment,
        samplePages,
        '@SamSpac'
      );

      expect(session.status).toBe('active');
      expect(session.totalQuestions).toBeGreaterThan(0);
      expect(await getQuizSession(session.id)).not.toBeNull();
      expect(poll).not.toHaveBeenCalled();
      expect(keyboard).not.toHaveBeenCalled();
      expect(text).not.toHaveBeenCalled();

      const answerResult = await handlePollAnswer({ poll_id: 'old-poll', option_ids: [0] });
      expect(answerResult.handled).toBe(false);
      const callbackResult = await handleQuizCallback('old-callback', `quiz:next_q:${session.id}:0:1`);
      expect(callbackResult).toEqual({ handled: false, action: 'website_only' });
    });
  });

  describe('4. Quiz Settings & Persistence', () => {
    it('saves and updates quiz settings per user', async () => {
      const current = await getBookQuizSettings(testUserId);
      expect(current.enabled).toBe(true);
      expect(current.questionsPerSection).toBe(2);

      const updated = await updateBookQuizSettings(testUserId, {
        questionsPerSection: 3,
        deliveryTiming: 'on_demand',
        revealExplanation: 'immediate',
      });

      expect(updated.questionsPerSection).toBe(3);
      expect(updated.deliveryTiming).toBe('on_demand');
      expect(updated.revealExplanation).toBe('immediate');

      const retrieved = await getBookQuizSettings(testUserId);
      expect(retrieved.questionsPerSection).toBe(3);
      expect(retrieved.deliveryTiming).toBe('on_demand');
    });
  });
});
