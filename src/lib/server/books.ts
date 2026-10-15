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
      await sql`CREATE TABLE IF NOT EXISTS book_files (
        book_id VARCHAR(64) PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        data BYTEA NOT NULL,
        size BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS book_previews (
        book_id VARCHAR(64) NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        pdf_page INTEGER NOT NULL,
        filename TEXT NOT NULL,
        mime_type VARCHAR(32) NOT NULL DEFAULT 'image/jpeg',
        data BYTEA NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY(book_id, pdf_page)
      )`;
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
        // Migrate existing PDF files from local disk to permanent Neon DB storage
        const diskPdfPath = path.join(DATA_DIR, record.storedFilename);
        if (fs.existsSync(diskPdfPath)) {
          try {
            const diskBytes = fs.readFileSync(diskPdfPath);
            if (diskBytes.length > 0) {
              const b64 = diskBytes.toString('base64');
              await sql`INSERT INTO book_files (book_id, filename, data, size, updated_at)
                VALUES (${record.id}, ${record.storedFilename}, decode(${b64}, 'base64'), ${diskBytes.length}, ${record.updatedAt || Date.now()})
                ON CONFLICT (book_id) DO NOTHING`;
            }
          } catch {}
        }
      }
    })().catch(error => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

function getBookPagesPath(bookId: string): string {
  return path.join(DATA_DIR, bookId, 'pages.json');
}

function readDiskBookPages(bookId: string): BookPageRecord[] {
  try {
    const p = getBookPagesPath(bookId);
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch {}
  // Backwards compatibility for legacy records with inline extractedPages
  const record = readRecords().find(b => b.id === bookId) as any;
  if (record?.extractedPages && Array.isArray(record.extractedPages)) {
    return record.extractedPages;
  }
  return [];
}

function writeDiskBookPages(bookId: string, pages: BookPageRecord[]) {
  const p = getBookPagesPath(bookId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const temporaryPath = `${p}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(pages, null, 2), 'utf8');
  fs.renameSync(temporaryPath, p);
}

async function persistRecord(record: BookRecord) {
  // Strip extractedPages from the metadata record so books.json and books table don't get bloated
  const { extractedPages, ...cleanRecord } = record as any;
  const sql = getDb();
  if (sql) {
    await ensureBookSchema(sql);
    await sql`INSERT INTO books (id, user_id, data, created_at, updated_at)
      VALUES (${cleanRecord.id}, ${cleanRecord.userId}, ${JSON.stringify(cleanRecord)}::jsonb, ${cleanRecord.createdAt}, ${cleanRecord.updatedAt})
      ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`;
  }
  const records = readRecords();
  const index = records.findIndex(item => item.id === cleanRecord.id && item.userId === cleanRecord.userId);
  if (index < 0) records.push(cleanRecord);
  else {
    records[index] = cleanRecord;
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
    const sql = getDb();
    if (sql) {
      await ensureBookSchema(sql);
      const b64 = Buffer.from(pdfBytes).toString('base64');
      await sql`
        INSERT INTO book_files (book_id, filename, data, size, updated_at)
        VALUES (${record.id}, ${record.storedFilename}, decode(${b64}, 'base64'), ${pdfBytes.length}, ${Date.now()})
        ON CONFLICT (book_id) DO UPDATE SET
          filename = EXCLUDED.filename,
          data = EXCLUDED.data,
          size = EXCLUDED.size,
          updated_at = EXCLUDED.updated_at
      `;
    }
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

      for (const page of pages) {
        if (page.visualPreview?.filename) {
          const previewDiskPath = path.join(DATA_DIR, book.id, 'page-previews', page.visualPreview.filename);
          if (fs.existsSync(previewDiskPath)) {
            try {
              const previewBytes = fs.readFileSync(previewDiskPath);
              if (previewBytes.length > 0) {
                const b64 = previewBytes.toString('base64');
                await sql`
                  INSERT INTO book_previews (book_id, pdf_page, filename, mime_type, data, updated_at)
                  VALUES (${book.id}, ${page.pdfPage}, ${page.visualPreview.filename}, ${page.visualPreview.mimeType || 'image/jpeg'}, decode(${b64}, 'base64'), ${Date.now()})
                  ON CONFLICT (book_id, pdf_page) DO UPDATE SET
                    filename = EXCLUDED.filename,
                    mime_type = EXCLUDED.mime_type,
                    data = EXCLUDED.data,
                    updated_at = EXCLUDED.updated_at
                `;
              }
            } catch (err) {
              console.error(`[Books] Failed to store page preview ${page.pdfPage} in DB:`, err);
            }
          }
        }
      }
    }
  }

  // Disk persistence: store page records in dedicated pages.json
  const prior = readDiskBookPages(book.id);
  const pageMap = new Map(prior.map(page => [page.pdfPage, page]));
  for (const page of pages) pageMap.set(page.pdfPage, page);
  const merged = [...pageMap.values()].sort((a, b) => a.pdfPage - b.pdfPage);
  writeDiskBookPages(book.id, merged);
}

export interface BookPagesStats {
  totalExpected: number;
  totalExtracted: number;
  extractedPageNumbers: number[];
  missingPageNumbers: number[];
  needsReviewCount: number;
  unreviewedCount: number;
  ocrCount: number;
  emptyCount: number;
  isComplete: boolean;
}

export async function getBookPagesStats(
  userId: string,
  bookId: string,
  startPage: number,
  endPage: number
): Promise<BookPagesStats> {
  const sql = getDb();
  let pages: Array<{ pdfPage: number; method: string; requiresReview: boolean; reviewedByUser: boolean }>;
  if (sql) {
    await ensureBookSchema(sql);
    const rows = await sql`
      SELECT pdf_page, method, requires_review, reviewed_by_user
      FROM book_pages
      WHERE book_id = ${bookId} AND user_id = ${userId} AND pdf_page BETWEEN ${startPage} AND ${endPage}
      ORDER BY pdf_page
    `;
    pages = rows.map((r: any) => ({
      pdfPage: Number(r.pdf_page),
      method: String(r.method),
      requiresReview: Boolean(r.requires_review),
      reviewedByUser: Boolean(r.reviewed_by_user),
    }));
  } else {
    const book = readRecords().find(b => b.id === bookId && b.userId === userId);
    if (!book) {
      pages = [];
    } else {
      const diskPages = readDiskBookPages(bookId);
      pages = diskPages
        .filter(p => p.pdfPage >= startPage && p.pdfPage <= endPage)
        .map(p => ({
          pdfPage: p.pdfPage,
          method: p.method,
          requiresReview: Boolean(p.requiresReview),
          reviewedByUser: Boolean(p.reviewedByUser),
        }));
    }
  }

  const extractedSet = new Set(pages.map(p => p.pdfPage));
  const missingPageNumbers: number[] = [];
  for (let p = startPage; p <= endPage; p++) {
    if (!extractedSet.has(p)) missingPageNumbers.push(p);
  }

  const extractedPageNumbers = pages.map(p => p.pdfPage).sort((a, b) => a - b);
  const totalExpected = endPage - startPage + 1;
  const needsReviewCount = pages.filter(p => p.requiresReview).length;
  const unreviewedCount = pages.filter(p => p.requiresReview && !p.reviewedByUser).length;
  const ocrCount = pages.filter(p => p.method === 'ocr').length;
  const emptyCount = pages.filter(p => p.method === 'empty').length;

  return {
    totalExpected,
    totalExtracted: pages.length,
    extractedPageNumbers,
    missingPageNumbers,
    needsReviewCount,
    unreviewedCount,
    ocrCount,
    emptyCount,
    isComplete: missingPageNumbers.length === 0,
  };
}

export async function listBookPages(
  userId: string,
  bookId: string,
  fromPage?: number,
  toPage?: number,
  options?: { summaryOnly?: boolean }
): Promise<BookPageRecord[]> {
  const sql = getDb();
  if (sql) {
    await ensureBookSchema(sql);
    const rows = fromPage !== undefined && toPage !== undefined
      ? (options?.summaryOnly
          ? await sql`SELECT book_id, pdf_page, '' AS text, method, confidence, warnings, requires_review, reviewed_by_user, visual_preview, updated_at FROM book_pages WHERE book_id = ${bookId} AND user_id = ${userId} AND pdf_page BETWEEN ${fromPage} AND ${toPage} ORDER BY pdf_page`
          : await sql`SELECT book_id, pdf_page, text, method, confidence, warnings, requires_review, reviewed_by_user, visual_preview, updated_at FROM book_pages WHERE book_id = ${bookId} AND user_id = ${userId} AND pdf_page BETWEEN ${fromPage} AND ${toPage} ORDER BY pdf_page`)
      : (options?.summaryOnly
          ? await sql`SELECT book_id, pdf_page, '' AS text, method, confidence, warnings, requires_review, reviewed_by_user, visual_preview, updated_at FROM book_pages WHERE book_id = ${bookId} AND user_id = ${userId} ORDER BY pdf_page`
          : await sql`SELECT book_id, pdf_page, text, method, confidence, warnings, requires_review, reviewed_by_user, visual_preview, updated_at FROM book_pages WHERE book_id = ${bookId} AND user_id = ${userId} ORDER BY pdf_page`);
    return rows.map((row: any) => ({
      bookId: row.book_id, pdfPage: Number(row.pdf_page), text: row.text, method: row.method,
      confidence: row.confidence === null ? null : Number(row.confidence),
      warnings: Array.isArray(row.warnings) ? row.warnings : [], requiresReview: Boolean(row.requires_review), reviewedByUser: Boolean(row.reviewed_by_user), visualPreview: row.visual_preview || undefined, updatedAt: Number(row.updated_at),
    }));
  }
  const record = readRecords().find(book => book.id === bookId && book.userId === userId);
  if (!record) return [];
  const diskPages = readDiskBookPages(bookId);
  const filtered = diskPages.filter(page => fromPage === undefined || toPage === undefined || (page.pdfPage >= fromPage && page.pdfPage <= toPage));
  if (options?.summaryOnly) {
    return filtered.map(p => ({ ...p, text: '' }));
  }
  return filtered;
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
  const diskPages = readDiskBookPages(bookId);
  const updatedDiskPages = diskPages.map(item => item.pdfPage === pdfPage ? reviewed : item);
  writeDiskBookPages(bookId, updatedDiskPages);
  return reviewed;
}

export async function updateBookPageText(userId: string, bookId: string, pdfPage: number, text: string): Promise<BookPageRecord> {
  const pages = await listBookPages(userId, bookId, pdfPage, pdfPage);
  const page = pages[0];
  if (!page) throw new Error(`Extracted page ${pdfPage} not found.`);
  const cleanText = typeof text === 'string' ? text : '';
  const isNowNotEmpty = cleanText.trim().length > 0;
  const updatedPage: BookPageRecord = {
    ...page,
    text: cleanText,
    method: isNowNotEmpty && page.method === 'empty' ? 'ocr' : page.method,
    requiresReview: false,
    reviewedByUser: true,
    warnings: isNowNotEmpty ? page.warnings.filter(w => !/empty|unreadable/i.test(w)) : page.warnings,
    updatedAt: Date.now(),
  };

  const sql = getDb();
  if (sql) {
    await ensureBookSchema(sql);
    await sql`UPDATE book_pages SET
      text = ${updatedPage.text},
      method = ${updatedPage.method},
      requires_review = FALSE,
      reviewed_by_user = TRUE,
      warnings = ${JSON.stringify(updatedPage.warnings)}::jsonb,
      updated_at = ${updatedPage.updatedAt}
      WHERE book_id = ${bookId} AND user_id = ${userId} AND pdf_page = ${pdfPage}`;
  }

  const diskPages = readDiskBookPages(bookId);
  const updatedDiskPages = diskPages.map(item => item.pdfPage === pdfPage ? updatedPage : item);
  writeDiskBookPages(bookId, updatedDiskPages);
  return updatedPage;
}

export async function getBookPdfPath(userId: string, id: string): Promise<string | null> {
  const record = await getBook(userId, id);
  if (!record) return null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const diskPath = path.join(DATA_DIR, record.storedFilename);

  if (fs.existsSync(diskPath)) {
    try {
      const stats = fs.statSync(diskPath);
      if (stats.size > 0) return diskPath;
    } catch {}
  }

  // Restore PDF from Neon Postgres if missing on local ephemeral container
  const sql = getDb();
  if (sql) {
    await ensureBookSchema(sql);
    try {
      const rows = await sql`
        SELECT encode(data, 'base64') AS data_base64
        FROM book_files
        WHERE book_id = ${id}
        LIMIT 1
      `;
      if (rows.length && rows[0].data_base64) {
        const buf = Buffer.from(rows[0].data_base64, 'base64');
        fs.writeFileSync(diskPath, buf);
        return diskPath;
      }
    } catch (err) {
      console.error(`[Books] Error restoring PDF from database for book ${id}:`, err);
    }
  }

  return fs.existsSync(diskPath) ? diskPath : null;
}

export async function getBookPagePreviewPath(userId: string, id: string, pdfPage: number): Promise<string | null> {
  const page = (await listBookPages(userId, id, pdfPage, pdfPage))[0];
  const book = page ? await getBook(userId, id) : null;
  if (!book || !page?.visualPreview) return null;

  const previewDir = path.join(DATA_DIR, id, 'page-previews');
  const previewDiskPath = path.join(previewDir, page.visualPreview.filename);

  if (fs.existsSync(previewDiskPath)) {
    try {
      const stats = fs.statSync(previewDiskPath);
      if (stats.size > 0) return previewDiskPath;
    } catch {}
  }

  // Restore preview image from Neon Postgres if missing on local disk
  const sql = getDb();
  if (sql) {
    await ensureBookSchema(sql);
    try {
      const rows = await sql`
        SELECT encode(data, 'base64') AS data_base64
        FROM book_previews
        WHERE book_id = ${id} AND pdf_page = ${pdfPage}
        LIMIT 1
      `;
      if (rows.length && rows[0].data_base64) {
        fs.mkdirSync(previewDir, { recursive: true });
        const buf = Buffer.from(rows[0].data_base64, 'base64');
        fs.writeFileSync(previewDiskPath, buf);
        return previewDiskPath;
      }
    } catch (err) {
      console.error(`[Books] Error restoring page preview ${pdfPage} from database for book ${id}:`, err);
    }
  }

  return fs.existsSync(previewDiskPath) ? previewDiskPath : null;
}

export async function ensurePagePreview(userId: string, id: string, pdfPage: number): Promise<string | null> {
  const existingPath = await getBookPagePreviewPath(userId, id, pdfPage);
  if (existingPath && fs.existsSync(existingPath)) {
    try {
      const stats = fs.statSync(existingPath);
      if (stats.size > 0) return existingPath;
    } catch {}
  }

  const previewDir = path.join(DATA_DIR, id, 'page-previews');
  const filename = `page-${pdfPage}.jpg`;
  const previewDiskPath = path.join(previewDir, filename);
  if (fs.existsSync(previewDiskPath)) {
    try {
      const stats = fs.statSync(previewDiskPath);
      if (stats.size > 0) return previewDiskPath;
    } catch {}
  }

  const pdfPath = await getBookPdfPath(userId, id);
  if (!pdfPath || !fs.existsSync(pdfPath)) return null;

  let renderDocTask: any = null;
  try {
    const bytes = fs.readFileSync(pdfPath);
    const canvasModule = await import('@napi-rs/canvas');
    const { getDocument } = await import('./books/pdf.js-extract/lib/pdfjs/pdf.mjs');
    renderDocTask = getDocument({ data: new Uint8Array(bytes), verbosity: -1 });
    const doc = await renderDocTask.promise;
    if (pdfPage < 1 || pdfPage > doc.numPages) return null;

    const pageProxy = await doc.getPage(pdfPage);
    const baseViewport = pageProxy.getViewport({ scale: 1 });
    const scale = Math.min(1.5, 1400 / Math.max(baseViewport.width, baseViewport.height));
    const viewport = pageProxy.getViewport({ scale });
    const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await pageProxy.render({ canvas, viewport, background: '#ffffff' }).promise;
    pageProxy.cleanup?.();

    fs.mkdirSync(previewDir, { recursive: true });
    const jpegBuffer = canvas.toBuffer('image/jpeg', 80);
    fs.writeFileSync(previewDiskPath, jpegBuffer);

    const sql = getDb();
    if (sql) {
      await ensureBookSchema(sql);
      const b64 = jpegBuffer.toString('base64');
      await sql`
        INSERT INTO book_previews (book_id, pdf_page, filename, mime_type, data, updated_at)
        VALUES (${id}, ${pdfPage}, ${filename}, 'image/jpeg', decode(${b64}, 'base64'), ${Date.now()})
        ON CONFLICT (book_id, pdf_page) DO UPDATE SET
          filename = EXCLUDED.filename,
          mime_type = EXCLUDED.mime_type,
          data = EXCLUDED.data,
          updated_at = EXCLUDED.updated_at
      `.catch(err => console.error('[Books] Error saving on-demand preview to DB:', err));
    }

    return previewDiskPath;
  } catch (err) {
    console.error(`[Books] Failed to render on-demand preview for page ${pdfPage}:`, err);
    return null;
  } finally {
    if (renderDocTask) await renderDocTask.destroy().catch(() => null);
  }
}

export async function deleteBook(userId: string, id: string) {
  const book = await getBook(userId, id);
  if (!book) return false;
  const sql = getDb();
  if (sql) {
    await ensureBookSchema(sql);
    await sql`DELETE FROM books WHERE id = ${id} AND user_id = ${userId}`;
    await sql`DELETE FROM book_files WHERE book_id = ${id}`;
    await sql`DELETE FROM book_previews WHERE book_id = ${id}`;
  }
  const records = readRecords().filter(item => !(item.id === id && item.userId === userId));
  writeRecords(records);
  fs.rmSync(path.join(DATA_DIR, book.storedFilename), { force: true });
  fs.rmSync(path.join(DATA_DIR, id), { recursive: true, force: true });
  return true;
}
