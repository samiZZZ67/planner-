import { listBookAssignments, updateBookAssignment, replaceDraftAssignments } from './bookAssignments';
import { getBookPdfPath, listAllBooks, listBookPages, saveBookPages, updateBook } from './books';
import { extractPdfRange } from './books/pdfExtraction';
import { generateConceptReadingPlan } from './readingPlan';
import { generateAssignmentStudyNotes } from './studyNotes';
import { makeBookPublishJob, upsertBookPublishJob } from './bookScheduler';
import type { BookAssignmentRecord, BookRecord } from '../books/types';

function localDate(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date: string, amount: number) {
  const shifted = new Date(`${date}T12:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + amount);
  return shifted.toISOString().slice(0, 10);
}

async function extractBook(book: BookRecord) {
  const filePath = await getBookPdfPath(book.userId, book.id);
  if (!filePath) throw new Error('The saved PDF is unavailable on the Render persistent disk.');
  let pendingPages: Awaited<ReturnType<typeof extractPdfRange>>['pages'] = [];
  const result = await extractPdfRange({
    bookId: book.id,
    filePath,
    startPage: book.startPage,
    endPage: book.endPage,
    onProgress: async (page, completedPages, totalPages) => {
      pendingPages.push(page);
      if (pendingPages.length >= 8 || completedPages === totalPages) {
        await saveBookPages(book, pendingPages);
        pendingPages = [];
        await updateBook({
          ...book,
          status: 'processing',
          extractionStatus: 'processing',
          extractionProgress: { completedPages, totalPages },
          extractionMessage: `Automatic extraction: ${completedPages} of ${totalPages} pages processed.`,
          automationStatus: 'processing',
        });
      }
    },
  });
  if (pendingPages.length) await saveBookPages(book, pendingPages);
  const needsReview = result.pages.some(page => page.requiresReview);
  return updateBook({
    ...book,
    status: needsReview ? 'draft' : 'ready',
    extractionStatus: needsReview ? 'needs_review' : 'completed',
    extractionProgress: { completedPages: result.pages.length, totalPages: result.pages.length },
    totalPdfPages: result.totalPdfPages,
    extractionMessage: needsReview
      ? 'Automatic publishing is waiting for visual review of OCR or right-to-left pages.'
      : `Extracted ${result.pages.length} pages and saved page images for daily Telegram posts.`,
    automationStatus: needsReview ? 'needs_review' : 'processing',
  });
}

async function readyBook(book: BookRecord) {
  let current = book;
  if (!['completed', 'needs_review'].includes(current.extractionStatus)) current = await extractBook(current);

  let pages = await listBookPages(current.userId, current.id, current.startPage, current.endPage);
  if (pages.length !== current.endPage - current.startPage + 1) {
    throw new Error('The selected PDF pages are incomplete after extraction.');
  }
  const unchecked = pages.filter(page => page.requiresReview && !page.reviewedByUser);
  if (unchecked.length) {
    await updateBook({ ...current, automationStatus: 'needs_review', extractionStatus: 'needs_review' });
    return null;
  }
  if (current.extractionStatus === 'needs_review') {
    current = await updateBook({ ...current, extractionStatus: 'completed', automationStatus: 'processing', extractionMessage: 'Visual review is complete; automatic publishing is continuing.' });
  }

  let assignments = await listBookAssignments(current.userId, current.id);
  if (!assignments.length) {
    const today = localDate(current.timezone);
    const planBook = current.startDate < today ? { ...current, startDate: today } : current;
    const plan = await generateConceptReadingPlan({ book: planBook, pages });
    assignments = await replaceDraftAssignments(current.userId, current.id, plan.assignments);
    current = await updateBook({ ...current, startDate: planBook.startDate, status: 'ready', extractionStatus: 'completed', automationStatus: 'ready', extractionMessage: `Automatic reading plan saved with ${assignments.length} daily assignments. ${plan.issues.join(' ')}`.trim() });
  } else {
    current = await updateBook({ ...current, status: 'ready', extractionStatus: 'completed', automationStatus: 'ready' });
  }

  const today = localDate(current.timezone);
  const overdue = assignments.filter(item => item.status === 'draft' && item.scheduledDate < today)
    .sort((a, b) => a.dayNumber - b.dayNumber);
  if (overdue.length) {
    let nextDate = today;
    const overdueIds = new Set(overdue.map(item => item.id));
    assignments = await Promise.all(assignments.map(async assignment => {
      if (!overdueIds.has(assignment.id)) return assignment;
      const updated = await updateBookAssignment({ ...assignment, scheduledDate: nextDate, updatedAt: Date.now() });
      nextDate = addDays(nextDate, 1);
      return updated;
    }));
  }
  return current;
}

async function prepareDueAssignment(book: BookRecord, assignments: BookAssignmentRecord[], now: number) {
  const todayStr = localDate(book.timezone, new Date(now));

  // 1. Ensure any approved assignment already has its publish job registered in book_publish_jobs
  const approvedAssignments = assignments.filter(item => item.status === 'approved' && item.deliveryStatus !== 'sent' && item.deliveryStatus !== 'failed');
  for (const app of approvedAssignments) {
    try {
      await upsertBookPublishJob(book, app);
    } catch {}
  }

  // 2. Filter uncompleted assignments (excluding superseded or completed)
  const pending = assignments.filter(item => item.status !== 'completed' && item.status !== 'superseded');
  if (!pending.length) return false;

  // 3. Find the due assignment to prepare:
  // If an assignment from a past day failed delivery, it must NOT deadlock the pipeline or block today's assignment!
  // First priority: an uncompleted assignment scheduled for today (e.g. Day 2)
  const todayAssignment = pending.find(item => item.scheduledDate === todayStr && item.deliveryStatus !== 'sent' && item.deliveryStatus !== 'failed');

  // Next priority: earliest pending assignment whose date is today or earlier and hasn't failed for today
  const due = todayAssignment || pending
    .filter(item => item.status === 'draft' && item.scheduledDate <= todayStr && item.deliveryStatus !== 'failed')
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.dayNumber - b.dayNumber)[0]
    || pending.find(item => item.status === 'draft' && item.deliveryStatus !== 'failed');

  if (!due || due.status !== 'draft') return false;

  const dueAt = makeBookPublishJob(book, due).scheduledAt;
  if (dueAt > now) return false;

  const pages = await listBookPages(book.userId, book.id, due.startPdfPage, due.endPdfPage);
  const generated = await generateAssignmentStudyNotes({ book, assignment: due, pages });
  const withNotes = await updateBookAssignment({ ...due, studyNotes: generated.studyNotes, updatedAt: Date.now() });
  const approved = { ...withNotes, status: 'approved' as const, updatedAt: Date.now() };
  await updateBookAssignment(approved);
  try {
    await upsertBookPublishJob(book, approved);
  } catch (error) {
    await updateBookAssignment({ ...withNotes, status: 'draft', updatedAt: Date.now() }).catch(() => undefined);
    throw error;
  }
  return true;
}

/** Prepare at most one book or one daily assignment per cron invocation. */
export async function prepareAutomaticBookPublishing(now = Date.now()) {
  const books = await listAllBooks();
  for (const original of books) {
    if (original.autoPublish === false) continue;
    const isFailed = original.automationStatus === 'failed';
    // If a book was previously marked failed, allow auto-recovery if 30 minutes have passed or if date has changed
    const canRecover = isFailed && (now - original.updatedAt > 30 * 60 * 1000 || localDate(original.timezone, new Date(original.updatedAt)) < localDate(original.timezone, new Date(now)));
    if (isFailed && !canRecover) continue;

    const originalStatus = (isFailed && canRecover) ? 'queued' : (original.automationStatus || 'queued');
    if (original.automationRetryAt && original.automationRetryAt > now) continue;
    if (originalStatus === 'processing' && now - original.updatedAt < 20 * 60 * 1000) continue;

    let book = original;
    try {
      if (originalStatus !== 'ready') {
        book = await updateBook({ ...original, automationStatus: 'processing', updatedAt: now });
        const ready = await readyBook(book);
        if (!ready) continue;
        book = ready;
      }
      const assignments = await listBookAssignments(book.userId, book.id);
      if (await prepareDueAssignment(book, assignments, now)) {
        return { bookId: book.id, status: 'assignment_queued' as const };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Automatic book preparation failed.';
      const attempts = (original.automationAttempts || 0) + 1;
      const retry = attempts < 5;
      await updateBook({
        ...book,
        automationAttempts: attempts,
        automationRetryAt: retry ? now + Math.min(60, 5 * 2 ** (attempts - 1)) * 60_000 : undefined,
        automationStatus: retry ? 'queued' : 'failed',
        extractionMessage: `Automatic publishing setup ${retry ? `will retry (attempt ${attempts}/5)` : 'failed after five attempts'}: ${message}`,
      }).catch(() => undefined);
      return { bookId: book.id, status: retry ? 'retry_scheduled' as const : 'failed' as const, message };
    }
  }
  return { status: 'idle' as const };
}
