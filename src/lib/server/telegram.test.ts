import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkTelegramChannel, formatReadingAssignment, splitTelegramText } from './telegram';
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
    expect(joined).toContain('Source: PDF page 1');
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
});
