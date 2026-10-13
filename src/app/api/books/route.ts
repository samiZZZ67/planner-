import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { listBooks, saveBook } from '@/lib/server/books';
import type { BookRecord } from '@/lib/books/types';

const MAX_PDF_BYTES = 100 * 1024 * 1024;

export async function GET(request: Request) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to access your book planner.' }, { status: 401 });
  return NextResponse.json({ books: await listBooks(session.userId) });
}

export async function POST(request: Request) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to upload a book.' }, { status: 401 });

  try {
    const form = await request.formData();
    const file = form.get('pdf');
    const title = String(form.get('title') || '').trim();
    const author = String(form.get('author') || '').trim();
    const startPage = Number(form.get('startPage'));
    const endPage = Number(form.get('endPage'));
    const durationDays = Number(form.get('durationDays'));
    const currentPage = Number(form.get('currentPage'));
    const startDate = String(form.get('startDate') || new Date().toISOString().slice(0, 10));
    const studyMinutes = Number(form.get('studyMinutes') || 60);
    const postingTime = String(form.get('postingTime') || '08:00');
    const timezone = String(form.get('timezone') || 'Africa/Nairobi');
    const metadata = String(form.get('metadata') || '').trim().slice(0, 2000);

    if (!(file instanceof File) || file.size < 5 || file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: 'Choose a PDF smaller than 100 MB.' }, { status: 400 });
    }
    if (!title || !author || !Number.isInteger(startPage) || !Number.isInteger(endPage) || startPage < 1 || endPage < startPage || !Number.isInteger(currentPage) || currentPage < startPage || currentPage > endPage || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365 || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(`${startDate}T12:00:00Z`)) || !Number.isInteger(studyMinutes) || studyMinutes < 5 || studyMinutes > 1440) {
      return NextResponse.json({ error: 'Enter a title, author, valid page range, and duration between 1 and 365 days.' }, { status: 400 });
    }
    if (!/^\d{2}:\d{2}$/.test(postingTime) || !Number.isFinite(Date.parse(`1970-01-01T${postingTime}:00Z`))) {
      return NextResponse.json({ error: 'Enter a valid posting time.' }, { status: 400 });
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      return NextResponse.json({ error: 'Enter a valid IANA timezone.' }, { status: 400 });
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      return NextResponse.json({ error: 'The uploaded file could not be read.' }, { status: 400 });
    }
    if (Buffer.from(bytes.slice(0, 5)).toString('ascii') !== '%PDF-') {
      return NextResponse.json({ error: 'The selected file is not a valid PDF.' }, { status: 400 });
    }

    const id = randomUUID();
    const now = Date.now();
    const record: BookRecord = {
      id, userId: session.userId, title, author, metadata,
      originalFilename: file.name.slice(0, 255), storedFilename: `${id}.pdf`, fileSize: file.size,
      startPage, endPage, durationDays, startDate, studyMinutes, postingTime, timezone, currentPage,
      status: 'draft', extractionStatus: 'pending',
      extractionMessage: 'PDF saved privately. Automatic extraction, daily summaries, examples, questions, and Telegram scheduling are queued.',
      autoPublish: true,
      automationStatus: 'queued',
      createdAt: now, updatedAt: now,
    };
    await saveBook(record, bytes);
    return NextResponse.json({ book: record }, { status: 201 });
  } catch (error) {
    console.error('[Books API] Could not save PDF or book record:', error);
    return NextResponse.json({ error: 'The PDF could not be stored on this server.' }, { status: 500 });
  }
}
