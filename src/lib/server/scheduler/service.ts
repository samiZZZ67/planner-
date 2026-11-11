import { claimDueBookPublishJobs, countFailedBookPublishJobs, countStaleBookPublishJobs, listBookPublishJobs, updateBookPublishJob, upsertBookPublishJob } from '../bookScheduler';
import { listBookAssignments, updateBookAssignment } from '../bookAssignments';
import { getBook, listBookPages, updateBook } from '../books';
import { countUncertainTelegramDeliveries, envConfig, publishApprovedAssignment, publishLoadPlanPagesToTelegram, sendTelegramTextToChannel } from '../telegram';
import { getBookQuizSettings, startQuizSessionForAssignment, processTelegramUpdates } from '../books/bookQuiz';
import { prepareAutomaticBookPublishing } from '../autoBookPublishing';
import { claimDueScheduledMessages, countFailedScheduledMessages, updateScheduledMessage } from './scheduledMessages';
import { countFailedBriefDeliveries, processDueBriefs } from './briefs';
import type { SchedulerExecutionResult } from './types';
import type { BookAssignmentRecord } from '../../books/types';

let isCycleRunning = false;

export function isSchedulerCycleRunning(): boolean {
  return isCycleRunning;
}

export function _resetSchedulerCycleForTest(): void {
  isCycleRunning = false;
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
      skipped: true,
      errors: [],
      unresolved: { bookJobs: 0, scheduledMessages: 0, briefs: 0, telegramDeliveries: 0 },
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
    errors: [],
    unresolved: { bookJobs: 0, scheduledMessages: 0, briefs: 0, telegramDeliveries: 0 },
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
      result.errors.push(`Automatic book preparation failed: ${prepErr instanceof Error ? prepErr.message : String(prepErr)}`);
    }

    // ── 2. Process Due Book Publishing Jobs ───────────────────────────
    let dueBookJobs: Awaited<ReturnType<typeof claimDueBookPublishJobs>> = [];
    try {
      const staleBookJobCount = await countStaleBookPublishJobs(now);
      if (staleBookJobCount > 0) {
        result.errors.push(`${staleBookJobCount} interrupted book publishing job(s) require Telegram delivery review before retrying.`);
      }
      dueBookJobs = await claimDueBookPublishJobs(now);
      result.bookJobs.claimed = dueBookJobs.length;
      if (dueBookJobs.length > 0) {
        console.log(`[Scheduler] 📚 Claimed ${dueBookJobs.length} due book publishing job(s)`);
      }
    } catch (claimErr: any) {
      console.error('[Scheduler] ❌ Error claiming due book jobs:', claimErr.message);
      result.errors.push(`Claiming due book jobs failed: ${claimErr instanceof Error ? claimErr.message : String(claimErr)}`);
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

        const pages = await listBookPages(job.userId, job.bookId, assignment.startPdfPage, assignment.endPdfPage);
        if (!pages.length) {
          throw new Error(`No extracted PDF page text found for assignment pages ${assignment.startPdfPage}-${assignment.endPdfPage}.`);
        }

        const previous = assignments.find(item => item.dayNumber === assignment.dayNumber - 1);

        console.log(`[Scheduler] 🚀 Dispatching Day ${assignment.dayNumber} of "${book.title}" to Telegram...`);
        let telegramMessageIds: number[] = [];

        if (!assignment.learningPackage && !process.env.VITEST) {
          try {
            const { getOrGenerateLearningPackage } = await import('../books/learningContent');
            const pkg = await getOrGenerateLearningPackage(job.userId, book, assignment, pages);
            assignment.learningPackage = pkg;
          } catch (lpErr: any) {
            console.warn('[Scheduler] Auto learning package generation warning:', lpErr?.message);
          }
        }

        if (assignment.status === 'approved' && assignment.studyNotes) {
          try {
            const delivery = await publishApprovedAssignment(job.userId, book, assignment, pages, previous);
            telegramMessageIds = delivery.telegramMessageIds;
          } catch (approveErr: any) {
            console.warn(`[Scheduler] ⚠️ publishApprovedAssignment failed (${approveErr.message}); falling back to extracted load plan pages.`);
            const fallback = await publishLoadPlanPagesToTelegram(job.userId, book, assignment, pages, previous);
            telegramMessageIds = fallback.telegramMessageIds;
          }
        } else {
          const loadPlanResult = await publishLoadPlanPagesToTelegram(job.userId, book, assignment, pages, previous);
          telegramMessageIds = loadPlanResult.telegramMessageIds;
        }

        // Quizzes remain strictly on the website (/quiz) — never dispatched to Telegram
        const isEntirelyBlank = pages.every(p => !p.text?.trim() || p.method === 'empty');

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
        let nextCurrentPage = Math.min(book.endPage + 1, Math.max(book.currentPage, assignment.endPdfPage + 1));
        let updatedBook = await updateBook({
          ...book,
          currentPage: nextCurrentPage,
          status: nextCurrentPage > book.endPage ? 'ready' : book.status,
        });

        await updateBookPublishJob({
          ...job,
          status: 'completed',
          lastError: `Telegram message IDs: ${telegramMessageIds.join(', ')}`,
        });

        console.log(`[Scheduler] ✅ Successfully published Day ${assignment.dayNumber} of "${book.title}"! Telegram IDs: [${telegramMessageIds.join(', ')}]`);
        result.bookJobs.completed++;

        // If the section was completely blank/illustration pages, automatically advance to and publish the next section!
        if (isEntirelyBlank) {
          const nextAssignment = assignments.find(item => item.dayNumber === assignment.dayNumber + 1);
          if (nextAssignment && nextAssignment.status !== 'completed') {
            const nextPages = await listBookPages(job.userId, job.bookId, nextAssignment.startPdfPage, nextAssignment.endPdfPage);
            if (nextPages.length > 0) {
              try {
                console.log(`[Scheduler] ⏩ Auto-advancing from blank section Day ${assignment.dayNumber} to Day ${nextAssignment.dayNumber}...`);
                let nextTelegramIds: number[] = [];
                if (nextAssignment.status === 'approved' && nextAssignment.studyNotes) {
                  try {
                    const nextDel = await publishApprovedAssignment(job.userId, updatedBook, nextAssignment, nextPages, assignment);
                    nextTelegramIds = nextDel.telegramMessageIds;
                  } catch {
                    const nextFallback = await publishLoadPlanPagesToTelegram(job.userId, updatedBook, nextAssignment, nextPages, assignment);
                    nextTelegramIds = nextFallback.telegramMessageIds;
                  }
                } else {
                  const nextFallback = await publishLoadPlanPagesToTelegram(job.userId, updatedBook, nextAssignment, nextPages, assignment);
                  nextTelegramIds = nextFallback.telegramMessageIds;
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
                const nextJob = (await listBookPublishJobs(job.userId)).find(item => item.assignmentId === nextAssignment.id);
                if (nextJob) await updateBookPublishJob({ ...nextJob, status: 'completed', lastError: `Telegram IDs: ${nextTelegramIds.join(', ')}` });
                result.bookJobs.completed++;
              } catch (nextErr) {
                console.warn('[Scheduler] Auto-advance next assignment dispatch warning:', nextErr);
              }
            }
          }
        }
      } catch (jobErr: any) {
        const errMsg = jobErr instanceof Error ? jobErr.message : 'Publishing failed';
        console.error(`[Scheduler] ❌ Failed publishing assignment ${job.assignmentId}:`, errMsg);

        const deliveryMeta = (jobErr as any)?.delivery as { safeToRetry?: boolean; retryAfterAt?: number | null } | undefined;
        const canRetrySafely = Boolean(deliveryMeta?.safeToRetry) && job.attemptCount < 5;
        if (currentAssignment) {
          await updateBookAssignment({
            ...currentAssignment,
            deliveryStatus: canRetrySafely ? 'scheduled' : 'failed',
            lastDeliveryError: errMsg,
            updatedAt: Date.now(),
          }).catch(() => undefined);
        }

        if (canRetrySafely) {
          const retryDelayMs = Math.min(60 * 60 * 1000, 60 * 1000 * Math.pow(2, Math.max(0, job.attemptCount - 1)));
          const retryAt = deliveryMeta?.retryAfterAt && deliveryMeta.retryAfterAt > Date.now()
            ? deliveryMeta.retryAfterAt
            : Date.now() + retryDelayMs;
          await updateBookPublishJob({
            ...job,
            status: 'scheduled',
            scheduledAt: retryAt,
            lastError: `Temporary Telegram failure: ${errMsg}. Scheduled retry at ${new Date(retryAt).toISOString()}`,
          });
          console.log(`[Scheduler] 🔁 Rescheduled assignment ${job.assignmentId} for retry at ${new Date(retryAt).toISOString()}`);
          result.bookJobs.retried++;
        } else {
          await updateBookPublishJob({
            ...job,
            status: 'failed',
            lastError: errMsg,
          });
          result.bookJobs.failed++;

          // Ensure that failure of this day does not stall the entire pipeline:
          // Automatically prepare and queue the next day's reading assignment if available
          try {
            const book = await getBook(job.userId, job.bookId);
            if (book && book.autoPublish !== false) {
              const allAssignments = await listBookAssignments(job.userId, job.bookId);
              const nextAssignment = allAssignments.find(item => item.dayNumber === (currentAssignment?.dayNumber || 0) + 1);
              if (nextAssignment && nextAssignment.status !== 'completed') {
                if (nextAssignment.status === 'approved') {
                  await upsertBookPublishJob(book, nextAssignment).catch(() => undefined);
                } else if (nextAssignment.status === 'draft') {
                  const nextPages = await listBookPages(job.userId, job.bookId, nextAssignment.startPdfPage, nextAssignment.endPdfPage);
                  if (nextPages.length > 0) {
                    const { generateAssignmentStudyNotes } = await import('../studyNotes');
                    const gen = await generateAssignmentStudyNotes({ book, assignment: nextAssignment, pages: nextPages }).catch(() => null);
                    if (gen?.studyNotes) {
                      const approvedNext = await updateBookAssignment({ ...nextAssignment, studyNotes: gen.studyNotes, status: 'approved', updatedAt: Date.now() });
                      await upsertBookPublishJob(book, approvedNext).catch(() => undefined);
                      console.log(`[Scheduler] ⏩ Auto-scheduled Day ${approvedNext.dayNumber} for delivery on ${approvedNext.scheduledDate}.`);
                    }
                  }
                }
              }
            }
          } catch (queueNextErr) {
            console.warn('[Scheduler] Non-fatal notice preparing next day assignment after failure:', queueNextErr);
          }
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
      result.errors.push(`Claiming scheduled messages failed: ${claimMsgErr instanceof Error ? claimMsgErr.message : String(claimMsgErr)}`);
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

    // ── 4. Process Morning & Evening Telegram Briefs ─────────────────
    try {
      result.briefs = await processDueBriefs(now);
      if (result.briefs && (result.briefs.completed > 0 || result.briefs.failed > 0)) {
        console.log(`[Scheduler] 🌅 Briefs processing result:`, result.briefs);
      }
    } catch (briefsErr: any) {
      console.error('[Scheduler] ❌ Error processing due briefs:', briefsErr.message);
      result.errors.push(`Processing scheduled briefs failed: ${briefsErr instanceof Error ? briefsErr.message : String(briefsErr)}`);
    }

    // ── 5. Process Background Telegram Updates (Polls & Callbacks) ────
    try {
      const updateResult = await processTelegramUpdates();
      if (updateResult.processedCount > 0) {
        console.log(`[Scheduler] 📬 Processed ${updateResult.processedCount} Telegram update(s) in background.`);
      }
    } catch {
      // Non-fatal if offline or in test
    }

    try {
      const [failedBookJobs, failedScheduledMessages, failedBriefs, uncertainTelegramDeliveries] = await Promise.all([
        countFailedBookPublishJobs(),
        countFailedScheduledMessages(),
        countFailedBriefDeliveries(),
        countUncertainTelegramDeliveries(),
      ]);
      result.unresolved = {
        bookJobs: failedBookJobs,
        scheduledMessages: failedScheduledMessages,
        briefs: failedBriefs,
        telegramDeliveries: uncertainTelegramDeliveries,
      };
    } catch (statusErr: any) {
      console.error('[Scheduler] ❌ Could not inspect unresolved delivery failures:', statusErr?.message || statusErr);
      result.errors.push(`Could not inspect unresolved delivery failures: ${statusErr instanceof Error ? statusErr.message : String(statusErr)}`);
    }
  } finally {
    isCycleRunning = false;
    result.durationMs = Date.now() - startTime;
    if (result.bookJobs.claimed > 0 || result.scheduledMessages.claimed > 0 || (result.briefs && result.briefs.processed > 0)) {
      console.log(`[Scheduler] 🏁 Completed cycle in ${result.durationMs}ms:`, {
        bookJobs: result.bookJobs,
        scheduledMessages: result.scheduledMessages,
        briefs: result.briefs,
      });
    }
  }

  return result;
}
