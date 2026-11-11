import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from '../neon';
import type { ScheduledMessageRecord, ScheduledMessageType, ScheduledMessageStatus } from './types';

const DATA_DIR = process.env.BOOK_DATA_DIR?.trim() || path.join(process.cwd(), '.data');
const MESSAGES_PATH = path.join(DATA_DIR, 'scheduled-messages.json');
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

function readMessages(): ScheduledMessageRecord[] {
  return readJson<ScheduledMessageRecord[]>(MESSAGES_PATH, []);
}

async function ensureSchema(sql: NonNullable<ReturnType<typeof getDb>>) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS scheduled_messages (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        type VARCHAR(32) NOT NULL,
        title TEXT DEFAULT '',
        content TEXT NOT NULL,
        scheduled_at BIGINT NOT NULL,
        timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
        status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        last_attempt_at BIGINT,
        last_error TEXT DEFAULT '',
        telegram_message_ids JSONB DEFAULT '[]'::jsonb,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_scheduled_messages_due ON scheduled_messages(status, scheduled_at)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_scheduled_messages_user ON scheduled_messages(user_id, scheduled_at DESC)`;
    })().catch(error => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export interface CreateScheduledMessageInput {
  userId: string;
  type: ScheduledMessageType;
  title?: string;
  content: string;
  scheduledAt: number;
  timezone?: string;
  maxAttempts?: number;
  metadata?: Record<string, any>;
}

export async function createScheduledMessage(input: CreateScheduledMessageInput): Promise<ScheduledMessageRecord> {
  const now = Date.now();
  const record: ScheduledMessageRecord = {
    id: randomUUID(),
    userId: input.userId,
    type: input.type,
    title: input.title || '',
    content: input.content,
    scheduledAt: input.scheduledAt,
    timezone: input.timezone || 'UTC',
    status: 'scheduled',
    attemptCount: 0,
    maxAttempts: input.maxAttempts || 3,
    lastAttemptAt: null,
    lastError: '',
    telegramMessageIds: [],
    metadata: input.metadata || {},
    createdAt: now,
    updatedAt: now,
  };

  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    await sql`INSERT INTO scheduled_messages (
      id, user_id, type, title, content, scheduled_at, timezone,
      status, attempt_count, max_attempts, last_attempt_at, last_error,
      telegram_message_ids, metadata, created_at, updated_at
    ) VALUES (
      ${record.id}, ${record.userId}, ${record.type}, ${record.title},
      ${record.content}, ${record.scheduledAt}, ${record.timezone},
      ${record.status}, ${record.attemptCount}, ${record.maxAttempts},
      ${record.lastAttemptAt}, ${record.lastError},
      ${JSON.stringify(record.telegramMessageIds)}::jsonb,
      ${JSON.stringify(record.metadata)}::jsonb,
      ${record.createdAt}, ${record.updatedAt}
    )`;
  }

  const all = readMessages();
  all.push(record);
  writeJson(MESSAGES_PATH, all);

  return record;
}

export async function claimDueScheduledMessages(now = Date.now(), limit = 20): Promise<ScheduledMessageRecord[]> {
  const sql = getDb();
  const staleBefore = now - 10 * 60 * 1000; // 10 minutes timeout for stuck processing jobs

  if (sql) {
    await ensureSchema(sql);

    // 1. Recover stale processing jobs interrupted by server restart
    await sql`UPDATE scheduled_messages
      SET status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'scheduled' END,
          last_error = 'Processing was interrupted by a server restart or timeout; reset for recovery.',
          updated_at = ${now}
      WHERE status = 'processing' AND updated_at < ${staleBefore}`;

    // 2. Select eligible due messages
    const candidates = await sql`
      SELECT id, user_id, type, title, content, scheduled_at, timezone,
             status, attempt_count, max_attempts, last_attempt_at, last_error,
             telegram_message_ids, metadata, created_at, updated_at
      FROM scheduled_messages
      WHERE status = 'scheduled' AND scheduled_at <= ${now}
      ORDER BY scheduled_at ASC
      LIMIT ${limit}
    `;

    const claimed: ScheduledMessageRecord[] = [];
    for (const row of candidates) {
      // Atomic claim to prevent duplicate deliveries across instances
      const updateResult = await sql`
        UPDATE scheduled_messages
        SET status = 'processing',
            attempt_count = attempt_count + 1,
            last_attempt_at = ${now},
            updated_at = ${now}
        WHERE id = ${row.id} AND status = 'scheduled'
        RETURNING id
      `;

      if (updateResult.length > 0) {
        claimed.push({
          id: row.id,
          userId: row.user_id,
          type: row.type as ScheduledMessageType,
          title: row.title || '',
          content: row.content,
          scheduledAt: Number(row.scheduled_at),
          timezone: row.timezone || 'UTC',
          status: 'processing',
          attemptCount: Number(row.attempt_count) + 1,
          maxAttempts: Number(row.max_attempts || 3),
          lastAttemptAt: now,
          lastError: row.last_error || '',
          telegramMessageIds: Array.isArray(row.telegram_message_ids) ? row.telegram_message_ids : [],
          metadata: row.metadata || {},
          createdAt: Number(row.created_at),
          updatedAt: now,
        });
      }
    }

    return claimed;
  }

  // Local JSON fallback
  const all = readMessages();
  // 1. Recover stale jobs
  let modified = false;
  for (const item of all) {
    if (item.status === 'processing' && item.updatedAt < staleBefore) {
      item.status = item.attemptCount >= item.maxAttempts ? 'failed' : 'scheduled';
      item.lastError = 'Processing was interrupted by a server restart or timeout; reset for recovery.';
      item.updatedAt = now;
      modified = true;
    }
  }

  // 2. Claim due jobs
  const due = all
    .filter(item => item.status === 'scheduled' && item.scheduledAt <= now)
    .sort((a, b) => a.scheduledAt - b.scheduledAt)
    .slice(0, limit);

  const claimed: ScheduledMessageRecord[] = [];
  const dueIds = new Set(due.map(item => item.id));

  for (const item of all) {
    if (dueIds.has(item.id) && item.status === 'scheduled') {
      item.status = 'processing';
      item.attemptCount += 1;
      item.lastAttemptAt = now;
      item.updatedAt = now;
      claimed.push({ ...item });
      modified = true;
    }
  }

  if (modified) {
    writeJson(MESSAGES_PATH, all);
  }

  return claimed;
}

export async function updateScheduledMessage(message: ScheduledMessageRecord): Promise<ScheduledMessageRecord> {
  const updated = { ...message, updatedAt: message.updatedAt ?? Date.now() };
  const sql = getDb();

  if (sql) {
    await ensureSchema(sql);
    await sql`
      UPDATE scheduled_messages
      SET status = ${updated.status},
          attempt_count = ${updated.attemptCount},
          last_attempt_at = ${updated.lastAttemptAt},
          last_error = ${updated.lastError},
          telegram_message_ids = ${JSON.stringify(updated.telegramMessageIds || [])}::jsonb,
          metadata = ${JSON.stringify(updated.metadata || {})}::jsonb,
          scheduled_at = ${updated.scheduledAt},
          updated_at = ${updated.updatedAt}
      WHERE id = ${updated.id} AND user_id = ${updated.userId}
    `;
  }

  const all = readMessages();
  const index = all.findIndex(item => item.id === updated.id && item.userId === updated.userId);
  if (index >= 0) {
    all[index] = updated;
    writeJson(MESSAGES_PATH, all);
  }

  return updated;
}

export async function listScheduledMessages(userId: string, limit = 100): Promise<ScheduledMessageRecord[]> {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`
      SELECT id, user_id, type, title, content, scheduled_at, timezone,
             status, attempt_count, max_attempts, last_attempt_at, last_error,
             telegram_message_ids, metadata, created_at, updated_at
      FROM scheduled_messages
      WHERE user_id = ${userId}
      ORDER BY scheduled_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      type: row.type as ScheduledMessageType,
      title: row.title || '',
      content: row.content,
      scheduledAt: Number(row.scheduled_at),
      timezone: row.timezone || 'UTC',
      status: row.status as ScheduledMessageStatus,
      attemptCount: Number(row.attempt_count),
      maxAttempts: Number(row.max_attempts || 3),
      lastAttemptAt: row.last_attempt_at ? Number(row.last_attempt_at) : null,
      lastError: row.last_error || '',
      telegramMessageIds: Array.isArray(row.telegram_message_ids) ? row.telegram_message_ids : [],
      metadata: row.metadata || {},
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));
  }

  return readMessages()
    .filter(item => item.userId === userId)
    .sort((a, b) => b.scheduledAt - a.scheduledAt)
    .slice(0, limit);
}

export async function countFailedScheduledMessages() {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`SELECT COUNT(*) AS count FROM scheduled_messages WHERE status = 'failed'`;
    return Number(rows[0]?.count || 0);
  }
  return readMessages().filter(item => item.status === 'failed').length;
}

export async function deleteScheduledMessage(id: string, userId: string): Promise<boolean> {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`DELETE FROM scheduled_messages WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
    return rows.length > 0;
  }

  const all = readMessages();
  const filtered = all.filter(item => !(item.id === id && item.userId === userId));
  if (filtered.length !== all.length) {
    writeJson(MESSAGES_PATH, filtered);
    return true;
  }
  return false;
}
