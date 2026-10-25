import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  researchReadingEnrichment,
  type EnrichedReadingContent,
} from './enrichment';
import {
  formatReadingAssignment,
  formatLoadPlanPages,
  publishApprovedAssignment,
  getAppOrigin,
} from '../telegram';
import type { BookRecord, BookAssignmentRecord, BookPageRecord } from '../../books/types';
import { saveBook, saveBookPages } from '../books';
import { updateBookAssignment } from '../bookAssignments';

describe('Wikipedia Research, Concept Grounding, Deduplication & Telegram Quiz Link Delivery', () => {
  const testUserId = `user_wq_${Date.now()}`;
  const testBookId = `book_wq_${Date.now()}`;

  const book: BookRecord = {
    id: testBookId,
    userId: testUserId,
    title: 'Thinking, Fast and Slow',
    author: 'Daniel Kahneman',
    metadata: '',
    originalFilename: 'thinking_fast_and_slow.pdf',
    storedFilename: `${testBookId}.pdf`,
    fileSize: 4096,
    startPage: 1,
    endPage: 20,
    durationDays: 2,
    startDate: '2026-10-25',
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

  const day1Pages: BookPageRecord[] = [
    {
      bookId: testBookId,
      pdfPage: 1,
      text: 'System 1 operates automatically and quickly, with little or no effort and no sense of voluntary control. System 2 allocates attention to the effortful mental operations that demand it, including complex computations.',
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
      text: 'When we think of ourselves, we identify with System 2, the conscious, reasoning self that has beliefs, makes choices, and decides what to think about and what to do.',
      method: 'native',
      confidence: 1,
      warnings: [],
      requiresReview: false,
      reviewedByUser: true,
      updatedAt: Date.now(),
    },
  ];

  const day2Pages: BookPageRecord[] = [
    {
      bookId: testBookId,
      pdfPage: 3,
      text: 'The anchoring effect occurs when people consider a particular value for an unknown quantity before estimating that quantity. The estimates stay close to the number that people considered.',
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
      text: 'Any number that you are asked to consider as a possible solution to an estimation problem will induce an anchoring effect. System 1 tries its best to build a world in which the anchor is the true number.',
      method: 'native',
      confidence: 1,
      warnings: [],
      requiresReview: false,
      reviewedByUser: true,
      updatedAt: Date.now(),
    },
  ];

  const day1Assignment: BookAssignmentRecord = {
    id: `asg_${testBookId}_day1`,
    userId: testUserId,
    bookId: testBookId,
    dayNumber: 1,
    scheduledDate: '2026-10-25',
    startPdfPage: 1,
    endPdfPage: 2,
    concepts: [{ title: 'Dual-Process Theory', concept: 'System 1 and System 2 cognitive processing', estimatedMinutes: 15 }],
    estimatedMinutes: 30,
    rationale: 'Foundation of cognitive systems',
    status: 'approved',
    postingTime: '08:00',
    studyNotes: {
      summary: 'System 1 is fast and intuitive; System 2 is slow, deliberate, and effortful.',
      keyConcepts: ['Dual-Process Theory', 'System 1 and System 2'],
      definitions: [
        { term: 'System 1', explanation: 'Fast, automatic, and subconscious cognition.', pdfPage: 1 },
        { term: 'System 2', explanation: 'Slow, controlled, and conscious mental exertion.', pdfPage: 1 },
      ],
      example: {
        kind: 'source',
        situation: 'Detecting that one object is more distant than another is System 1.',
        conceptInAction: 'Effortless automatic perceptual calculation.',
        lesson: 'Automatic processes occur effortlessly without deliberate mental strain.',
        sourceDisclosure: 'PDF page 1',
        pdfPage: 1,
      },
      questions: [
        { question: 'Which system operates automatically and quickly?', answer: 'System 1', pdfPages: [1] },
      ],
      notes: 'Cognitive effort allocation framework.',
      generatedByModel: 'test',
      generatedAt: Date.now(),
    },
    updatedAt: Date.now(),
  };

  const day2Assignment: BookAssignmentRecord = {
    id: `asg_${testBookId}_day2`,
    userId: testUserId,
    bookId: testBookId,
    dayNumber: 2,
    scheduledDate: '2026-10-26',
    startPdfPage: 3,
    endPdfPage: 4,
    concepts: [{ title: 'Anchoring Bias', concept: 'Cognitive bias of disproportionate influence from initial numerical anchors', estimatedMinutes: 15 }],
    estimatedMinutes: 30,
    rationale: 'Core cognitive heuristic and error mechanism',
    status: 'approved',
    postingTime: '08:00',
    studyNotes: {
      summary: 'People involuntarily anchor their estimates to initial figures, even when irrelevant.',
      keyConcepts: ['Anchoring Bias', 'Heuristics and Biases'],
      definitions: [
        { term: 'Anchoring Effect', explanation: 'Disproportionate reliance on the first piece of information encountered.', pdfPage: 3 },
      ],
      example: {
        kind: 'source',
        situation: 'Estimating the price of a house after an initial high list price.',
        conceptInAction: 'Valuation remains anchored upward.',
        lesson: 'Initial numbers distort subsequent numerical judgements.',
        sourceDisclosure: 'PDF page 3',
        pdfPage: 3,
      },
      questions: [
        { question: 'What does the anchoring effect cause estimates to do?', answer: 'Stay close to the initial number considered.', pdfPages: [3] },
      ],
      notes: 'Behavioral economics heuristic study.',
      generatedByModel: 'test',
      generatedAt: Date.now(),
    },
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = 'test_token';
    process.env.TELEGRAM_CHAT_ID = '@SamSpac';

    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('zenquotes.io')) {
        return new Response(JSON.stringify([{ q: 'A quick quote', a: 'Author' }]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.includes('wikiquote.org')) {
        return new Response(JSON.stringify({ query: { search: [] } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.includes('youtube') || u.includes('podcastindex')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.includes('api.telegram.org')) {
        if (u.endsWith('/getMe')) return new Response(JSON.stringify({ ok: true, result: { id: 1, username: 'test_bot', first_name: 'Test Bot' } }), { status: 200 });
        if (u.endsWith('/getChat')) return new Response(JSON.stringify({ ok: true, result: { id: -10012345, title: 'Test Channel', type: 'channel' } }), { status: 200 });
        if (u.endsWith('/getChatMember')) return new Response(JSON.stringify({ ok: true, result: { status: 'administrator', can_post_messages: true } }), { status: 200 });
        if (u.endsWith('/sendMessage')) return new Response(JSON.stringify({ ok: true, result: { message_id: 1234 } }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('1. Grounded Wikipedia Research & Cross-Delivery Deduplication', () => {
    it('grounds Day 1 Wikipedia research in Day 1 concepts and extracts', async () => {
      const enrichmentDay1 = await researchReadingEnrichment({
        book,
        assignment: day1Assignment,
        pages: day1Pages,
        studyNotes: day1Assignment.studyNotes,
      });

      expect(enrichmentDay1.realLifeExamples.length).toBeGreaterThanOrEqual(1);
      const topExample = enrichmentDay1.realLifeExamples[0];

      // Grounded in Day 1's concept "Dual-Process Theory"
      expect(topExample.title).toContain('Dual-Process Theory');
      expect(topExample.sourceUrl).toContain('wikipedia.org');
      expect(topExample.attribution).toContain('Wikipedia (CC BY-SA 4.0)');
      expect(topExample.connection).toContain('PDF pages 1–2');
      expect(topExample.connection).toContain('Thinking, Fast and Slow');
    });

    it('tracks Day 1 delivered topics and ensures Day 2 never repeats Day 1 Wikipedia topic', async () => {
      // Day 1 delivery
      const enrichmentDay1 = await researchReadingEnrichment({
        book,
        assignment: day1Assignment,
        pages: day1Pages,
        studyNotes: day1Assignment.studyNotes,
      });

      // Pass Day 1 assignment as previousAssignments to Day 2
      const enrichmentDay2 = await researchReadingEnrichment({
        book,
        assignment: day2Assignment,
        pages: day2Pages,
        studyNotes: day2Assignment.studyNotes,
        previousAssignments: [{
          ...day1Assignment,
          learningPackage: {
            bookId: book.id,
            assignmentId: day1Assignment.id,
            startPdfPage: 1,
            endPdfPage: 2,
            summary: day1Assignment.studyNotes!.summary,
            keyConcepts: day1Assignment.studyNotes!.keyConcepts,
            realLifeExamples: enrichmentDay1.realLifeExamples,
            quiz: [],
            status: { summary: 'success', examples: 'success', quiz: 'success' },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        }],
      });

      expect(enrichmentDay2.realLifeExamples.length).toBeGreaterThanOrEqual(1);
      const day2Example = enrichmentDay2.realLifeExamples[0];

      // Day 2 must use Day 2's concept ("Anchoring Bias"), NOT Day 1's concept
      expect(day2Example.title).toContain('Anchoring Bias');
      expect(day2Example.title).not.toContain('Dual-Process Theory');
      expect(day2Example.connection).toContain('PDF pages 3–4');
    });

    it('falls back to book-grounded explanation if no relevant Wikipedia article is found', async () => {
      // Create a section with no concepts and no Wikipedia match
      const obscureAssignment: BookAssignmentRecord = {
        ...day1Assignment,
        id: 'asg_obscure',
        concepts: [],
        studyNotes: {
          summary: 'Obscure specialized principles.',
          keyConcepts: [],
          definitions: [],
          example: {
            kind: 'source',
            situation: 'Empirical experiment conducted with 150 participants.',
            conceptInAction: 'Direct demonstration of decision inertia under high stakes.',
            lesson: 'Decision inertia delays action unless counter-incentivized.',
            sourceDisclosure: 'PDF page 1',
            pdfPage: 1,
          },
          questions: [],
          notes: 'Experimental analysis.',
          generatedByModel: 'test',
          generatedAt: Date.now(),
        },
      };

      const enrichment = await researchReadingEnrichment({
        book,
        assignment: obscureAssignment,
        pages: day1Pages,
        studyNotes: obscureAssignment.studyNotes,
        previouslyUsedTopics: new Set(['dual-process theory', 'thinking, fast and slow', 'daniel kahneman']),
      });

      expect(enrichment.realLifeExamples.length).toBeGreaterThanOrEqual(1);
      const fallbackEx = enrichment.realLifeExamples[0];
      // Fallback must be grounded in the book reading, not a fabricated external link
      expect(fallbackEx.attribution).toContain('Source: Book Reading');
      expect(fallbackEx.sourceTitle).toContain('Thinking, Fast and Slow (PDF p. 1)');
      expect(fallbackEx.situation).toContain('Empirical experiment conducted with 150 participants');
    });
  });

  describe('2. Telegram Quiz Delivery Rules (Links Only, Zero Polls)', () => {
    it('formats Telegram message with ONLY the clickable quiz website link and zero question texts', () => {
      const enrichment: EnrichedReadingContent = {
        realLifeExamples: [{
          title: 'Dual-Process Theory — Real-World Application',
          situation: 'Cognitive psychology experiments demonstrate split-second decision making.',
          connection: 'Illuminates principles on PDF pages 1–2.',
          sourceTitle: 'Dual-Process Theory (Wikipedia)',
          sourceUrl: 'https://en.wikipedia.org/wiki/Dual-process_theory',
          attribution: 'Source: Wikipedia (CC BY-SA 4.0)',
        }],
        quotes: [],
        videos: [],
        podcasts: [],
        quiz: [
          {
            question: 'What is the primary function of System 1?',
            options: ['To compute complex logarithms', 'To operate quickly and automatically', 'To regulate voluntary metabolism'],
            correctOptionIndex: 1,
            explanation: 'System 1 operates automatically and quickly as described on PDF page 1.',
            difficulty: 'easy',
            sourcePdfPages: [1],
          },
        ],
      };

      const messageParts = formatReadingAssignment(book, day1Assignment, day1Pages, undefined, enrichment);
      const joined = messageParts.join('\n');

      // MUST contain interactive practice quiz website link
      expect(joined).toContain('🎯 <b>Interactive Practice Quiz:</b>');
      expect(joined).toContain(`/quiz?assignmentId=${encodeURIComponent(day1Assignment.id)}`);
      expect(joined).toContain("Take Today's Reading Quiz (Day 1)");

      // MUST NEVER leak quiz questions, options, or answers directly into Telegram message
      expect(joined).not.toContain('What is the primary function of System 1?');
      expect(joined).not.toContain('To operate quickly and automatically');
      expect(joined).not.toContain('<b>Answer:</b>');
      expect(joined).not.toContain('Reading Quiz:');
    });

    it('formats Load Plan pages with dedicated quiz link and zero question texts', () => {
      const loadParts = formatLoadPlanPages(book, day1Assignment, day1Pages);
      const joined = loadParts.join('\n');

      expect(joined).toContain('🎯 <b>Interactive Practice Quiz:</b>');
      expect(joined).toContain(`/quiz?assignmentId=${encodeURIComponent(day1Assignment.id)}`);
      expect(joined).not.toContain('Reading Quiz:');
    });

    it('never dispatches Telegram quiz polls during publishApprovedAssignment', async () => {
      const sentRequests: Array<{ url: string; body: any }> = [];

      vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        sentRequests.push({ url: u, body });

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
          return new Response(JSON.stringify({ ok: true, result: { message_id: 5001 + sentRequests.length } }), { status: 200 });
        }
        if (u.endsWith('/sendPoll')) {
          throw new Error('sendPoll should NEVER be called when delivering reading assignments to Telegram!');
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }));

      const delivery = await publishApprovedAssignment(
        testUserId,
        book,
        day1Assignment,
        day1Pages,
        undefined,
        {
          realLifeExamples: [],
          quotes: [],
          videos: [],
          podcasts: [],
          quiz: [
            {
              question: 'Test Question',
              options: ['Option A', 'Option B'],
              correctOptionIndex: 0,
              explanation: 'Exp',
              difficulty: 'easy',
            },
          ],
        }
      );

      expect(delivery.status).toBe('completed');
      // Verify NO sendPoll request was ever made to Telegram
      const pollCalls = sentRequests.filter(r => r.url.endsWith('/sendPoll'));
      expect(pollCalls.length).toBe(0);
    });
  });

  describe('3. App Origin & Clean URL Resolution', () => {
    it('uses MOON_APP_URL or APP_URL over generic fallbacks for quiz links', () => {
      const origMoon = process.env.MOON_APP_URL;
      const origApp = process.env.APP_URL;
      const origClient = process.env.CLIENT_URL;

      try {
        process.env.MOON_APP_URL = 'https://nightplanner.onrender.com';
        expect(getAppOrigin()).toBe('https://nightplanner.onrender.com');

        delete process.env.MOON_APP_URL;
        process.env.APP_URL = 'https://planner-custom.up.railway.app';
        expect(getAppOrigin()).toBe('https://planner-custom.up.railway.app');
      } finally {
        if (origMoon !== undefined) process.env.MOON_APP_URL = origMoon; else delete process.env.MOON_APP_URL;
        if (origApp !== undefined) process.env.APP_URL = origApp; else delete process.env.APP_URL;
        if (origClient !== undefined) process.env.CLIENT_URL = origClient; else delete process.env.CLIENT_URL;
      }
    });
  });
});
