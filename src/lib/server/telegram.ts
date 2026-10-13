import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from './neon';
import type { BookAssignmentRecord, BookRecord, BookPageRecord } from '../books/types';

export type TelegramDeliveryStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'uncertain';
export interface TelegramDeliveryRecord {
  id: string;
  userId: string;
  bookId: string;
  assignmentId: string;
  status: TelegramDeliveryStatus;
  messageParts: string[];
  nextPart: number;
  telegramMessageIds: number[];
  lastError: string;
  safeToRetry: boolean;
  retryAfterAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const DATA_ROOT = process.env.BOOK_DATA_DIR?.trim() || path.join(process.cwd(), '.data');
const DELIVERY_PATH = path.join(DATA_ROOT, 'telegram-deliveries.json');
let schemaReady: Promise<void> | null = null;

function readDeliveries(): TelegramDeliveryRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(DELIVERY_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeDeliveries(records: TelegramDeliveryRecord[]) {
  fs.mkdirSync(path.dirname(DELIVERY_PATH), { recursive: true });
  const temp = `${DELIVERY_PATH}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(records, null, 2), 'utf8');
  fs.renameSync(temp, DELIVERY_PATH);
}

async function ensureSchema(sql: NonNullable<ReturnType<typeof getDb>>) {
  if (!schemaReady) {
    schemaReady = sql`CREATE TABLE IF NOT EXISTS telegram_deliveries (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      book_id VARCHAR(64) NOT NULL,
      assignment_id VARCHAR(64) NOT NULL,
      status VARCHAR(20) NOT NULL,
      data JSONB NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE(user_id, assignment_id)
    )`.then(async () => {
      await sql`CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_owner ON telegram_deliveries(user_id, updated_at DESC)`;
    }).catch(error => { schemaReady = null; throw error; });
  }
  await schemaReady;
}

function envConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) throw new Error('Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on the backend service.');
  return { token, chatId };
}

async function telegramCall<T>(method: string, payload?: unknown): Promise<T> {
  const { token } = envConfig();
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
  } catch {
    throw Object.assign(new Error('Telegram request timed out or could not connect. Check delivery status before retrying.'), { uncertain: method === 'sendMessage' });
  }
  const data = await response.json().catch(() => null) as { ok?: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } } | null;
  if (!response.ok || !data?.ok) {
    const code = data?.error_code ?? response.status;
    const retryAfter = data?.parameters?.retry_after;
    if (code === 429 && retryAfter) throw Object.assign(new Error(`Telegram rate limited the request; retry after ${retryAfter} seconds.`), { retryAfter });
    if (code >= 500) throw Object.assign(new Error('Telegram is temporarily unavailable.'), { transient: true });
    throw new Error(data?.description || `Telegram request failed (${code}).`);
  }
  return data.result as T;
}

export async function checkTelegramChannel() {
  const { chatId } = envConfig();
  const bot = await telegramCall<{ id: number; username?: string; first_name?: string }>('getMe');
  const [chat, member] = await Promise.all([
    telegramCall<{ id: number; title?: string; type?: string; username?: string }>('getChat', { chat_id: chatId }),
    telegramCall<{ status: string; can_post_messages?: boolean }>('getChatMember', { chat_id: chatId, user_id: bot.id }),
  ]);
  const canPost = member.status === 'creator' || (member.status === 'administrator' && member.can_post_messages === true);
  return {
    configured: true,
    connected: true,
    canPost,
    bot: { username: bot.username || null, name: bot.first_name || null },
    channel: { title: chat.title || chat.username || String(chat.id), type: chat.type || 'unknown' },
    message: canPost ? 'Bot can publish to the configured channel.' : 'Bot is in the channel but lacks administrator posting permission.',
  };
}

export function splitTelegramText(text: string, max = 3500): string[] {
  const chars = Array.from(text);
  const parts: string[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = start;
    let units = 0;
    while (end < chars.length && units + chars[end].length <= max) {
      units += chars[end].length;
      end += 1;
    }
    if (end < chars.length) {
      const breakAt = chars.lastIndexOf('\n', end - 1);
      if (breakAt > start + Math.floor((end - start) * 0.55)) end = breakAt + 1;
    }
    if (end === start) end += 1;
    parts.push(chars.slice(start, end).join(''));
    start = end;
  }
  return parts.length ? parts : [''];
}

export function formatReadingAssignment(book: BookRecord, assignment: BookAssignmentRecord, pages: BookPageRecord[]): string[] {
  if (assignment.status !== 'approved' || !assignment.studyNotes) throw new Error('Only assignments with approved study notes can be published.');
  const orderedPages = [...pages].sort((a, b) => a.pdfPage - b.pdfPage);
  if (orderedPages.length !== assignment.endPdfPage - assignment.startPdfPage + 1 || orderedPages.some((page, index) => page.pdfPage !== assignment.startPdfPage + index || page.method === 'empty' || !page.text.trim() || (page.requiresReview && !page.reviewedByUser))) {
    throw new Error('The source pages are incomplete, unreadable, or still need OCR review.');
  }
  const notes = assignment.studyNotes;
  const pageChunks = orderedPages.flatMap(page => {
    const parts = splitTelegramText(page.text, 3200);
    return parts.map((part, index) => `\n[PDF page ${page.pdfPage}${parts.length > 1 ? `, part ${index + 1}/${parts.length}` : ''}]\n${part}`);
  });
  const chunks: string[] = [
    `📖 ${book.title}${book.author ? ` — ${book.author}` : ''}\nReading assignment for ${assignment.scheduledDate}\nPDF pages ${assignment.startPdfPage}–${assignment.endPdfPage}`,
    ...pageChunks,
    `\nStudy summary\n${notes.summary}\n\nKey concepts\n${notes.keyConcepts.map(item => `• ${item}`).join('\n')}`,
    `Definitions\n${notes.definitions.map(item => `• ${item.term} (PDF p. ${item.pdfPage}): ${item.explanation}`).join('\n')}`,
    `Illustrative example (hypothetical)\n${notes.example.situation}\n${notes.example.conceptInAction}\nLesson: ${notes.example.lesson}\n${notes.example.sourceDisclosure}`,
    `Revision questions\n${notes.questions.map((item, index) => `${index + 1}. ${item.question}\nAnswer: ${item.answer}\nSource: PDF page${item.pdfPages.length === 1 ? '' : 's'} ${item.pdfPages.join(', ')}`).join('\n\n')}\n\nStudy notes\n${notes.notes}`,
  ];
  return chunks.flatMap(chunk => splitTelegramText(chunk));
}

export async function listTelegramDeliveries(userId: string) {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`SELECT data FROM telegram_deliveries WHERE user_id = ${userId} ORDER BY updated_at DESC LIMIT 100`;
    return rows.map((row: any) => row.data as TelegramDeliveryRecord);
  }
  return readDeliveries().filter(item => item.userId === userId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
}

async function getAssignmentDelivery(userId: string, assignmentId: string): Promise<TelegramDeliveryRecord | null> {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`SELECT data FROM telegram_deliveries WHERE user_id = ${userId} AND assignment_id = ${assignmentId} LIMIT 1`;
    if (rows[0]?.data) return rows[0].data as TelegramDeliveryRecord;
  }
  return readDeliveries().find(item => item.userId === userId && item.assignmentId === assignmentId) || null;
}

async function saveDelivery(delivery: TelegramDeliveryRecord) {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    await sql`INSERT INTO telegram_deliveries (id, user_id, book_id, assignment_id, status, data, created_at, updated_at)
      VALUES (${delivery.id}, ${delivery.userId}, ${delivery.bookId}, ${delivery.assignmentId}, ${delivery.status}, ${JSON.stringify(delivery)}::jsonb, ${delivery.createdAt}, ${delivery.updatedAt})
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`;
  }
  const all = readDeliveries();
  const index = all.findIndex(item => item.id === delivery.id);
  if (index < 0) all.push(delivery); else all[index] = delivery;
  writeDeliveries(all);
  return delivery;
}

async function createDelivery(userId: string, bookId: string, assignmentId: string, parts: string[]) {
  const sql = getDb();
  const now = Date.now();
  const item: TelegramDeliveryRecord = { id: randomUUID(), userId, bookId, assignmentId, status: 'pending', messageParts: parts, nextPart: 0, telegramMessageIds: [], lastError: '', safeToRetry: false, retryAfterAt: null, createdAt: now, updatedAt: now };
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`INSERT INTO telegram_deliveries (id, user_id, book_id, assignment_id, status, data, created_at, updated_at)
      VALUES (${item.id}, ${userId}, ${bookId}, ${assignmentId}, 'pending', ${JSON.stringify(item)}::jsonb, ${now}, ${now})
      ON CONFLICT (user_id, assignment_id) DO NOTHING RETURNING data`;
    if (!rows.length) throw new Error('A Telegram delivery already exists for this assignment. Check its status before trying again.');
  } else {
    const all = readDeliveries();
    if (all.some(entry => entry.userId === userId && entry.assignmentId === assignmentId)) throw new Error('A Telegram delivery already exists for this assignment. Check its status before trying again.');
    all.push(item);
    writeDeliveries(all);
  }
  return item;
}

async function claimDelivery(delivery: TelegramDeliveryRecord): Promise<TelegramDeliveryRecord | null> {
  const now = Date.now();
  const claimed = { ...delivery, status: 'processing' as const, safeToRetry: false, retryAfterAt: null, updatedAt: now };
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`UPDATE telegram_deliveries SET status = 'processing', data = ${JSON.stringify(claimed)}::jsonb, updated_at = ${now}
      WHERE id = ${delivery.id} AND (status = 'pending' OR (status = 'failed' AND COALESCE((data->>'safeToRetry')::boolean, FALSE) = TRUE)) RETURNING id`;
    return rows.length ? saveDelivery(claimed) : null;
  }
  const all = readDeliveries();
  const index = all.findIndex(item => item.id === delivery.id && (item.status === 'pending' || (item.status === 'failed' && item.safeToRetry)));
  if (index < 0) return null;
  all[index] = claimed;
  writeDeliveries(all);
  return claimed;
}

export async function publishApprovedAssignment(userId: string, book: BookRecord, assignment: BookAssignmentRecord, pages: BookPageRecord[]) {
  const parts = formatReadingAssignment(book, assignment, pages);
  let delivery = await getAssignmentDelivery(userId, assignment.id);
  if (delivery?.status === 'completed') throw new Error('This assignment has already been published successfully.');
  if (delivery && delivery.status !== 'pending') {
    if (delivery.status === 'uncertain' || !delivery.safeToRetry) throw Object.assign(new Error('A previous delivery may have sent part of this assignment. Check the Telegram channel and delivery record before retrying.'), { delivery });
    if (delivery.retryAfterAt && delivery.retryAfterAt > Date.now()) throw Object.assign(new Error(`Telegram asked us to retry after ${new Date(delivery.retryAfterAt).toISOString()}.`), { delivery });
  }
  if (!delivery) delivery = await createDelivery(userId, book.id, assignment.id, parts);
  const claimed = await claimDelivery(delivery);
  if (!claimed) throw new Error('Another request is already processing this Telegram delivery, or the saved delivery can no longer be retried.');
  delivery = claimed;
  let sendingStarted = false;
  try {
    const connection = await checkTelegramChannel();
    if (!connection.canPost) throw new Error(connection.message);
    while (delivery.nextPart < delivery.messageParts.length) {
      sendingStarted = true;
      const message = await telegramCall<{ message_id: number }>('sendMessage', { chat_id: envConfig().chatId, text: delivery.messageParts[delivery.nextPart], disable_web_page_preview: true });
      delivery = await saveDelivery({ ...delivery, nextPart: delivery.nextPart + 1, telegramMessageIds: [...delivery.telegramMessageIds, message.message_id], updatedAt: Date.now() });
      sendingStarted = false;
    }
    return await saveDelivery({ ...delivery, status: 'completed', lastError: '', safeToRetry: false, retryAfterAt: null, updatedAt: Date.now() });
  } catch (error) {
    const err = error as Error & { retryAfter?: number; transient?: boolean };
    // A network failure while sending may have delivered the message. Never retry it automatically.
    const uncertain = Boolean((err as Error & { uncertain?: boolean }).uncertain) || (sendingStarted && (err as Error & { transient?: boolean }).transient === true);
    const safeToRetry = !uncertain && (!sendingStarted || Boolean(err.retryAfter));
    delivery = await saveDelivery({ ...delivery, status: uncertain ? 'uncertain' : 'failed', lastError: err.message, safeToRetry, retryAfterAt: err.retryAfter ? Date.now() + err.retryAfter * 1000 : null, updatedAt: Date.now() });
    throw Object.assign(new Error(err.message), { delivery });
  }
}
