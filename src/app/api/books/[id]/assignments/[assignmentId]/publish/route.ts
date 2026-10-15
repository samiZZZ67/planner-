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

    // Launch interactive quiz session if enabled
    let quizSession: any = null;
    try {
      const { getBookQuizSettings, startQuizSessionForAssignment } = await import('@/lib/server/books/bookQuiz');
      const quizSettings = await getBookQuizSettings(session.userId);
      if (quizSettings.enabled) {
        const { envConfig } = await import('@/lib/server/telegram');
        const targetChatId = envConfig().chatId;
        quizSession = await startQuizSessionForAssignment(
          session.userId,
          book,
          assignment,
          pages,
          targetChatId,
          { skipFirstExcerpt: true }
        );
      }
    } catch (quizErr: any) {
      console.warn('[Publish] Interactive quiz launch warning:', quizErr?.message || quizErr);
    }

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
    const nextCurrentPage = Math.min(book.endPage + 1, Math.max(book.currentPage, assignment.endPdfPage + 1));
    const updatedBook = await updateBook({
      ...book,
      currentPage: nextCurrentPage,
      status: nextCurrentPage > book.endPage ? 'ready' : book.status,
    });

    const job = (await listBookPublishJobs(session.userId)).find(item => item.assignmentId === assignmentId);
    if (job) await updateBookPublishJob({ ...job, status: 'completed', lastError: '' });

    return NextResponse.json({
      ok: true,
      delivery,
      channel,
      bot,
      book: updatedBook,
      quizSession: quizSession ? { id: quizSession.id, totalQuestions: quizSession.totalQuestions, totalSections: quizSession.totalSections } : null,
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
