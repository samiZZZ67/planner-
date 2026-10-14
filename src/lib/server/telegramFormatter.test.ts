import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectTelegramContentType,
  escapeTelegramHtml,
  formatMarkdownToTelegramHtml,
  formatTelegramMessage,
  sanitizeTelegramHtml,
  splitTelegramHtml,
  stripHtml,
} from './telegramFormatter';
import {
  checkTelegramChannel,
  formatLoadPlanPages,
  formatReadingAssignment,
  publishApprovedAssignment,
  publishLoadPlanPagesToTelegram,
  sendTelegramMessageWithFallback,
  sendTelegramTextToChannel,
  splitTelegramText,
} from './telegram';
import type { BookAssignmentRecord, BookPageRecord, BookRecord } from '../books/types';

const testBook: BookRecord = {
  id: 'test-book-1',
  userId: 'owner',
  title: 'Clean Architecture in TypeScript',
  author: 'Robert Martin & Co.',
  metadata: '',
  originalFilename: 'clean-arch.pdf',
  storedFilename: 'clean-arch.pdf',
  fileSize: 204800,
  startPage: 1,
  endPage: 5,
  durationDays: 5,
  startDate: '2026-10-15',
  studyMinutes: 45,
  postingTime: '08:00',
  timezone: 'Africa/Nairobi',
  currentPage: 1,
  status: 'ready',
  extractionStatus: 'completed',
  extractionMessage: '',
  totalPdfPages: 5,
  createdAt: 1,
  updatedAt: 1,
};

const testAssignment: BookAssignmentRecord = {
  id: 'test-assignment-1',
  userId: 'owner',
  bookId: 'test-book-1',
  dayNumber: 1,
  scheduledDate: '2026-10-15',
  startPdfPage: 1,
  endPdfPage: 1,
  concepts: [{ title: 'Dependency Inversion', concept: 'Depend on abstractions.', estimatedMinutes: 20 }],
  estimatedMinutes: 20,
  rationale: 'Foundational principle.',
  status: 'approved',
  updatedAt: 1,
  studyNotes: {
    summary: 'High-level modules should not depend on low-level modules; both should depend on abstractions.',
    keyConcepts: ['Inversion of Control', 'Decoupled Modules'],
    definitions: [{ term: 'DIP', explanation: 'Dependency Inversion Principle', pdfPage: 1 }],
    example: {
      kind: 'source',
      pdfPage: 1,
      situation: 'Database logger coupling.',
      conceptInAction: 'Use ILogger interface.',
      lesson: 'Decoupling enables testability.',
      sourceDisclosure: 'From chapter 11.',
    },
    questions: [{ question: 'What is DIP?', answer: 'Depend on abstractions.', pdfPages: [1] }],
    notes: 'Remember to define interfaces first.',
    generatedByModel: 'test-model',
    generatedAt: 1,
  },
};

const testPage: BookPageRecord = {
  bookId: 'test-book-1',
  pdfPage: 1,
  text: 'To build resilient software, interfaces must decouple services from implementations: if (service < 0 && client > 10) return false;',
  method: 'native',
  confidence: null,
  warnings: [],
  requiresReview: false,
  reviewedByUser: false,
  updatedAt: 1,
};

describe('AI-Powered Telegram Message Formatting Suite', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── TEST CASE 1: Normal text message ─────────────────────────────────────
  it('1. formats normal text messages cleanly while preserving original text, emojis, and line breaks', () => {
    const rawText = 'Welcome to NightPlanner! Today your schedule has 4 focus sessions.\n\nEnjoy deep work and keep pushing! 🚀';
    const formatted = formatTelegramMessage(rawText);

    // Preserves original words exactly
    expect(formatted).toContain('Welcome to NightPlanner!');
    expect(formatted).toContain('Today your schedule has 4 focus sessions.');
    expect(formatted).toContain('Enjoy deep work and keep pushing! 🚀');
    expect(formatted).toContain('\n\n');

    // Stripping HTML returns the exact original content
    expect(stripHtml(formatted).trim()).toBe(rawText.trim());
  });

  // ── TEST CASE 2: Bold, italic, strikethrough, headings ───────────────────
  it('2. converts markdown bold, italic, strikethrough, and headings into valid Telegram HTML', () => {
    const markdown = `# Daily Briefing\n\nThis is **high priority** work and *secondary focus*. Also note ~~deprecated task~~ was cancelled.`;
    const formatted = formatTelegramMessage(markdown);

    expect(formatted).toContain('<b>Daily Briefing</b>');
    expect(formatted).toContain('<b>high priority</b>');
    expect(formatted).toContain('<i>secondary focus</i>');
    expect(formatted).toContain('<s>deprecated task</s>');

    // Stripping HTML preserves exact text
    expect(stripHtml(formatted)).toContain('Daily Briefing');
    expect(stripHtml(formatted)).toContain('high priority');
    expect(stripHtml(formatted)).toContain('secondary focus');
    expect(stripHtml(formatted)).toContain('deprecated task');
  });

  // ── TEST CASE 3: URLs, hyperlinks, emojis, line breaks ───────────────────
  it('3. preserves and styles hyperlinks, raw URLs, emojis, and line breaks safely', () => {
    const input = `Check our website at https://nightplanner.app for updates.\nAlso see [Documentation](https://docs.nightplanner.app/api)!\n\nStatus: 🟢 All systems online 🚀 ✨`;
    const formatted = formatTelegramMessage(input);

    expect(formatted).toContain('<a href="https://nightplanner.app">https://nightplanner.app</a>');
    expect(formatted).toContain('<a href="https://docs.nightplanner.app/api">Documentation</a>');
    expect(formatted).toContain('🟢 All systems online 🚀 ✨');
    expect(formatted).toContain('\n\n');

    // URLs and destinations are preserved
    expect(formatted).not.toContain('&amp;https://');
  });

  // ── TEST CASE 4: Book excerpt with code, quotations, special characters ──
  it('4. preserves book excerpts verbatim, escaping special characters (<, >, &) and formatting code blocks', () => {
    const bookExcerpt = `[PDF page 1]\nAlgorithm definition:\n\`\`\`python\nif x < 10 and y > 20:\n    return "valid" & True\n\`\`\`\nQuotation: "Simplicity is prerequisite for reliability." — Edsger W. Dijkstra`;

    const formatted = formatTelegramMessage(bookExcerpt);

    // Page header formatted
    expect(formatted).toContain('📄 <b>[PDF page 1]</b>');

    // Special characters <, >, & safely escaped inside code block
    expect(formatted).toContain('&lt;');
    expect(formatted).toContain('&gt;');
    expect(formatted).toContain('&amp;');

    // Code block formatted with Telegram-supported <pre><code ...>
    expect(formatted).toContain('<pre><code class="language-python">');
    expect(formatted).toContain('</code></pre>');

    // Verbatim text preserved
    expect(stripHtml(formatted)).toContain('if x < 10 and y > 20:');
    expect(stripHtml(formatted)).toContain('Simplicity is prerequisite for reliability.');
  });

  // ── TEST CASE 5: Long message exceeding Telegram's single-message limit ─
  it('5. safely splits long messages (>3800 chars) while closing and reopening HTML tags across segments', () => {
    // Generate a long message wrapped in <blockquote> and <b>
    const longParagraph = 'Architectural boundaries separate software elements from one another. '.repeat(60);
    const longHtml = `<blockquote><b>${longParagraph}</b></blockquote>`;

    expect(longHtml.length).toBeGreaterThan(4000);

    const chunks = splitTelegramHtml(longHtml, 2000);
    expect(chunks.length).toBeGreaterThan(1);

    // Every chunk must be within the limit
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2100);
    }

    // Chunk 1 must close any tags opened within it
    expect(chunks[0].endsWith('</b></blockquote>')).toBe(true);

    // Chunk 2 must reopen those tags at its start
    expect(chunks[1].startsWith('<blockquote><b>')).toBe(true);
    expect(chunks[1].endsWith('</b></blockquote>')).toBe(true);

    // Combined stripped text must preserve all content
    const combinedText = chunks.map(c => stripHtml(c)).join('');
    expect(combinedText.replace(/\s+/g, ' ').trim()).toBe(
      stripHtml(longHtml).replace(/\s+/g, ' ').trim()
    );
  });

  // ── TEST CASE 6: Scheduled delivery and manual Send Now delivery ─────────
  it('6. integrates with Telegram delivery pipeline using parse_mode: HTML and returns receipts', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';
    process.env.TELEGRAM_CHAT_ID = '@test_channel';

    const sentRequests: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/getMe')) {
        return new Response(JSON.stringify({ ok: true, result: { id: 99, username: 'night_bot', first_name: 'NightBot' } }), { status: 200 });
      }
      if (u.endsWith('/getChat')) {
        return new Response(JSON.stringify({ ok: true, result: { id: -10099, title: 'Study Channel', type: 'channel' } }), { status: 200 });
      }
      if (u.endsWith('/getChatMember')) {
        return new Response(JSON.stringify({ ok: true, result: { status: 'administrator', can_post_messages: true } }), { status: 200 });
      }
      if (u.endsWith('/sendMessage')) {
        const payload = JSON.parse(String(init?.body || '{}'));
        sentRequests.push(payload);
        return new Response(JSON.stringify({ ok: true, result: { message_id: 501 + sentRequests.length } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    }));

    // 6a. Direct manual send
    const sendResult = await sendTelegramTextToChannel(
      '📅 **Daily Schedule Update**\n\n• Task 1: Complete Embedded Systems Lab\n• Task 2: Video editing 14:00'
    );
    expect(sendResult.messageId).toBeGreaterThan(0);
    expect(sentRequests.length).toBeGreaterThan(0);
    const directPayload = sentRequests[0];
    expect(directPayload.parse_mode).toBe('HTML');
    expect(directPayload.text).toContain('<b>Daily Schedule Update</b>');

    // 6b. Send Now load plan pages delivery
    const uniqueAssignment1: BookAssignmentRecord = {
      ...testAssignment,
      id: `test-assignment-loadplan-${crypto.randomUUID()}`,
    };
    const loadPlanResult = await publishLoadPlanPagesToTelegram('owner', testBook, uniqueAssignment1, [testPage]);
    expect(loadPlanResult.delivery.status).toBe('completed');
    expect(loadPlanResult.telegramMessageIds.length).toBeGreaterThan(0);

    const loadPlanPayloads = sentRequests.slice(1);
    expect(loadPlanPayloads.length).toBeGreaterThan(0);
    // Page section should be sent with parse_mode: 'HTML'
    expect(loadPlanPayloads.some(p => p.parse_mode === 'HTML')).toBe(true);

    // 6c. Approved assignment delivery
    const uniqueAssignment2: BookAssignmentRecord = {
      ...testAssignment,
      id: `test-assignment-approved-${crypto.randomUUID()}`,
      dayNumber: 2,
      scheduledDate: '2026-10-16',
    };
    const approvedResult = await publishApprovedAssignment('owner', testBook, uniqueAssignment2, [testPage]);
    expect(approvedResult.status).toBe('completed');
  });

  // ── TEST CASE 7: Malformed HTML & unsupported formatting fallback ─────────
  it('7. sanitizes malformed/unsupported HTML and falls back to plain text if Telegram rejects parsing', async () => {
    // 7a. Sanitizer strips invalid tags like <script>, <font>, <div> and balances unclosed <b>
    const malformed = `<div style="color:red"><font size="4"><span>Important: <b>Unclosed bold statement<script>alert(1)</script>`;
    const sanitized = sanitizeTelegramHtml(malformed);

    expect(sanitized).not.toContain('<div');
    expect(sanitized).not.toContain('<font');
    expect(sanitized).not.toContain('<script');
    expect(sanitized).toContain('Important: <b>Unclosed bold statement</b>');

    // 7b. API Fallback: If Telegram throws "can't parse entities", sendTelegramMessageWithFallback retries plain text
    const calls: { parse_mode?: string; text: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/getMe')) {
        return new Response(JSON.stringify({ ok: true, result: { id: 1 } }), { status: 200 });
      }
      if (u.endsWith('/sendMessage')) {
        const body = JSON.parse(String(init?.body || '{}'));
        calls.push(body);
        if (body.parse_mode === 'HTML' && body.text.includes('bad_entity')) {
          // Simulate Telegram 400 Bad Request entity parse error
          return new Response(
            JSON.stringify({
              ok: false,
              error_code: 400,
              description: "Bad Request: can't parse entities: Character '>' is reserved",
            }),
            { status: 400 }
          );
        }
        return new Response(JSON.stringify({ ok: true, result: { message_id: 888 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    }));

    const result = await sendTelegramMessageWithFallback('@test_channel', '<b>Hello</b> bad_entity > test');
    expect(result.message_id).toBe(888);

    // The first call was HTML, and upon failure, the second call retried without parse_mode
    expect(calls.length).toBe(2);
    expect(calls[0].parse_mode).toBe('HTML');
    expect(calls[1].parse_mode).toBeUndefined();
    expect(calls[1].text).toBe('Hello bad_entity > test');
  });

  // ── TEST CASE 8: Backward compatibility with splitTelegramText ───────────
  it('8. preserves backwards compatibility for splitTelegramText with Unicode codepoints', () => {
    const input = '📖' + 'y'.repeat(20);
    const pieces = splitTelegramText(input, 7);
    expect(pieces.every(piece => piece.length <= 7)).toBe(true);
    expect(pieces.join('')).toBe(input);
  });

  // ── TEST CASE 9: Content type detection accuracy ─────────────────────────
  it('9. accurately identifies content types', () => {
    expect(detectTelegramContentType('[PDF page 3]\nChapter text')).toBe('book_excerpt');
    expect(detectTelegramContentType('Study summary\nKey concepts\nDefinitions:')).toBe('educational');
    expect(detectTelegramContentType('```python\nprint("hello")\n```')).toBe('technical');
    expect(detectTelegramContentType('1. Open terminal\n2. Run build\n3. Deploy app')).toBe('list_instruction');
    expect(detectTelegramContentType('Hey, how are you doing today?')).toBe('general');
  });
});
