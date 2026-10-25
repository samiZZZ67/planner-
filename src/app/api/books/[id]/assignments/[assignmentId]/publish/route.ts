import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getBook, listBookPages, updateBook } from '@/lib/server/books';
import { listBookAssignments, updateBookAssignment } from '@/lib/server/bookAssignments';
import { publishApprovedAssignment, publishLoadPlanPagesToTelegram } from '@/lib/server/telegram';
import { listBookPublishJobs, updateBookPublishJob } from '@/lib/server/bookScheduler';

export async function POST(request: Request, context: RouteContext<'/api/books/[id]/assignments/[assignmentId]/publish'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to publish a reading assignment.' }, { status: 401 });
  const { id, assignmentId } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  const assignments = await listBookAssignments(session.userId, id);
  const assignment = assignments.find(item => item.id === assignmentId);
  if (!assignment) return NextResponse.json({ error: 'Reading assignment not found.' }, { status: 404 });

  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const isSendNow = Boolean(body?.sendNow || body?.override || url.searchParams.get('sendNow') === 'true');

  if (!isSendNow && (assignment.status !== 'approved' || !assignment.studyNotes)) {
    return NextResponse.json({ error: 'Approve this assignment and its study notes before publishing.' }, { status: 409 });
  }

  try {
    const pages = await listBookPages(session.userId, id, assignment.startPdfPage, assignment.endPdfPage);
    if (!pages.length) {
      return NextResponse.json({ error: 'No extracted page content found for this section. Extract the book pages first.' }, { status: 400 });
    }
    const previous = assignments.find(item => item.dayNumber === assignment.dayNumber - 1);

    if (!assignment.learningPackage && !process.env.VITEST) {
      try {
        const { getOrGenerateLearningPackage } = await import('@/lib/server/books/learningContent');
        const pkg = await getOrGenerateLearningPackage(session.userId, book, assignment, pages);
        assignment.learningPackage = pkg;
      } catch (lpErr: any) {
        console.warn('[Publish] Auto learning package generation warning:', lpErr?.message);
      }
    }

    let delivery: any;
    let channel: string | undefined;
    let bot: string | undefined;

    if (!isSendNow && assignment.status === 'approved' && assignment.studyNotes) {
      delivery = await publishApprovedAssignment(session.userId, book, assignment, pages, previous);
    } else {
      const result = await publishLoadPlanPagesToTelegram(session.userId, book, assignment, pages, previous);
      delivery = result.delivery;
      channel = result.channel;
      bot = result.bot;
    }

    // Quizzes are kept strictly on the website (/quiz) — never dispatched to Telegram
    const isEntirelyBlank = pages.every(p => !p.text?.trim() || p.method === 'empty');

    // Preserve the original schedule and all dates; mark status completed and deliveryStatus sent
    await updateBookAssignment({
      ...assignment,
      status: 'completed',
      deliveryStatus: 'sent',
      deliveredAt: Date.now(),
      lastDeliveryError: undefined,
      updatedAt: Date.now(),
    });

    // Advance book.currentPage to assignment.endPdfPage + 1
    let nextCurrentPage = Math.min(book.endPage + 1, Math.max(book.currentPage, assignment.endPdfPage + 1));
    let updatedBook = await updateBook({
      ...book,
      currentPage: nextCurrentPage,
      status: nextCurrentPage > book.endPage ? 'ready' : book.status,
    });

    const job = (await listBookPublishJobs(session.userId)).find(item => item.assignmentId === assignmentId);
    if (job) await updateBookPublishJob({ ...job, status: 'completed', lastError: '' });

    // If the section was completely blank or illustration pages, inform user and automatically proceed to next section
    if (isEntirelyBlank) {
      const allAssignments = await listBookAssignments(session.userId, id);
      const nextAssignment = allAssignments.find(item => item.dayNumber === assignment.dayNumber + 1);
      if (nextAssignment && nextAssignment.status !== 'completed') {
        const nextPages = await listBookPages(session.userId, id, nextAssignment.startPdfPage, nextAssignment.endPdfPage);
        if (nextPages.length > 0) {
          try {
            console.log(`[Publish] Auto-advancing from blank section Day ${assignment.dayNumber} to Day ${nextAssignment.dayNumber}...`);
            if (nextAssignment.status === 'approved' && nextAssignment.studyNotes) {
              await publishApprovedAssignment(session.userId, updatedBook, nextAssignment, nextPages, assignment);
            } else {
              await publishLoadPlanPagesToTelegram(session.userId, updatedBook, nextAssignment, nextPages, assignment);
            }
            await updateBookAssignment({
              ...nextAssignment,
              status: 'completed',
              deliveryStatus: 'sent',
              deliveredAt: Date.now(),
              lastDeliveryError: undefined,
              updatedAt: Date.now(),
            });
            nextCurrentPage = Math.min(updatedBook.endPage + 1, Math.max(updatedBook.currentPage, nextAssignment.endPdfPage + 1));
            updatedBook = await updateBook({
              ...updatedBook,
              currentPage: nextCurrentPage,
              status: nextCurrentPage > updatedBook.endPage ? 'ready' : updatedBook.status,
            });
            const nextJob = (await listBookPublishJobs(session.userId)).find(item => item.assignmentId === nextAssignment.id);
            if (nextJob) await updateBookPublishJob({ ...nextJob, status: 'completed', lastError: '' });
          } catch (nextErr) {
            console.warn('[Publish] Auto-advance next assignment dispatch warning:', nextErr);
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      delivery,
      channel,
      bot,
      book: updatedBook,
      quizSession: null,
    });
  } catch (error) {
    const failure = error as Error & { delivery?: unknown };
    // Record failure status on assignment without premature page advancement
    await updateBookAssignment({
      ...assignment,
      deliveryStatus: 'failed',
      lastDeliveryError: failure.message,
      updatedAt: Date.now(),
    }).catch(() => undefined);

    const retry = failure.delivery as { safeToRetry?: boolean; retryAfterAt?: number | null } | undefined;
    const job = (await listBookPublishJobs(session.userId)).find(item => item.assignmentId === assignmentId);
    if (job && retry?.safeToRetry && retry.retryAfterAt) await updateBookPublishJob({ ...job, status: 'scheduled', scheduledAt: retry.retryAfterAt, lastError: failure.message });
    return NextResponse.json({ error: failure.message, delivery: failure.delivery }, { status: /already exists|currently/i.test(failure.message) ? 409 : 502 });
  }
}
