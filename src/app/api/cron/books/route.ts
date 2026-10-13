import { NextResponse } from 'next/server';
import { claimDueBookPublishJobs, updateBookPublishJob } from '@/lib/server/bookScheduler';
import { listBookAssignments } from '@/lib/server/bookAssignments';
import { getBook, listBookPages } from '@/lib/server/books';
import { publishApprovedAssignment } from '@/lib/server/telegram';

export async function POST(request: Request) {
  const secret = process.env.BOOKS_CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: 'Scheduled publishing is not configured.' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const due = await claimDueBookPublishJobs(Date.now());
  const results: Array<{ assignmentId: string; status: string; message?: string }> = [];
  for (const job of due) {
    try {
      const book = await getBook(job.userId, job.bookId);
      const assignment = book && (await listBookAssignments(job.userId, job.bookId)).find(item => item.id === job.assignmentId);
      if (!book || !assignment || assignment.status !== 'approved') throw new Error('Book or approved assignment is no longer available.');
      const pages = await listBookPages(job.userId, job.bookId, assignment.startPdfPage, assignment.endPdfPage);
      const delivery = await publishApprovedAssignment(job.userId, book, assignment, pages);
      await updateBookPublishJob({ ...job, status: 'completed', lastError: `Telegram message IDs: ${delivery.telegramMessageIds.join(', ')}` });
      results.push({ assignmentId: job.assignmentId, status: 'completed' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scheduled publish failed.';
      const delivery = (error as Error & { delivery?: { safeToRetry?: boolean; retryAfterAt?: number | null } }).delivery;
      if (delivery?.safeToRetry && delivery.retryAfterAt && job.attemptCount < 5) {
        await updateBookPublishJob({ ...job, status: 'scheduled', scheduledAt: delivery.retryAfterAt, lastError: message });
        results.push({ assignmentId: job.assignmentId, status: 'retry_scheduled', message });
      } else {
        await updateBookPublishJob({ ...job, status: 'failed', lastError: message });
        results.push({ assignmentId: job.assignmentId, status: 'failed', message });
      }
    }
  }
  return NextResponse.json({ claimed: due.length, results });
}
