import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './neon';
import type { BookAssignmentRecord, BookRecord } from '../books/types';
import { normalizeTimeString } from '../date/ethiopianTime';

export type PublishJobStatus = 'scheduled' | 'processing' | 'completed' | 'failed' | 'paused';
export interface BookPublishJob {
  id: string;
  userId: string;
  bookId: string;
  assignmentId: string;
  scheduledAt: number;
  timezone: string;
  status: PublishJobStatus;
  attemptCount: number;
  lastError: string;
  updatedAt: number;
}
interface AutomationSetting { userId: string; paused: boolean; updatedAt: number }

const DATA_DIR = process.env.BOOK_DATA_DIR?.trim() || path.join(process.cwd(), '.data');
const JOBS_PATH = path.join(DATA_DIR, 'book-publish-jobs.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'book-publish-settings.json');
let schemaReady: Promise<void> | null = null;

function readJson<T>(file: string, empty: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return empty; }
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
function readJobs() { return readJson<BookPublishJob[]>(JOBS_PATH, []); }
function readSettings() { return readJson<AutomationSetting[]>(SETTINGS_PATH, []); }

async function ensureSchema(sql: NonNullable<ReturnType<typeof getDb>>) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS book_publish_jobs (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        book_id VARCHAR(64) NOT NULL,
        assignment_id VARCHAR(64) NOT NULL,
        scheduled_at BIGINT NOT NULL,
        status VARCHAR(20) NOT NULL,
        data JSONB NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE(user_id, assignment_id)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_book_publish_jobs_due ON book_publish_jobs(status, scheduled_at)`;
      await sql`CREATE TABLE IF NOT EXISTS book_publish_settings (user_id VARCHAR(64) PRIMARY KEY, paused BOOLEAN NOT NULL DEFAULT FALSE, updated_at BIGINT NOT NULL)`;
    })().catch(error => { schemaReady = null; throw error; });
  }
  await schemaReady;
}

/** Convert a local wall-clock date/time to UTC using Intl, including DST validation. */
export function zonedDateTimeToTimestamp(date: string, time: string, timezone: string): number {
  const normTime = normalizeTimeString(time);
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(normTime);
  if (!dateMatch || !timeMatch) throw new Error('Schedule needs a valid YYYY-MM-DD date and HH:mm time.');
  const [year, month, day] = dateMatch.slice(1).map(Number);
  const [hour, minute] = timeMatch.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) throw new Error('Schedule date or time is out of range.');
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const calendarCheck = new Date(targetAsUtc);
  if (calendarCheck.getUTCFullYear() !== year || calendarCheck.getUTCMonth() + 1 !== month || calendarCheck.getUTCDate() !== day) throw new Error('Schedule date is not a valid calendar date.');
  let candidate = targetAsUtc;
  const effectiveTz = timezone || 'Africa/Addis_Ababa';
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: effectiveTz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 4; i++) {
    const values = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(part => [part.type, part.value]));
    const renderedAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
    const delta = targetAsUtc - renderedAsUtc;
    if (delta === 0) return candidate;
    candidate += delta;
  }
  throw new Error(`The requested local time does not exist in ${effectiveTz} (daylight-saving transition).`);
}

export function makeBookPublishJob(
  book: BookRecord,
  assignment: BookAssignmentRecord,
  scheduledDate = assignment.scheduledDate,
  postingTime = assignment.postingTime || book.postingTime
): BookPublishJob {
  const effectiveTime = normalizeTimeString(postingTime || book.postingTime || '08:00');
  const timezone = book.timezone || 'Africa/Addis_Ababa';
  return {
    id: assignment.id,
    userId: book.userId,
    bookId: book.id,
    assignmentId: assignment.id,
    scheduledAt: zonedDateTimeToTimestamp(scheduledDate, effectiveTime, timezone),
    timezone,
    status: 'scheduled',
    attemptCount: 0,
    lastError: '',
    updatedAt: Date.now(),
  };
}

export async function upsertBookPublishJob(book: BookRecord, assignment: BookAssignmentRecord) {
  if (assignment.status !== 'approved') throw new Error('Only approved assignments can be scheduled for publishing.');
  const job = makeBookPublishJob(book, assignment, assignment.scheduledDate, assignment.postingTime || book.postingTime);
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    await sql`INSERT INTO book_publish_jobs (id, user_id, book_id, assignment_id, scheduled_at, status, data, updated_at)
      VALUES (${job.id}, ${job.userId}, ${job.bookId}, ${job.assignmentId}, ${job.scheduledAt}, ${job.status}, ${JSON.stringify(job)}::jsonb, ${job.updatedAt})
      ON CONFLICT (user_id, assignment_id) DO UPDATE SET scheduled_at = EXCLUDED.scheduled_at,
      status = CASE WHEN book_publish_jobs.status IN ('completed','processing') THEN book_publish_jobs.status ELSE 'scheduled' END,
      data = CASE WHEN book_publish_jobs.status IN ('completed','processing') THEN book_publish_jobs.data ELSE EXCLUDED.data END,
      updated_at = EXCLUDED.updated_at`;
  }
  const all = readJobs();
  const index = all.findIndex(item => item.userId === job.userId && item.assignmentId === job.assignmentId);
  if (index < 0) all.push(job);
  else if (!['completed', 'processing'].includes(all[index].status)) all[index] = job;
  writeJson(JOBS_PATH, all);
  return job;
}

export async function rescheduleBookPublishJob(userId: string, book: BookRecord, assignment: BookAssignmentRecord, date: string, time: string) {
  const normalizedTime = normalizeTimeString(time);
  const job = makeBookPublishJob(book, assignment, date, normalizedTime);
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`
      INSERT INTO book_publish_jobs (id, user_id, book_id, assignment_id, scheduled_at, status, data, updated_at)
      VALUES (${job.id}, ${job.userId}, ${job.bookId}, ${job.assignmentId}, ${job.scheduledAt}, 'scheduled', ${JSON.stringify(job)}::jsonb, ${job.updatedAt})
      ON CONFLICT (user_id, assignment_id) DO UPDATE SET
        scheduled_at = EXCLUDED.scheduled_at,
        status = CASE WHEN book_publish_jobs.status = 'completed' THEN book_publish_jobs.status ELSE 'scheduled' END,
        data = CASE WHEN book_publish_jobs.status = 'completed' THEN book_publish_jobs.data ELSE EXCLUDED.data END,
        updated_at = EXCLUDED.updated_at
      RETURNING id, status
    `;
    if (rows[0]?.status === 'completed') throw new Error('Completed Telegram publishing cannot be rescheduled.');
  }
  const all = readJobs();
  const index = all.findIndex(item => item.userId === userId && item.assignmentId === assignment.id);
  if (index < 0) {
    all.push(job);
  } else if (all[index].status === 'completed') {
    throw new Error('Completed Telegram publishing cannot be rescheduled.');
  } else {
    all[index] = job;
  }
  writeJson(JOBS_PATH, all);
  return job;
}

export async function setPublishingPaused(userId: string, paused: boolean) {
  const setting = { userId, paused, updatedAt: Date.now() };
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    await sql`INSERT INTO book_publish_settings (user_id, paused, updated_at) VALUES (${userId}, ${paused}, ${setting.updatedAt})
      ON CONFLICT (user_id) DO UPDATE SET paused = EXCLUDED.paused, updated_at = EXCLUDED.updated_at`;
    await sql`UPDATE book_publish_jobs SET status = ${paused ? 'paused' : 'scheduled'},
      data = jsonb_set(data, '{status}', to_jsonb(${paused ? 'paused' : 'scheduled'}::text)), updated_at = ${setting.updatedAt}
      WHERE user_id = ${userId} AND status IN ('scheduled','paused')`;
  }
  const settings = readSettings();
  const settingIndex = settings.findIndex(item => item.userId === userId);
  if (settingIndex < 0) settings.push(setting); else settings[settingIndex] = setting;
  writeJson(SETTINGS_PATH, settings);
  const jobs = readJobs().map(job => job.userId === userId && ['scheduled', 'paused'].includes(job.status)
    ? { ...job, status: paused ? 'paused' as const : 'scheduled' as const, updatedAt: setting.updatedAt } : job);
  writeJson(JOBS_PATH, jobs);
  return setting;
}

export async function getPublishingPaused(userId: string) {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`SELECT paused FROM book_publish_settings WHERE user_id = ${userId} LIMIT 1`;
    return Boolean(rows[0]?.paused);
  }
  return Boolean(readSettings().find(item => item.userId === userId)?.paused);
}

export async function listBookPublishJobs(userId: string) {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`SELECT data FROM book_publish_jobs WHERE user_id = ${userId} ORDER BY scheduled_at DESC LIMIT 200`;
    return rows.map((row: any) => row.data as BookPublishJob);
  }
  return readJobs().filter(item => item.userId === userId).sort((a, b) => b.scheduledAt - a.scheduledAt).slice(0, 200);
}

export async function claimDueBookPublishJobs(now = Date.now(), limit = 20) {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const staleBefore = now - 10 * 60 * 1000;
    const interruptedMessage = 'Scheduler operation was interrupted. Check Telegram and delivery status before retrying.';
    await sql`UPDATE book_publish_jobs SET status = 'failed',
      data = jsonb_set(jsonb_set(data, '{status}', '"failed"'::jsonb), '{lastError}', to_jsonb(${interruptedMessage}::text)), updated_at = ${now}
      WHERE status = 'processing' AND updated_at < ${staleBefore}`;
    await sql`UPDATE telegram_deliveries SET status = 'uncertain',
      data = jsonb_set(jsonb_set(jsonb_set(data, '{status}', '"uncertain"'::jsonb), '{lastError}', to_jsonb(${interruptedMessage}::text)), '{safeToRetry}', 'false'::jsonb), updated_at = ${now}
      WHERE status = 'processing' AND updated_at < ${staleBefore}`;
    const candidates = await sql`SELECT j.data FROM book_publish_jobs j
      LEFT JOIN book_publish_settings s ON s.user_id = j.user_id
      WHERE j.status = 'scheduled' AND j.scheduled_at <= ${now} AND COALESCE(s.paused, FALSE) = FALSE
      ORDER BY j.scheduled_at ASC LIMIT ${limit}`;
    const claimed: BookPublishJob[] = [];
    for (const row of candidates) {
      const job = row.data as BookPublishJob;
      const next = { ...job, status: 'processing' as const, attemptCount: job.attemptCount + 1, updatedAt: now };
      const rows = await sql`UPDATE book_publish_jobs SET status = 'processing', data = ${JSON.stringify(next)}::jsonb, updated_at = ${now}
        WHERE id = ${job.id} AND status = 'scheduled' RETURNING id`;
      if (rows.length) claimed.push(next);
    }
    return claimed;
  }
  const settings = readSettings();
  const staleBefore = now - 10 * 60 * 1000;
  const interruptedMessage = 'Scheduler operation was interrupted. Check Telegram and delivery status before retrying.';
  const priorJobs = readJobs();
  const all = priorJobs.map(item => item.status === 'processing' && item.updatedAt < staleBefore
    ? { ...item, status: 'failed' as const, lastError: interruptedMessage, updatedAt: now }
    : item);
  if (all.some((item, index) => item !== priorJobs[index])) writeJson(JOBS_PATH, all);
  const deliveriesPath = path.join(DATA_DIR, 'telegram-deliveries.json');
  const localDeliveries = readJson<Array<{ status: string; updatedAt: number; lastError?: string; safeToRetry?: boolean }>>(deliveriesPath, []);
  const interruptedDeliveries = localDeliveries.map(item => item.status === 'processing' && item.updatedAt < staleBefore
    ? { ...item, status: 'uncertain', lastError: interruptedMessage, safeToRetry: false, updatedAt: now }
    : item);
  if (interruptedDeliveries.some((item, index) => item !== localDeliveries[index])) writeJson(deliveriesPath, interruptedDeliveries);
  const due = all.filter(item => item.status === 'scheduled' && item.scheduledAt <= now && !settings.find(setting => setting.userId === item.userId)?.paused)
    .sort((a, b) => a.scheduledAt - b.scheduledAt).slice(0, limit);
  const ids = new Set(due.map(item => item.id));
  const claimed = all.map(item => ids.has(item.id) ? { ...item, status: 'processing' as const, attemptCount: item.attemptCount + 1, updatedAt: now } : item);
  writeJson(JOBS_PATH, claimed);
  return claimed.filter(item => ids.has(item.id));
}

export async function updateBookPublishJob(job: BookPublishJob) {
  const updated = { ...job, updatedAt: Date.now() };
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    await sql`UPDATE book_publish_jobs SET status = ${updated.status}, scheduled_at = ${updated.scheduledAt}, data = ${JSON.stringify(updated)}::jsonb, updated_at = ${updated.updatedAt}
      WHERE id = ${updated.id} AND user_id = ${updated.userId}`;
  }
  const all = readJobs();
  const index = all.findIndex(item => item.id === updated.id && item.userId === updated.userId);
  if (index >= 0) { all[index] = updated; writeJson(JOBS_PATH, all); }
  return updated;
}

export async function deleteBookPublishJobs(userId: string, bookId: string) {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    await sql`DELETE FROM book_publish_jobs WHERE book_id = ${bookId} AND user_id = ${userId}`;
  }
  writeJson(JOBS_PATH, readJobs().filter(item => !(item.bookId === bookId && item.userId === userId)));
}
