import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../neon';
import { sendTelegramTextToChannel } from '../telegram';
import { generateMorningBriefingText, generateEveningReviewText } from '../telegramTaskAlerts';
import { listBookAssignments } from '../bookAssignments';
import { listBooks } from '../books';
import { getEthiopianClock, normalizeTimeString } from '../../date/ethiopianTime';
import { zonedDateTimeToTimestamp } from '../bookScheduler';

export type BriefType = 'morning' | 'evening';
export type BriefDeliveryStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

export interface BriefConfig {
  userId: string;
  enabled: boolean;
  morningTime: string;      // default: "08:00"
  eveningTime: string;      // default: "20:00"
  timezone: string;         // default: "Africa/Addis_Ababa"
  skipNextMorningDate?: string | null;
  skipNextEveningDate?: string | null;
  overrideMorningDate?: string | null;
  overrideMorningTime?: string | null;
  overrideEveningDate?: string | null;
  overrideEveningTime?: string | null;
  temporaryMorningContent?: string | null;
  temporaryEveningContent?: string | null;
  updatedAt: number;
}

export interface BriefDeliveryRecord {
  id: string; // Idempotency key: `${briefType}_${userId}_${targetDate}`
  userId: string;
  briefType: BriefType;
  targetDate: string; // YYYY-MM-DD
  scheduledFor: number; // UTC ms
  status: BriefDeliveryStatus;
  isManualSend: boolean;
  content: string;
  telegramMessageIds: number[];
  lastError: string;
  attemptCount: number;
  maxAttempts: number;
  deliveredAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface BriefStatusInfo {
  config: BriefConfig;
  currentTimezone: string;
  currentLocalTime: string;
  currentLocalDate: string;
  currentHabeshaTime: string;
  currentHabeshaDate: string;
  morning: {
    enabled: boolean;
    configuredTime: string;
    effectiveTime: string;
    habeshaTime: string;
    nextScheduledIso: string;
    nextScheduledHabesha: string;
    isDeliveredToday: boolean;
    isSkippedToday: boolean;
    hasTimeOverride: boolean;
    hasContentOverride: boolean;
    lastDelivery: BriefDeliveryRecord | null;
  };
  evening: {
    enabled: boolean;
    configuredTime: string;
    effectiveTime: string;
    habeshaTime: string;
    nextScheduledIso: string;
    nextScheduledHabesha: string;
    isDeliveredToday: boolean;
    isSkippedToday: boolean;
    hasTimeOverride: boolean;
    hasContentOverride: boolean;
    lastDelivery: BriefDeliveryRecord | null;
  };
  recentDeliveries: BriefDeliveryRecord[];
}

const DATA_DIR = process.env.BOOK_DATA_DIR?.trim() || path.join(process.cwd(), '.data');
const SETTINGS_PATH = path.join(DATA_DIR, 'telegram-brief-settings.json');
const DELIVERIES_PATH = path.join(DATA_DIR, 'telegram-brief-deliveries.json');
let schemaReady: Promise<void> | null = null;

function readJson<T>(file: string, empty: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return empty;
  }
}

function writeJson<T>(file: string, data: T) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch {
    fs.copyFileSync(temp, file);
    try { fs.unlinkSync(temp); } catch {}
  }
}

async function ensureSchema(sql: NonNullable<ReturnType<typeof getDb>>) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS telegram_brief_settings (
        user_id VARCHAR(64) PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT true,
        morning_time VARCHAR(10) NOT NULL DEFAULT '08:00',
        evening_time VARCHAR(10) NOT NULL DEFAULT '20:00',
        timezone VARCHAR(64) NOT NULL DEFAULT 'Africa/Addis_Ababa',
        skip_next_morning VARCHAR(20),
        skip_next_evening VARCHAR(20),
        override_morning_date VARCHAR(20),
        override_morning_time VARCHAR(10),
        override_evening_date VARCHAR(20),
        override_evening_time VARCHAR(10),
        temp_morning_content TEXT,
        temp_evening_content TEXT,
        updated_at BIGINT NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS telegram_brief_deliveries (
        id VARCHAR(128) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        brief_type VARCHAR(20) NOT NULL,
        target_date VARCHAR(20) NOT NULL,
        scheduled_for BIGINT NOT NULL,
        status VARCHAR(20) NOT NULL,
        is_manual_send BOOLEAN NOT NULL DEFAULT false,
        content TEXT NOT NULL,
        telegram_message_ids JSONB DEFAULT '[]'::jsonb,
        last_error TEXT DEFAULT '',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        delivered_at BIGINT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_brief_deliveries_due ON telegram_brief_deliveries(status, scheduled_for)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_brief_deliveries_user_date ON telegram_brief_deliveries(user_id, target_date DESC)`;
    })().catch(err => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

export function defaultBriefConfig(userId: string): BriefConfig {
  return {
    userId,
    enabled: true,
    morningTime: '08:00',
    eveningTime: '20:00',
    timezone: 'Africa/Addis_Ababa',
    skipNextMorningDate: null,
    skipNextEveningDate: null,
    overrideMorningDate: null,
    overrideMorningTime: null,
    overrideEveningDate: null,
    overrideEveningTime: null,
    temporaryMorningContent: null,
    temporaryEveningContent: null,
    updatedAt: Date.now(),
  };
}

export function getLocalTodayDate(timezone = 'Africa/Addis_Ababa', offsetDays = 0): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const base = new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day) + offsetDays));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`;
}

export function getLocalCurrentTime(timezone = 'Africa/Addis_Ababa'): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.hour}:${map.minute}`;
}

export async function getBriefConfig(userId = 'owner'): Promise<BriefConfig> {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`SELECT * FROM telegram_brief_settings WHERE user_id = ${userId} LIMIT 1`;
    if (rows.length > 0) {
      const r = rows[0];
      return {
        userId: r.user_id,
        enabled: Boolean(r.enabled),
        morningTime: r.morning_time || '08:00',
        eveningTime: r.evening_time || '20:00',
        timezone: r.timezone || 'Africa/Addis_Ababa',
        skipNextMorningDate: r.skip_next_morning || null,
        skipNextEveningDate: r.skip_next_evening || null,
        overrideMorningDate: r.override_morning_date || null,
        overrideMorningTime: r.override_morning_time || null,
        overrideEveningDate: r.override_evening_date || null,
        overrideEveningTime: r.override_evening_time || null,
        temporaryMorningContent: r.temp_morning_content || null,
        temporaryEveningContent: r.temp_evening_content || null,
        updatedAt: Number(r.updated_at),
      };
    }
  }

  const all = readJson<BriefConfig[]>(SETTINGS_PATH, []);
  const found = all.find(c => c.userId === userId);
  if (found) return found;

  const def = defaultBriefConfig(userId);
  all.push(def);
  writeJson(SETTINGS_PATH, all);
  return def;
}

export async function saveBriefConfig(update: Partial<BriefConfig> & { userId: string }): Promise<BriefConfig> {
  const current = await getBriefConfig(update.userId);
  const merged: BriefConfig = {
    ...current,
    ...update,
    morningTime: normalizeTimeString(update.morningTime ?? current.morningTime),
    eveningTime: normalizeTimeString(update.eveningTime ?? current.eveningTime),
    timezone: update.timezone ?? current.timezone ?? 'Africa/Addis_Ababa',
    updatedAt: Date.now(),
  };

  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    await sql`
      INSERT INTO telegram_brief_settings (
        user_id, enabled, morning_time, evening_time, timezone,
        skip_next_morning, skip_next_evening,
        override_morning_date, override_morning_time,
        override_evening_date, override_evening_time,
        temp_morning_content, temp_evening_content, updated_at
      ) VALUES (
        ${merged.userId}, ${merged.enabled}, ${merged.morningTime}, ${merged.eveningTime}, ${merged.timezone},
        ${merged.skipNextMorningDate || null}, ${merged.skipNextEveningDate || null},
        ${merged.overrideMorningDate || null}, ${merged.overrideMorningTime || null},
        ${merged.overrideEveningDate || null}, ${merged.overrideEveningTime || null},
        ${merged.temporaryMorningContent || null}, ${merged.temporaryEveningContent || null},
        ${merged.updatedAt}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        morning_time = EXCLUDED.morning_time,
        evening_time = EXCLUDED.evening_time,
        timezone = EXCLUDED.timezone,
        skip_next_morning = EXCLUDED.skip_next_morning,
        skip_next_evening = EXCLUDED.skip_next_evening,
        override_morning_date = EXCLUDED.override_morning_date,
        override_morning_time = EXCLUDED.override_morning_time,
        override_evening_date = EXCLUDED.override_evening_date,
        override_evening_time = EXCLUDED.override_evening_time,
        temp_morning_content = EXCLUDED.temp_morning_content,
        temp_evening_content = EXCLUDED.temp_evening_content,
        updated_at = EXCLUDED.updated_at
    `;
  }

  const all = readJson<BriefConfig[]>(SETTINGS_PATH, []);
  const index = all.findIndex(c => c.userId === merged.userId);
  if (index >= 0) all[index] = merged;
  else all.push(merged);
  writeJson(SETTINGS_PATH, all);

  return merged;
}

export async function listBriefDeliveries(userId = 'owner', limit = 20): Promise<BriefDeliveryRecord[]> {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`
      SELECT * FROM telegram_brief_deliveries
      WHERE user_id = ${userId}
      ORDER BY scheduled_for DESC
      LIMIT ${limit}
    `;
    return rows.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      briefType: r.brief_type as BriefType,
      targetDate: r.target_date,
      scheduledFor: Number(r.scheduled_for),
      status: r.status as BriefDeliveryStatus,
      isManualSend: Boolean(r.is_manual_send),
      content: r.content,
      telegramMessageIds: Array.isArray(r.telegram_message_ids) ? r.telegram_message_ids : [],
      lastError: r.last_error || '',
      attemptCount: Number(r.attempt_count),
      maxAttempts: Number(r.max_attempts || 3),
      deliveredAt: r.delivered_at ? Number(r.delivered_at) : null,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
  }

  const all = readJson<BriefDeliveryRecord[]>(DELIVERIES_PATH, []);
  return all
    .filter(d => d.userId === userId)
    .sort((a, b) => b.scheduledFor - a.scheduledFor)
    .slice(0, limit);
}

export async function countFailedBriefDeliveries() {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`SELECT COUNT(*) AS count FROM telegram_brief_deliveries WHERE status = 'failed'`;
    return Number(rows[0]?.count || 0);
  }
  return readJson<BriefDeliveryRecord[]>(DELIVERIES_PATH, []).filter(item => item.status === 'failed').length;
}

export async function getBriefDelivery(id: string): Promise<BriefDeliveryRecord | null> {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`SELECT * FROM telegram_brief_deliveries WHERE id = ${id} LIMIT 1`;
    if (rows.length > 0) {
      const r = rows[0];
      return {
        id: r.id,
        userId: r.user_id,
        briefType: r.brief_type as BriefType,
        targetDate: r.target_date,
        scheduledFor: Number(r.scheduled_for),
        status: r.status as BriefDeliveryStatus,
        isManualSend: Boolean(r.is_manual_send),
        content: r.content,
        telegramMessageIds: Array.isArray(r.telegram_message_ids) ? r.telegram_message_ids : [],
        lastError: r.last_error || '',
        attemptCount: Number(r.attempt_count),
        maxAttempts: Number(r.max_attempts || 3),
        deliveredAt: r.delivered_at ? Number(r.delivered_at) : null,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
      };
    }
  }

  const all = readJson<BriefDeliveryRecord[]>(DELIVERIES_PATH, []);
  return all.find(d => d.id === id) || null;
}

export async function upsertBriefDelivery(record: BriefDeliveryRecord): Promise<BriefDeliveryRecord> {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    await sql`
      INSERT INTO telegram_brief_deliveries (
        id, user_id, brief_type, target_date, scheduled_for, status,
        is_manual_send, content, telegram_message_ids, last_error,
        attempt_count, max_attempts, delivered_at, created_at, updated_at
      ) VALUES (
        ${record.id}, ${record.userId}, ${record.briefType}, ${record.targetDate},
        ${record.scheduledFor}, ${record.status}, ${record.isManualSend},
        ${record.content}, ${JSON.stringify(record.telegramMessageIds)}::jsonb,
        ${record.lastError}, ${record.attemptCount}, ${record.maxAttempts},
        ${record.deliveredAt}, ${record.createdAt}, ${record.updatedAt}
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        is_manual_send = EXCLUDED.is_manual_send,
        content = EXCLUDED.content,
        telegram_message_ids = EXCLUDED.telegram_message_ids,
        last_error = EXCLUDED.last_error,
        attempt_count = EXCLUDED.attempt_count,
        delivered_at = EXCLUDED.delivered_at,
        updated_at = EXCLUDED.updated_at
    `;
  }

  const all = readJson<BriefDeliveryRecord[]>(DELIVERIES_PATH, []);
  const index = all.findIndex(d => d.id === record.id);
  if (index >= 0) all[index] = record;
  else all.push(record);
  writeJson(DELIVERIES_PATH, all);

  return record;
}

/**
 * Generate enriched Telegram message text for Morning or Evening Brief
 */
export async function generateEnrichedBriefContent(
  briefType: BriefType,
  targetDate: string,
  userId = 'owner',
  temporaryNote?: string | null
): Promise<string> {
  const baseContent = briefType === 'morning'
    ? await generateMorningBriefingText(targetDate, userId)
    : await generateEveningReviewText(targetDate, userId);

  const clock = getEthiopianClock(
    briefType === 'morning' ? '08:00' : '20:00',
    'Africa/Addis_Ababa',
    targetDate
  );

  // Check reading assignment for today
  let readingSnippet = '';
  try {
    const books = await listBooks(userId);
    for (const b of books) {
      const assignments = await listBookAssignments(userId, b.id);
      const todayAssignment = assignments.find(a => a.scheduledDate === targetDate);
      if (todayAssignment) {
        readingSnippet = `📖 <b>Reading Load Plan:</b> Day ${todayAssignment.dayNumber} of "${b.title}" (PDF pages ${todayAssignment.startPdfPage}–${todayAssignment.endPdfPage})${todayAssignment.status === 'completed' ? ' ✅ Completed' : ''}\n`;
        break;
      }
    }
  } catch {
    // Non-fatal if book lookup fails
  }

  // Insert Ethiopian calendar & clock line and reading snippet into the message header
  const lines = baseContent.split('\n');
  const headerIdx = lines.findIndex(l => l.includes('📅'));
  if (headerIdx >= 0) {
    const ethiopianLine = `🇪🇹 <i>${clock.ethiopianDateStr} · ${clock.ethiopianTimeStr}</i>`;
    lines.splice(headerIdx + 1, 0, ethiopianLine);
  }

  if (readingSnippet) {
    const budgetIdx = lines.findIndex(l => l.includes('⏱ Focus Budget') || l.includes('📊 Completion'));
    if (budgetIdx >= 0) {
      lines.splice(budgetIdx + 1, 0, readingSnippet);
    }
  }

  if (temporaryNote && temporaryNote.trim()) {
    lines.push('');
    lines.push(`📝 <b>Custom Scheduled Note:</b>`);
    lines.push(`<i>${temporaryNote.trim()}</i>`);
  }

  return lines.join('\n');
}

/**
 * Compute the next scheduled UTC epoch timestamp for morning or evening brief
 */
export function calculateNextScheduledUtc(
  briefType: BriefType,
  config: BriefConfig,
  now = Date.now()
): { scheduledUtc: number; localDate: string; localTime: string } {
  const tz = config.timezone || 'Africa/Addis_Ababa';
  const today = getLocalTodayDate(tz);
  const currentTime = getLocalCurrentTime(tz);

  let targetTime = briefType === 'morning' ? config.morningTime : config.eveningTime;
  let targetDate = today;

  // Check temporary override
  if (briefType === 'morning' && config.overrideMorningDate && config.overrideMorningTime) {
    targetDate = config.overrideMorningDate;
    targetTime = config.overrideMorningTime;
  } else if (briefType === 'evening' && config.overrideEveningDate && config.overrideEveningTime) {
    targetDate = config.overrideEveningDate;
    targetTime = config.overrideEveningTime;
  } else {
    // If today's time has already passed, schedule for tomorrow
    if (currentTime >= targetTime) {
      targetDate = getLocalTodayDate(tz, 1);
    }
  }

  const scheduledUtc = zonedDateTimeToTimestamp(targetDate, targetTime, tz);
  return { scheduledUtc, localDate: targetDate, localTime: targetTime };
}

/**
 * Send a brief immediately (Send Now manual override)
 */
export async function sendBriefNow(
  userId = 'owner',
  briefType: BriefType,
  customContentOverride?: string
): Promise<{ success: boolean; record: BriefDeliveryRecord; channel: string }> {
  const config = await getBriefConfig(userId);
  const tz = config.timezone || 'Africa/Addis_Ababa';
  const today = getLocalTodayDate(tz);
  const id = `${briefType}_${userId}_${today}`;
  const now = Date.now();

  const tempContent = customContentOverride || (briefType === 'morning' ? config.temporaryMorningContent : config.temporaryEveningContent);
  const content = await generateEnrichedBriefContent(briefType, today, userId, tempContent);

  const existing = await getBriefDelivery(id);
  const record: BriefDeliveryRecord = {
    id,
    userId,
    briefType,
    targetDate: today,
    scheduledFor: now,
    status: 'processing',
    isManualSend: true,
    content,
    telegramMessageIds: existing?.telegramMessageIds || [],
    lastError: '',
    attemptCount: (existing?.attemptCount || 0) + 1,
    maxAttempts: 3,
    deliveredAt: null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await upsertBriefDelivery(record);

  try {
    const telegramRes = await sendTelegramTextToChannel(content, userId);
    record.status = 'completed';
    record.deliveredAt = Date.now();
    record.telegramMessageIds = [telegramRes.messageId];
    record.updatedAt = Date.now();
    await upsertBriefDelivery(record);

    // Clear temporary overrides
    if (briefType === 'morning') {
      await saveBriefConfig({
        userId,
        temporaryMorningContent: null,
        overrideMorningDate: null,
        overrideMorningTime: null,
      });
    } else {
      await saveBriefConfig({
        userId,
        temporaryEveningContent: null,
        overrideEveningDate: null,
        overrideEveningTime: null,
      });
    }

    return {
      success: true,
      record,
      channel: telegramRes.channel,
    };
  } catch (err: any) {
    const errMsg = err instanceof Error ? err.message : 'Manual brief delivery failed';
    record.status = 'failed';
    record.lastError = errMsg;
    record.updatedAt = Date.now();
    await upsertBriefDelivery(record);
    throw err;
  }
}

/**
 * Authoritative background sweep for due Morning and Evening briefs.
 * Called automatically every minute by the scheduler cycle.
 */
export async function processDueBriefs(now = Date.now(), targetUserId?: string): Promise<{
  processed: number;
  completed: number;
  skipped: number;
  failed: number;
}> {
  const stats = { processed: 0, completed: 0, skipped: 0, failed: 0 };

  let configs: BriefConfig[] = [];
  if (targetUserId) {
    configs = [await getBriefConfig(targetUserId)];
  } else {
    configs = readJson<BriefConfig[]>(SETTINGS_PATH, []);
    if (!configs.some(c => c.userId === 'owner')) {
      configs.push(await getBriefConfig('owner'));
    }
  }

  for (const config of configs) {
    if (!config.enabled) continue;

    const tz = config.timezone || 'Africa/Addis_Ababa';
    const today = getLocalTodayDate(tz);
    const currentTime = getLocalCurrentTime(tz);

    const briefTypes: BriefType[] = ['morning', 'evening'];

    for (const briefType of briefTypes) {
      const isMorning = briefType === 'morning';
      const configuredTime = isMorning ? config.morningTime : config.eveningTime;
      const skipDate = isMorning ? config.skipNextMorningDate : config.skipNextEveningDate;
      const overrideDate = isMorning ? config.overrideMorningDate : config.overrideEveningDate;
      const overrideTime = isMorning ? config.overrideMorningTime : config.overrideEveningTime;
      const tempNote = isMorning ? config.temporaryMorningContent : config.temporaryEveningContent;

      const effectiveDate = (overrideDate === today && overrideTime) ? overrideDate : today;
      const effectiveTime = (overrideDate === today && overrideTime) ? overrideTime : configuredTime;

      // Check if scheduled time has arrived today
      if (currentTime < effectiveTime) continue;

      const id = `${briefType}_${config.userId}_${today}`;
      const existing = await getBriefDelivery(id);

      // Check idempotency: if already completed or skipped today, do not resend!
      if (existing && (existing.status === 'completed' || existing.status === 'skipped')) {
        continue;
      }

      // Check if user chose to skip today
      if (skipDate === today) {
        console.log(`[BriefScheduler] ⏭️ Skipping ${briefType} brief for ${today} as requested by user.`);
        await upsertBriefDelivery({
          id,
          userId: config.userId,
          briefType,
          targetDate: today,
          scheduledFor: now,
          status: 'skipped',
          isManualSend: false,
          content: 'Skipped by user override.',
          telegramMessageIds: [],
          lastError: '',
          attemptCount: 1,
          maxAttempts: 1,
          deliveredAt: null,
          createdAt: now,
          updatedAt: now,
        });

        // Clear skip flag
        if (isMorning) {
          await saveBriefConfig({ userId: config.userId, skipNextMorningDate: null });
        } else {
          await saveBriefConfig({ userId: config.userId, skipNextEveningDate: null });
        }
        stats.skipped++;
        continue;
      }

      // If currently processing and fresh (< 5 mins), avoid overlapping duplicate sends
      if (existing?.status === 'processing' && now - existing.updatedAt < 5 * 60 * 1000) {
        continue;
      }

      stats.processed++;
      console.log(`[BriefScheduler] 🚀 Delivering automatic ${briefType} brief to Telegram (${today} ${effectiveTime} ${tz})...`);

      const content = await generateEnrichedBriefContent(briefType, today, config.userId, tempNote);
      const deliveryRecord: BriefDeliveryRecord = {
        id,
        userId: config.userId,
        briefType,
        targetDate: today,
        scheduledFor: zonedDateTimeToTimestamp(today, effectiveTime, tz),
        status: 'processing',
        isManualSend: false,
        content,
        telegramMessageIds: existing?.telegramMessageIds || [],
        lastError: '',
        attemptCount: (existing?.attemptCount || 0) + 1,
        maxAttempts: 3,
        deliveredAt: null,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };

      await upsertBriefDelivery(deliveryRecord);

      try {
        const res = await sendTelegramTextToChannel(content, config.userId);
        deliveryRecord.status = 'completed';
        deliveryRecord.deliveredAt = Date.now();
        deliveryRecord.telegramMessageIds = [res.messageId];
        deliveryRecord.updatedAt = Date.now();
        await upsertBriefDelivery(deliveryRecord);

        // Clear one-time overrides
        if (isMorning) {
          await saveBriefConfig({
            userId: config.userId,
            overrideMorningDate: null,
            overrideMorningTime: null,
            temporaryMorningContent: null,
          });
        } else {
          await saveBriefConfig({
            userId: config.userId,
            overrideEveningDate: null,
            overrideEveningTime: null,
            temporaryEveningContent: null,
          });
        }

        console.log(`[BriefScheduler] ✅ Delivered ${briefType} brief! Telegram ID: ${res.messageId}`);
        stats.completed++;
      } catch (sendErr: any) {
        const errMsg = sendErr instanceof Error ? sendErr.message : 'Brief dispatch failed';
        console.error(`[BriefScheduler] ❌ Failed to dispatch ${briefType} brief:`, errMsg);
        deliveryRecord.status = deliveryRecord.attemptCount >= deliveryRecord.maxAttempts ? 'failed' : 'pending';
        deliveryRecord.lastError = errMsg;
        deliveryRecord.updatedAt = Date.now();
        await upsertBriefDelivery(deliveryRecord);
        stats.failed++;
      }
    }
  }

  return stats;
}

/**
 * Retrieve comprehensive status of Brief Scheduling for the UI
 */
export async function getBriefStatus(userId = 'owner'): Promise<BriefStatusInfo> {
  const config = await getBriefConfig(userId);
  const tz = config.timezone || 'Africa/Addis_Ababa';
  const today = getLocalTodayDate(tz);
  const currentTime = getLocalCurrentTime(tz);

  const clockNow = getEthiopianClock(currentTime, tz, today);

  const deliveries = await listBriefDeliveries(userId, 20);
  const morningDeliveries = deliveries.filter(d => d.briefType === 'morning');
  const eveningDeliveries = deliveries.filter(d => d.briefType === 'evening');

  const morningToday = morningDeliveries.find(d => d.targetDate === today);
  const eveningToday = eveningDeliveries.find(d => d.targetDate === today);

  const nextMorning = calculateNextScheduledUtc('morning', config);
  const nextEvening = calculateNextScheduledUtc('evening', config);

  const morningClock = getEthiopianClock(nextMorning.localTime, tz, nextMorning.localDate);
  const eveningClock = getEthiopianClock(nextEvening.localTime, tz, nextEvening.localDate);

  return {
    config,
    currentTimezone: tz,
    currentLocalTime: `${currentTime} EAT`,
    currentLocalDate: today,
    currentHabeshaTime: clockNow.ethiopianTimeStr,
    currentHabeshaDate: clockNow.ethiopianDateStr,
    morning: {
      enabled: config.enabled,
      configuredTime: config.morningTime,
      effectiveTime: nextMorning.localTime,
      habeshaTime: morningClock.ethiopianTimeStr,
      nextScheduledIso: new Date(nextMorning.scheduledUtc).toISOString(),
      nextScheduledHabesha: `${nextMorning.localDate} · ${morningClock.ethiopianTimeStr}`,
      isDeliveredToday: morningToday?.status === 'completed',
      isSkippedToday: morningToday?.status === 'skipped' || config.skipNextMorningDate === today,
      hasTimeOverride: Boolean(config.overrideMorningDate && config.overrideMorningTime),
      hasContentOverride: Boolean(config.temporaryMorningContent),
      lastDelivery: morningDeliveries[0] || null,
    },
    evening: {
      enabled: config.enabled,
      configuredTime: config.eveningTime,
      effectiveTime: nextEvening.localTime,
      habeshaTime: eveningClock.ethiopianTimeStr,
      nextScheduledIso: new Date(nextEvening.scheduledUtc).toISOString(),
      nextScheduledHabesha: `${nextEvening.localDate} · ${eveningClock.ethiopianTimeStr}`,
      isDeliveredToday: eveningToday?.status === 'completed',
      isSkippedToday: eveningToday?.status === 'skipped' || config.skipNextEveningDate === today,
      hasTimeOverride: Boolean(config.overrideEveningDate && config.overrideEveningTime),
      hasContentOverride: Boolean(config.temporaryEveningContent),
      lastDelivery: eveningDeliveries[0] || null,
    },
    recentDeliveries: deliveries,
  };
}
