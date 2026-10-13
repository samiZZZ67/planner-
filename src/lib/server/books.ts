import fs from 'node:fs';
import path from 'node:path';
import type { BookRecord } from '@/lib/books/types';

const DATA_DIR = path.join(process.cwd(), '.data', 'books');
const INDEX_PATH = path.join(process.cwd(), '.data', 'books.json');

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
  fs.writeFileSync(INDEX_PATH, JSON.stringify(records, null, 2), 'utf8');
}

export function listBooks(userId: string) {
  return readRecords().filter(book => book.userId === userId).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getBook(userId: string, id: string) {
  return readRecords().find(book => book.userId === userId && book.id === id) || null;
}

export function saveBook(record: BookRecord, pdfBytes: Uint8Array) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const diskPath = path.join(DATA_DIR, record.storedFilename);
  fs.writeFileSync(diskPath, pdfBytes, { flag: 'wx' });
  const records = readRecords();
  records.push(record);
  try {
    writeRecords(records);
  } catch (error) {
    fs.rmSync(diskPath, { force: true });
    throw error;
  }
  return record;
}

export function getBookPdfPath(userId: string, id: string) {
  const record = getBook(userId, id);
  return record ? path.join(DATA_DIR, record.storedFilename) : null;
}
