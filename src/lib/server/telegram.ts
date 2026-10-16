import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from './neon';
import type { BookAssignmentRecord, BookRecord, BookPageRecord } from '../books/types';
import { formatTelegramMessage, splitTelegramHtml, stripHtml, sanitizeUtf8, sanitizePayload, truncateUnicode, sanitizeJsonPayloadString } from './telegramFormatter';
import { researchReadingEnrichment, type EnrichedReadingContent } from './sources/enrichment';

export { formatTelegramMessage, splitTelegramHtml, stripHtml, sanitizeUtf8, sanitizePayload, truncateUnicode, sanitizeJsonPayloadString } from './telegramFormatter';
export { researchReadingEnrichment, type EnrichedReadingContent } from './sources/enrichment';

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
  imageFilename?: string;
  imagePage?: number;
  imageSent?: boolean;
  lastError: string;
  safeToRetry: boolean;
  retryAfterAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TelegramSendReceipt {
  id: string;
  userId: string;
  status: 'sent' | 'uncertain' | 'failed';
  channel: string;
  chatId: string;
  messageId: number | null;
  detail: string;
  createdAt: number;
}

const DATA_ROOT = process.env.BOOK_DATA_DIR?.trim() || path.join(process.cwd(), '.data');
const DELIVERY_PATH = path.join(DATA_ROOT, 'telegram-deliveries.json');
const SEND_RECEIPTS_PATH = path.join(DATA_ROOT, 'telegram-send-receipts.json');
let schemaReady: Promise<void> | null = null;

function readDeliveries(): TelegramDeliveryRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(DELIVERY_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeDeliveries(records: TelegramDeliveryRecord[]) {
  fs.mkdirSync(path.dirname(DELIVERY_PATH), { recursive: true });
  const temp = `${DELIVERY_PATH}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(records, null, 2), 'utf8');
  try {
    fs.renameSync(temp, DELIVERY_PATH);
  } catch {
    fs.copyFileSync(temp, DELIVERY_PATH);
    try { fs.unlinkSync(temp); } catch {}
  }
}

function readSendReceipts(): TelegramSendReceipt[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(SEND_RECEIPTS_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function saveSendReceipt(receipt: TelegramSendReceipt) {
  try {
    const sql = getDb();
    if (sql) {
      await ensureSchema(sql);
      await sql`INSERT INTO telegram_manual_sends (id, user_id, status, data, created_at)
        VALUES (${receipt.id}, ${receipt.userId}, ${receipt.status}, ${JSON.stringify(receipt)}::jsonb, ${receipt.createdAt})`;
    }
    const records = readSendReceipts();
    records.push(receipt);
    fs.mkdirSync(path.dirname(SEND_RECEIPTS_PATH), { recursive: true });
    const temp = `${SEND_RECEIPTS_PATH}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(records.slice(-500), null, 2), 'utf8');
    try {
      fs.renameSync(temp, SEND_RECEIPTS_PATH);
    } catch {
      fs.copyFileSync(temp, SEND_RECEIPTS_PATH);
      try { fs.unlinkSync(temp); } catch {}
    }
  } catch (error) {
    // A logging failure must not turn Telegram's confirmed response into a false send failure.
    console.error('[Telegram] Could not save the direct-send receipt:', error);
  }
}

export const DEFAULT_TELEGRAM_BOT_TOKEN = '8316651482:AAGtILkTPiozkOmokFAJ-yUNUWFXI45C7kc';
export const DEFAULT_TELEGRAM_CHAT_ID = '@SamSpac';

interface TelegramRuntimeConfig {
  botToken?: string;
  chatId?: string;
}

let runtimeTelegramConfig: TelegramRuntimeConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined,
  chatId: process.env.TELEGRAM_CHAT_ID?.trim() || undefined,
};

let telegramDbLoaded = false;
let telegramDbLoadingPromise: Promise<void> | null = null;

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
      await sql`CREATE TABLE IF NOT EXISTS telegram_manual_sends (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        status VARCHAR(20) NOT NULL,
        data JSONB NOT NULL,
        created_at BIGINT NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_telegram_manual_sends_owner ON telegram_manual_sends(user_id, created_at DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS telegram_settings (
        key VARCHAR(64) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at BIGINT NOT NULL
      )`;
    }).catch(error => { schemaReady = null; throw error; });
  }
  await schemaReady;
}

export async function loadTelegramConfigFromDb(): Promise<void> {
  if (process.env.VITEST) return;
  const sql = getDb();
  if (!sql) return;
  if (telegramDbLoaded) return;
  if (telegramDbLoadingPromise) return telegramDbLoadingPromise;

  telegramDbLoadingPromise = (async () => {
    try {
      await ensureSchema(sql);
      const rows = await sql`SELECT key, value FROM telegram_settings`;
      let dbToken: string | undefined;
      let dbChatId: string | undefined;
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (row.key === 'telegram_bot_token' && typeof row.value === 'string' && row.value.trim()) {
            dbToken = row.value.trim();
          }
          if (row.key === 'telegram_chat_id' && typeof row.value === 'string' && row.value.trim()) {
            dbChatId = row.value.trim();
          }
        }
      }

      if (dbToken || dbChatId) {
        runtimeTelegramConfig = {
          botToken: dbToken || runtimeTelegramConfig.botToken || DEFAULT_TELEGRAM_BOT_TOKEN,
          chatId: dbChatId || runtimeTelegramConfig.chatId || DEFAULT_TELEGRAM_CHAT_ID,
        };
      } else {
        const tokenToSeed = runtimeTelegramConfig.botToken || process.env.TELEGRAM_BOT_TOKEN?.trim() || DEFAULT_TELEGRAM_BOT_TOKEN;
        const chatIdToSeed = runtimeTelegramConfig.chatId || process.env.TELEGRAM_CHAT_ID?.trim() || DEFAULT_TELEGRAM_CHAT_ID;
        const now = Date.now();
        await sql`
          INSERT INTO telegram_settings (key, value, updated_at)
          VALUES ('telegram_bot_token', ${tokenToSeed}, ${now})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        `;
        await sql`
          INSERT INTO telegram_settings (key, value, updated_at)
          VALUES ('telegram_chat_id', ${chatIdToSeed}, ${now})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        `;
        runtimeTelegramConfig = {
          botToken: tokenToSeed,
          chatId: chatIdToSeed,
        };
      }
      telegramDbLoaded = true;
    } catch (err) {
      console.error('[Telegram] Failed to load settings from DB:', err);
    } finally {
      telegramDbLoadingPromise = null;
    }
  })();

  return telegramDbLoadingPromise;
}

export async function setTelegramRuntimeConfig(update: { botToken?: string; chatId?: string }): Promise<void> {
  if (update.botToken !== undefined && update.botToken.trim()) {
    runtimeTelegramConfig.botToken = update.botToken.trim();
  }
  if (update.chatId !== undefined && update.chatId.trim()) {
    runtimeTelegramConfig.chatId = update.chatId.trim();
  }
  if (process.env.VITEST) return;
  const sql = getDb();
  if (!sql) return;

  try {
    await ensureSchema(sql);
    const now = Date.now();
    if (update.botToken !== undefined && update.botToken.trim()) {
      await sql`
        INSERT INTO telegram_settings (key, value, updated_at)
        VALUES ('telegram_bot_token', ${update.botToken.trim()}, ${now})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `;
    }
    if (update.chatId !== undefined && update.chatId.trim()) {
      await sql`
        INSERT INTO telegram_settings (key, value, updated_at)
        VALUES ('telegram_chat_id', ${update.chatId.trim()}, ${now})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `;
    }
  } catch (err) {
    console.error('[Telegram] Failed to persist settings to DB:', err);
  }
}

export function isTelegramConfigured(): boolean {
  try {
    const { token, chatId } = envConfig();
    return Boolean(token && chatId);
  } catch {
    return false;
  }
}

export function envConfig() {
  if (process.env.VITEST) {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || runtimeTelegramConfig.botToken;
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim() || runtimeTelegramConfig.chatId;
    if (!token || !chatId) {
      throw new Error('Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on the backend service.');
    }
    return { token, chatId };
  }

  const token =
    runtimeTelegramConfig.botToken ||
    process.env.TELEGRAM_BOT_TOKEN?.trim() ||
    DEFAULT_TELEGRAM_BOT_TOKEN;
  const chatId =
    runtimeTelegramConfig.chatId ||
    process.env.TELEGRAM_CHAT_ID?.trim() ||
    DEFAULT_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on the backend service.');
  }
  return { token, chatId };
}

async function telegramCall<T>(method: string, payload?: unknown): Promise<T> {
  await loadTelegramConfigFromDb();
  const { token } = envConfig();
  const cleanPayload = payload !== undefined ? sanitizePayload(payload) : undefined;
  let jsonBody = cleanPayload !== undefined ? JSON.stringify(cleanPayload) : undefined;
  if (jsonBody !== undefined) {
    jsonBody = sanitizeJsonPayloadString(jsonBody);
  }
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: jsonBody === undefined ? 'GET' : 'POST',
      headers: jsonBody === undefined ? undefined : { 'content-type': 'application/json; charset=utf-8' },
      body: jsonBody,
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

export async function sendTelegramMessageWithFallback(
  chatId: string,
  formattedText: string,
  disableWebPagePreview = true
): Promise<{ message_id: number }> {
  const cleanFormattedText = sanitizeUtf8(formattedText);
  try {
    return await telegramCall<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text: cleanFormattedText,
      parse_mode: 'HTML',
      disable_web_page_preview: disableWebPagePreview,
    });
  } catch (error: any) {
    const errMsg = String(error?.message || error);
    // If Telegram rejects due to entity parsing, bad HTML formatting, or UTF-8 encoding issues, retry safely with plain text
    if (/can't parse entities|entity|tag|parse|html|bad request|utf-8|encoded/i.test(errMsg)) {
      console.warn('[Telegram] HTML formatting or encoding rejected by Telegram API; falling back to sanitized plain text:', errMsg);
      return await telegramCall<{ message_id: number }>('sendMessage', {
        chat_id: chatId,
        text: sanitizeUtf8(stripHtml(cleanFormattedText)),
        disable_web_page_preview: disableWebPagePreview,
      });
    }
    throw error;
  }
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface SendQuizPollParams {
  chatId: string;
  question: string;
  options: string[];
  correctOptionId: number;
  explanation?: string;
  isAnonymous?: boolean;
  replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] };
}

export interface TelegramPollResult {
  messageId: number;
  pollId: string;
  question: string;
  correctOptionId: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number | string; title?: string; type?: string };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
    date?: number;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string; username?: string };
    message?: { message_id: number; chat: { id: number | string } };
    data?: string;
  };
  poll_answer?: {
    poll_id: string;
    voter_chat?: { id: number | string; title?: string };
    user?: { id: number; first_name?: string; username?: string };
    option_ids: number[];
  };
}

export async function sendTelegramQuizPoll(params: SendQuizPollParams): Promise<TelegramPollResult> {
  const question = truncateUnicode(params.question.trim(), 300);
  const options = params.options.slice(0, 10).map(opt => truncateUnicode(opt.trim(), 100));
  if (options.length < 2) {
    throw new Error('A quiz poll requires at least 2 answer options.');
  }
  const correctOptionId = Math.max(0, Math.min(params.correctOptionId, options.length - 1));
  const explanation = params.explanation?.trim() ? truncateUnicode(params.explanation.trim(), 200) : undefined;

  const payload: any = {
    chat_id: params.chatId,
    question,
    options,
    type: 'quiz',
    correct_option_id: correctOptionId,
    is_anonymous: params.isAnonymous ?? false,
  };
  if (explanation) {
    payload.explanation = explanation;
  }
  if (params.replyMarkup) {
    payload.reply_markup = params.replyMarkup;
  }

  const res = await telegramCall<{ message_id: number; poll?: { id: string } }>('sendPoll', payload);
  return {
    messageId: res.message_id,
    pollId: res.poll?.id || `poll_${Date.now()}_${res.message_id}`,
    question,
    correctOptionId,
  };
}

export async function sendTelegramMessageWithKeyboard(
  chatId: string,
  formattedText: string,
  keyboard: InlineKeyboardButton[][],
  disableWebPagePreview = true
): Promise<{ message_id: number }> {
  const cleanFormattedText = sanitizeUtf8(formattedText);
  try {
    return await telegramCall<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text: cleanFormattedText,
      parse_mode: 'HTML',
      disable_web_page_preview: disableWebPagePreview,
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (error: any) {
    const errMsg = String(error?.message || error);
    if (/can't parse entities|entity|tag|parse|html|bad request|utf-8|encoded/i.test(errMsg)) {
      return await telegramCall<{ message_id: number }>('sendMessage', {
        chat_id: chatId,
        text: sanitizeUtf8(stripHtml(cleanFormattedText)),
        disable_web_page_preview: disableWebPagePreview,
        reply_markup: { inline_keyboard: keyboard },
      });
    }
    throw error;
  }
}

export async function answerTelegramCallback(
  callbackQueryId: string,
  text?: string,
  showAlert = false
): Promise<boolean> {
  try {
    await telegramCall<boolean>('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: text ? text.slice(0, 200) : undefined,
      show_alert: showAlert,
    });
    return true;
  } catch (err) {
    console.warn('[Telegram] Could not answer callback query:', err);
    return false;
  }
}

export async function editTelegramMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] }
): Promise<boolean> {
  try {
    await telegramCall('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
    return true;
  } catch (err) {
    console.warn('[Telegram] Could not edit message text:', err);
    return false;
  }
}

export async function getTelegramUpdates(offset?: number, limit = 100): Promise<TelegramUpdate[]> {
  try {
    return await telegramCall<TelegramUpdate[]>('getUpdates', {
      offset,
      limit,
      timeout: 0,
      allowed_updates: ['callback_query', 'poll_answer', 'message'],
    });
  } catch (err) {
    console.warn('[Telegram] getUpdates failed:', err);
    return [];
  }
}

export async function setTelegramWebhook(url: string, secretToken?: string): Promise<{ ok: boolean; description?: string }> {
  try {
    const res = await telegramCall<boolean>('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ['callback_query', 'poll_answer', 'message'],
    });
    return { ok: Boolean(res) };
  } catch (err: any) {
    return { ok: false, description: err?.message || 'Failed to set webhook' };
  }
}

export async function getTelegramWebhookInfo(): Promise<any> {
  try {
    return await telegramCall<any>('getWebhookInfo');
  } catch (err: any) {
    return { url: '', has_custom_certificate: false, pending_update_count: 0, last_error_message: err?.message };
  }
}

export async function deleteTelegramWebhook(): Promise<boolean> {
  try {
    return await telegramCall<boolean>('deleteWebhook');
  } catch (err) {
    console.warn('[Telegram] deleteWebhook failed:', err);
    return false;
  }
}

export interface TelegramSendTextResult {
  channel: string;
  messageId: number;
  receiptId: string;
  messageIds?: number[];
}

export async function sendTelegramTextToChannel(
  text: string,
  userId = 'owner'
): Promise<TelegramSendTextResult> {
  if (!text.trim()) throw new Error('Type a message before sending it.');
  const connection = await checkTelegramChannel();
  if (!connection.canPost) throw new Error(connection.message);
  const { chatId } = envConfig();

  // Apply intelligent Telegram HTML formatting
  const formatted = formatTelegramMessage(text);
  const parts = splitTelegramHtml(formatted, 3500);

  const receiptBase = { id: randomUUID(), userId, channel: connection.channel.title, chatId, createdAt: Date.now() };
  try {
    const sentIds: number[] = [];
    for (const part of parts) {
      const sent = await sendTelegramMessageWithFallback(chatId, part, true);
      sentIds.push(sent.message_id);
    }
    const primaryMessageId = sentIds[0] ?? 0;
    await saveSendReceipt({
      ...receiptBase,
      status: 'sent',
      messageId: primaryMessageId,
      detail: `Telegram API accepted ${sentIds.length} message part(s). Message ID(s): ${sentIds.join(', ')}`,
    });
    return {
      channel: connection.channel.title,
      messageId: primaryMessageId,
      receiptId: receiptBase.id,
      messageIds: sentIds,
    };
  } catch (error) {
    const err = error as Error & { uncertain?: boolean };
    await saveSendReceipt({ ...receiptBase, status: err.uncertain ? 'uncertain' : 'failed', messageId: null, detail: err.message });
    throw error;
  }
}

export async function listRecentTelegramSends(userId: string, limit = 10): Promise<TelegramSendReceipt[]> {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`SELECT data FROM telegram_manual_sends WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limit}`;
    return rows.map((row: any) => row.data as TelegramSendReceipt);
  }
  return readSendReceipts().filter(item => item.userId === userId).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export async function sendTelegramMediaToChannel(text: string, media: File) {
  if (text.length > 1024) throw new Error('Telegram captions are limited to 1,024 characters.');
  const name = media.name.toLowerCase();
  const imageType = ['image/jpeg', 'image/png', 'image/webp'].includes(media.type);
  const voiceType = (
    (media.type === 'audio/ogg' || media.type === 'application/ogg') && name.endsWith('.ogg')
  ) || (media.type === 'audio/mpeg' && name.endsWith('.mp3'))
    || (['audio/mp4', 'audio/x-m4a', 'audio/m4a'].includes(media.type) && name.endsWith('.m4a'));
  const kind = imageType ? 'photo' : voiceType ? 'voice' : null;
  const maxBytes = kind === 'photo' ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
  if (!kind) throw new Error('Choose a JPEG, PNG, or WebP image, or an OGG/Opus, MP3, or M4A voice file.');
  if (media.size <= 0 || media.size > maxBytes) {
    throw new Error(kind === 'photo' ? 'Images must be 10 MB or smaller.' : 'Voice files must be 50 MB or smaller.');
  }

  const connection = await checkTelegramChannel();
  if (!connection.canPost) throw new Error(connection.message);
  const { token, chatId } = envConfig();
  const form = new FormData();
  form.set('chat_id', chatId);
  form.set(kind === 'photo' ? 'photo' : 'voice', media, media.name);
  if (text) form.set('caption', truncateUnicode(text, 1024));

  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${kind === 'photo' ? 'sendPhoto' : 'sendVoice'}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60_000),
      cache: 'no-store',
    });
  } catch {
    throw Object.assign(new Error('Telegram upload timed out or could not connect. Check the channel before retrying.'), { uncertain: true });
  }
  const data = await response.json().catch(() => null) as { ok?: boolean; result?: { message_id: number }; description?: string; error_code?: number } | null;
  if (!response.ok || !data?.ok) {
    const code = data?.error_code ?? response.status;
    throw new Error(data?.description || `Telegram media upload failed (${code}).`);
  }
  return { channel: connection.channel.title, messageId: data.result?.message_id, kind };
}

export function splitTelegramText(text: string, max = 3500): string[] {
  if (/<[a-z/][\s\S]*>/i.test(text) && max >= 100) {
    return splitTelegramHtml(text, max).map(chunk => sanitizeUtf8(chunk));
  }
  const chars = Array.from(sanitizeUtf8(text));
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
  return parts.length ? parts.map(part => sanitizeUtf8(part)) : [''];
}

export function formatReadingAssignment(
  book: BookRecord,
  assignment: BookAssignmentRecord,
  pages: BookPageRecord[],
  previousAssignment?: BookAssignmentRecord,
  enrichment?: EnrichedReadingContent
): string[] {
  if (assignment.status !== 'approved' || !assignment.studyNotes) throw new Error('Only assignments with approved study notes can be published.');
  const orderedPages = [...pages].sort((a, b) => a.pdfPage - b.pdfPage);
  if (orderedPages.length !== assignment.endPdfPage - assignment.startPdfPage + 1 || orderedPages.some((page, index) => page.pdfPage !== assignment.startPdfPage + index)) {
    throw new Error('The source pages are incomplete or missing.');
  }
  if (orderedPages.some(page => page.method === 'ocr' && page.text?.trim() && page.requiresReview && !page.reviewedByUser)) {
    throw new Error('The source pages contain OCR pages that still need OCR review.');
  }
  const notes = assignment.studyNotes;
  const continuity = previousAssignment?.studyNotes
    ? `Connection to yesterday's post (Day ${previousAssignment.dayNumber})\nYesterday's takeaway: ${previousAssignment.studyNotes.summary}\nToday builds on: ${assignment.concepts.map(item => item.title).join(', ')}`
    : '';

  const hasReadablePages = orderedPages.some(p => p.text?.trim() && p.method !== 'empty');
  const emptyNotice = !hasReadablePages
    ? `\nℹ️ Notice: All pages in this section (PDF pages ${assignment.startPdfPage}–${assignment.endPdfPage}) are blank or illustration pages. Automatically proceeding to the next reading section.\n`
    : '';

  // 1. Assigned Book Text (preserve original extracted text verbatim)
  const pageChunks = orderedPages.flatMap(page => {
    const rawText = page.text?.trim();
    if (!rawText || page.method === 'empty') {
      return [`\n📄 [PDF Page ${page.pdfPage} · Blank / Illustration Page]\nℹ️ (No extractable text found on page ${page.pdfPage} — automatically proceeding to next page)`];
    }
    const cleanText = sanitizeUtf8(rawText);
    const parts = splitTelegramText(cleanText, 3200);
    return parts.map((part, index) => `\n[PDF page ${page.pdfPage}${parts.length > 1 ? `, part ${index + 1}/${parts.length}` : ''}]\n${part}`);
  });

  const section1 = [
    `📖 ${sanitizeUtf8(book.title)}${book.author ? ` — ${sanitizeUtf8(book.author)}` : ''}\nReading assignment for ${assignment.scheduledDate}\nPDF pages ${assignment.startPdfPage}–${assignment.endPdfPage}`,
    ...(emptyNotice ? [emptyNotice] : []),
    ...pageChunks,
  ];

  // 2. Summary (main ideas and key concepts)
  const section2 = [
    `\nStudy summary\n${sanitizeUtf8(notes.summary)}\n\nKey concepts\n${notes.keyConcepts.map(item => `• ${sanitizeUtf8(item)}`).join('\n')}`,
    ...(notes.definitions?.length ? [`Definitions\n${notes.definitions.map(item => `• ${sanitizeUtf8(item.term)} (PDF p. ${item.pdfPage}): ${sanitizeUtf8(item.explanation)}`).join('\n')}`] : []),
  ];

  // 3. Real-life Examples (verifiable historical/biographical examples with links and connection to reading)
  const section3: string[] = [];
  if (enrichment?.realLifeExamples?.length) {
    const examplesFormatted = enrichment.realLifeExamples.map(e =>
      `• <b>${sanitizeUtf8(e.title)}</b>\n${sanitizeUtf8(e.situation)}\n<i>Connection:</i> ${sanitizeUtf8(e.connection)}\n<i>Source:</i> ${e.sourceUrl.startsWith('http') ? `<a href="${e.sourceUrl}">${sanitizeUtf8(e.sourceTitle)}</a>` : sanitizeUtf8(e.sourceTitle)} (${sanitizeUtf8(e.attribution)})`
    ).join('\n\n');
    section3.push(`\n🏛️ <b>Real-Life Examples:</b>\n${examplesFormatted}`);
  } else if (notes.example?.situation) {
    section3.push(`${notes.example.kind === 'source' ? `Real-world example from the book (PDF p. ${notes.example.pdfPage})` : 'Practical application (illustrative)'}\n${sanitizeUtf8(notes.example.situation)}\n${sanitizeUtf8(notes.example.conceptInAction)}\nLesson: ${sanitizeUtf8(notes.example.lesson)}\n${notes.example.sourceDisclosure}`);
  }

  // 4. Quotes (verified quotations with provider attribution)
  const section4: string[] = [];
  if (enrichment?.quotes?.length) {
    const quotesFormatted = enrichment.quotes.map(q =>
      `• <i>"${sanitizeUtf8(q.quote)}"</i> — <b>${sanitizeUtf8(q.author)}</b>${q.sourceContext ? ` <i>(${sanitizeUtf8(q.sourceContext)})</i>` : ''}\n  <i>${sanitizeUtf8(q.attribution)}</i>${q.sourceUrl ? ` · <a href="${q.sourceUrl}">Source</a>` : ''}`
    ).join('\n\n');
    section4.push(`\n💬 <b>Quotes:</b>\n${quotesFormatted}`);
  }

  // 5. Related Videos (working YouTube links)
  const section5: string[] = [];
  if (enrichment?.videos?.length) {
    const videosFormatted = enrichment.videos.map(v =>
      `• <a href="${v.url}">${sanitizeUtf8(v.title)}</a> — <i>${sanitizeUtf8(v.channelName)}</i>`
    ).join('\n');
    section5.push(`\n📺 <b>Related Videos:</b>\n${videosFormatted}`);
  }

  // 6. Related Podcasts (working Podcast Index links)
  const section6: string[] = [];
  if (enrichment?.podcasts?.length) {
    const podcastsFormatted = enrichment.podcasts.map(p =>
      `• <a href="${p.url}">${sanitizeUtf8(p.title)}</a> — <i>${sanitizeUtf8(p.podcastName)}</i>${p.description ? `\n  ${sanitizeUtf8(p.description.slice(0, 150))}...` : ''}`
    ).join('\n\n');
    section6.push(`\n🎙️ <b>Related Podcasts:</b>\n${podcastsFormatted}`);
  }

  // 7. Quiz (original reading-grounded questions with difficulty, options, and explanations)
  const section7: string[] = [];
  const appOrigin = process.env.CLIENT_URL?.split(',')[0] || process.env.NEXT_PUBLIC_API_URL || 'https://your-planner-app.vercel.app';
  const interactiveQuizUrl = `${appOrigin}/books?quiz=${assignment.id}`;

  if (enrichment?.quiz?.length) {
    const quizFormatted = enrichment.quiz.map((q, idx) => {
      const optionsFormatted = q.options.map((opt, oIdx) => `  ${String.fromCharCode(65 + oIdx)}) ${sanitizeUtf8(opt)}`).join('\n');
      const correctLetter = String.fromCharCode(65 + q.correctOptionIndex);
      return `<b>Question ${idx + 1} (${q.difficulty.toUpperCase()}):</b> ${sanitizeUtf8(q.question)}\n${optionsFormatted}\n<b>Answer:</b> ${correctLetter}) ${sanitizeUtf8(q.options[q.correctOptionIndex])}\n<i>Explanation:</i> ${sanitizeUtf8(q.explanation)}`;
    }).join('\n\n');
    section7.push(`\n🧠 <b>Reading Quiz:</b>\n${quizFormatted}\n\n🎯 <b>Interactive Quiz:</b> <a href="${interactiveQuizUrl}">Launch Website Interactive Quiz</a>`);
  } else if (notes.questions?.length) {
    section7.push(`Revision questions\n${notes.questions.map((item, index) => `${index + 1}. ${sanitizeUtf8(item.question)}\nAnswer: ${sanitizeUtf8(item.answer)}\nSource: PDF page${item.pdfPages.length === 1 ? '' : 's'} ${item.pdfPages.join(', ')}`).join('\n\n')}\n\n🎯 <b>Interactive Quiz:</b> <a href="${interactiveQuizUrl}">Launch Website Interactive Quiz</a>`);
  }

  const chunks: string[] = [
    ...section1,
    ...section2,
    ...section3,
    ...(continuity ? [sanitizeUtf8(continuity)] : []),
    ...section4,
    ...section5,
    ...section6,
    ...section7,
    ...(notes.notes ? [`\nStudy notes\n${sanitizeUtf8(notes.notes)}`] : []),
  ];
  return chunks.flatMap(chunk => splitTelegramText(sanitizeUtf8(chunk)));
}

export function formatLoadPlanPages(
  book: BookRecord,
  assignment: BookAssignmentRecord,
  pages: BookPageRecord[],
  previousAssignment?: BookAssignmentRecord,
  enrichment?: EnrichedReadingContent
): string[] {
  const orderedPages = [...pages].sort((a, b) => a.pdfPage - b.pdfPage);
  if (!orderedPages.length) {
    throw new Error(`No extracted pages available for Day ${assignment.dayNumber} (PDF pages ${assignment.startPdfPage}–${assignment.endPdfPage}). Please make sure pages have been extracted first.`);
  }

  const hasReadablePages = orderedPages.some(p => p.text?.trim() && p.method !== 'empty');

  const header = [
    `📖 ${sanitizeUtf8(book.title)}${book.author ? ` — ${sanitizeUtf8(book.author)}` : ''}`,
    `📅 Reading Load Plan · Day ${assignment.dayNumber} (${assignment.scheduledDate})`,
    `📄 PDF Pages: ${assignment.startPdfPage}–${assignment.endPdfPage}`,
    assignment.concepts?.length ? `💡 Concepts: ${assignment.concepts.map(item => sanitizeUtf8(item.title)).join(', ')}` : '',
    assignment.estimatedMinutes ? `⏱ Estimated time: ${assignment.estimatedMinutes} minutes` : '',
    !hasReadablePages ? `ℹ️ Notice: All pages in this section (PDF pages ${assignment.startPdfPage}–${assignment.endPdfPage}) are blank or illustration pages. Automatically proceeding to the next reading section.` : '',
  ].filter(Boolean).join('\n');

  // 1. Assigned Book Text
  const pageChunks = orderedPages.flatMap(page => {
    const raw = page.text?.trim();
    if (!raw || page.method === 'empty') {
      return [`\n📄 [PDF Page ${page.pdfPage} · Blank / Illustration Page]\nℹ️ (No extractable text found on page ${page.pdfPage} — automatically proceeding to next page)`];
    }
    const cleanText = sanitizeUtf8(raw);
    const parts = splitTelegramText(cleanText, 3200);
    return parts.map((part, index) =>
      `\n📄 [PDF Page ${page.pdfPage}${parts.length > 1 ? ` · Part ${index + 1}/${parts.length}` : ''}]\n${part}`
    );
  });

  // 2. Summary & Notes
  const notesChunks: string[] = [];
  if (assignment.studyNotes) {
    const notes = assignment.studyNotes;
    if (notes.summary) {
      notesChunks.push(`\n📝 Study Summary\n${sanitizeUtf8(notes.summary)}`);
    }
    if (notes.keyConcepts?.length) {
      notesChunks.push(`Key Concepts:\n${notes.keyConcepts.map(item => `• ${sanitizeUtf8(item)}`).join('\n')}`);
    }
    if (notes.definitions?.length) {
      notesChunks.push(`Definitions:\n${notes.definitions.map(item => `• ${sanitizeUtf8(item.term)} (PDF p. ${item.pdfPage}): ${sanitizeUtf8(item.explanation)}`).join('\n')}`);
    }
    if (!enrichment?.quiz?.length && notes.questions?.length) {
      notesChunks.push(`Revision Questions:\n${notes.questions.map((item, index) => `${index + 1}. ${sanitizeUtf8(item.question)}\nAnswer: ${sanitizeUtf8(item.answer)}`).join('\n\n')}`);
    }
  }

  // 3. Real-Life Examples
  const examplesChunks: string[] = [];
  if (enrichment?.realLifeExamples?.length) {
    const examplesFormatted = enrichment.realLifeExamples.map(e =>
      `• <b>${sanitizeUtf8(e.title)}</b>\n${sanitizeUtf8(e.situation)}\n<i>Connection:</i> ${sanitizeUtf8(e.connection)}\n<i>Source:</i> ${e.sourceUrl.startsWith('http') ? `<a href="${e.sourceUrl}">${sanitizeUtf8(e.sourceTitle)}</a>` : sanitizeUtf8(e.sourceTitle)} (${sanitizeUtf8(e.attribution)})`
    ).join('\n\n');
    examplesChunks.push(`\n🏛️ <b>Real-Life Examples:</b>\n${examplesFormatted}`);
  }

  // 4. Quotes
  const quotesChunks: string[] = [];
  if (enrichment?.quotes?.length) {
    const quotesFormatted = enrichment.quotes.map(q =>
      `• <i>"${sanitizeUtf8(q.quote)}"</i> — <b>${sanitizeUtf8(q.author)}</b>${q.sourceContext ? ` <i>(${sanitizeUtf8(q.sourceContext)})</i>` : ''}\n  <i>${sanitizeUtf8(q.attribution)}</i>${q.sourceUrl ? ` · <a href="${q.sourceUrl}">Source</a>` : ''}`
    ).join('\n\n');
    quotesChunks.push(`\n💬 <b>Quotes:</b>\n${quotesFormatted}`);
  }

  // 5. Related Videos
  const videosChunks: string[] = [];
  if (enrichment?.videos?.length) {
    const videosFormatted = enrichment.videos.map(v =>
      `• <a href="${v.url}">${sanitizeUtf8(v.title)}</a> — <i>${sanitizeUtf8(v.channelName)}</i>`
    ).join('\n');
    videosChunks.push(`\n📺 <b>Related Videos:</b>\n${videosFormatted}`);
  }

  // 6. Related Podcasts
  const podcastsChunks: string[] = [];
  if (enrichment?.podcasts?.length) {
    const podcastsFormatted = enrichment.podcasts.map(p =>
      `• <a href="${p.url}">${sanitizeUtf8(p.title)}</a> — <i>${sanitizeUtf8(p.podcastName)}</i>${p.description ? `\n  ${sanitizeUtf8(p.description.slice(0, 150))}...` : ''}`
    ).join('\n\n');
    podcastsChunks.push(`\n🎙️ <b>Related Podcasts:</b>\n${podcastsFormatted}`);
  }

  // 7. Quiz
  const quizChunks: string[] = [];
  const appOrigin = process.env.CLIENT_URL?.split(',')[0] || process.env.NEXT_PUBLIC_API_URL || 'https://your-planner-app.vercel.app';
  const interactiveQuizUrl = `${appOrigin}/books?quiz=${assignment.id}`;

  if (enrichment?.quiz?.length) {
    const quizFormatted = enrichment.quiz.map((q, idx) => {
      const optionsFormatted = q.options.map((opt, oIdx) => `  ${String.fromCharCode(65 + oIdx)}) ${sanitizeUtf8(opt)}`).join('\n');
      const correctLetter = String.fromCharCode(65 + q.correctOptionIndex);
      return `<b>Question ${idx + 1} (${q.difficulty.toUpperCase()}):</b> ${sanitizeUtf8(q.question)}\n${optionsFormatted}\n<b>Answer:</b> ${correctLetter}) ${sanitizeUtf8(q.options[q.correctOptionIndex])}\n<i>Explanation:</i> ${sanitizeUtf8(q.explanation)}`;
    }).join('\n\n');
    quizChunks.push(`\n🧠 <b>Reading Quiz:</b>\n${quizFormatted}\n\n🎯 <b>Interactive Quiz:</b> <a href="${interactiveQuizUrl}">Launch Website Interactive Quiz</a>`);
  }

  const continuity = previousAssignment?.studyNotes
    ? `\nConnection to Day ${previousAssignment.dayNumber}:\nYesterday: ${sanitizeUtf8(previousAssignment.studyNotes.summary)}`
    : '';

  const chunks: string[] = [
    header,
    ...pageChunks,
    ...(notesChunks.length ? notesChunks : []),
    ...(examplesChunks.length ? examplesChunks : []),
    ...(quotesChunks.length ? quotesChunks : []),
    ...(videosChunks.length ? videosChunks : []),
    ...(podcastsChunks.length ? podcastsChunks : []),
    ...(quizChunks.length ? quizChunks : []),
    ...(continuity ? [continuity] : []),
  ];

  return chunks.flatMap(chunk => splitTelegramText(sanitizeUtf8(chunk)));
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

async function createDelivery(userId: string, bookId: string, assignmentId: string, parts: string[], image?: { filename: string; page: number }) {
  const sql = getDb();
  const now = Date.now();
  const item: TelegramDeliveryRecord = { id: randomUUID(), userId, bookId, assignmentId, status: 'pending', messageParts: parts, nextPart: 0, telegramMessageIds: [], ...(image ? { imageFilename: image.filename, imagePage: image.page, imageSent: false } : {}), lastError: '', safeToRetry: false, retryAfterAt: null, createdAt: now, updatedAt: now };
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`INSERT INTO telegram_deliveries (id, user_id, book_id, assignment_id, status, data, created_at, updated_at)
      VALUES (${item.id}, ${userId}, ${bookId}, ${assignmentId}, 'pending', ${JSON.stringify(item)}::jsonb, ${now}, ${now})
      ON CONFLICT (user_id, assignment_id) DO UPDATE SET status = 'pending', data = ${JSON.stringify(item)}::jsonb, updated_at = ${now} RETURNING data`;
    return (rows[0]?.data || item) as TelegramDeliveryRecord;
  } else {
    const all = readDeliveries();
    const existingIndex = all.findIndex(entry => entry.userId === userId && entry.assignmentId === assignmentId);
    if (existingIndex >= 0) {
      all[existingIndex] = item;
    } else {
      all.push(item);
    }
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

async function sendPageImage(bookId: string, filename: string, caption: string) {
  const imagePath = path.join(DATA_ROOT, 'books', bookId, 'page-previews', path.basename(filename));
  const image = fs.readFileSync(imagePath);
  if (image.length > 10 * 1024 * 1024) throw new Error('The rendered page image exceeds Telegram\'s 10 MB photo limit.');
  const connection = await checkTelegramChannel();
  if (!connection.canPost) throw new Error(connection.message);
  const { token, chatId } = envConfig();
  const form = new FormData();
  form.set('chat_id', chatId);
  form.set('caption', truncateUnicode(caption, 1024));
  form.set('photo', new Blob([image], { type: 'image/jpeg' }), filename);
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000), cache: 'no-store' });
  } catch {
    throw Object.assign(new Error('Telegram image upload timed out or could not connect. Check the channel before retrying.'), { uncertain: true });
  }
  const data = await response.json().catch(() => null) as { ok?: boolean; result?: { message_id: number }; description?: string; error_code?: number; parameters?: { retry_after?: number } } | null;
  if (!response.ok || !data?.ok) {
    const code = data?.error_code ?? response.status;
    if (code === 429 && data?.parameters?.retry_after) throw Object.assign(new Error(`Telegram rate limited the image; retry after ${data.parameters.retry_after} seconds.`), { retryAfter: data.parameters.retry_after });
    if (code >= 500) throw Object.assign(new Error('Telegram is temporarily unavailable while uploading the page image.'), { transient: true });
    throw new Error(data?.description || `Telegram image upload failed (${code}).`);
  }
  return data.result!.message_id;
}

export async function publishApprovedAssignment(
  userId: string,
  book: BookRecord,
  assignment: BookAssignmentRecord,
  pages: BookPageRecord[],
  previousAssignment?: BookAssignmentRecord,
  enrichment?: EnrichedReadingContent
) {
  const previousDelivery = previousAssignment ? await getAssignmentDelivery(userId, previousAssignment.id) : null;
  const postedPrevious = previousDelivery?.status === 'completed' ? previousAssignment : undefined;

  let activeEnrichment = enrichment;
  if (!activeEnrichment && !process.env.VITEST) {
    try {
      activeEnrichment = await researchReadingEnrichment({ book, assignment, pages, studyNotes: assignment.studyNotes });
    } catch (enrichErr: any) {
      console.warn('[Telegram] External enrichment lookup non-fatal warning:', enrichErr.message);
    }
  }

  const parts = formatReadingAssignment(book, assignment, pages, postedPrevious, activeEnrichment);
  let delivery = await getAssignmentDelivery(userId, assignment.id);
  if (delivery?.status === 'completed') throw new Error('This assignment has already been published successfully.');
  if (delivery && delivery.status !== 'pending') {
    if (delivery.status === 'uncertain' || !delivery.safeToRetry) throw Object.assign(new Error('A previous delivery may have sent part of this assignment. Check the Telegram channel and delivery record before retrying.'), { delivery });
    if (delivery.retryAfterAt && delivery.retryAfterAt > Date.now()) throw Object.assign(new Error(`Telegram asked us to retry after ${new Date(delivery.retryAfterAt).toISOString()}.`), { delivery });
  }
  if (!delivery) {
    const imagePage = pages.find(page => page.visualPreview?.filename);
    delivery = await createDelivery(userId, book.id, assignment.id, parts, imagePage?.visualPreview ? { filename: imagePage.visualPreview.filename, page: imagePage.pdfPage } : undefined);
  }
  const claimed = await claimDelivery(delivery);
  if (!claimed) throw new Error('Another request is already processing this Telegram delivery, or the saved delivery can no longer be retried.');
  delivery = claimed;
  let sendingStarted = false;
  try {
    const connection = await checkTelegramChannel();
    if (!connection.canPost) throw new Error(connection.message);
    const { chatId } = envConfig();
    while (delivery.nextPart < delivery.messageParts.length) {
      sendingStarted = true;
      const part = delivery.messageParts[delivery.nextPart];
      const formattedPart = formatTelegramMessage(part);
      const message = await sendTelegramMessageWithFallback(chatId, formattedPart, true);
      delivery = await saveDelivery({ ...delivery, nextPart: delivery.nextPart + 1, telegramMessageIds: [...delivery.telegramMessageIds, message.message_id], updatedAt: Date.now() });
      sendingStarted = false;
    }
    if (delivery.imageFilename && !delivery.imageSent) {
      sendingStarted = true;
      const messageId = await sendPageImage(book.id, delivery.imageFilename, `${book.title} · Day ${assignment.dayNumber} · original PDF page ${delivery.imagePage}`);
      delivery = await saveDelivery({ ...delivery, imageSent: true, telegramMessageIds: [...delivery.telegramMessageIds, messageId], updatedAt: Date.now() });
      sendingStarted = false;
    }

    // Dispatch native interactive Telegram quiz polls for subscribers
    if (activeEnrichment?.quiz?.length && !process.env.VITEST) {
      for (let qIdx = 0; qIdx < Math.min(3, activeEnrichment.quiz.length); qIdx++) {
        const q = activeEnrichment.quiz[qIdx];
        try {
          const pollRes = await sendTelegramQuizPoll({
            chatId,
            question: truncateUnicode(`[Day ${assignment.dayNumber} · Quiz] ${q.question}`, 300),
            options: q.options,
            correctOptionId: q.correctOptionIndex,
            explanation: truncateUnicode(q.explanation, 200),
            isAnonymous: false,
          });
          delivery = await saveDelivery({
            ...delivery,
            telegramMessageIds: [...delivery.telegramMessageIds, pollRes.messageId],
            updatedAt: Date.now(),
          });
        } catch (pollErr: any) {
          console.warn('[Telegram] Quiz poll dispatch warning:', pollErr?.message);
        }
      }
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

export async function publishLoadPlanPagesToTelegram(
  userId: string,
  book: BookRecord,
  assignment: BookAssignmentRecord,
  pages: BookPageRecord[],
  previousAssignment?: BookAssignmentRecord,
  enrichment?: EnrichedReadingContent
) {
  let activeEnrichment = enrichment;
  if (!activeEnrichment && !process.env.VITEST) {
    try {
      activeEnrichment = await researchReadingEnrichment({ book, assignment, pages, studyNotes: assignment.studyNotes });
    } catch (enrichErr: any) {
      console.warn('[Telegram] External enrichment lookup non-fatal warning:', enrichErr.message);
    }
  }

  const parts = formatLoadPlanPages(book, assignment, pages, previousAssignment, activeEnrichment);
  let delivery = await getAssignmentDelivery(userId, assignment.id);
  if (!delivery) {
    const imagePage = pages.find(page => page.visualPreview?.filename);
    delivery = await createDelivery(
      userId,
      book.id,
      assignment.id,
      parts,
      imagePage?.visualPreview ? { filename: imagePage.visualPreview.filename, page: imagePage.pdfPage } : undefined
    );
  } else {
    delivery = {
      ...delivery,
      status: 'pending',
      messageParts: parts,
      nextPart: 0,
      telegramMessageIds: [],
      lastError: '',
      safeToRetry: true,
      retryAfterAt: null,
      updatedAt: Date.now(),
    };
    await saveDelivery(delivery);
  }

  const claimed = await claimDelivery(delivery);
  if (!claimed) throw new Error('Another request is already processing this Telegram delivery, or it cannot be retried.');
  delivery = claimed;

  let sendingStarted = false;
  try {
    const connection = await checkTelegramChannel();
    if (!connection.canPost) throw new Error(connection.message);

    const { chatId } = envConfig();
    while (delivery.nextPart < delivery.messageParts.length) {
      sendingStarted = true;
      const part = delivery.messageParts[delivery.nextPart];
      const formattedPart = formatTelegramMessage(part);
      const message = await sendTelegramMessageWithFallback(chatId, formattedPart, true);
      delivery = await saveDelivery({
        ...delivery,
        nextPart: delivery.nextPart + 1,
        telegramMessageIds: [...delivery.telegramMessageIds, message.message_id],
        updatedAt: Date.now(),
      });
      sendingStarted = false;
    }

    if (delivery.imageFilename && !delivery.imageSent) {
      try {
        sendingStarted = true;
        const messageId = await sendPageImage(
          book.id,
          delivery.imageFilename,
          `${book.title} · Day ${assignment.dayNumber} · original PDF page ${delivery.imagePage}`
        );
        delivery = await saveDelivery({
          ...delivery,
          imageSent: true,
          telegramMessageIds: [...delivery.telegramMessageIds, messageId],
          updatedAt: Date.now(),
        });
      } catch (imgErr) {
        console.warn('[Telegram] Could not send page preview image, text was sent successfully:', imgErr);
      } finally {
        sendingStarted = false;
      }
    }

    // Dispatch native interactive Telegram quiz polls for subscribers
    if (activeEnrichment?.quiz?.length && !process.env.VITEST) {
      for (let qIdx = 0; qIdx < Math.min(3, activeEnrichment.quiz.length); qIdx++) {
        const q = activeEnrichment.quiz[qIdx];
        try {
          const pollRes = await sendTelegramQuizPoll({
            chatId,
            question: truncateUnicode(`[Day ${assignment.dayNumber} · Quiz] ${q.question}`, 300),
            options: q.options,
            correctOptionId: q.correctOptionIndex,
            explanation: truncateUnicode(q.explanation, 200),
            isAnonymous: false,
          });
          delivery = await saveDelivery({
            ...delivery,
            telegramMessageIds: [...delivery.telegramMessageIds, pollRes.messageId],
            updatedAt: Date.now(),
          });
        } catch (pollErr: any) {
          console.warn('[Telegram] Quiz poll dispatch warning in load plan:', pollErr?.message);
        }
      }
    }

    const completed = await saveDelivery({
      ...delivery,
      status: 'completed',
      lastError: '',
      safeToRetry: false,
      retryAfterAt: null,
      updatedAt: Date.now(),
    });

    return {
      delivery: completed,
      channel: connection.channel.title,
      bot: connection.bot.username ? `@${connection.bot.username}` : connection.bot.name || 'Telegram Bot',
      messageCount: completed.telegramMessageIds.length,
      telegramMessageIds: completed.telegramMessageIds,
    };
  } catch (error) {
    const err = error as Error & { retryAfter?: number; transient?: boolean };
    const uncertain = Boolean((err as Error & { uncertain?: boolean }).uncertain) || (sendingStarted && (err as Error & { transient?: boolean }).transient === true);
    const safeToRetry = !uncertain && (!sendingStarted || Boolean(err.retryAfter));
    delivery = await saveDelivery({
      ...delivery,
      status: uncertain ? 'uncertain' : 'failed',
      lastError: err.message,
      safeToRetry,
      retryAfterAt: err.retryAfter ? Date.now() + err.retryAfter * 1000 : null,
      updatedAt: Date.now(),
    });
    throw Object.assign(new Error(err.message), { delivery });
  }
}

export async function deleteBookDeliveries(userId: string, bookId: string) {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    await sql`DELETE FROM telegram_deliveries WHERE book_id = ${bookId} AND user_id = ${userId}`;
  }
  writeDeliveries(readDeliveries().filter(item => !(item.bookId === bookId && item.userId === userId)));
}
