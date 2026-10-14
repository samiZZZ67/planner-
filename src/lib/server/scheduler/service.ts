import { claimDueBookPublishJobs, updateBookPublishJob } from '../bookScheduler';
import { listBookAssignments, updateBookAssignment } from '../bookAssignments';
import { getBook, listBookPages, updateBook } from '../books';
import { publishApprovedAssignment, sendTelegramTextToChannel } from '../telegram';
import { prepareAutomaticBookPublishing } from '../autoBookPublishing';
import { claimDueScheduledMessages, updateScheduledMessage } from './scheduledMessages';
import type { SchedulerExecutionResult } from './types';
import type { BookAssignmentRecord } from '../../books/types';

let isCycleRunning = false;

export function isSchedulerCycleRunning(): boolean {
  return isCycleRunning;
}

/**
 * Authoritative single execution cycle that queries and delivers all due
 * book reading sections, scheduled plans, and custom Telegram messages.
 */
export async function runScheduledDeliveryCycle(now: number = Date.now()): Promise<SchedulerExecutionResult> {
  if (isCycleRunning) {
    console.log(`[Scheduler] ⚠️ Execution cycle already running at ${new Date(now).toISOString()}; skipping tick.`);
    return {
      timestamp: now,
      isoTime: new Date(now).toISOString(),
      bookJobs: { claimed: 0, completed: 0, retried: 0, failed: 0, alreadyCompleted: 0 },
      scheduledMessages: { claimed: 0, completed: 0, retried: 0, failed: 0 },
      durationMs: 0,
    };
  }

  isCycleRunning = true;
  const startTime = Date.now();
  console.log(`[Scheduler] 🕒 Running scheduled check at ${new Date(now).toISOString()}...`);

  const result: SchedulerExecutionResult = {
    timestamp: now,
    isoTime: new Date(now).toISOString(),
    bookJobs: { claimed: 0, completed: 0, retried: 0, failed: 0, alreadyCompleted: 0 },
    scheduledMessages: { claimed: 0, completed: 0, retried: 0, failed: 0 },
    durationMs: 0,
  };

  try {
    // ── 1. Automatic Book Publishing Preparation ──────────────────────
    try {
      result.automaticPreparation = await prepareAutomaticBookPublishing(now);
      if (result.automaticPreparation?.status && result.automaticPreparation.status !== 'idle') {
        console.log('[Scheduler] 📖 Automatic book preparation result:', result.automaticPreparation);
      }
    } catch (prepErr: any) {
      console.error('[Scheduler] ⚠️ Error during automatic book preparation (non-fatal):', prepErr.message);
    }

    // ── 2. Process Due Book Publishing Jobs ───────────────────────────
    let dueBookJobs: Awaited<ReturnType<typeof claimDueBookPublishJobs>> = [];
    try {
      dueBookJobs = await claimDueBookPublishJobs(now);
      result.bookJobs.claimed = dueBookJobs.length;
      if (dueBookJobs.length > 0) {
        console.log(`[Scheduler] 📚 Claimed ${dueBookJobs.length} due book publishing job(s)`);
      }
    } catch (claimErr: any) {
      console.error('[Scheduler] ❌ Error claiming due book jobs:', claimErr.message);
    }

    for (const job of dueBookJobs) {
      let currentAssignment: BookAssignmentRecord | undefined;
      try {
        const book = await getBook(job.userId, job.bookId);
        const assignments = book ? await listBookAssignments(job.userId, job.bookId) : [];
        const assignment = assignments.find(item => item.id === job.assignmentId);
        currentAssignment = assignment;

        if (!book || !assignment) {
          throw new Error('Book or reading assignment record no longer exists.');
        }

        // Idempotency safeguard: if user already pressed "Send Now", do not send again!
        if (assignment.status === 'completed') {
          console.log(`[Scheduler] ⏭️ Assignment ${job.assignmentId} (Day ${assignment.dayNumber}) already completed; marking job completed.`);
          await updateBookPublishJob({
            ...job,
            status: 'completed',
            lastError: 'Assignment was already marked completed (sent via Send Now or previous delivery).',
          });
          result.bookJobs.alreadyCompleted++;
          continue;
        }

        if (assignment.status !== 'approved') {
          throw new Error(`Assignment status is '${assignment.status}', but must be 'approved' for delivery.`);
        }

        const pages = await listBookPages(job.userId, job.bookId, assignment.startPdfPage, assignment.endPdfPage);
        if (!pages.length) {
          throw new Error(`No extracted PDF page text found for assignment pages ${assignment.startPdfPage}-${assignment.endPdfPage}.`);
        }

        const previous = assignments.find(item => item.dayNumber === assignment.dayNumber - 1);

        console.log(`[Scheduler] 🚀 Dispatching Day ${assignment.dayNumber} of "${book.title}" to Telegram...`);
        const delivery = await publishApprovedAssignment(job.userId, book, assignment, pages, previous);

        // Mark assignment completed and update deliveryStatus
        await updateBookAssignment({
          ...assignment,
          status: 'completed',
          deliveryStatus: 'sent',
          deliveredAt: Date.now(),
          lastDeliveryError: undefined,
          updatedAt: Date.now(),
        });

        // Automatically advance book.currentPage
        const nextCurrentPage = Math.min(book.endPage + 1, Math.max(book.currentPage, assignment.endPdfPage + 1));
        await updateBook({
          ...book,
          currentPage: nextCurrentPage,
          status: nextCurrentPage > book.endPage ? 'ready' : book.status,
        });

        await updateBookPublishJob({
          ...job,
          status: 'completed',
          lastError: `Telegram message IDs: ${delivery.telegramMessageIds.join(', ')}`,
        });

        console.log(`[Scheduler] ✅ Successfully published Day ${assignment.dayNumber} of "${book.title}"! Telegram IDs: [${delivery.telegramMessageIds.join(', ')}]`);
        result.bookJobs.completed++;
      } catch (jobErr: any) {
        const errMsg = jobErr instanceof Error ? jobErr.message : 'Publishing failed';
        console.error(`[Scheduler] ❌ Failed publishing assignment ${job.assignmentId}:`, errMsg);

        if (currentAssignment) {
          await updateBookAssignment({
            ...currentAssignment,
            deliveryStatus: 'failed',
            lastDeliveryError: errMsg,
            updatedAt: Date.now(),
          }).catch(() => undefined);
        }

        const deliveryMeta = (jobErr as any)?.delivery as { safeToRetry?: boolean; retryAfterAt?: number | null } | undefined;
        if (deliveryMeta?.safeToRetry && deliveryMeta.retryAfterAt && job.attemptCount < 5) {
          await updateBookPublishJob({
            ...job,
            status: 'scheduled',
            scheduledAt: deliveryMeta.retryAfterAt,
            lastError: `Temporary Telegram failure: ${errMsg}. Scheduled retry at ${new Date(deliveryMeta.retryAfterAt).toISOString()}`,
          });
          console.log(`[Scheduler] 🔁 Rescheduled assignment ${job.assignmentId} for retry at ${new Date(deliveryMeta.retryAfterAt).toISOString()}`);
          result.bookJobs.retried++;
        } else {
          await updateBookPublishJob({
            ...job,
            status: 'failed',
            lastError: errMsg,
          });
          result.bookJobs.failed++;
        }
      }
    }

    // ── 3. Process Due Scheduled Messages ─────────────────────────────
    let dueMessages: Awaited<ReturnType<typeof claimDueScheduledMessages>> = [];
    try {
      dueMessages = await claimDueScheduledMessages(now);
      result.scheduledMessages.claimed = dueMessages.length;
      if (dueMessages.length > 0) {
        console.log(`[Scheduler] ✉️ Claimed ${dueMessages.length} due scheduled message(s)`);
      }
    } catch (claimMsgErr: any) {
      console.error('[Scheduler] ❌ Error claiming due scheduled messages:', claimMsgErr.message);
    }

    for (const msg of dueMessages) {
      try {
        console.log(`[Scheduler] 🚀 Dispatching scheduled message ${msg.id} (${msg.type}) to Telegram...`);

        let payload = msg.content;
        if (msg.type === 'daily_plan') {
          payload = `📅 *NightPlanner Daily Schedule*\n\n${msg.content}`;
        } else if (msg.type === 'weekly_report') {
          payload = `📊 *NightPlanner Weekly Report*\n\n${msg.content}`;
        }

        const telegramRes = await sendTelegramTextToChannel(payload, msg.userId);

        await updateScheduledMessage({
          ...msg,
          status: 'completed',
          telegramMessageIds: [telegramRes.messageId],
          lastError: '',
        });

        console.log(`[Scheduler] ✅ Delivered scheduled message ${msg.id} to Telegram! Message ID: ${telegramRes.messageId}`);
        result.scheduledMessages.completed++;
      } catch (msgErr: any) {
        const errMsg = msgErr instanceof Error ? msgErr.message : 'Message dispatch failed';
        console.error(`[Scheduler] ❌ Failed to dispatch scheduled message ${msg.id}:`, errMsg);

        if (msg.attemptCount < msg.maxAttempts) {
          const retryDelayMs = Math.min(60 * 60 * 1000, 5 * 60 * 1000 * Math.pow(2, msg.attemptCount - 1));
          const retryAt = now + retryDelayMs;
          await updateScheduledMessage({
            ...msg,
            status: 'scheduled',
            scheduledAt: retryAt,
            lastError: `Temporary error: ${errMsg}. Scheduled retry at ${new Date(retryAt).toISOString()}`,
          });
          console.log(`[Scheduler] 🔁 Rescheduled message ${msg.id} for retry at ${new Date(retryAt).toISOString()}`);
          result.scheduledMessages.retried++;
        } else {
          await updateScheduledMessage({
            ...msg,
            status: 'failed',
            lastError: errMsg,
          });
          result.scheduledMessages.failed++;
        }
      }
    }
  } finally {
    isCycleRunning = false;
    result.durationMs = Date.now() - startTime;
    if (result.bookJobs.claimed > 0 || result.scheduledMessages.claimed > 0) {
      console.log(`[Scheduler] 🏁 Completed cycle in ${result.durationMs}ms:`, {
        bookJobs: result.bookJobs,
        scheduledMessages: result.scheduledMessages,
      });
    }
  }

  return result;
}
