import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from './neon';
import type { BookAssignmentRecord, BookRecord, BookPageRecord } from '../books/types';
import { formatTelegramMessage, splitTelegramHtml, stripHtml, sanitizeUtf8, sanitizePayload, truncateUnicode, sanitizeJsonPayloadString, escapeTelegramHtml, escapeTelegramAttr } from './telegramFormatter';
import { researchReadingEnrichment, type EnrichedReadingContent } from './sources/enrichment';
import { orderCompleteAssignmentPages } from './books/sourceCoverage';

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
  channel?: string;
  bot?: string;
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

export function getAppOrigin(): string {
  const moonAppUrl = process.env.MOON_APP_URL?.trim();
  if (moonAppUrl) {
    return (moonAppUrl.startsWith('http') ? moonAppUrl : `https://${moonAppUrl}`).replace(/\/+$/, '');
  }

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    return (appUrl.startsWith('http') ? appUrl : `https://${appUrl}`).replace(/\/+$/, '');
  }

  const clientUrl = process.env.CLIENT_URL?.split(',')[0]?.trim();
  if (clientUrl && clientUrl !== '*') {
    return clientUrl.replace(/\/+$/, '');
  }

  const renderExternal = process.env.RENDER_EXTERNAL_URL?.trim();
  if (renderExternal) {
    return (renderExternal.startsWith('http') ? renderExternal : `https://${renderExternal}`).replace(/\/+$/, '');
  }

  const renderHost = process.env.RENDER_EXTERNAL_HOSTNAME?.trim();
  if (renderHost) {
    return `https://${renderHost}`.replace(/\/+$/, '');
  }

  const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (publicAppUrl) {
    return (publicAppUrl.startsWith('http') ? publicAppUrl : `https://${publicAppUrl}`).replace(/\/+$/, '');
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return (vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`).replace(/\/+$/, '');
  }

  const publicApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (publicApiUrl) {
    return (publicApiUrl.startsWith('http') ? publicApiUrl : `https://${publicApiUrl}`).replace(/\/+$/, '');
  }

  return 'https://your-planner-app.vercel.app';
}


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
  void params;
  throw new Error('Book quizzes are website-only; Telegram quiz polls are disabled.');
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

function buildAssignmentTelegramContent(
  book: BookRecord,
  assignment: BookAssignmentRecord,
  pages: BookPageRecord[],
  previousAssignment?: BookAssignmentRecord,
  enrichment?: EnrichedReadingContent,
  requireApproved = false,
): string[] {
  if (requireApproved && (assignment.status !== 'approved' || !assignment.studyNotes)) {
    throw new Error('Only assignments with approved study notes can be published.');
  }
  const orderedPages = orderCompleteAssignmentPages(assignment, pages);
  const notes = assignment.studyNotes;
  const learning = assignment.learningPackage;
  const original = orderedPages.map(page => {
    const rawText = page.text || '';
    return !rawText.trim()
      ? `<b>[PDF Page ${page.pdfPage}: Blank or Illustration Page]</b>\n(No extractable text was found on this page; it may be blank or visual-only.)`
      : `<b>[PDF Page ${page.pdfPage}]</b>\n${escapeTelegramHtml(sanitizeUtf8(rawText))}`;
  });
  const summary = learning?.summary || notes?.summary || 'Study materials have not been generated for this unit.';
  const concepts = learning?.keyConcepts || notes?.keyConcepts || assignment.concepts.map(item => item.title);
  const definitions = learning?.definitions || notes?.definitions || [];
  const connection = learning?.previousUnitConnection?.explanation
    ? `${learning.previousUnitConnection.previousTitle || 'Previous unit'}: ${learning.previousUnitConnection.explanation}`
    : previousAssignment?.studyNotes
      ? `Yesterday's takeaway: ${previousAssignment.studyNotes.summary}\nToday builds on: ${(assignment.concepts || []).map(item => item.title).join(', ')}`
      : 'This is the first delivered study unit for this book.';
  const examples = learning?.realLifeExamples?.length
    ? learning.realLifeExamples.map(item => {
        const source = item.sourceUrl?.startsWith('http')
          ? `<a href="${escapeTelegramAttr(item.sourceUrl)}">${escapeTelegramHtml(item.sourceTitle || 'Source')}</a>`
          : escapeTelegramHtml(item.sourceDisclosure || item.attribution);
        return `<b>${escapeTelegramHtml(item.title)}</b>\n${escapeTelegramHtml(item.situation)}\n<i>Connection:</i> ${escapeTelegramHtml(item.connection)}${item.lesson ? `\n<i>Lesson:</i> ${escapeTelegramHtml(item.lesson)}` : ''}\n<i>Source:</i> ${source}`;
      }).join('\n\n')
    : enrichment?.realLifeExamples?.length
      ? enrichment.realLifeExamples.map(item => `<b>${escapeTelegramHtml(item.title)}</b>\n${escapeTelegramHtml(item.situation)}\n<i>Connection:</i> ${escapeTelegramHtml(item.connection)}\n<i>Source:</i> ${item.sourceUrl.startsWith('http') ? `<a href="${escapeTelegramAttr(item.sourceUrl)}">${escapeTelegramHtml(item.sourceTitle)}</a>` : escapeTelegramHtml(item.sourceTitle)} (${escapeTelegramHtml(item.attribution)})`).join('\n\n')
      : notes?.example?.situation
        ? `${escapeTelegramHtml(notes.example.situation)}\n${escapeTelegramHtml(notes.example.conceptInAction)}\n<i>Lesson:</i> ${escapeTelegramHtml(notes.example.lesson)}\n<i>Source:</i> ${escapeTelegramHtml(notes.example.sourceDisclosure)}`
        : 'No example was available for this unit.';
  const quotes = learning?.quotes?.length
    ? learning.quotes.map(item => `<i>"${escapeTelegramHtml(item.text)}"</i> (PDF p. ${item.pdfPage})`).join('\n')
    : enrichment?.quotes?.length
      ? enrichment.quotes.map(item => `<i>"${escapeTelegramHtml(item.quote)}"</i> - <b>${escapeTelegramHtml(item.author)}</b> (${escapeTelegramHtml(item.attribution)})${item.sourceUrl ? ` <a href="${escapeTelegramAttr(item.sourceUrl)}">Source</a>` : ''}`).join('\n')
      : 'No verified quotation was found in the extracted source for this unit.';
  const quizUrl = `${getAppOrigin() || 'http://localhost:3000'}/quiz?assignmentId=${encodeURIComponent(assignment.id)}`;
  const content = [
    `<b>${escapeTelegramHtml(book.title)}${book.author ? ` - ${escapeTelegramHtml(book.author)}` : ''}</b>\n${requireApproved ? 'Approved reading assignment' : `Reading Load Plan \u00b7 Day ${assignment.dayNumber} (${assignment.scheduledDate})`}\n${requireApproved ? `PDF pages ${assignment.startPdfPage}\u2013${assignment.endPdfPage}` : `PDF Pages: ${assignment.startPdfPage}\u2013${assignment.endPdfPage}`}`,
    '<b>1. Original Extracted Text</b>', ...original,
    `<b>2. Study Summary</b>\n${escapeTelegramHtml(sanitizeUtf8(summary))}${concepts.length ? `\n\n<b>Key Concepts</b>\n${concepts.map(item => `\u25AA ${escapeTelegramHtml(item)}`).join('\n')}` : ''}`,
    `<b>3. Definitions</b>\n${definitions.length ? definitions.map(item => `\u25AA ${escapeTelegramHtml(item.term)} (PDF p. ${item.pdfPage}): ${escapeTelegramHtml(item.explanation)}`).join('\n') : 'No source-grounded definitions were identified for this unit.'}`,
    `<b>4. Connection to Yesterday's Post</b>\n${escapeTelegramHtml(sanitizeUtf8(connection))}`,
    `<b>5. Real-Life Examples</b>\n${examples}`,
    `<b>6. Quotes</b>\n${quotes}`,
    `<b>7. Website Quiz</b>\n<a href="${escapeTelegramAttr(quizUrl)}">Open this unit's quiz</a>`,
  ];
  // Keep supplementary links after the required learning sequence.
  if (enrichment?.videos?.length) content.push(`<b>Related Videos:</b>\n${enrichment.videos.map(item => `<a href="${escapeTelegramAttr(item.url)}">${escapeTelegramHtml(item.title)}</a> - ${escapeTelegramHtml(item.channelName)}`).join('\n')}`);
  if (enrichment?.podcasts?.length) content.push(`<b>Related Podcasts:</b>\n${enrichment.podcasts.map(item => `<a href="${escapeTelegramAttr(item.url)}">${escapeTelegramHtml(item.title)}</a> - ${escapeTelegramHtml(item.podcastName)}`).join('\n')}`);
  return content.flatMap(part => splitTelegramText(sanitizeUtf8(part)));
}

export function formatReadingAssignment(
  book: BookRecord,
  assignment: BookAssignmentRecord,
  pages: BookPageRecord[],
  previousAssignment?: BookAssignmentRecord,
  enrichment?: EnrichedReadingContent
): string[] {
  return buildAssignmentTelegramContent(book, assignment, pages, previousAssignment, enrichment, true);
}

export function formatLoadPlanPages(
  book: BookRecord,
  assignment: BookAssignmentRecord,
  pages: BookPageRecord[],
  previousAssignment?: BookAssignmentRecord,
  enrichment?: EnrichedReadingContent
): string[] {
  return buildAssignmentTelegramContent(book, assignment, pages, previousAssignment, enrichment, false);
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
      ON CONFLICT (user_id, assignment_id) DO NOTHING RETURNING data`;
    if (rows[0]?.data) return rows[0].data as TelegramDeliveryRecord;
    const existing = await getAssignmentDelivery(userId, assignmentId);
    if (existing) return existing;
    throw new Error('Telegram delivery could not be created safely; retry after refreshing the delivery state.');
  } else {
    const all = readDeliveries();
    const existingIndex = all.findIndex(entry => entry.userId === userId && entry.assignmentId === assignmentId);
    if (existingIndex >= 0) return all[existingIndex];
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
  if (!process.env.VITEST) {
    try {
      const { getOrGenerateLearningPackage } = await import('./books/learningContent');
      assignment.learningPackage = await getOrGenerateLearningPackage(userId, book, assignment, pages);
    } catch (error) {
      console.warn('[Telegram] Learning package preparation warning:', error);
    }
  }
  const previousDelivery = previousAssignment ? await getAssignmentDelivery(userId, previousAssignment.id) : null;
  const postedPrevious = previousDelivery?.status === 'completed' ? previousAssignment : undefined;

  let activeEnrichment = enrichment;
  if (!activeEnrichment && !process.env.VITEST) {
    try {
      activeEnrichment = await researchReadingEnrichment({
        book,
        assignment,
        pages,
        studyNotes: assignment.studyNotes,
        previousAssignments: previousAssignment ? [previousAssignment] : undefined,
      });
    } catch (enrichErr: any) {
      console.warn('[Telegram] External enrichment lookup non-fatal warning:', enrichErr.message);
    }
  }

  const parts = formatReadingAssignment(book, assignment, pages, postedPrevious, activeEnrichment);
  let delivery = await getAssignmentDelivery(userId, assignment.id);
  if (delivery?.status === 'completed') return delivery;
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
  if (!process.env.VITEST) {
    try {
      const { getOrGenerateLearningPackage } = await import('./books/learningContent');
      assignment.learningPackage = await getOrGenerateLearningPackage(userId, book, assignment, pages);
    } catch (error) {
      console.warn('[Telegram] Learning package preparation warning:', error);
    }
  }
  let activeEnrichment = enrichment;
  if (!activeEnrichment && !process.env.VITEST) {
    try {
      activeEnrichment = await researchReadingEnrichment({
        book,
        assignment,
        pages,
        studyNotes: assignment.studyNotes,
        previousAssignments: previousAssignment ? [previousAssignment] : undefined,
      });
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
  } else if (delivery.status === 'completed') {
    return { delivery, channel: delivery.channel || 'Previously delivered Telegram channel', bot: delivery.bot || 'Previously used Telegram bot', messageCount: delivery.telegramMessageIds.length, telegramMessageIds: delivery.telegramMessageIds };
  } else if (delivery.status !== 'pending') {
    if (delivery.status === 'uncertain' || !delivery.safeToRetry) throw Object.assign(new Error('A previous delivery may have sent part of this assignment. Check Telegram and the delivery record before retrying.'), { delivery });
    if (delivery.retryAfterAt && delivery.retryAfterAt > Date.now()) throw Object.assign(new Error(`Telegram asked us to retry after ${new Date(delivery.retryAfterAt).toISOString()}.`), { delivery });
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



    const completed = await saveDelivery({
      ...delivery,
      status: 'completed',
      channel: connection.channel.title,
      bot: connection.bot.username ? `@${connection.bot.username}` : connection.bot.name || 'Telegram Bot',
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
