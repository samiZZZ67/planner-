import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './neon';
import type { BookAssignmentRecord } from '../books/types';

const ASSIGNMENTS_PATH = path.join(process.env.BOOK_DATA_DIR?.trim() || path.join(process.cwd(), '.data'), 'book-assignments.json');
let schemaReady: Promise<void> | null = null;

function readAll(): BookAssignmentRecord[] {
  try {
    const value = JSON.parse(fs.readFileSync(ASSIGNMENTS_PATH, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeAll(assignments: BookAssignmentRecord[]) {
  fs.mkdirSync(path.dirname(ASSIGNMENTS_PATH), { recursive: true });
  const temporary = `${ASSIGNMENTS_PATH}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(assignments, null, 2), 'utf8');
  fs.renameSync(temporary, ASSIGNMENTS_PATH);
}

async function ensureSchema(sql: NonNullable<ReturnType<typeof getDb>>) {
  if (!schemaReady) {
    schemaReady = sql`CREATE TABLE IF NOT EXISTS book_assignments (
      id VARCHAR(64) PRIMARY KEY,
      book_id VARCHAR(64) NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      user_id VARCHAR(64) NOT NULL,
      scheduled_date DATE NOT NULL,
      start_pdf_page INTEGER NOT NULL,
      end_pdf_page INTEGER NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      data JSONB NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`.then(async () => {
      await sql`CREATE INDEX IF NOT EXISTS idx_book_assignments_owner_date ON book_assignments(user_id, book_id, scheduled_date)`;
    }).catch(error => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export async function listBookAssignments(userId: string, bookId: string) {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`SELECT data FROM book_assignments WHERE book_id = ${bookId} AND user_id = ${userId} AND status <> 'superseded' ORDER BY scheduled_date, start_pdf_page`;
    return rows.map((row: any) => row.data as BookAssignmentRecord);
  }
  return readAll().filter(item => item.bookId === bookId && item.userId === userId && item.status !== 'superseded')
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.startPdfPage - b.startPdfPage);
}

export async function replaceDraftAssignments(userId: string, bookId: string, assignments: BookAssignmentRecord[]) {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    await sql`UPDATE book_assignments SET status = 'superseded', updated_at = ${Date.now()}
      WHERE book_id = ${bookId} AND user_id = ${userId} AND status = 'draft'`;
    for (const assignment of assignments) {
      await sql`INSERT INTO book_assignments (id, book_id, user_id, scheduled_date, start_pdf_page, end_pdf_page, status, data, created_at, updated_at)
        VALUES (${assignment.id}, ${bookId}, ${userId}, ${assignment.scheduledDate}, ${assignment.startPdfPage}, ${assignment.endPdfPage}, ${assignment.status}, ${JSON.stringify(assignment)}::jsonb, ${assignment.updatedAt}, ${assignment.updatedAt})`;
    }
  }
  const old = readAll().map(item => item.bookId === bookId && item.userId === userId && item.status === 'draft'
    ? { ...item, status: 'superseded' as const, updatedAt: Date.now() }
    : item);
  writeAll([...old.filter(item => !(item.bookId === bookId && item.userId === userId && assignments.some(next => next.id === item.id))), ...assignments]);
  return assignments;
}

export async function updateBookAssignment(assignment: BookAssignmentRecord) {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    const rows = await sql`UPDATE book_assignments SET status = ${assignment.status}, data = ${JSON.stringify(assignment)}::jsonb,
      updated_at = ${assignment.updatedAt} WHERE id = ${assignment.id} AND book_id = ${assignment.bookId} AND user_id = ${assignment.userId} RETURNING id`;
    if (!rows.length) throw new Error('Reading assignment not found.');
  }
  const assignments = readAll();
  const index = assignments.findIndex(item => item.id === assignment.id && item.bookId === assignment.bookId && item.userId === assignment.userId);
  if (index >= 0) {
    assignments[index] = assignment;
    writeAll(assignments);
  } else if (!sql) {
    throw new Error('Reading assignment not found.');
  }
  return assignment;
}

export async function deleteBookAssignments(userId: string, bookId: string) {
  const sql = getDb();
  if (sql) {
    await ensureSchema(sql);
    await sql`DELETE FROM book_assignments WHERE book_id = ${bookId} AND user_id = ${userId}`;
  }
  writeAll(readAll().filter(item => !(item.bookId === bookId && item.userId === userId)));
}
