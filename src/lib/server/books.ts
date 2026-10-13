import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './neon';
import type { BookPageRecord, BookRecord } from '../books/types';

const BOOK_DATA_DIR = process.env.BOOK_DATA_DIR?.trim() || path.join(process.cwd(), '.data');
const DATA_DIR = path.join(BOOK_DATA_DIR, 'books');
const INDEX_PATH = path.join(BOOK_DATA_DIR, 'books.json');
let schemaReady: Promise<void> | null = null;

function readRecords(): BookRecord[] {
  try {
    const records = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function writeRecords(records: BookRecord[]) {
  fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
  const temporaryPath = `${INDEX_PATH}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(records, null, 2), 'utf8');
  fs.renameSync(temporaryPath, INDEX_PATH);
}

async function ensureBookSchema(sql: NonNullable<ReturnType<typeof getDb>>) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS books (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        data JSONB NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_books_user_updated ON books(user_id, updated_at DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS book_pages (
        book_id VARCHAR(64) NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        user_id VARCHAR(64) NOT NULL,
        pdf_page INTEGER NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        method VARCHAR(16) NOT NULL,
        confidence NUMERIC(5,2),
        warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
        requires_review BOOLEAN NOT NULL DEFAULT FALSE,
        reviewed_by_user BOOLEAN NOT NULL DEFAULT FALSE,
        visual_preview JSONB,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY(book_id, pdf_page)
      )`;
      await sql`ALTER TABLE book_pages ADD COLUMN IF NOT EXISTS reviewed_by_user BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`ALTER TABLE book_pages ADD COLUMN IF NOT EXISTS visual_preview JSONB`;
      await sql`CREATE INDEX IF NOT EXISTS idx_book_pages_owner ON book_pages(user_id, book_id, pdf_page)`;
      // Preserve book metadata and extracted pages from the pre-Neon JSON fallback.
      for (const record of readRecords()) {
        await sql`INSERT INTO books (id, user_id, data, created_at, updated_at)
          VALUES (${record.id}, ${record.userId}, ${JSON.stringify(record)}::jsonb, ${record.createdAt}, ${record.updatedAt})
          ON CONFLICT (id) DO NOTHING`;
        const localPages = (record as BookRecord & { extractedPages?: BookPageRecord[] }).extractedPages || [];
        if (localPages.length) {
          const serialized = JSON.stringify(localPages.map(page => ({ pdfPage: page.pdfPage, text: page.text, method: page.method, confidence: page.confidence, warnings: page.warnings, requiresReview: page.requiresReview, reviewedByUser: page.reviewedByUser || false, visualPreview: page.visualPreview || null, updatedAt: page.updatedAt })));
          await sql`INSERT INTO book_pages (book_id, user_id, pdf_page, text, method, confidence, warnings, requires_review, reviewed_by_user, visual_preview, updated_at)
            SELECT ${record.id}, ${record.userId}, (item->>'pdfPage')::integer, item->>'text', item->>'method',
              NULLIF(item->>'confidence', 'null')::numeric, COALESCE(item->'warnings', '[]'::jsonb),
              COALESCE((item->>'requiresReview')::boolean, false), COALESCE((item->>'reviewedByUser')::boolean, false), NULLIF(item->'visualPreview', 'null'::jsonb), (item->>'updatedAt')::bigint
            FROM jsonb_array_elements(${serialized}::jsonb) AS item
            ON CONFLICT (book_id, pdf_page) DO NOTHING`;
        }
      }
    })().catch(error => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

async function persistRecord(record: BookRecord) {
  const sql = getDb();
  if (sql) {
    await ensureBookSchema(sql);
    await sql`INSERT INTO books (id, user_id, data, created_at, updated_at)
      VALUES (${record.id}, ${record.userId}, ${JSON.stringify(record)}::jsonb, ${record.createdAt}, ${record.updatedAt})
      ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`;
  }
  const records = readRecords();
  const index = records.findIndex(item => item.id === record.id && item.userId === record.userId);
  if (index < 0) records.push(record);
  else {
    const prior = records[index] as BookRecord & { extractedPages?: BookPageRecord[] };
    records[index] = {
      ...record,
      ...((record as BookRecord & { extractedPages?: BookPageRecord[] }).extractedPages || prior.extractedPages
        ? { extractedPages: (record as BookRecord & { extractedPages?: BookPageRecord[] }).extractedPages || prior.extractedPages }
        : {}),
    };
  }
  writeRecords(records);
}

export async function listBooks(userId: string): Promise<BookRecord[]> {
  const sql = getDb();
  if (sql) {
    await ensureBookSchema(sql);
    const rows = await sql`SELECT data FROM books WHERE user_id = ${userId} ORDER BY updated_at DESC`;
    return rows.map((row: any) => row.data as BookRecord);
  }
  return readRecords().filter(book => book.userId === userId).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listAllBooks(): Promise<BookRecord[]> {
  const sql = getDb();
  if (sql) {
    await ensureBookSchema(sql);
    const rows = await sql`SELECT data FROM books ORDER BY updated_at ASC`;
    return rows.map((row: any) => row.data as BookRecord);
  }
  return readRecords().sort((a, b) => a.updatedAt - b.updatedAt);
}

export async function getBook(userId: string, id: string): Promise<BookRecord | null> {
  const sql = getDb();
  if (sql) {
    await ensureBookSchema(sql);
    const rows = await sql`SELECT data FROM books WHERE id = ${id} AND user_id = ${userId} LIMIT 1`;
    return rows[0]?.data as BookRecord || null;
  }
  return readRecords().find(book => book.userId === userId && book.id === id) || null;
}

export async function saveBook(record: BookRecord, pdfBytes: Uint8Array) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const diskPath = path.join(DATA_DIR, record.storedFilename);
  fs.writeFileSync(diskPath, pdfBytes, { flag: 'wx' });
  try {
    await persistRecord(record);
  } catch (error) {
    fs.rmSync(diskPath, { force: true });
    throw error;
  }
  return record;
}

export async function updateBook(record: BookRecord) {
  const updated = { ...record, updatedAt: Date.now() };
  await persistRecord(updated);
  return updated;
}

export async function saveBookPages(book: BookRecord, pages: BookPageRecord[]) {
  const sql = getDb();
  if (sql) {
    await ensureBookSchema(sql);
    if (pages.length) {
      const serialized = JSON.stringify(pages.map(page => ({ ...page, bookId: undefined, reviewedByUser: page.reviewedByUser || false })));
      await sql`INSERT INTO book_pages (book_id, user_id, pdf_page, text, method, confidence, warnings, requires_review, reviewed_by_user, visual_preview, updated_at)
        SELECT ${book.id}, ${book.userId}, (item->>'pdfPage')::integer, item->>'text', item->>'method',
          NULLIF(item->>'confidence', 'null')::numeric, COALESCE(item->'warnings', '[]'::jsonb),
          COALESCE((item->>'requiresReview')::boolean, false), COALESCE((item->>'reviewedByUser')::boolean, false), NULLIF(item->'visualPreview', 'null'::jsonb), (item->>'updatedAt')::bigint
        FROM jsonb_array_elements(${serialized}::jsonb) AS item
        ON CONFLICT (book_id, pdf_page) DO UPDATE SET text = EXCLUDED.text, method = EXCLUDED.method,
          confidence = EXCLUDED.confidence, warnings = EXCLUDED.warnings, requires_review = EXCLUDED.requires_review, reviewed_by_user = FALSE, visual_preview = EXCLUDED.visual_preview, updated_at = EXCLUDED.updated_at`;
    }
  }
  const records = readRecords();
  const index = records.findIndex(item => item.id === book.id && item.userId === book.userId);
  if (index < 0) throw new Error('Book record disappeared while saving extracted pages.');
  const prior = (records[index] as BookRecord & { extractedPages?: BookPageRecord[] }).extractedPages || [];
  const pageMap = new Map(prior.map(page => [page.pdfPage, page]));
  for (const page of pages) pageMap.set(page.pdfPage, page);
  (records[index] as BookRecord & { extractedPages?: BookPageRecord[] }).extractedPages = [...pageMap.values()].sort((a, b) => a.pdfPage - b.pdfPage);
  writeRecords(records);
}

export async function listBookPages(userId: string, bookId: string, fromPage?: number, toPage?: number): Promise<BookPageRecord[]> {
  const sql = getDb();
  if (sql) {
    await ensureBookSchema(sql);
    const rows = fromPage !== undefined && toPage !== undefined
      ? await sql`SELECT book_id, pdf_page, text, method, confidence, warnings, requires_review, reviewed_by_user, visual_preview, updated_at FROM book_pages WHERE book_id = ${bookId} AND user_id = ${userId} AND pdf_page BETWEEN ${fromPage} AND ${toPage} ORDER BY pdf_page`
      : await sql`SELECT book_id, pdf_page, text, method, confidence, warnings, requires_review, reviewed_by_user, visual_preview, updated_at FROM book_pages WHERE book_id = ${bookId} AND user_id = ${userId} ORDER BY pdf_page`;
    return rows.map((row: any) => ({
      bookId: row.book_id, pdfPage: Number(row.pdf_page), text: row.text, method: row.method,
      confidence: row.confidence === null ? null : Number(row.confidence),
      warnings: Array.isArray(row.warnings) ? row.warnings : [], requiresReview: Boolean(row.requires_review), reviewedByUser: Boolean(row.reviewed_by_user), visualPreview: row.visual_preview || undefined, updatedAt: Number(row.updated_at),
    }));
  }
  const record = readRecords().find(book => book.id === bookId && book.userId === userId) as (BookRecord & { extractedPages?: BookPageRecord[] }) | undefined;
  return (record?.extractedPages || []).filter(page => fromPage === undefined || toPage === undefined || (page.pdfPage >= fromPage && page.pdfPage <= toPage));
}

export async function markBookPageReviewed(userId: string, bookId: string, pdfPage: number) {
  const pages = await listBookPages(userId, bookId, pdfPage, pdfPage);
  const page = pages[0];
  if (!page) throw new Error('Extracted page not found.');
  if (page.method === 'empty' || !page.text.trim()) throw new Error('This page has no readable extracted text; it cannot be approved.');
  const reviewed = { ...page, reviewedByUser: true, updatedAt: Date.now() };
  const sql = getDb();
  if (sql) {
    await ensureBookSchema(sql);
    await sql`UPDATE book_pages SET reviewed_by_user = TRUE, updated_at = ${reviewed.updatedAt} WHERE book_id = ${bookId} AND user_id = ${userId} AND pdf_page = ${pdfPage}`;
  }
  const records = readRecords();
  const index = records.findIndex(book => book.id === bookId && book.userId === userId);
  if (index >= 0) {
    const record = records[index] as BookRecord & { extractedPages?: BookPageRecord[] };
    if (record.extractedPages) {
      record.extractedPages = record.extractedPages.map(item => item.pdfPage === pdfPage ? reviewed : item);
      records[index] = record;
      writeRecords(records);
    }
  }
  return reviewed;
}

export async function getBookPdfPath(userId: string, id: string) {
  const record = await getBook(userId, id);
  return record ? path.join(DATA_DIR, record.storedFilename) : null;
}

export async function getBookPagePreviewPath(userId: string, id: string, pdfPage: number) {
  const page = (await listBookPages(userId, id, pdfPage, pdfPage))[0];
  const book = page ? await getBook(userId, id) : null;
  if (!book || !page?.visualPreview) return null;
  return path.join(DATA_DIR, id, 'page-previews', page.visualPreview.filename);
}

export async function deleteBook(userId: string, id: string) {
  const book = await getBook(userId, id);
  if (!book) return false;
  const sql = getDb();
  if (sql) {
    await ensureBookSchema(sql);
    await sql`DELETE FROM books WHERE id = ${id} AND user_id = ${userId}`;
  }
  const records = readRecords().filter(item => !(item.id === id && item.userId === userId));
  writeRecords(records);
  fs.rmSync(path.join(DATA_DIR, book.storedFilename), { force: true });
  fs.rmSync(path.join(DATA_DIR, id), { recursive: true, force: true });
  return true;
}
