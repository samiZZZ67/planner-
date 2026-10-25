import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from '../neon';
import { sendChatCompletionWithFallback, getGatewayConfig } from '../freellm/gateway';
import {
  sendTelegramQuizPoll,
  sendTelegramMessageWithKeyboard,
  answerTelegramCallback,
  editTelegramMessageText,
  sendTelegramTextToChannel,
  splitTelegramText,
  formatTelegramMessage,
  sanitizeUtf8,
  truncateUnicode,
  type InlineKeyboardButton,
  type TelegramPollResult,
} from '../telegram';
import { listBookPages, updateBook } from '../books';
import { updateBookAssignment } from '../bookAssignments';
import type { BookRecord, BookPageRecord, BookAssignmentRecord } from '../../books/types';
import { distributeOptionsBalanced, shuffleOptionsWithKey } from './quizShuffle';

const DATA_DIR = process.env.BOOK_DATA_DIR || path.join(process.cwd(), '.data');
const SESSIONS_PATH = path.join(DATA_DIR, 'book-quiz-sessions.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'book-quiz-settings.json');
const POLL_MAP_PATH = path.join(DATA_DIR, 'book-quiz-poll-map.json');

// --- Types ---

export interface BookQuizQuestion {
  id: string; // e.g. "q_0"
  question: string; // concise question grounded in the book (max 300 chars)
  options: string[]; // 2-4 choices (max 100 chars each)
  correctOptionId: number; // 0-based index
  conciseExplanation: string; // short summary for Telegram quiz bubble (max 200 chars)
  detailedExplanation: string; // full explanation why the answer is correct/incorrect
  definition: {
    term: string;
    explanation: string;
    pdfPage?: number;
  };
  practicalExample: {
    kind: 'source' | 'illustrative';
    situation: string;
    lesson: string;
    sourceDisclosure?: string;
    pdfPage?: number;
  };
  sourcePdfPages: number[];
}

export interface BookQuizSection {
  sectionIndex: number;
  title: string;
  startPdfPage: number;
  endPdfPage: number;
  originalExcerpt: string; // Exact unparaphrased text from the source pages
  questions: BookQuizQuestion[];
}

export interface UserAnswerRecord {
  questionId: string;
  sectionIndex: number;
  questionIndex: number;
  selectedOptionId: number;
  isCorrect: boolean;
  answeredAt: number;
  voterId?: number;
  voterName?: string;
}

export interface BookQuizSettings {
  userId: string;
  enabled: boolean;
  questionsPerSection: number; // 1-5 (default 2)
  deliveryTiming: 'with_reading' | 'on_demand'; // default 'with_reading'
  revealExplanation: 'after_answer' | 'immediate'; // default 'after_answer'
  updatedAt: number;
}

export interface BookQuizSession {
  id: string;
  userId: string;
  bookId: string;
  assignmentId: string;
  bookTitle: string;
  author?: string;
  dayNumber: number;
  chatId: string;
  status: 'active' | 'completed' | 'abandoned';
  currentSectionIndex: number;
  currentQuestionIndex: number;
  totalSections: number;
  totalQuestions: number;
  sections: BookQuizSection[];
  answers: Record<string, UserAnswerRecord>;
  lastPollMessageId?: number;
  lastControlMessageId?: number;
  lastPollId?: string;
  settings: BookQuizSettings;
  score: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
}

export interface PollToQuizMapping {
  pollId: string;
  sessionId: string;
  questionId: string;
  sectionIndex: number;
  questionIndex: number;
  updatedAt: number;
}

// --- File Storage Helpers ---

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(filePath: string, data: T): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    try {
      fs.renameSync(tempPath, filePath);
    } catch {
      fs.copyFileSync(tempPath, filePath);
      fs.rmSync(tempPath, { force: true });
    }
  } catch (err) {
    console.error(`[BookQuiz] Failed to write JSON to ${filePath}:`, err);
  }
}

// --- Database Schema ---

let schemaPromise: Promise<void> | null = null;

async function ensureQuizSchema(sql: NonNullable<ReturnType<typeof getDb>>): Promise<void> {
  if (process.env.VITEST) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS book_quiz_sessions (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        book_id VARCHAR(64) NOT NULL,
        assignment_id VARCHAR(64) NOT NULL,
        chat_id VARCHAR(64) NOT NULL,
        status VARCHAR(20) NOT NULL,
        data JSONB NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_quiz_sessions_owner ON book_quiz_sessions(user_id, updated_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_quiz_sessions_assignment ON book_quiz_sessions(assignment_id)`;

      await sql`CREATE TABLE IF NOT EXISTS book_quiz_settings (
        user_id VARCHAR(64) PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        questions_per_section INTEGER NOT NULL DEFAULT 2,
        delivery_timing VARCHAR(20) NOT NULL DEFAULT 'with_reading',
        reveal_explanation VARCHAR(20) NOT NULL DEFAULT 'after_answer',
        updated_at BIGINT NOT NULL
      )`;

      await sql`CREATE TABLE IF NOT EXISTS book_quiz_poll_map (
        poll_id VARCHAR(64) PRIMARY KEY,
        session_id VARCHAR(64) NOT NULL,
        question_id VARCHAR(64) NOT NULL,
        section_index INTEGER NOT NULL,
        question_index INTEGER NOT NULL,
        updated_at BIGINT NOT NULL
      )`;
    })().catch(err => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

// --- Settings Management ---

export const DEFAULT_QUIZ_SETTINGS: BookQuizSettings = {
  userId: 'owner',
  enabled: true,
  questionsPerSection: 2,
  deliveryTiming: 'with_reading',
  revealExplanation: 'after_answer',
  updatedAt: Date.now(),
};

export async function getBookQuizSettings(userId: string): Promise<BookQuizSettings> {
  const sql = getDb();
  if (sql) {
    await ensureQuizSchema(sql);
    const rows = await sql`SELECT enabled, questions_per_section, delivery_timing, reveal_explanation, updated_at
      FROM book_quiz_settings WHERE user_id = ${userId} LIMIT 1`;
    if (rows[0]) {
      return {
        userId,
        enabled: Boolean(rows[0].enabled),
        questionsPerSection: Math.max(1, Math.min(5, Number(rows[0].questions_per_section) || 2)),
        deliveryTiming: rows[0].delivery_timing === 'on_demand' ? 'on_demand' : 'with_reading',
        revealExplanation: rows[0].reveal_explanation === 'immediate' ? 'immediate' : 'after_answer',
        updatedAt: Number(rows[0].updated_at) || Date.now(),
      };
    }
  }

  const all = readJson<BookQuizSettings[]>(SETTINGS_PATH, []);
  const found = all.find(s => s.userId === userId);
  return found ? { ...DEFAULT_QUIZ_SETTINGS, ...found } : { ...DEFAULT_QUIZ_SETTINGS, userId };
}

export async function updateBookQuizSettings(
  userId: string,
  updates: Partial<Omit<BookQuizSettings, 'userId' | 'updatedAt'>>
): Promise<BookQuizSettings> {
  const current = await getBookQuizSettings(userId);
  const updated: BookQuizSettings = {
    ...current,
    ...updates,
    userId,
    questionsPerSection: updates.questionsPerSection !== undefined
      ? Math.max(1, Math.min(5, Number(updates.questionsPerSection)))
      : current.questionsPerSection,
    updatedAt: Date.now(),
  };

  const sql = getDb();
  if (sql) {
    await ensureQuizSchema(sql);
    await sql`INSERT INTO book_quiz_settings (user_id, enabled, questions_per_section, delivery_timing, reveal_explanation, updated_at)
      VALUES (${userId}, ${updated.enabled}, ${updated.questionsPerSection}, ${updated.deliveryTiming}, ${updated.revealExplanation}, ${updated.updatedAt})
      ON CONFLICT (user_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        questions_per_section = EXCLUDED.questions_per_section,
        delivery_timing = EXCLUDED.delivery_timing,
        reveal_explanation = EXCLUDED.reveal_explanation,
        updated_at = EXCLUDED.updated_at`;
  }

  const all = readJson<BookQuizSettings[]>(SETTINGS_PATH, []);
  const index = all.findIndex(s => s.userId === userId);
  if (index >= 0) all[index] = updated; else all.push(updated);
  writeJson(SETTINGS_PATH, all);

  return updated;
}

// --- Session Persistence ---

export async function saveQuizSession(session: BookQuizSession): Promise<BookQuizSession> {
  const updated = { ...session, updatedAt: Date.now() };
  const sql = getDb();
  if (sql) {
    await ensureQuizSchema(sql);
    await sql`INSERT INTO book_quiz_sessions (id, user_id, book_id, assignment_id, chat_id, status, data, created_at, updated_at)
      VALUES (${updated.id}, ${updated.userId}, ${updated.bookId}, ${updated.assignmentId}, ${updated.chatId}, ${updated.status}, ${JSON.stringify(updated)}::jsonb, ${updated.createdAt}, ${updated.updatedAt})
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        data = EXCLUDED.data,
        updated_at = EXCLUDED.updated_at`;
  }

  const all = readJson<BookQuizSession[]>(SESSIONS_PATH, []);
  const index = all.findIndex(s => s.id === updated.id);
  if (index >= 0) all[index] = updated; else all.push(updated);
  writeJson(SESSIONS_PATH, all);

  return updated;
}

export async function getQuizSession(sessionId: string): Promise<BookQuizSession | null> {
  const sql = getDb();
  if (sql) {
    await ensureQuizSchema(sql);
    const rows = await sql`SELECT data FROM book_quiz_sessions WHERE id = ${sessionId} LIMIT 1`;
    if (rows[0]?.data) return rows[0].data as BookQuizSession;
  }

  const all = readJson<BookQuizSession[]>(SESSIONS_PATH, []);
  return all.find(s => s.id === sessionId) || null;
}

export async function getActiveQuizSessionForAssignment(userId: string, assignmentId: string): Promise<BookQuizSession | null> {
  const sql = getDb();
  if (sql) {
    await ensureQuizSchema(sql);
    const rows = await sql`SELECT data FROM book_quiz_sessions WHERE user_id = ${userId} AND assignment_id = ${assignmentId} AND status = 'active' ORDER BY updated_at DESC LIMIT 1`;
    if (rows[0]?.data) return rows[0].data as BookQuizSession;
  }

  const all = readJson<BookQuizSession[]>(SESSIONS_PATH, []);
  return all.find(s => s.userId === userId && s.assignmentId === assignmentId && s.status === 'active') || null;
}

export async function listRecentQuizSessions(userId: string, limit = 20): Promise<BookQuizSession[]> {
  const sql = getDb();
  if (sql) {
    await ensureQuizSchema(sql);
    const rows = await sql`SELECT data FROM book_quiz_sessions WHERE user_id = ${userId} ORDER BY updated_at DESC LIMIT ${limit}`;
    return rows.map((r: any) => r.data as BookQuizSession);
  }

  const all = readJson<BookQuizSession[]>(SESSIONS_PATH, []);
  return all.filter(s => s.userId === userId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

// --- Poll Mapping Helpers ---

export async function registerPollMapping(mapping: PollToQuizMapping): Promise<void> {
  const sql = getDb();
  if (sql) {
    await ensureQuizSchema(sql);
    await sql`INSERT INTO book_quiz_poll_map (poll_id, session_id, question_id, section_index, question_index, updated_at)
      VALUES (${mapping.pollId}, ${mapping.sessionId}, ${mapping.questionId}, ${mapping.sectionIndex}, ${mapping.questionIndex}, ${mapping.updatedAt})
      ON CONFLICT (poll_id) DO UPDATE SET
        session_id = EXCLUDED.session_id,
        question_id = EXCLUDED.question_id,
        section_index = EXCLUDED.section_index,
        question_index = EXCLUDED.question_index,
        updated_at = EXCLUDED.updated_at`;
  }

  const all = readJson<PollToQuizMapping[]>(POLL_MAP_PATH, []);
  const index = all.findIndex(m => m.pollId === mapping.pollId);
  if (index >= 0) all[index] = mapping; else all.push(mapping);
  writeJson(POLL_MAP_PATH, all);
}

export async function getPollMapping(pollId: string): Promise<PollToQuizMapping | null> {
  const sql = getDb();
  if (sql) {
    await ensureQuizSchema(sql);
    const rows = await sql`SELECT poll_id, session_id, question_id, section_index, question_index, updated_at
      FROM book_quiz_poll_map WHERE poll_id = ${pollId} LIMIT 1`;
    if (rows[0]) {
      return {
        pollId: rows[0].poll_id,
        sessionId: rows[0].session_id,
        questionId: rows[0].question_id,
        sectionIndex: Number(rows[0].section_index),
        questionIndex: Number(rows[0].question_index),
        updatedAt: Number(rows[0].updated_at),
      };
    }
  }

  const all = readJson<PollToQuizMapping[]>(POLL_MAP_PATH, []);
  return all.find(m => m.pollId === pollId) || null;
}

// --- AI Question Generation with Deterministic Grounded Fallback ---

function parseJsonSafe(content: string): any {
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(content.slice(start, end + 1));
    } catch { /* ignore */ }
  }
  const objStart = content.indexOf('{');
  const objEnd = content.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) {
    try {
      const obj = JSON.parse(content.slice(objStart, objEnd + 1));
      return obj.questions || obj.items || [obj];
    } catch { /* ignore */ }
  }
  return null;
}

export function generateDeterministicQuestions(
  book: BookRecord,
  pages: BookPageRecord[],
  startPage: number,
  endPage: number,
  count = 2,
  studyNotes?: BookAssignmentRecord['studyNotes']
): BookQuizQuestion[] {
  const questions: BookQuizQuestion[] = [];
  const relevantPages = pages.filter(p => p.pdfPage >= startPage && p.pdfPage <= endPage);

  // 1. If study notes contain validated questions, convert them into rich multiple-choice quiz questions
  if (studyNotes?.questions?.length) {
    for (let i = 0; i < Math.min(count, studyNotes.questions.length); i++) {
      const item = studyNotes.questions[i];
      const termDef = studyNotes.definitions?.[i] || studyNotes.definitions?.[0] || {
        term: book.title,
        explanation: studyNotes.summary,
        pdfPage: startPage,
      };
      const example = studyNotes.example || {
        kind: 'illustrative' as const,
        situation: 'Applying the principles in focused daily practice.',
        lesson: 'Disciplined deep work produces disproportionate results.',
        sourceDisclosure: 'Illustrative application',
        pdfPage: startPage,
      };

      const correctAns = truncateUnicode(item.answer, 95);
      const distractors = [
        `Misinterpreting ${termDef.term} as standard passive reading without practice.`,
        `Relying solely on brief superficial reviews rather than deep analysis.`,
        `Postponing structured execution indefinitely without deliberate scheduling.`,
      ].map(d => truncateUnicode(d, 95));

      const { options, correctIndex } = distributeOptionsBalanced(correctAns, distractors, i);

      questions.push({
        id: `q_${questions.length}`,
        question: truncateUnicode(item.question, 290),
        options,
        correctOptionId: correctIndex,
        conciseExplanation: `Correct! ${truncateUnicode(correctAns, 180)}`,
        detailedExplanation: `According to ${book.title} (PDF p. ${item.pdfPages?.join(', ') || startPage}): ${item.answer}`,
        definition: {
          term: termDef.term,
          explanation: termDef.explanation,
          pdfPage: termDef.pdfPage || startPage,
        },
        practicalExample: {
          kind: example.kind === 'source' ? 'source' : 'illustrative',
          situation: example.situation,
          lesson: example.lesson,
          sourceDisclosure: example.sourceDisclosure || `Original book text (PDF p. ${startPage})`,
          pdfPage: example.pdfPage || startPage,
        },
        sourcePdfPages: item.pdfPages?.length ? item.pdfPages : [startPage],
      });
    }
  }

  // 2. If we need more questions, generate grounded concept questions from page sentences
  while (questions.length < count) {
    const qIdx = questions.length;
    const page = relevantPages[qIdx % relevantPages.length] || relevantPages[0] || { pdfPage: startPage, text: book.title };
    const sentences = page.text
      .split(/(?<=[.?!])\s+/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 25 && s.length < 200 && !/^\d+$/.test(s));

    const coreSentence = sentences[qIdx % Math.max(1, sentences.length)] || `Key foundation from PDF page ${page.pdfPage} of ${book.title}.`;
    const prompt = `What core insight is established in PDF page ${page.pdfPage} of ${book.title}?`;

    const correct = truncateUnicode(coreSentence, 95);
    const candidateDistractors = [
      `Superficial multitasking without concentrated focus.`,
      `Discarding deliberate practice in favor of passive observation.`,
      `Randomizing task execution without adhering to schedule principles.`,
    ];

    const { options, correctIndex } = distributeOptionsBalanced(correct, candidateDistractors, qIdx);

    questions.push({
      id: `q_${qIdx}`,
      question: truncateUnicode(prompt, 290),
      options,
      correctOptionId: correctIndex,
      conciseExplanation: `Correct! Grounded in PDF page ${page.pdfPage}: "${truncateUnicode(correct, 150)}"`,
      detailedExplanation: `In ${book.title} (PDF page ${page.pdfPage}), the text directly emphasizes: "${coreSentence}"`,
      definition: {
        term: `Principle (PDF p. ${page.pdfPage})`,
        explanation: coreSentence,
        pdfPage: page.pdfPage,
      },
      practicalExample: {
        kind: 'source',
        situation: `Direct instruction from PDF page ${page.pdfPage}.`,
        lesson: `Follow the verified methodology outlined in the book.`,
        sourceDisclosure: `PDF page ${page.pdfPage}`,
        pdfPage: page.pdfPage,
      },
      sourcePdfPages: [page.pdfPage],
    });
  }

  return questions.slice(0, count);
}

export async function generateBookQuizQuestions(options: {
  book: BookRecord;
  assignment: BookAssignmentRecord;
  pages: BookPageRecord[];
  startPage: number;
  endPage: number;
  count: number;
  model?: string;
}): Promise<BookQuizQuestion[]> {
  const { book, assignment, pages, startPage, endPage, count } = options;
  const relevantPages = pages.filter(p => p.pdfPage >= startPage && p.pdfPage <= endPage);

  if (process.env.VITEST || !relevantPages.length) {
    return generateDeterministicQuestions(book, pages, startPage, endPage, count, assignment.studyNotes);
  }

  const model = options.model?.trim() || getGatewayConfig().defaultModel || 'auto';
  const sourceContext = relevantPages.map(p => `[PDF Page ${p.pdfPage}]\n${p.text}`).join('\n\n').slice(0, 18000);

  try {
    const response = await sendChatCompletionWithFallback({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: `You are generating an interactive Telegram Quiz grounded strictly in the provided book excerpt.
Rules:
1. Generate exactly ${count} multiple-choice questions.
2. Questions must be strictly derived from the provided original text. Do not invent facts, quotes, or external concepts.
3. Length limits:
   - "question": 1-290 characters.
   - "options": exactly 3 or 4 choices, each 1-95 characters.
   - "correctOptionId": integer 0 to options.length - 1.
   - "conciseExplanation": concise summary under 200 characters explaining why the correct choice is right (Telegram native poll limit).
   - "detailedExplanation": complete explanation why the choice is right and others are distractors.
   - "definition": {"term":"...","explanation":"...","pdfPage":number}.
   - "practicalExample": {"kind":"source or illustrative","situation":"...","lesson":"...","sourceDisclosure":"...","pdfPage":number}.
   - "sourcePdfPages": [number].
4. Return ONLY a valid JSON array of objects conforming to the schema.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            bookTitle: book.title,
            author: book.author,
            sectionPages: [startPage, endPage],
            sourceText: sourceContext,
          }),
        },
      ],
    });

    const parsed = parseJsonSafe(response.content);
    if (Array.isArray(parsed) && parsed.length >= 1) {
      const validated: BookQuizQuestion[] = [];
      for (let i = 0; i < Math.min(count, parsed.length); i++) {
        const item = parsed[i];
        const question = truncateUnicode(String(item.question || '').trim(), 290);
        const optionsList = Array.isArray(item.options) ? item.options.map((o: any) => truncateUnicode(String(o).trim(), 95)).filter(Boolean) : [];
        if (question && optionsList.length >= 2) {
          const rawCorrectId = Number.isInteger(Number(item.correctOptionId))
            ? Math.max(0, Math.min(Number(item.correctOptionId), optionsList.length - 1))
            : 0;
          const rawOptions = optionsList.slice(0, 4).map((o: any) => sanitizeUtf8(o));
          const { options: syncedOptions, correctIndex: syncedCorrectId } = shuffleOptionsWithKey(rawOptions, rawCorrectId);

          validated.push({
            id: `q_${i}`,
            question: sanitizeUtf8(question),
            options: syncedOptions,
            correctOptionId: syncedCorrectId,
            conciseExplanation: truncateUnicode(sanitizeUtf8(String(item.conciseExplanation || `Correct! Grounded in PDF pages ${startPage}-${endPage}.`).trim()), 195),
            detailedExplanation: sanitizeUtf8(String(item.detailedExplanation || `Based on ${book.title}.`).trim()),
            definition: {
              term: sanitizeUtf8(String(item.definition?.term || book.title).trim()),
              explanation: sanitizeUtf8(String(item.definition?.explanation || 'Core book concept.').trim()),
              pdfPage: Number(item.definition?.pdfPage) || startPage,
            },
            practicalExample: {
              kind: item.practicalExample?.kind === 'source' ? 'source' : 'illustrative',
              situation: sanitizeUtf8(String(item.practicalExample?.situation || 'Applying this principle in study.').trim()),
              lesson: sanitizeUtf8(String(item.practicalExample?.lesson || 'Focus and practice yield success.').trim()),
              sourceDisclosure: sanitizeUtf8(String(item.practicalExample?.sourceDisclosure || `PDF page ${startPage}`).trim()),
              pdfPage: Number(item.practicalExample?.pdfPage) || startPage,
            },
            sourcePdfPages: Array.isArray(item.sourcePdfPages) ? item.sourcePdfPages.map(Number) : [startPage],
          });
        }
      }
      if (validated.length >= 1) return validated;
    }
  } catch (err) {
    console.warn('[BookQuiz] AI quiz generation failed; using deterministic grounded generator:', err);
  }

  return generateDeterministicQuestions(book, pages, startPage, endPage, count, assignment.studyNotes);
}

// --- Reading Section & Quiz Builder ---

export async function buildQuizSectionsForAssignment(
  book: BookRecord,
  assignment: BookAssignmentRecord,
  pages: BookPageRecord[],
  settings: BookQuizSettings
): Promise<BookQuizSection[]> {
  const orderedPages = [...pages].sort((a, b) => a.pdfPage - b.pdfPage);
  if (!orderedPages.length) {
    throw new Error(`No extracted pages found for Day ${assignment.dayNumber} (PDF pages ${assignment.startPdfPage}–${assignment.endPdfPage}).`);
  }

  const sections: BookQuizSection[] = [];
  const totalPages = orderedPages.length;
  // If assignment has <= 3 pages, use 1 section. If more, split into 2-page chunks.
  const pagesPerSection = totalPages <= 3 ? totalPages : 2;

  let pageIndex = 0;
  let sectionIndex = 0;

  while (pageIndex < totalPages) {
    const chunk = orderedPages.slice(pageIndex, pageIndex + pagesPerSection);
    const startPdfPage = chunk[0].pdfPage;
    const endPdfPage = chunk[chunk.length - 1].pdfPage;

    // Preserved UNPARAPHRASED original text excerpt
    const originalExcerpt = chunk.map(p => `[PDF Page ${p.pdfPage}]\n${p.text}`).join('\n\n');

    // Generate book-grounded questions
    const questions = await generateBookQuizQuestions({
      book,
      assignment,
      pages,
      startPage: startPdfPage,
      endPage: endPdfPage,
      count: settings.questionsPerSection,
    });

    sections.push({
      sectionIndex,
      title: `Section ${sectionIndex + 1} (PDF pages ${startPdfPage}–${endPdfPage})`,
      startPdfPage,
      endPdfPage,
      originalExcerpt,
      questions,
    });

    pageIndex += pagesPerSection;
    sectionIndex++;
  }

  return sections;
}

// --- Session Lifecycle & Telegram Dispatch ---

export function makeNavigationKeyboard(
  sessionId: string,
  sectionIndex: number,
  questionIndex: number,
  totalQuestionsInSection: number,
  totalSections: number
): InlineKeyboardButton[][] {
  const isLastQuestionInSection = questionIndex >= totalQuestionsInSection - 1;
  const isLastSection = sectionIndex >= totalSections - 1;

  const row1: InlineKeyboardButton[] = [
    { text: '💡 Repeat Explanation', callback_data: `quiz:exp:${sessionId}:${sectionIndex}:${questionIndex}` },
  ];

  if (!isLastQuestionInSection) {
    row1.push({ text: 'Next Question ➡️', callback_data: `quiz:next_q:${sessionId}:${sectionIndex}:${questionIndex + 1}` });
  } else if (!isLastSection) {
    row1.push({ text: '📖 Next Section ⏩', callback_data: `quiz:next_s:${sessionId}:${sectionIndex + 1}` });
  }

  const row2: InlineKeyboardButton[] = [];
  if (!isLastSection && !isLastQuestionInSection) {
    row2.push({ text: '📖 Next Section ⏩', callback_data: `quiz:next_s:${sessionId}:${sectionIndex + 1}` });
  }
  row2.push({ text: '🏁 Finish Session', callback_data: `quiz:fin:${sessionId}` });

  return [row1, row2];
}

export function formatLearningFeedbackCard(
  question: BookQuizQuestion,
  selectedOptionId?: number,
  isCorrect?: boolean
): string {
  const letters = ['A', 'B', 'C', 'D', 'E'];
  const correctLetter = letters[question.correctOptionId] || `#${question.correctOptionId + 1}`;
  const correctText = question.options[question.correctOptionId] || '';

  const statusHeader = selectedOptionId !== undefined
    ? (isCorrect
        ? `🎉 <b>Correct Answer! Well done!</b>`
        : `❌ <b>Incorrect!</b> You selected Option ${letters[selectedOptionId] || '#' + (selectedOptionId + 1)}.`)
    : `📘 <b>Learning Feedback & Concept Review</b>`;

  const lines = [
    statusHeader,
    `\n❓ <b>Question:</b> <i>${question.question}</i>`,
    `\n✅ <b>Correct Answer:</b> Option ${correctLetter}: <b>${correctText}</b>`,
    `💡 <b>Why it's correct:</b> ${question.detailedExplanation}`,
    `\n📖 <b>Core Definition:</b>`,
    `• <b>${question.definition.term}</b> (PDF p. ${question.definition.pdfPage || question.sourcePdfPages[0] || '?'})`,
    `  ${question.definition.explanation}`,
    `\n✨ <b>Practical Example:</b>`,
    `• <b>Situation:</b> ${question.practicalExample.situation}`,
    `• <b>Lesson:</b> ${question.practicalExample.lesson}`,
    `• <i>Source: ${question.practicalExample.sourceDisclosure || `PDF page ${question.practicalExample.pdfPage || question.sourcePdfPages[0]}`}</i>`,
  ];

  return lines.join('\n');
}

export async function sendQuizQuestion(
  session: BookQuizSession,
  sectionIndex: number,
  questionIndex: number
): Promise<{ pollResult: TelegramPollResult; controlMessageId: number }> {
  const section = session.sections[sectionIndex];
  if (!section) throw new Error(`Section ${sectionIndex} not found in quiz session.`);
  const question = section.questions[questionIndex];
  if (!question) throw new Error(`Question ${questionIndex} not found in Section ${sectionIndex}.`);

  // 1. Send native Telegram Quiz Poll
  const pollResult = await sendTelegramQuizPoll({
    chatId: session.chatId,
    question: truncateUnicode(`[Day ${session.dayNumber} · S${sectionIndex + 1}:Q${questionIndex + 1}] ${question.question}`, 300),
    options: question.options,
    correctOptionId: question.correctOptionId,
    explanation: truncateUnicode(question.conciseExplanation, 200),
    isAnonymous: false,
  });

  // Map poll ID to this session and question for update processing
  await registerPollMapping({
    pollId: pollResult.pollId,
    sessionId: session.id,
    questionId: question.id,
    sectionIndex,
    questionIndex,
    updatedAt: Date.now(),
  });

  // 2. Send accompanying Navigation Control Card with inline keyboard
  const navKeyboard = makeNavigationKeyboard(
    session.id,
    sectionIndex,
    questionIndex,
    section.questions.length,
    session.sections.length
  );

  const controlText = [
    `📍 <b>Reading & Quiz Progress:</b> Day ${session.dayNumber} · Section ${sectionIndex + 1} of ${session.sections.length}`,
    `❓ <b>Question ${questionIndex + 1} of ${section.questions.length}</b> (PDF pages ${section.startPdfPage}–${section.endPdfPage})`,
    `<i>Tap an answer above to test your recall. Use the buttons below to navigate:</i>`,
  ].join('\n');

  const controlMsg = await sendTelegramMessageWithKeyboard(session.chatId, controlText, navKeyboard);

  // 3. If immediate explanation is enabled in settings, post the learning feedback card right away
  if (session.settings.revealExplanation === 'immediate') {
    const feedback = formatLearningFeedbackCard(question);
    await sendTelegramTextToChannel(feedback, session.userId).catch(() => undefined);
  }

  // Update session pointers
  session.currentSectionIndex = sectionIndex;
  session.currentQuestionIndex = questionIndex;
  session.lastPollMessageId = pollResult.messageId;
  session.lastControlMessageId = controlMsg.message_id;
  session.lastPollId = pollResult.pollId;
  await saveQuizSession(session);

  return { pollResult, controlMessageId: controlMsg.message_id };
}

export async function sendSectionExcerpt(
  session: BookQuizSession,
  sectionIndex: number
): Promise<{ excerptMessageIds: number[] }> {
  const section = session.sections[sectionIndex];
  if (!section) throw new Error(`Section ${sectionIndex} not found in quiz session.`);

  const header = [
    `📖 <b>ORIGINAL BOOK READING · DAY ${session.dayNumber}</b>`,
    `📚 <b>${session.bookTitle}</b>${session.author ? ` — ${session.author}` : ''}`,
    `📑 <b>Section ${sectionIndex + 1} of ${session.sections.length} · PDF Pages ${section.startPdfPage}–${section.endPdfPage}</b>`,
    `<i>Read the original unedited book excerpt below, then answer the interactive quiz questions that follow:</i>`,
  ].join('\n');

  // Split large book excerpts safely according to Telegram HTML length limits
  const parts = splitTelegramText(`${header}\n\n${section.originalExcerpt}`, 3400);
  const sentIds: number[] = [];

  for (const part of parts) {
    const res = await sendTelegramTextToChannel(part, session.userId);
    if (res.messageId) sentIds.push(res.messageId);
    if (res.messageIds?.length) sentIds.push(...res.messageIds);
  }

  return { excerptMessageIds: sentIds };
}

export async function startQuizSessionForAssignment(
  userId: string,
  book: BookRecord,
  assignment: BookAssignmentRecord,
  pages: BookPageRecord[],
  chatId: string,
  options?: { skipFirstExcerpt?: boolean; skipTelegramMessages?: boolean }
): Promise<BookQuizSession> {
  const hasReadablePages = pages.some(p => p.text?.trim() && p.method !== 'empty');
  if (!hasReadablePages) {
    console.log(`[BookQuiz] Skipping interactive quiz for Day ${assignment.dayNumber}: all pages in section are blank or illustration pages.`);
    const emptySession: BookQuizSession = {
      id: randomUUID(),
      userId,
      bookId: book.id,
      assignmentId: assignment.id,
      bookTitle: book.title,
      author: book.author,
      dayNumber: assignment.dayNumber,
      chatId,
      status: 'completed',
      currentSectionIndex: 0,
      currentQuestionIndex: 0,
      totalSections: 0,
      totalQuestions: 0,
      sections: [],
      answers: {},
      settings: await getBookQuizSettings(userId),
      score: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: Date.now(),
    };
    return emptySession;
  }
  const settings = await getBookQuizSettings(userId);
  const sections = await buildQuizSectionsForAssignment(book, assignment, pages, settings);

  const totalQuestions = sections.reduce((sum, sec) => sum + sec.questions.length, 0);
  const sessionId = randomUUID();

  const session: BookQuizSession = {
    id: sessionId,
    userId,
    bookId: book.id,
    assignmentId: assignment.id,
    bookTitle: book.title,
    author: book.author,
    dayNumber: assignment.dayNumber,
    chatId,
    status: 'active',
    currentSectionIndex: 0,
    currentQuestionIndex: 0,
    totalSections: sections.length,
    totalQuestions,
    sections,
    answers: {},
    settings,
    score: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null,
  };

  await saveQuizSession(session);

  // If skipTelegramMessages is true, do not dispatch any messages or polls to Telegram
  if (!options?.skipTelegramMessages) {
    // Send Section 1's original unparaphrased excerpt unless caller already posted it
    if (!options?.skipFirstExcerpt) {
      await sendSectionExcerpt(session, 0);
    }

    // If timing is 'on_demand', send a prompt button to start the quiz
    if (settings.deliveryTiming === 'on_demand') {
      const startKeyboard: InlineKeyboardButton[][] = [
        [{ text: `🎯 Start Section 1 Quiz (${sections[0].questions.length} Questions)`, callback_data: `quiz:start:${sessionId}` }],
      ];
      await sendTelegramMessageWithKeyboard(
        chatId,
        `📖 <b>Section 1 Reading Delivered!</b>\nWhen you have finished reading PDF pages ${sections[0].startPdfPage}–${sections[0].endPdfPage}, tap the button below to start your interactive quiz questions:`,
        startKeyboard
      );
    } else {
      // Default 'with_reading': immediately launch Question 1
      await sendQuizQuestion(session, 0, 0);
    }
  }

  return session;
}

// --- Callback & Poll Update Handlers ---

export async function handleQuizCallback(
  callbackQueryId: string,
  callbackData: string,
  fromUser?: { id?: number; first_name?: string; username?: string }
): Promise<{ handled: boolean; action: string; message?: string }> {
  const parts = callbackData.split(':');
  if (parts[0] !== 'quiz') return { handled: false, action: 'ignored' };

  const action = parts[1]; // 'next_q' | 'exp' | 'next_s' | 'fin' | 'start'
  const sessionId = parts[2];

  const session = await getQuizSession(sessionId);
  if (!session) {
    await answerTelegramCallback(callbackQueryId, 'Quiz session expired or not found.', true);
    return { handled: true, action: 'session_not_found' };
  }

  if (action === 'start') {
    await answerTelegramCallback(callbackQueryId, 'Starting Quiz Question 1! 🚀');
    await sendQuizQuestion(session, 0, 0);
    return { handled: true, action: 'started_quiz' };
  }

  if (action === 'next_q') {
    const secIdx = Number(parts[3]) || 0;
    const qIdx = Number(parts[4]) || 0;
    const section = session.sections[secIdx];
    if (!section || !section.questions[qIdx]) {
      await answerTelegramCallback(callbackQueryId, 'No more questions in this section. Moving to next section...');
      if (secIdx + 1 < session.sections.length) {
        await sendSectionExcerpt(session, secIdx + 1);
        await sendQuizQuestion(session, secIdx + 1, 0);
        return { handled: true, action: 'advanced_to_next_section' };
      }
      return await finishQuizSession(session, callbackQueryId);
    }
    await answerTelegramCallback(callbackQueryId, `Loading Question ${qIdx + 1}...`);
    await sendQuizQuestion(session, secIdx, qIdx);
    return { handled: true, action: 'next_question_sent' };
  }

  if (action === 'exp') {
    const secIdx = Number(parts[3]) || 0;
    const qIdx = Number(parts[4]) || 0;
    const section = session.sections[secIdx];
    const question = section?.questions[qIdx];
    if (!question) {
      await answerTelegramCallback(callbackQueryId, 'Question details not found.', true);
      return { handled: true, action: 'question_not_found' };
    }
    await answerTelegramCallback(callbackQueryId, 'Displaying Learning Feedback! 💡');
    const existingAnswer = session.answers[question.id];
    const card = formatLearningFeedbackCard(
      question,
      existingAnswer?.selectedOptionId,
      existingAnswer?.isCorrect
    );
    await sendTelegramTextToChannel(card, session.userId);
    return { handled: true, action: 'explanation_repeated' };
  }

  if (action === 'next_s') {
    const nextSecIdx = Number(parts[3]) || (session.currentSectionIndex + 1);
    if (nextSecIdx >= session.sections.length) {
      return await finishQuizSession(session, callbackQueryId);
    }
    await answerTelegramCallback(callbackQueryId, `Loading Section ${nextSecIdx + 1}... 📖`);
    await sendSectionExcerpt(session, nextSecIdx);
    await sendQuizQuestion(session, nextSecIdx, 0);
    return { handled: true, action: 'next_section_sent' };
  }

  if (action === 'fin') {
    return await finishQuizSession(session, callbackQueryId);
  }

  return { handled: false, action: 'unknown_action' };
}

async function finishQuizSession(
  session: BookQuizSession,
  callbackQueryId?: string
): Promise<{ handled: boolean; action: string }> {
  if (callbackQueryId) {
    await answerTelegramCallback(callbackQueryId, 'Finishing Reading & Quiz Session! 🏁');
  }

  const answeredCount = Object.keys(session.answers).length;
  const scorePercent = answeredCount > 0 ? Math.round((session.score / answeredCount) * 100) : 100;

  session.status = 'completed';
  session.completedAt = Date.now();
  await saveQuizSession(session);

  const banner = [
    `🎉 <b>READING & QUIZ SESSION COMPLETED!</b>`,
    `📖 <b>Book:</b> ${session.bookTitle}`,
    `📅 <b>Day:</b> ${session.dayNumber} · All ${session.totalSections} section(s) reviewed`,
    `📊 <b>Quiz Score:</b> ${session.score} / ${answeredCount || session.totalQuestions} correct (${scorePercent}%)`,
    `🏆 <i>Great job! Today's assigned reading progress and comprehension review have been recorded.</i>`,
  ].join('\n');

  await sendTelegramTextToChannel(banner, session.userId);

  // Automatically advance reading assignment progress
  try {
    const { listBookAssignments } = await import('../bookAssignments');
    const assignments = await listBookAssignments(session.userId, session.bookId);
    const assignment = assignments.find(a => a.id === session.assignmentId);
    if (assignment && assignment.status !== 'completed') {
      await updateBookAssignment({
        ...assignment,
        status: 'completed',
        deliveryStatus: 'sent',
        deliveredAt: Date.now(),
        updatedAt: Date.now(),
      });
      const { getBook } = await import('../books');
      const book = await getBook(session.userId, session.bookId);
      if (book) {
        const nextCurrentPage = Math.min(book.endPage + 1, Math.max(book.currentPage, assignment.endPdfPage + 1));
        await updateBook({
          ...book,
          currentPage: nextCurrentPage,
          status: nextCurrentPage > book.endPage ? 'ready' : book.status,
        });
      }
    }
  } catch (err) {
    console.warn('[BookQuiz] Could not advance assignment status on finish:', err);
  }

  return { handled: true, action: 'session_completed' };
}

export async function handlePollAnswer(pollAnswer: {
  poll_id: string;
  user?: { id?: number; first_name?: string; username?: string };
  option_ids: number[];
}): Promise<{ handled: boolean; isCorrect?: boolean; feedbackSent?: boolean }> {
  const mapping = await getPollMapping(pollAnswer.poll_id);
  if (!mapping) {
    return { handled: false };
  }

  const session = await getQuizSession(mapping.sessionId);
  if (!session) return { handled: false };

  const section = session.sections[mapping.sectionIndex];
  const question = section?.questions[mapping.questionIndex];
  if (!question) return { handled: false };

  const selectedOptionId = pollAnswer.option_ids[0] ?? -1;
  const isCorrect = selectedOptionId === question.correctOptionId;

  // Record user response
  const answerRecord: UserAnswerRecord = {
    questionId: question.id,
    sectionIndex: mapping.sectionIndex,
    questionIndex: mapping.questionIndex,
    selectedOptionId,
    isCorrect,
    answeredAt: Date.now(),
    voterId: pollAnswer.user?.id,
    voterName: pollAnswer.user?.first_name || pollAnswer.user?.username,
  };

  const wasAlreadyAnswered = Boolean(session.answers[question.id]);
  session.answers[question.id] = answerRecord;

  if (!wasAlreadyAnswered && isCorrect) {
    session.score += 1;
  }
  await saveQuizSession(session);

  // If revealExplanation is 'after_answer', dispatch the rich learning feedback card!
  let feedbackSent = false;
  if (session.settings.revealExplanation === 'after_answer') {
    const card = formatLearningFeedbackCard(question, selectedOptionId, isCorrect);
    await sendTelegramTextToChannel(card, session.userId).catch(() => undefined);
    feedbackSent = true;
  }

  return { handled: true, isCorrect, feedbackSent };
}

// --- Background / Polling Update Processor ---

let lastProcessedUpdateId = 0;

export async function processTelegramUpdates(): Promise<{ processedCount: number; lastUpdateId: number }> {
  const { getTelegramUpdates } = await import('../telegram');
  const updates = await getTelegramUpdates(lastProcessedUpdateId > 0 ? lastProcessedUpdateId + 1 : undefined);

  let processedCount = 0;
  for (const update of updates) {
    if (update.update_id > lastProcessedUpdateId) {
      lastProcessedUpdateId = update.update_id;
    }

    if (update.callback_query && update.callback_query.data) {
      await handleQuizCallback(
        update.callback_query.id,
        update.callback_query.data,
        update.callback_query.from
      );
      processedCount++;
    } else if (update.poll_answer) {
      await handlePollAnswer({
        poll_id: update.poll_answer.poll_id,
        user: update.poll_answer.user,
        option_ids: update.poll_answer.option_ids,
      });
      processedCount++;
    }
  }

  return { processedCount, lastUpdateId: lastProcessedUpdateId };
}
