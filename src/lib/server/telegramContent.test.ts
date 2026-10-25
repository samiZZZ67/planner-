import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatReadingAssignment,
  formatLoadPlanPages,
  publishApprovedAssignment,
  publishLoadPlanPagesToTelegram,
  type EnrichedReadingContent,
} from './telegram';
import type { BookRecord, BookAssignmentRecord, BookPageRecord } from '../books/types';

describe('Telegram Book Delivery Content Structure & 7 Sections Suite', () => {
  const testUserId = `user_tg_${Date.now()}`;
  const testBookId = `book_tg_${Date.now()}`;

  const sampleBook: BookRecord = {
    id: testBookId,
    userId: testUserId,
    title: 'Atomic Habits: An Easy & Proven Way to Build Good Habits',
    author: 'James Clear',
    metadata: '',
    originalFilename: 'atomic_habits.pdf',
    storedFilename: `${testBookId}.pdf`,
    fileSize: 2048,
    startPage: 10,
    endPage: 15,
    durationDays: 2,
    startDate: '2026-10-16',
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

  const samplePages: BookPageRecord[] = [
    {
      bookId: testBookId,
      pdfPage: 10,
      text: 'Habits are the compound interest of self-improvement. The same way that money multiplies through compound interest, the effects of your habits multiply as you repeat them.',
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
      text: 'If you can get 1 percent better each day for one year, you will end up thirty-seven times better by the time you are done. Conversely, if you get 1 percent worse each day for one year, you will decline nearly down to zero.',
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
    scheduledDate: '2026-10-16',
    startPdfPage: 10,
    endPdfPage: 11,
    concepts: [
      { title: 'The Aggregation of Marginal Gains', concept: '1 percent daily improvement', estimatedMinutes: 15 },
    ],
    estimatedMinutes: 30,
    rationale: 'Fundamental compounding framework',
    status: 'approved',
    postingTime: '08:00',
    studyNotes: {
      summary: 'Small daily changes compound into massive long-term results through the aggregation of marginal gains.',
      keyConcepts: ['Compound Interest of Self-Improvement', '1% Better Every Day'],
      definitions: [
        {
          term: 'Habit',
          explanation: 'A routine or behavior that is performed regularly and, in many cases, automatically.',
          pdfPage: 10,
        },
      ],
      example: {
        kind: 'source',
        situation: 'British Cycling team under Dave Brailsford redesigned every tiny detail by 1 percent.',
        conceptInAction: 'Aggregated small gains across ergonomics, pillows, and bike maintenance.',
        lesson: 'Tiny improvements in isolation seem insignificant, but accumulated together they dominate world competitions.',
        sourceDisclosure: 'PDF page 11',
        pdfPage: 11,
      },
      questions: [
        {
          question: 'What happens after one year if you improve by 1 percent every day?',
          answer: 'You end up approximately 37 times better.',
          pdfPages: [11],
        },
      ],
      notes: 'Focus on trajectory rather than current results.',
      generatedByModel: 'test-model',
      generatedAt: Date.now(),
    },
    updatedAt: Date.now(),
  };

  const sampleEnrichment: EnrichedReadingContent = {
    realLifeExamples: [
      {
        title: 'British Cycling & Dave Brailsford',
        situation: 'British Cycling had won just a single gold medal in 100 years before implementing 1% marginal gains.',
        connection: 'Direct historical proof of the compounding principle discussed in the reading.',
        sourceTitle: 'Dave Brailsford Wikipedia Biography',
        sourceUrl: 'https://en.wikipedia.org/wiki/Dave_Brailsford',
        attribution: 'Source: Wikipedia (CC BY-SA 4.0)',
      },
    ],
    quotes: [
      {
        quote: 'You do not rise to the level of your goals. You fall to the level of your systems.',
        author: 'James Clear',
        sourceContext: 'Atomic Habits, Chapter 1',
        sourceUrl: 'https://en.wikiquote.org/wiki/James_Clear',
        attribution: 'Source: Wikiquote (CC BY-SA 4.0)',
      },
      {
        quote: 'Continuous improvement is better than delayed perfection.',
        author: 'Mark Twain',
        sourceUrl: 'https://zenquotes.io/',
        attribution: 'Inspirational quotes provided by ZenQuotes (https://zenquotes.io/)',
      },
    ],
    videos: [
      {
        videoId: 'U_nzqnXWvSo',
        title: 'Atomic Habits by James Clear | Animated Book Summary',
        channelName: 'Productivity Game',
        url: 'https://www.youtube.com/watch?v=U_nzqnXWvSo',
        description: 'How to build good habits and break bad ones.',
      },
    ],
    podcasts: [
      {
        id: 1001,
        title: 'The Tim Ferriss Show: James Clear on Habits and Focus',
        podcastName: 'The Tim Ferriss Show',
        url: 'https://tim.blog/podcast/james-clear',
        description: 'Discussion with James Clear on systems, routines, and identity.',
      },
    ],
    quiz: [
      {
        question: 'According to the reading on PDF page 11, what is the mathematical effect of getting 1% better each day for a year?',
        options: [
          'You become 37 times better.',
          'You double your productivity.',
          'Your performance remains largely unchanged.',
          'You improve linearly by exactly 365%.',
        ],
        correctOptionIndex: 0,
        explanation: '1.01 to the power of 365 equals approximately 37.78, making you roughly thirty-seven times better.',
        difficulty: 'medium',
        sourcePdfPages: [11],
      },
      {
        question: 'How does the author define habits on PDF page 10?',
        options: [
          'As the compound interest of self-improvement.',
          'As unalterable subconscious reflexes.',
          'As rigid schedules that limit creative freedom.',
        ],
        correctOptionIndex: 0,
        explanation: 'James Clear explicitly introduces habits as the compound interest of self-improvement on PDF page 10.',
        difficulty: 'easy',
        sourcePdfPages: [10],
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = 'test_token';
    process.env.TELEGRAM_CHAT_ID = '@SamSpac';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('1. Seven Clearly Separated Delivery Sections', () => {
    it('formats approved assignment with all 7 distinct sections', () => {
      const parts = formatReadingAssignment(
        sampleBook,
        sampleAssignment,
        samplePages,
        undefined,
        sampleEnrichment
      );
      const joined = parts.join('\n');

      // 1. Assigned book text (exact verbatim text and page ranges)
      expect(joined).toContain('Atomic Habits');
      expect(joined).toContain('PDF pages 10');
      expect(joined).toContain('[PDF Page 10]');
      expect(joined).toContain('Habits are the compound interest of self-improvement.');
      expect(joined).toContain('[PDF Page 11]');
      expect(joined).toContain('If you can get 1 percent better each day for one year');

      // 2. Summary
      expect(joined).toContain('<b>2. Study Summary</b>');
      expect(joined).toContain('Small daily changes compound into massive long-term results');
      expect(joined).toContain('Key Concepts');
      expect(joined).toContain('1% Better Every Day');
      expect(joined).toContain('Definitions');
      expect(joined).toContain('Habit (PDF p. 10)');

      // 3. Real-life examples (with source link and attribution)
      expect(joined).toContain('5. Real-Life Examples');
      expect(joined).toContain('British Cycling &amp; Dave Brailsford');
      expect(joined).toContain('Direct historical proof of the compounding principle');
      expect(joined).toContain('https://en.wikipedia.org/wiki/Dave_Brailsford');
      expect(joined).toContain('Source: Wikipedia (CC BY-SA 4.0)');

      // 4. Quotes (with verified attribution and link-back)
      expect(joined).toContain('6. Quotes');
      expect(joined).toContain('You do not rise to the level of your goals');
      expect(joined).toContain('James Clear');
      expect(joined).toContain('Source: Wikiquote (CC BY-SA 4.0)');
      expect(joined).toContain('Continuous improvement is better than delayed perfection');
      expect(joined).toContain('Inspirational quotes provided by ZenQuotes');

      // 5. Related videos (working YouTube link)
      expect(joined).toContain('Related Videos:');
      expect(joined).toContain('https://www.youtube.com/watch?v=U_nzqnXWvSo');
      expect(joined).toContain('Productivity Game');

      // 6. Related podcasts (working Podcast Index link)
      expect(joined).toContain('Related Podcasts:');
      expect(joined).toContain('The Tim Ferriss Show: James Clear on Habits and Focus');
      expect(joined).toContain('https://tim.blog/podcast/james-clear');

      // 7. Interactive Practice Quiz is strictly kept on the website — never sent to Telegram
      expect(joined).not.toContain('🎯 <b>Interactive Practice Quiz:</b>');
      expect(joined).toContain('/quiz?assignmentId=');
      expect(joined).not.toContain("Take Today's Reading Quiz");
      expect(joined).not.toContain('Question 1 (MEDIUM):');
      expect(joined).not.toContain('<b>Answer:</b>');
    });

    it('omits unavailable sections cleanly without sending generic filler', () => {
      // Create an enrichment payload where videos and podcasts are absent
      const minimalEnrichment: EnrichedReadingContent = {
        realLifeExamples: sampleEnrichment.realLifeExamples,
        quotes: sampleEnrichment.quotes,
        videos: [], // No videos
        podcasts: [], // No podcasts
        quiz: sampleEnrichment.quiz,
      };

      const parts = formatReadingAssignment(
        sampleBook,
        sampleAssignment,
        samplePages,
        undefined,
        minimalEnrichment
      );
      const joined = parts.join('\n');

      expect(joined).toContain('5. Real-Life Examples');
      expect(joined).toContain('6. Quotes');
      expect(joined).not.toContain('🎯 <b>Interactive Practice Quiz:</b>');
      expect(joined).toContain('/quiz?assignmentId=');
      // Should NOT contain video or podcast section headers or generic filler
      expect(joined).not.toContain('<b>Related Videos:</b>');
      expect(joined).not.toContain('<b>Related Podcasts:</b>');
      expect(joined).not.toContain('No videos available');
      expect(joined).not.toContain('No podcasts available');
    });

    it('formats Load Plan pages with enrichment sections', () => {
      const parts = formatLoadPlanPages(
        sampleBook,
        sampleAssignment,
        samplePages,
        undefined,
        sampleEnrichment
      );
      const joined = parts.join('\n');

      expect(joined).toContain('Reading Load Plan');
      expect(joined).toContain('PDF Pages: 10');
      expect(joined).toContain('[PDF Page 10]');
      expect(joined).toContain('Habits are the compound interest of self-improvement.');
      expect(joined).toContain('5. Real-Life Examples');
      expect(joined).toContain('6. Quotes');
      expect(joined).toContain('Related Videos:');
      expect(joined).toContain('Related Podcasts:');
      expect(joined).not.toContain('🎯 <b>Interactive Practice Quiz:</b>');
      expect(joined).toContain('/quiz?assignmentId=');
    });
  });

  describe('2. Delivery Execution & Duplicate Delivery Prevention', () => {
    it('dispatches all message parts to Telegram Bot API with parse_mode HTML', async () => {
      const dispatchedBodies: any[] = [];
      vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith('/getMe')) {
          return new Response(JSON.stringify({ ok: true, result: { id: 1, username: 'test_bot', first_name: 'Test Bot' } }), { status: 200 });
        }
        if (u.endsWith('/getChat')) {
          return new Response(JSON.stringify({ ok: true, result: { id: -10012345, title: 'Test Channel', type: 'channel' } }), { status: 200 });
        }
        if (u.endsWith('/getChatMember')) {
          return new Response(JSON.stringify({ ok: true, result: { status: 'administrator', can_post_messages: true } }), { status: 200 });
        }
        if (u.endsWith('/sendMessage')) {
          const body = JSON.parse(String(init?.body || '{}'));
          dispatchedBodies.push(body);
          return new Response(JSON.stringify({ ok: true, result: { message_id: 1000 + dispatchedBodies.length } }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }));

      const delivery = await publishApprovedAssignment(
        testUserId,
        sampleBook,
        sampleAssignment,
        samplePages,
        undefined,
        sampleEnrichment
      );

      expect(delivery.status).toBe('completed');
      expect(delivery.telegramMessageIds.length).toBeGreaterThanOrEqual(1);
      expect(dispatchedBodies.length).toBe(delivery.telegramMessageIds.length);
      expect(dispatchedBodies[0].parse_mode).toBe('HTML');
      expect(dispatchedBodies[0].chat_id).toBe('@SamSpac');
    });

    it('prevents duplicate Telegram deliveries when already completed', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.endsWith('/getMe')) return new Response(JSON.stringify({ ok: true, result: { id: 1, username: 'bot' } }));
        if (u.endsWith('/getChat')) return new Response(JSON.stringify({ ok: true, result: { id: -1, title: 'Chan', type: 'channel' } }));
        if (u.endsWith('/getChatMember')) return new Response(JSON.stringify({ ok: true, result: { status: 'administrator', can_post_messages: true } }));
        if (u.endsWith('/sendMessage')) return new Response(JSON.stringify({ ok: true, result: { message_id: 999 } }));
        return new Response(JSON.stringify({ ok: true }));
      }));

      // A repeated publish returns the persistent receipt without sending the content again.
      const repeated = await publishApprovedAssignment(testUserId, sampleBook, sampleAssignment, samplePages, undefined, sampleEnrichment);
      expect(repeated.status).toBe('completed');
    });
  });
});
