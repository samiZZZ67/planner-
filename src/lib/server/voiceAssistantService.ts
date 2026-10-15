/**
 * Authoritative Server Service for Voice Assistant Commands
 *
 * Direct execution of user intent against real database models, Telegram dispatchers,
 * book schedulers, and brief delivery systems. No hallucinated outcomes.
 */

import {
  getTasksFromDb,
  createTaskInDb,
  updateTaskInDb,
  deleteTaskInDb,
  getSectionsFromDb,
} from './tasks';
import { listBooks, listBookPages } from './books';
import { listBookAssignments, updateBookAssignment } from './bookAssignments';
import {
  cancelBookPublishJob,
  listBookPublishJobs,
  rescheduleBookPublishJob,
  upsertBookPublishJob,
} from './bookScheduler';
import {
  checkTelegramChannel,
  publishApprovedAssignment,
  publishLoadPlanPagesToTelegram,
  sendTelegramTextToChannel,
} from './telegram';
import {
  getBriefStatus,
  getLocalTodayDate,
  generateEnrichedBriefContent,
  sendBriefNow,
  saveBriefConfig,
} from './scheduler/briefs';
import {
  calculateDeliveryCountdown,
  resolveNextBookDelivery,
} from '../date/bookDeliverySchedule';
import { sendChatCompletionWithFallback } from './freellm/gateway';
import type { ParsedVoiceIntent, VoiceContext } from '../voice/voiceIntentParser';

export interface VoiceExecutionResult {
  ok: boolean;
  action: string;
  message: string;
  spokenText: string;
  data?: Record<string, any>;
  needsConfirmation?: boolean;
  confirmationPrompt?: string;
  confirmationToken?: string;
  targetTask?: { id: string; title: string };
  navigationTab?: string;
}

export async function executeVoiceCommand(
  userId: string,
  parsed: ParsedVoiceIntent,
  context: VoiceContext = {}
): Promise<VoiceExecutionResult> {
  const { intent, params } = parsed;

  try {
    // ═════════════════════════════════════════════════════════════════
    // 1. CONFIRMATION HANDLING (YES / NO)
    // ═════════════════════════════════════════════════════════════════
    if (intent === 'assistant.confirm') {
      const confirmedIntent = params.confirmedIntent;
      if (confirmedIntent === 'tasks.delete' && params.targetId) {
        const delRes = await deleteTaskInDb(params.targetId);
        if (!delRes.ok) {
          return {
            ok: false,
            action: 'tasks.delete',
            message: `Could not delete task: ${delRes.error}`,
            spokenText: `Could not delete task: ${delRes.error}`,
          };
        }
        const title = params.targetTitle || 'Task';
        return {
          ok: true,
          action: 'tasks.delete',
          message: `🗑️ Deleted "${title}" from your tasks.`,
          spokenText: `Deleted ${title} from your tasks.`,
          data: { taskId: params.targetId },
        };
      }

      if (confirmedIntent === 'books.cancel') {
        const books = await listBooks(userId);
        const assignmentsByBook: Record<string, any[]> = {};
        for (const b of books) {
          assignmentsByBook[b.id] = await listBookAssignments(userId, b.id);
        }
        const next = resolveNextBookDelivery(books, assignmentsByBook, Date.now());
        if (next?.assignmentId) {
          await cancelBookPublishJob(userId, next.assignmentId);
          if (next.assignment) {
            await updateBookAssignment({
              ...next.assignment,
              status: 'draft',
              deliveryStatus: 'cancelled',
              updatedAt: Date.now(),
            });
          }
          return {
            ok: true,
            action: 'books.cancel',
            message: `🛑 Cancelled next delivery for "${next.bookTitle}". Reverted to draft.`,
            spokenText: `Cancelled the next scheduled delivery for ${next.bookTitle}.`,
          };
        }
      }

      return {
        ok: true,
        action: 'assistant.confirm',
        message: 'Action confirmed and processed.',
        spokenText: 'Action confirmed.',
      };
    }

    if (intent === 'assistant.reject') {
      return {
        ok: true,
        action: 'assistant.reject',
        message: 'Cancelled. I left your data unchanged.',
        spokenText: 'Cancelled. I left your data unchanged.',
      };
    }

    if (intent === 'assistant.stop_speaking') {
      return {
        ok: true,
        action: 'assistant.stop_speaking',
        message: 'Speech paused.',
        spokenText: '',
      };
    }

    if (intent === 'assistant.cancel') {
      return {
        ok: true,
        action: 'assistant.cancel',
        message: 'Cancelled. Listening for your next command.',
        spokenText: 'Listening for your next command.',
      };
    }

    // ═════════════════════════════════════════════════════════════════
    // 2. NAVIGATION
    // ═════════════════════════════════════════════════════════════════
    if (intent === 'navigation.tab') {
      const tab = params.tab || 'todo';
      const labelMap: Record<string, string> = {
        todo: 'To-Do Dashboard',
        books: 'Book Planner',
        note: 'Notes & Reflection',
        analytics: 'Analytics',
        settings: 'Settings',
        weekly: 'Weekly Plan',
        monthly: 'Monthly Plan',
      };
      return {
        ok: true,
        action: 'navigation.tab',
        navigationTab: tab,
        message: `🧭 Navigated to **${labelMap[tab] || tab}**.`,
        spokenText: `Opening ${labelMap[tab] || tab}.`,
      };
    }

    // ═════════════════════════════════════════════════════════════════
    // 3. TASKS OPERATIONS
    // ═════════════════════════════════════════════════════════════════
    if (intent === 'tasks.query') {
      const date = params.date || getLocalTodayDate();
      const filter = params.filter || 'remaining';
      const tasks = await getTasksFromDb(date);

      const remaining = tasks.filter(t => !t.isCompleted);
      const completed = tasks.filter(t => t.isCompleted);

      if (filter === 'completed') {
        if (completed.length === 0) {
          return {
            ok: true,
            action: 'tasks.query',
            message: `You haven't completed any tasks for ${date} yet.`,
            spokenText: `You haven't completed any tasks yet today.`,
            data: { tasks: [] },
          };
        }
        const titles = completed.map((t, idx) => `${idx + 1}. ${t.title}`).join('\n');
        return {
          ok: true,
          action: 'tasks.query',
          message: `✅ **Completed tasks (${completed.length}):**\n${titles}`,
          spokenText: `You have completed ${completed.length} task${completed.length === 1 ? '' : 's'}: ${completed.slice(0, 3).map(t => t.title).join(', ')}.`,
          data: { tasks: completed },
        };
      }

      // Default: Remaining tasks
      if (remaining.length === 0) {
        return {
          ok: true,
          action: 'tasks.query',
          message: `🎉 All clear! You have no remaining tasks for ${date}.`,
          spokenText: `All clear! You have finished all tasks for today.`,
          data: { tasks: [] },
        };
      }

      const topTasks = remaining.slice(0, 5);
      const listText = topTasks
        .map((t, idx) => {
          const time = t.startTime ? ` (${t.startTime})` : '';
          const mins = t.scheduledMinutes ? ` · ${t.scheduledMinutes}m` : '';
          return `${idx + 1}. **${t.title}**${time}${mins}`;
        })
        .join('\n');

      const spokenTitles = topTasks.map(t => t.title).join(', ');
      return {
        ok: true,
        action: 'tasks.query',
        message: `📋 **Remaining tasks today (${remaining.length}):**\n${listText}${remaining.length > 5 ? `\n_...and ${remaining.length - 5} more._` : ''}`,
        spokenText: `You have ${remaining.length} task${remaining.length === 1 ? '' : 's'} remaining: ${spokenTitles}.`,
        data: { tasks: remaining },
      };
    }

    if (intent === 'tasks.create') {
      const res = await createTaskInDb({
        title: params.title || 'New Voice Task',
        date: params.date || getLocalTodayDate(),
        scheduledMinutes: params.scheduledMinutes || 60,
        startTime: params.startTime,
        priority: params.priority || 'Medium',
        mustDo: Boolean(params.mustDo),
        category: params.category,
      });

      if (!res.ok || !res.task) {
        return {
          ok: false,
          action: 'tasks.create',
          message: `Could not create task: ${res.error}`,
          spokenText: `Failed to create task: ${res.error}`,
        };
      }

      const t = res.task;
      const timeStr = t.startTime ? ` at ${t.startTime}` : '';
      const durStr = t.scheduledMinutes ? ` for ${t.scheduledMinutes} minutes` : '';

      return {
        ok: true,
        action: 'tasks.create',
        message: `✨ Created task **${t.title}**${durStr}${timeStr} in category *${t.sectionId || 'General'}*.`,
        spokenText: `Created task "${t.title}"${durStr}${timeStr}.`,
        data: { task: t },
        targetTask: { id: t.id, title: t.title },
      };
    }

    if (intent === 'tasks.complete') {
      const date = params.date || getLocalTodayDate();
      const tasks = await getTasksFromDb(date);
      const query = (params.taskQuery || '').toLowerCase();

      const matched = tasks.find(
        t => (params.taskId && t.id === params.taskId) ||
             (query && t.title.toLowerCase().includes(query)) ||
             (query && query.includes(t.title.toLowerCase()))
      ) || tasks.find(t => !t.isCompleted); // Fallback to first incomplete task

      if (!matched) {
        return {
          ok: false,
          action: 'tasks.complete',
          message: `Could not find a task matching "${params.taskQuery || 'your request'}".`,
          spokenText: `I couldn't find that task in your list.`,
        };
      }

      const updateRes = await updateTaskInDb(matched.id, {
        isCompleted: true,
        status: 'completed',
        completedAt: Date.now(),
      }, date);

      if (!updateRes.ok) {
        return {
          ok: false,
          action: 'tasks.complete',
          message: `Failed to mark task complete: ${updateRes.error}`,
          spokenText: `Could not complete task: ${updateRes.error}`,
        };
      }

      return {
        ok: true,
        action: 'tasks.complete',
        message: `✅ Completed **${matched.title}**!`,
        spokenText: `Marked "${matched.title}" as completed!`,
        data: { task: updateRes.task },
        targetTask: { id: matched.id, title: matched.title },
      };
    }

    if (intent === 'tasks.uncomplete') {
      const date = params.date || getLocalTodayDate();
      const tasks = await getTasksFromDb(date);
      const query = (params.taskQuery || '').toLowerCase();

      const matched = tasks.find(
        t => (params.taskId && t.id === params.taskId) ||
             (query && t.title.toLowerCase().includes(query)) ||
             (query && query.includes(t.title.toLowerCase()))
      ) || tasks.find(t => t.isCompleted);

      if (!matched) {
        return {
          ok: false,
          action: 'tasks.uncomplete',
          message: `Could not find task to uncomplete.`,
          spokenText: `I couldn't find that task.`,
        };
      }

      const updateRes = await updateTaskInDb(matched.id, {
        isCompleted: false,
        status: 'not_started',
        completedAt: null,
      }, date);

      return {
        ok: true,
        action: 'tasks.uncomplete',
        message: `🔄 Marked **${matched.title}** incomplete.`,
        spokenText: `Marked "${matched.title}" as incomplete.`,
        data: { task: updateRes.task },
        targetTask: { id: matched.id, title: matched.title },
      };
    }

    if (intent === 'tasks.delete') {
      const date = params.date || getLocalTodayDate();
      const tasks = await getTasksFromDb(date);
      const query = (params.taskQuery || '').toLowerCase();

      const matched = tasks.find(
        t => (params.taskId && t.id === params.taskId) ||
             (query && t.title.toLowerCase().includes(query)) ||
             (query && query.includes(t.title.toLowerCase()))
      );

      if (!matched) {
        return {
          ok: false,
          action: 'tasks.delete',
          message: `Could not find a task matching "${params.taskQuery}".`,
          spokenText: `I couldn't find a task matching that name to delete.`,
        };
      }

      // Destructive action: return confirmation request
      return {
        ok: true,
        action: 'tasks.delete',
        needsConfirmation: true,
        confirmationPrompt: `I found "${matched.title}". Are you sure you want to delete it?`,
        confirmationToken: matched.id,
        targetTask: { id: matched.id, title: matched.title },
        message: `⚠️ **Confirmation Required:** Do you want to delete **"${matched.title}"**? Say "Yes" to confirm or "Cancel".`,
        spokenText: `I found "${matched.title}". Are you sure you want to delete it?`,
      };
    }

    if (intent === 'tasks.reschedule') {
      const date = params.date || getLocalTodayDate();
      const tasks = await getTasksFromDb(date);
      const query = (params.taskQuery || '').toLowerCase();

      const matched = tasks.find(
        t => (params.taskId && t.id === params.taskId) ||
             (query && t.title.toLowerCase().includes(query)) ||
             (query && query.includes(t.title.toLowerCase()))
      ) || tasks.find(t => !t.isCompleted);

      if (!matched) {
        return {
          ok: false,
          action: 'tasks.reschedule',
          message: `Could not find task to reschedule.`,
          spokenText: `I couldn't find that task to reschedule.`,
        };
      }

      const updates: any = {};
      if (params.newTime) updates.startTime = params.newTime;
      if (params.newDate) updates.date = params.newDate;

      const updateRes = await updateTaskInDb(matched.id, updates, date);
      if (!updateRes.ok) {
        return {
          ok: false,
          action: 'tasks.reschedule',
          message: `Failed to reschedule task: ${updateRes.error}`,
          spokenText: `Failed to reschedule task: ${updateRes.error}`,
        };
      }

      const shiftStr = params.newTime ? ` to ${params.newTime}` : '';
      const dateStr = params.newDate && params.newDate !== date ? ` on ${params.newDate}` : '';

      return {
        ok: true,
        action: 'tasks.reschedule',
        message: `🕒 Rescheduled **${matched.title}**${shiftStr}${dateStr}.`,
        spokenText: `Moved "${matched.title}"${shiftStr}${dateStr}.`,
        data: { task: updateRes.task },
        targetTask: { id: matched.id, title: matched.title },
      };
    }

    if (intent === 'tasks.budget') {
      const date = params.date || getLocalTodayDate();
      const tasks = await getTasksFromDb(date);
      const totalMins = tasks.reduce((sum, t) => sum + (t.scheduledMinutes || t.estimatedMinutes || 0), 0);
      const totalHours = (totalMins / 60).toFixed(1);
      const budgetMins = 8 * 60; // 8 hours focus budget
      const remainingBudgetMins = Math.max(0, budgetMins - totalMins);
      const remainingHours = (remainingBudgetMins / 60).toFixed(1);

      return {
        ok: true,
        action: 'tasks.budget',
        message: `⏱️ **Daily Focus Budget for ${date}:**\n• Scheduled Focus: **${totalHours} hours** (${totalMins} mins across ${tasks.length} tasks)\n• Remaining Focus Budget: **${remainingHours} hours** available.`,
        spokenText: `You have scheduled ${totalHours} hours of focus work today across ${tasks.length} tasks, with ${remainingHours} hours remaining in your 8-hour focus budget.`,
        data: { totalMins, remainingBudgetMins },
      };
    }

    // ═════════════════════════════════════════════════════════════════
    // 4. BOOKS & READING DELIVERY
    // ═════════════════════════════════════════════════════════════════
    if (intent === 'books.next_delivery') {
      const books = await listBooks(userId);
      const assignmentsByBook: Record<string, any[]> = {};
      for (const b of books) {
        assignmentsByBook[b.id] = await listBookAssignments(userId, b.id);
      }
      const next = resolveNextBookDelivery(books, assignmentsByBook, Date.now());

      if (!next) {
        return {
          ok: true,
          action: 'books.next_delivery',
          message: `📚 No upcoming book deliveries scheduled right now.`,
          spokenText: `There are no upcoming book deliveries scheduled right now.`,
        };
      }

      const cd = calculateDeliveryCountdown(next.scheduledAt, Date.now());
      const remainingHuman = cd.humanRemaining;

      return {
        ok: true,
        action: 'books.next_delivery',
        message: `📖 **Next Book Delivery:**\n• Book: **${next.bookTitle}**\n• Section: **Day ${next.dayNumber} · ${next.conceptTitle}**\n• Scheduled: **${next.formattedTime12h} (${next.timezone})** · ${next.ethiopianTimeStr}\n• Countdown: **${remainingHuman}** (${cd.formattedAlarm})`,
        spokenText: `Your next book delivery is in ${remainingHuman}, at ${next.formattedTime12h}: ${next.conceptTitle}.`,
        data: { nextDelivery: next, countdown: cd },
      };
    }

    if (intent === 'books.current_section') {
      const books = await listBooks(userId);
      if (books.length === 0) {
        return {
          ok: true,
          action: 'books.current_section',
          message: `No books uploaded yet. Upload a PDF in Book Planner to create reading sections.`,
          spokenText: `You haven't uploaded any books yet.`,
        };
      }
      const book = books[0];
      const assignments = await listBookAssignments(userId, book.id);
      const pending = assignments.find(a => a.status !== 'completed' && a.status !== 'superseded') || assignments[0];

      if (!pending) {
        return {
          ok: true,
          action: 'books.current_section',
          message: `All sections for **${book.title}** are complete!`,
          spokenText: `You've completed all reading sections for ${book.title}!`,
        };
      }

      const concepts = pending.concepts.map(c => c.title).join(', ') || 'Core reading';
      return {
        ok: true,
        action: 'books.current_section',
        message: `📖 **Current Assigned Reading:**\n• Book: **${book.title}**\n• Section: **Day ${pending.dayNumber}** (pp. ${pending.startPdfPage}–${pending.endPdfPage})\n• Concepts: *${concepts}*\n• Scheduled: ${pending.scheduledDate} at ${pending.postingTime || book.postingTime}`,
        spokenText: `Your current reading section is Day ${pending.dayNumber} of ${book.title}, covering pages ${pending.startPdfPage} to ${pending.endPdfPage}: ${concepts}.`,
        data: { book, assignment: pending },
      };
    }

    if (intent === 'books.send_now') {
      const books = await listBooks(userId);
      if (books.length === 0) {
        return {
          ok: false,
          action: 'books.send_now',
          message: `No books available in Book Planner to send.`,
          spokenText: `No books found to send to Telegram.`,
        };
      }

      const book = books[0];
      const assignments = await listBookAssignments(userId, book.id);
      const nextPending = assignments.find(a => a.status !== 'completed' && a.status !== 'superseded');

      if (!nextPending) {
        return {
          ok: true,
          action: 'books.send_now',
          message: `All reading sections for **${book.title}** have already been delivered!`,
          spokenText: `All sections for ${book.title} have already been delivered.`,
        };
      }

      const pages = await listBookPages(userId, book.id, nextPending.startPdfPage, nextPending.endPdfPage);
      if (pages.length === 0) {
        return {
          ok: false,
          action: 'books.send_now',
          message: `Extracted pages for Day ${nextPending.dayNumber} are not available yet. Extract PDF pages in Book Planner first.`,
          spokenText: `Extracted pages for that section are not available yet.`,
        };
      }

      const previous = assignments.find(item => item.dayNumber === nextPending.dayNumber - 1);
      let deliveryResult: any;

      if (nextPending.status === 'approved' && nextPending.studyNotes) {
        const delivery = await publishApprovedAssignment(userId, book, nextPending, pages, previous);
        deliveryResult = {
          channel: 'Telegram Channel',
          bot: 'Telegram Bot',
          telegramMessageIds: delivery.telegramMessageIds,
        };
      } else {
        deliveryResult = await publishLoadPlanPagesToTelegram(userId, book, nextPending, pages, previous);
      }

      await updateBookAssignment({
        ...nextPending,
        status: 'completed',
        deliveryStatus: 'sent',
        deliveredAt: Date.now(),
        updatedAt: Date.now(),
      });

      const msgCount = deliveryResult.telegramMessageIds?.length || 1;
      return {
        ok: true,
        action: 'books.send_now',
        message: `🚀 **Delivered to Telegram!**\n• Book: **${book.title}**\n• Day ${nextPending.dayNumber} (pp. ${nextPending.startPdfPage}–${nextPending.endPdfPage})\n• Channel: **${deliveryResult.channel}**\n• Messages Sent: **${msgCount}**`,
        spokenText: `Dispatched Day ${nextPending.dayNumber} section of ${book.title} to your Telegram channel!`,
        data: { deliveryResult },
      };
    }

    if (intent === 'books.cancel') {
      return {
        ok: true,
        action: 'books.cancel',
        needsConfirmation: true,
        confirmationPrompt: 'Are you sure you want to cancel the next scheduled book delivery?',
        message: '⚠️ **Confirmation Required:** Do you want to cancel the next scheduled Telegram book delivery? Say "Yes" to confirm or "Cancel".',
        spokenText: 'Are you sure you want to cancel the next scheduled book delivery?',
      };
    }

    // ═════════════════════════════════════════════════════════════════
    // 5. BRIEFS & TELEGRAM
    // ═════════════════════════════════════════════════════════════════
    if (intent === 'briefs.read_morning') {
      const today = getLocalTodayDate();
      const content = await generateEnrichedBriefContent('morning', today, userId);
      return {
        ok: true,
        action: 'briefs.read_morning',
        message: content,
        spokenText: `Here is your morning brief for today: ${content.slice(0, 300).replace(/[#*`_~]/g, '')}...`,
        data: { content },
      };
    }

    if (intent === 'briefs.read_evening') {
      const today = getLocalTodayDate();
      const content = await generateEnrichedBriefContent('evening', today, userId);
      return {
        ok: true,
        action: 'briefs.read_evening',
        message: content,
        spokenText: `Here is your evening review for today: ${content.slice(0, 300).replace(/[#*`_~]/g, '')}...`,
        data: { content },
      };
    }

    if (intent === 'briefs.send_morning_now') {
      const res = await sendBriefNow(userId, 'morning');
      return {
        ok: true,
        action: 'briefs.send_morning_now',
        message: `🚀 **Morning Brief Delivered!** Dispatched to Telegram channel **${res.channel}**.`,
        spokenText: `Your morning brief has been sent to Telegram!`,
        data: { delivery: res },
      };
    }

    if (intent === 'briefs.send_evening_now') {
      const res = await sendBriefNow(userId, 'evening');
      return {
        ok: true,
        action: 'briefs.send_evening_now',
        message: `🚀 **Evening Review Delivered!** Dispatched to Telegram channel **${res.channel}**.`,
        spokenText: `Your evening review has been sent to Telegram!`,
        data: { delivery: res },
      };
    }

    if (intent === 'briefs.skip') {
      const briefType = params.briefType || 'evening';
      const today = getLocalTodayDate();
      const payload: any = { userId };
      if (briefType === 'morning') payload.skipNextMorningDate = today;
      else payload.skipNextEveningDate = today;

      await saveBriefConfig(payload);
      return {
        ok: true,
        action: 'briefs.skip',
        message: `⏭️ Skipped today's **${briefType === 'morning' ? 'Morning Brief' : 'Evening Review'}** (${today}). Recurring schedule remains active for tomorrow.`,
        spokenText: `Skipped today's ${briefType} brief. Regular schedule remains active for tomorrow.`,
      };
    }

    if (intent === 'telegram.status') {
      const status = await checkTelegramChannel().catch(err => ({
        configured: false,
        connected: false,
        canPost: false,
        message: err.message,
      }));

      const stateStr = status.connected && status.canPost
        ? 'Connected and authorized to post to channel'
        : 'Needs configuration or credentials check';

      return {
        ok: true,
        action: 'telegram.status',
        message: `📡 **Telegram Integration Status:**\n• Connection: **${status.connected ? 'Online' : 'Offline'}**\n• Posting Access: **${status.canPost ? 'Ready' : 'Restricted'}**\n• Status Detail: ${status.message || stateStr}`,
        spokenText: `Telegram is ${status.connected ? 'connected and ready to post' : 'currently offline or needs configuration'}.`,
        data: { status },
      };
    }

    if (intent === 'telegram.post') {
      if (!params.text) {
        return {
          ok: false,
          action: 'telegram.post',
          message: 'Please provide a message text to post to Telegram.',
          spokenText: 'What message would you like me to post to Telegram?',
        };
      }
      const res = await sendTelegramTextToChannel(params.text, userId);
      return {
        ok: true,
        action: 'telegram.post',
        message: `🚀 **Message Posted to Telegram!**\n• Channel: **${res.channel}**\n• Telegram Message ID: **${res.messageId}**\n• Text: "${params.text}"`,
        spokenText: `Posted your message to Telegram channel ${res.channel}!`,
        data: { receipt: res },
      };
    }

    // ═════════════════════════════════════════════════════════════════
    // 6. ADVISORY / CHAT FALLBACK WITH LIVE VERIFIED CONTEXT
    // ═════════════════════════════════════════════════════════════════
    const prompt = params.prompt || parsed.rawText;
    const date = getLocalTodayDate();
    const tasks = await getTasksFromDb(date);
    const remainingTasks = tasks.filter(t => !t.isCompleted);
    const books = await listBooks(userId);

    const contextSummary = `Verified NightPlanner state as of ${date}:
- Remaining tasks today (${remainingTasks.length}): ${remainingTasks.slice(0, 5).map(t => t.title).join(', ') || 'None'}
- Active books (${books.length}): ${books.map(b => b.title).join(', ') || 'None'}
User asks via voice: "${prompt}"`;

    const aiRes = await sendChatCompletionWithFallback({
      messages: [
        {
          role: 'system',
          content: `You are Sami, the voice command AI assistant for NightPlanner. Respond directly and concisely to Sam. Keep voice answers under 3 sentences unless explaining a complex question. Real context:\n${contextSummary}`,
        },
        { role: 'user', content: prompt },
      ],
      model: 'auto',
      temperature: 0.7,
    });

    const reply = String(aiRes.content || "I'm ready for your next command.");
    return {
      ok: true,
      action: 'assistant.chat',
      message: reply,
      spokenText: reply.slice(0, 300).replace(/[#*`_~]/g, ''),
      data: { model: aiRes.model },
    };
  } catch (err: any) {
    console.error('[VoiceAssistantService] Execution error:', err);
    return {
      ok: false,
      action: parsed.intent,
      message: `Error executing command: ${err.message || 'Internal failure'}`,
      spokenText: `Sorry Sam, I encountered an issue: ${err.message || 'unknown error'}`,
    };
  }
}
