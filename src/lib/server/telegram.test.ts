import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkTelegramChannel, formatLoadPlanPages, formatReadingAssignment, splitTelegramText } from './telegram';
import type { BookAssignmentRecord, BookPageRecord, BookRecord } from '../books/types';

const book: BookRecord = {
  id: 'book-1', userId: 'owner', title: 'Learning', author: 'A. Writer', metadata: '', originalFilename: 'learning.pdf', storedFilename: 'book.pdf',
  fileSize: 100, startPage: 1, endPage: 1, durationDays: 1, startDate: '2026-10-13', studyMinutes: 30, postingTime: '08:00', timezone: 'Africa/Nairobi',
  currentPage: 1, status: 'ready', extractionStatus: 'completed', extractionMessage: '', totalPdfPages: 1, createdAt: 1, updatedAt: 1,
};
const approved: BookAssignmentRecord = {
  id: 'assignment-1', userId: 'owner', bookId: 'book-1', dayNumber: 1, scheduledDate: '2026-10-13', startPdfPage: 1, endPdfPage: 1,
  concepts: [], estimatedMinutes: 20, rationale: '', status: 'approved', updatedAt: 1,
  studyNotes: {
    summary: 'A short summary.', keyConcepts: ['Concept A'], definitions: [{ term: 'A', explanation: 'Meaning A', pdfPage: 1 }],
    example: { situation: 'A hypothetical case.', conceptInAction: 'Concept A applies.', lesson: 'Learn A.', sourceDisclosure: 'Hypothetical example.' },
    questions: [{ question: 'What is A?', answer: 'A is A.', pdfPages: [1] }], notes: 'Review A.', generatedByModel: 'test', generatedAt: 1,
  },
};
const page: BookPageRecord = { bookId: 'book-1', pdfPage: 1, text: 'Exact source\ntext — with punctuation.', method: 'native', confidence: null, warnings: [], requiresReview: false, reviewedByUser: false, updatedAt: 1 };

describe('Telegram reading assignment formatting', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves extracted page text and includes page references and separate notes', () => {
    const joined = formatReadingAssignment(book, approved, [page]).join('');
    expect(joined).toContain('[PDF page 1]\nExact source\ntext — with punctuation.');
    expect(joined).toContain('Study summary');
    expect(joined).toContain('• A (PDF p. 1): Meaning A');
    expect(joined).not.toContain('/quiz');
  });

  it('splits by Unicode code points without losing characters', () => {
    const input = '📖' + 'x'.repeat(20);
    const pieces = splitTelegramText(input, 7);
    expect(pieces.every(piece => piece.length <= 7)).toBe(true);
    expect(pieces.join('')).toBe(input);
  });

  it('refuses draft assignments and pages awaiting OCR review', () => {
    expect(() => formatReadingAssignment(book, { ...approved, status: 'draft' }, [page])).toThrow(/approved/i);
    expect(() => formatReadingAssignment(book, approved, [{ ...page, method: 'ocr', requiresReview: true }])).toThrow(/OCR review/i);
  });

  it('formats load plan pages without requiring approved notes status', () => {
    const draftAssignment: BookAssignmentRecord = {
      ...approved,
      status: 'draft',
      studyNotes: undefined,
      concepts: [{ title: 'Core Insight', concept: 'Read actively.', estimatedMinutes: 20 }],
    };
    const parts = formatLoadPlanPages(book, draftAssignment, [page]);
    const joined = parts.join('');
    expect(joined).toContain('Reading Load Plan · Day 1');
    expect(joined).toContain('PDF Pages: 1–1');
    expect(joined).toContain('[PDF Page 1]');
    expect(joined).toContain('Exact source\ntext — with punctuation.');
    expect(joined).toContain('Core Insight');
  });

  it('checks bot identity, configured channel, and admin posting permission without exposing the token', async () => {
    const oldToken = process.env.TELEGRAM_BOT_TOKEN;
    const oldChat = process.env.TELEGRAM_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = 'test-secret-token';
    process.env.TELEGRAM_CHAT_ID = '@study_channel';
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      calls.push(value.split('/').at(-1) || '');
      const result = value.endsWith('/getMe')
        ? { id: 7, username: 'reading_bot', first_name: 'Reading Bot' }
        : value.endsWith('/getChat')
          ? { id: -9, title: 'Study Channel', type: 'channel' }
          : { status: 'administrator', can_post_messages: true };
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    }));
    try {
      const status = await checkTelegramChannel();
      expect(status.canPost).toBe(true);
      expect(status.channel.title).toBe('Study Channel');
      expect(calls).toEqual(['getMe', 'getChat', 'getChatMember']);
      expect(JSON.stringify(status)).not.toContain('test-secret-token');
    } finally {
      if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = oldToken;
      if (oldChat === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = oldChat;
    }
  });

  it('immediately sends load plan pages and returns delivery receipt', async () => {
    const oldToken = process.env.TELEGRAM_BOT_TOKEN;
    const oldChat = process.env.TELEGRAM_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = '-1001234567890';
    const sentMessages: any[] = [];

    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/getMe')) {
        return new Response(JSON.stringify({ ok: true, result: { id: 1, username: 'bot', first_name: 'Bot' } }), { status: 200 });
      }
      if (u.endsWith('/getChat')) {
        return new Response(JSON.stringify({ ok: true, result: { id: -1001234567890, title: 'Chan', type: 'channel' } }), { status: 200 });
      }
      if (u.endsWith('/getChatMember')) {
        return new Response(JSON.stringify({ ok: true, result: { status: 'administrator', can_post_messages: true } }), { status: 200 });
      }
      if (u.endsWith('/sendMessage')) {
        const body = JSON.parse(String(init?.body || '{}'));
        sentMessages.push(body);
        return new Response(JSON.stringify({ ok: true, result: { message_id: 100 + sentMessages.length } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    }));

    try {
      const { publishLoadPlanPagesToTelegram } = await import('./telegram');
      const testAssignment: BookAssignmentRecord = {
        ...approved,
        id: 'assignment-sendnow-1',
        dayNumber: 1,
        scheduledDate: '2026-10-15',
        status: 'draft',
      };

      const result = await publishLoadPlanPagesToTelegram('owner', book, testAssignment, [page]);
      expect(result.delivery.status).toBe('completed');
      expect(result.delivery.telegramMessageIds.length).toBeGreaterThan(0);
      expect(sentMessages.length).toBeGreaterThan(0);
      expect(sentMessages[0].text).toContain('Reading Load Plan · Day 1');
      // Original assignment scheduled date was NOT modified by the delivery
      expect(testAssignment.scheduledDate).toBe('2026-10-15');
      expect(testAssignment.dayNumber).toBe(1);
    } finally {
      if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = oldToken;
      if (oldChat === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = oldChat;
    }
  });

  it('sanitizes strings with lone surrogates, null bytes, and non-printable control characters', async () => {
    const { sanitizeUtf8, sanitizePayload } = await import('./telegram');
    const corrupted = 'Hello\u0000\uD800 World\uDFFF \x07with Emoji 📖 and Ethiopian ሰላም';
    const cleaned = sanitizeUtf8(corrupted);
    expect(cleaned).toBe('Hello World with Emoji 📖 and Ethiopian ሰላም');

    const nested = {
      title: 'Book\uD800',
      items: ['Safe', 'Bad\u0000String\uDFFF'],
      meta: { note: 'Text\x1Fhere' },
    };
    const sanitized = sanitizePayload(nested);
    expect(sanitized).toEqual({
      title: 'Book',
      items: ['Safe', 'BadString'],
      meta: { note: 'Texthere' },
    });
  });

  it('formats empty and illustration pages gracefully without throwing errors', () => {
    const emptyPage: BookPageRecord = {
      bookId: 'book-1',
      pdfPage: 1,
      text: '',
      method: 'empty',
      confidence: null,
      warnings: ['Empty page'],
      requiresReview: false,
      reviewedByUser: false,
      updatedAt: 1,
    };

    // Format reading assignment with an empty page
    const assignmentParts = formatReadingAssignment(book, approved, [emptyPage]);
    const assignmentText = assignmentParts.join('');
    expect(assignmentText).toContain('Blank / Illustration Page');
    expect(assignmentText).toContain('proceeding to the next reading section');

    // Format load plan pages with an empty page
    const draftAssignment: BookAssignmentRecord = {
      ...approved,
      status: 'draft',
      studyNotes: undefined,
    };
    const loadPlanParts = formatLoadPlanPages(book, draftAssignment, [emptyPage]);
    const loadPlanText = loadPlanParts.join('');
    expect(loadPlanText).toContain('Blank / Illustration Page');
    expect(loadPlanText).toContain('proceeding to the next reading section');
  });

  it('resolves getAppOrigin across RENDER_EXTERNAL_URL, CLIENT_URL, and fallback', async () => {
    const { getAppOrigin } = await import('./telegram');
    const origClient = process.env.CLIENT_URL;
    const origRender = process.env.RENDER_EXTERNAL_URL;

    try {
      delete process.env.CLIENT_URL;
      process.env.RENDER_EXTERNAL_URL = 'https://nightplanner.onrender.com';
      expect(getAppOrigin()).toBe('https://nightplanner.onrender.com');

      process.env.RENDER_EXTERNAL_URL = 'nightplanner.onrender.com';
      expect(getAppOrigin()).toBe('https://nightplanner.onrender.com');

      process.env.CLIENT_URL = 'https://mycustomapp.com';
      expect(getAppOrigin()).toBe('https://mycustomapp.com');

      process.env.CLIENT_URL = '*';
      expect(getAppOrigin()).toBe('https://nightplanner.onrender.com');
    } finally {
      if (origClient !== undefined) process.env.CLIENT_URL = origClient; else delete process.env.CLIENT_URL;
      if (origRender !== undefined) process.env.RENDER_EXTERNAL_URL = origRender; else delete process.env.RENDER_EXTERNAL_URL;
    }
  });

  it('ensures reading assignments never contain quiz links or quiz payloads for Telegram', () => {
    const assignmentParts = formatReadingAssignment(book, approved, [page]);
    const text = assignmentParts.join('');
    expect(text).not.toContain('🎯 <b>Interactive Practice Quiz:</b>');
    expect(text).not.toContain('/quiz');
  });
});
