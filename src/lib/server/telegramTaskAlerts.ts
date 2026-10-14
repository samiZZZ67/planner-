import { getTasksFromDb, getSectionsFromDb } from './tasks';
import { getLocalDb } from './localDb';
import { checkTelegramChannel, sendTelegramTextToChannel, isTelegramConfigured } from './telegram';
import { formatTelegramMessage } from './telegramFormatter';
import type { Task, Section, Day } from '@/types';

export interface TelegramTaskAlertResult {
  ok: boolean;
  action: 'morning_briefing' | 'evening_review' | 'task_reminder' | 'test_alert';
  messageId?: number;
  channel?: string;
  preview: string;
  error?: string;
}

/**
 * Format total minutes into a human-readable duration string (e.g. "2h 30m" or "45m")
 */
function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hrs = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hrs}h ${remainingMins}m` : `${hrs}h`;
}

/**
 * Generate formatted Morning Briefing Telegram message for today's plan
 */
export async function generateMorningBriefingText(date: string, userId = 'owner'): Promise<string> {
  const [tasks, sections] = await Promise.all([
    getTasksFromDb(date),
    getSectionsFromDb(),
  ]);

  const localDb = getLocalDb();
  const dayRecord = localDb.days[date] as Day | undefined;
  const focusBudgetHours = dayRecord?.freeHours ?? 8;

  const dateObj = new Date(date + 'T00:00:00Z');
  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  const activeTasks = tasks.filter(t => !t.deleted);
  const mustDoTasks = activeTasks.filter(t => t.mustDo);
  const standardTasks = activeTasks.filter(t => !t.mustDo);

  const totalPlannedMins = activeTasks.reduce((acc, t) => acc + (t.scheduledMinutes || t.estimatedMinutes || 60), 0);
  const totalPlannedHours = Math.round((totalPlannedMins / 60) * 10) / 10;
  const isOverBudget = totalPlannedHours > focusBudgetHours;

  const lines: string[] = [];
  lines.push(`🌅 <b>NightPlanner Daily Briefing</b>`);
  lines.push(`📅 <b>${dayName}, ${formattedDate}</b>`);
  lines.push(`⏱ Focus Budget: <b>${focusBudgetHours}h</b> | Planned: <b>${totalPlannedHours}h</b>${isOverBudget ? ' ⚠️ (Over Budget)' : ' ✅'}`);
  lines.push('');

  if (mustDoTasks.length > 0) {
    lines.push(`🎯 <b>Top Goals & Must-Dos:</b>`);
    mustDoTasks.forEach((t, i) => {
      const duration = formatMinutes(t.scheduledMinutes || t.estimatedMinutes || 60);
      const timeStr = t.startTime ? ` [${t.startTime}${t.endTime ? `–${t.endTime}` : ''}]` : '';
      lines.push(`${i + 1}. <b>${t.title}</b>${timeStr} (${duration})`);
    });
    lines.push('');
  }

  if (standardTasks.length > 0) {
    lines.push(`📋 <b>Scheduled Focus Tasks (${standardTasks.length}):</b>`);
    standardTasks.forEach(t => {
      const sec = sections.find(s => s.id === t.sectionId);
      const secLabel = sec ? `[${sec.name}] ` : '';
      const timeStr = t.startTime ? `${t.startTime}: ` : '• ';
      const duration = formatMinutes(t.scheduledMinutes || t.estimatedMinutes || 60);
      lines.push(`${timeStr}${secLabel}${t.title} (${duration})`);
    });
    lines.push('');
  }

  if (activeTasks.length === 0) {
    lines.push(`🏖 <i>No tasks currently scheduled for today. Have a restful deep work day or add tasks in NightPlanner!</i>`);
    lines.push('');
  }

  lines.push(`🚀 <i>Make today count. Open NightPlanner to begin deep work.</i>`);
  return lines.join('\n');
}

/**
 * Generate formatted Evening Review Telegram message summarizing completed work
 */
export async function generateEveningReviewText(date: string, userId = 'owner'): Promise<string> {
  const tasks = await getTasksFromDb(date);
  const activeTasks = tasks.filter(t => !t.deleted);
  const completedTasks = activeTasks.filter(t => t.isCompleted);
  const remainingTasks = activeTasks.filter(t => !t.isCompleted);

  const localDb = getLocalDb();
  const dayRecord = localDb.days[date] as Day | undefined;

  const dateObj = new Date(date + 'T00:00:00Z');
  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  const totalTasks = activeTasks.length;
  const pct = totalTasks > 0 ? Math.round((completedTasks.length / totalTasks) * 100) : 100;

  const lines: string[] = [];
  lines.push(`🌙 <b>NightPlanner Evening Review</b>`);
  lines.push(`📅 <b>${dayName}, ${formattedDate}</b>`);
  lines.push(`📊 Completion: <b>${pct}%</b> (${completedTasks.length}/${totalTasks} tasks completed)`);
  lines.push('');

  if (completedTasks.length > 0) {
    lines.push(`✅ <b>Completed Today:</b>`);
    completedTasks.forEach(t => {
      lines.push(`• <s>${t.title}</s>`);
    });
    lines.push('');
  }

  if (remainingTasks.length > 0) {
    lines.push(`⏳ <b>Carried Forward / Incomplete (${remainingTasks.length}):</b>`);
    remainingTasks.forEach(t => {
      lines.push(`• ${t.title}`);
    });
    lines.push(`<i>These can be rolled over to tomorrow with 1-click in NightPlanner.</i>`);
    lines.push('');
  }

  if (dayRecord?.review?.worked) {
    lines.push(`💡 <b>Today's Reflection:</b>`);
    lines.push(`"${dayRecord.review.worked}"`);
    lines.push('');
  }

  if (pct >= 80) {
    lines.push(`⭐ <b>Outstanding work today! Rest well and recharge for tomorrow.</b>`);
  } else {
    lines.push(`💪 <b>Great effort. Tomorrow brings a fresh start and new focus.</b>`);
  }

  return lines.join('\n');
}

/**
 * Generate task reminder text
 */
export function generateTaskReminderText(task: Task): string {
  const time = task.startTime ? ` at ${task.startTime}` : '';
  const duration = formatMinutes(task.scheduledMinutes || task.estimatedMinutes || 60);

  return [
    `⏰ <b>Upcoming Task Reminder</b>`,
    `Task: <b>${task.title}</b>`,
    `Scheduled: <b>${task.date}${time}</b> (${duration})`,
    task.priority === 'High' ? `🔥 <b>High Priority Must-Do</b>` : '',
    task.description ? `\n<i>${task.description}</i>` : '',
    `\n🎯 <i>Prepare your focus space and open NightPlanner to start the timer.</i>`,
  ].filter(Boolean).join('\n');
}

/**
 * Dispatch task alert to Telegram
 */
export async function sendTelegramTaskAlert(
  action: 'morning_briefing' | 'evening_review' | 'task_reminder' | 'test_alert',
  options: { date?: string; taskId?: string; userId?: string } = {}
): Promise<TelegramTaskAlertResult> {
  const userId = options.userId || 'owner';
  const targetDate = options.date || new Date().toISOString().split('T')[0];

  let rawContent = '';

  if (action === 'morning_briefing') {
    rawContent = await generateMorningBriefingText(targetDate, userId);
  } else if (action === 'evening_review') {
    rawContent = await generateEveningReviewText(targetDate, userId);
  } else if (action === 'task_reminder') {
    const tasks = await getTasksFromDb(targetDate);
    const targetTask = options.taskId ? tasks.find(t => t.id === options.taskId) : tasks[0];
    if (!targetTask) {
      throw new Error(`No task found on ${targetDate} to send reminder for.`);
    }
    rawContent = generateTaskReminderText(targetTask);
  } else {
    // test_alert
    rawContent = [
      `🧪 <b>NightPlanner Telegram Alert Test</b>`,
      `Your Telegram bot integration is active, authenticated, and ready to send daily task briefings and reminders!`,
      `📅 Current Date: <b>${targetDate}</b>`,
      `🤖 Powered by NightPlanner Scheduler Engine.`,
    ].join('\n');
  }

  try {
    const res = await sendTelegramTextToChannel(rawContent, userId);
    return {
      ok: true,
      action,
      messageId: res.messageId,
      channel: res.channel,
      preview: rawContent,
    };
  } catch (err: any) {
    return {
      ok: false,
      action,
      preview: rawContent,
      error: err?.message || 'Failed to dispatch Telegram alert.',
    };
  }
}
