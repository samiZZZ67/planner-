/**
 * NightPlanner Voice Intent Parser
 *
 * Maps natural language spoken instructions to typed application operations.
 * Resolves conversational context, parameters, and confirmation states.
 */

export type VoiceIntentType =
  // Tasks
  | 'tasks.query'
  | 'tasks.create'
  | 'tasks.complete'
  | 'tasks.uncomplete'
  | 'tasks.delete'
  | 'tasks.reschedule'
  | 'tasks.budget'
  | 'tasks.generate_plan'
  // Books & PDF
  | 'books.next_delivery'
  | 'books.current_section'
  | 'books.send_now'
  | 'books.reschedule'
  | 'books.cancel'
  // Briefs & Telegram
  | 'briefs.read_morning'
  | 'briefs.read_evening'
  | 'briefs.send_morning_now'
  | 'briefs.send_evening_now'
  | 'briefs.skip'
  | 'briefs.reschedule'
  | 'telegram.status'
  | 'telegram.post'
  // Navigation
  | 'navigation.tab'
  // Assistant Control
  | 'assistant.stop_speaking'
  | 'assistant.cancel'
  | 'assistant.confirm'
  | 'assistant.reject'
  // Conversational / Open-ended fallback
  | 'assistant.chat';

export interface PendingConfirmation {
  intent: VoiceIntentType;
  targetId?: string;
  targetTitle?: string;
  details?: Record<string, any>;
  expiresAt: number;
}

export interface VoiceContext {
  lastReferencedTaskId?: string;
  lastReferencedTaskTitle?: string;
  lastReferencedBookId?: string;
  lastReferencedBookTitle?: string;
  pendingConfirmation?: PendingConfirmation | null;
  currentDate?: string;
  timezone?: string;
}

export interface ParsedVoiceIntent {
  intent: VoiceIntentType;
  params: Record<string, any>;
  confidence: number;
  rawText: string;
  requiresConfirmation?: boolean;
  confirmationPrompt?: string;
  navigationTab?: string;
}

/**
 * Normalizes user speech for keyword and pattern extraction.
 */
function clean(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses natural duration strings into minutes.
 * e.g. "for two hours" -> 120, "for 30 minutes" -> 30, "for 1 hour and 30 minutes" -> 90
 */
export function parseDurationMinutes(text: string): number | null {
  const hourMatch = /(\d+|one|two|three|four|five|six|seven|eight)\s*(?:hour|hours|hr|hrs)/i.exec(text);
  const minMatch = /(\d+)\s*(?:minute|minutes|min|mins)/i.exec(text);

  const wordToNum: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  };

  let totalMinutes = 0;
  let found = false;

  if (hourMatch) {
    const rawH = hourMatch[1].toLowerCase();
    const h = wordToNum[rawH] !== undefined ? wordToNum[rawH] : Number(rawH);
    if (!isNaN(h)) {
      totalMinutes += h * 60;
      found = true;
    }
  }

  if (minMatch) {
    const m = Number(minMatch[1]);
    if (!isNaN(m)) {
      totalMinutes += m;
      found = true;
    }
  }

  return found ? totalMinutes : null;
}

/**
 * Parses natural time of day into HH:mm (24-hour).
 * e.g. "3 in the afternoon" -> "15:00", "at 8:30 am" -> "08:30", "at 8 pm" -> "20:00"
 */
export function parseNaturalTime(text: string): string | null {
  // e.g. "3 in the afternoon" or "three in the afternoon"
  const afternoonWordMatch = /\b(?:at\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven)\s*(?:in\s+the\s+afternoon|in\s+the\s+evening|pm)\b/i.exec(text);
  if (afternoonWordMatch) {
    const words: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
    };
    const val = words[afternoonWordMatch[1].toLowerCase()] || Number(afternoonWordMatch[1]);
    if (!isNaN(val)) {
      const h = val < 12 ? val + 12 : val;
      return `${String(h).padStart(2, '0')}:00`;
    }
  }

  // e.g. "8:30 am" or "8:00 pm" or "8 pm" or "08:00"
  const standardMatch = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  if (standardMatch && (standardMatch[3] || standardMatch[2])) {
    let h = Number(standardMatch[1]);
    const m = Number(standardMatch[2] || 0);
    const meridiem = (standardMatch[3] || '').toLowerCase();
    if (meridiem === 'pm' && h < 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return null;
}

/**
 * Parses target date from speech: "tomorrow", "today", "yesterday", or YYYY-MM-DD.
 */
export function parseNaturalDate(text: string, baseDate?: string): string {
  const todayStr = baseDate || new Date().toISOString().split('T')[0];
  if (/\btomorrow\b/i.test(text)) {
    const d = new Date(todayStr);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }
  if (/\byesterday\b/i.test(text)) {
    const d = new Date(todayStr);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }
  const isoMatch = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (isoMatch) return isoMatch[1];
  return todayStr;
}

/**
 * Main Intent Parsing Engine
 */
export function parseVoiceIntent(rawTranscript: string, context: VoiceContext = {}): ParsedVoiceIntent {
  const text = rawTranscript.trim();
  const c = clean(text);

  // 1. Pending Confirmation Resolution (highest priority)
  if (context.pendingConfirmation && Date.now() < context.pendingConfirmation.expiresAt) {
    if (/^(?:yes|yep|yeah|confirm|do it|sure|proceed|ok|okay|please do|delete it|yes delete)$/i.test(c)) {
      return {
        intent: 'assistant.confirm',
        params: {
          confirmedIntent: context.pendingConfirmation.intent,
          targetId: context.pendingConfirmation.targetId,
          targetTitle: context.pendingConfirmation.targetTitle,
          details: context.pendingConfirmation.details,
        },
        confidence: 1.0,
        rawText: text,
      };
    }
    if (/^(?:no|nope|cancel|stop|don'?t|never mind|abort|leave it)$/i.test(c)) {
      return {
        intent: 'assistant.reject',
        params: {
          rejectedIntent: context.pendingConfirmation.intent,
          targetId: context.pendingConfirmation.targetId,
        },
        confidence: 1.0,
        rawText: text,
      };
    }
  }

  // 2. Immediate Assistant Control
  if (/^(?:stop speaking|stop talking|be quiet|shut up|mute voice|pause speaking)$/i.test(c)) {
    return { intent: 'assistant.stop_speaking', params: {}, confidence: 1.0, rawText: text };
  }
  if (/^(?:cancel|never mind|stop|go back to listening)$/i.test(c)) {
    return { intent: 'assistant.cancel', params: {}, confidence: 1.0, rawText: text };
  }

  // 3. Navigation Commands
  if (/\b(?:open|go to|navigate to|show|view)\b.{0,30}\b(?:book|books|book planner|reading planner)\b/i.test(c)) {
    return { intent: 'navigation.tab', params: { tab: 'books' }, navigationTab: 'books', confidence: 0.95, rawText: text };
  }
  if (/\b(?:open|go to|navigate to|show|view)\b.{0,30}\b(?:note|notes|journal|reflection)\b/i.test(c)) {
    return { intent: 'navigation.tab', params: { tab: 'note' }, navigationTab: 'note', confidence: 0.95, rawText: text };
  }
  if (/\b(?:open|go to|navigate to|show|view)\b.{0,30}\b(?:analytics|stats|statistics|progress|graphs?)\b/i.test(c)) {
    return { intent: 'navigation.tab', params: { tab: 'analytics' }, navigationTab: 'analytics', confidence: 0.95, rawText: text };
  }
  if (/\b(?:open|go to|navigate to|show|view)\b.{0,30}\b(?:settings|preferences|config)\b/i.test(c)) {
    return { intent: 'navigation.tab', params: { tab: 'settings' }, navigationTab: 'settings', confidence: 0.95, rawText: text };
  }
  if (/\b(?:open|go to|navigate to|show|view)\b.{0,30}\b(?:todo|tasks|task list|dashboard)\b/i.test(c)) {
    return { intent: 'navigation.tab', params: { tab: 'todo' }, navigationTab: 'todo', confidence: 0.95, rawText: text };
  }
  if (/\b(?:open|go to|navigate to|show|view)\b.{0,30}\b(?:weekly|week view|weekly plan)\b/i.test(c)) {
    return { intent: 'navigation.tab', params: { tab: 'weekly' }, navigationTab: 'weekly', confidence: 0.95, rawText: text };
  }
  if (/\b(?:open|go to|navigate to|show|view)\b.{0,30}\b(?:monthly|month view|monthly plan)\b/i.test(c)) {
    return { intent: 'navigation.tab', params: { tab: 'monthly' }, navigationTab: 'monthly', confidence: 0.95, rawText: text };
  }

  // 4. Briefs & Morning / Evening Delivery
  // "Send morning brief now"
  if (/\b(?:send|post|dispatch|deliver)\b.{0,30}\bmorning brief\b.{0,30}\b(?:now|immediately|telegram)\b/i.test(c) ||
      /\bsend\s+(?:my\s+)?morning\s+brief\b/i.test(c)) {
    return { intent: 'briefs.send_morning_now', params: {}, confidence: 0.95, rawText: text };
  }
  // "Send evening brief now"
  if (/\b(?:send|post|dispatch|deliver)\b.{0,30}\bevening (?:brief|review)\b.{0,30}\b(?:now|immediately|telegram)\b/i.test(c) ||
      /\bsend\s+(?:my\s+)?evening\s+(?:brief|review)\b/i.test(c)) {
    return { intent: 'briefs.send_evening_now', params: {}, confidence: 0.95, rawText: text };
  }
  // "Give me my morning brief" / "Read my morning brief"
  if (/\b(?:give me|read|what is in|show|tell me)\b.{0,20}\bmorning brief\b/i.test(c) ||
      c === 'morning brief') {
    return { intent: 'briefs.read_morning', params: {}, confidence: 0.95, rawText: text };
  }
  // "What is scheduled for this evening?" / "Read evening review"
  if (/\b(?:what is|what's|show|read|tell me)\b.{0,30}\b(?:scheduled for this evening|evening brief|evening review)\b/i.test(c)) {
    return { intent: 'briefs.read_evening', params: {}, confidence: 0.95, rawText: text };
  }
  // "Skip today's evening brief" / "Skip morning brief"
  if (/\bskip\b.{0,20}\b(morning|evening)\b.{0,20}\bbrief\b/i.test(c)) {
    const briefType = /\bmorning\b/i.test(c) ? 'morning' : 'evening';
    return { intent: 'briefs.skip', params: { briefType }, confidence: 0.95, rawText: text };
  }
  // "Change my evening brief time to 9 PM"
  if (/\b(?:change|reschedule|move|set)\b.{0,30}\b(morning|evening)\b.{0,20}\btime\b/i.test(c)) {
    const briefType = /\bmorning\b/i.test(c) ? 'morning' : 'evening';
    const parsedTime = parseNaturalTime(text) || '20:00';
    return { intent: 'briefs.reschedule', params: { briefType, time: parsedTime }, confidence: 0.9, rawText: text };
  }

  // 5. Telegram Integration Inquiries & Direct Post
  // "Show me whether the last Telegram message was delivered" / "Telegram status"
  if (/\b(?:show me|check|verify|is|status)\b.{0,40}\btelegram\b.{0,30}\b(?:delivered|connected|working|sent|message)\b/i.test(c)) {
    return { intent: 'telegram.status', params: {}, confidence: 0.9, rawText: text };
  }
  // Direct post: "Post to Telegram: hello world"
  const directPostMatch = /^(?:please\s+)?(?:post|send)\s+(?:a\s+message\s+)?to\s+telegram\s*[:\-]\s*(.+)$/i.exec(text);
  if (directPostMatch && directPostMatch[1]) {
    return { intent: 'telegram.post', params: { text: directPostMatch[1].trim() }, confidence: 0.95, rawText: text };
  }

  // 6. Book Reading & Delivery Scheduler
  // "How much time is left before the next book section is sent?" / "When is the next book delivery?"
  if (/\b(?:how much time|when is|what time is|remaining time|countdown)\b.{0,40}\b(?:next book|book delivery|book section|reading delivery)\b/i.test(c) ||
      /\bnext book delivery\b/i.test(c)) {
    return { intent: 'books.next_delivery', params: {}, confidence: 0.95, rawText: text };
  }
  // "What is my assigned reading section today?" / "Explain the current assigned section"
  if (/\b(?:what is|explain|show)\b.{0,30}\b(?:assigned reading|current assigned section|book chapter|reading section)\b/i.test(c)) {
    return { intent: 'books.current_section', params: {}, confidence: 0.9, rawText: text };
  }
  // "Post the next assigned book section to Telegram now" / "Send current book section to Telegram"
  if (/\b(?:post|send|dispatch|publish)\b.{0,40}\b(?:next|current|assigned)?\s*(?:book section|reading section|extracted pages|load plan)\b.{0,30}\btelegram\b/i.test(c) ||
      /\bsend (?:the )?(?:current )?book section to telegram\b/i.test(c)) {
    return { intent: 'books.send_now', params: {}, confidence: 0.95, rawText: text };
  }
  // "Cancel the next scheduled book delivery" -> Destructive action, requires confirmation!
  if (/\bcancel\b.{0,30}\b(?:next scheduled book delivery|next book delivery|book publishing)\b/i.test(c)) {
    return {
      intent: 'books.cancel',
      params: {},
      requiresConfirmation: true,
      confirmationPrompt: 'Are you sure you want to cancel the next scheduled book delivery?',
      confidence: 0.95,
      rawText: text,
    };
  }
  // "Reschedule the next section for 8 PM East Africa Time"
  if (/\breschedule\b.{0,30}\b(?:book|section|delivery)\b/i.test(c)) {
    const time = parseNaturalTime(text) || '20:00';
    const date = parseNaturalDate(text);
    return { intent: 'books.reschedule', params: { time, date }, confidence: 0.9, rawText: text };
  }

  // 7. Tasks & Daily Planning Operations
  // Available budget / remaining time explanation
  if (/\b(?:explain|how much)\b.{0,30}\b(?:available time|remaining daily budget|budget left|free time|focus hours)\b/i.test(c) ||
      c === 'remaining budget') {
    return { intent: 'tasks.budget', params: { date: parseNaturalDate(text) }, confidence: 0.95, rawText: text };
  }
  // Generate daily plan
  if (/\b(?:generate|create|regenerate|build)\b.{0,30}\b(?:daily plan|day plan|schedule for today|plan for today)\b/i.test(c)) {
    return { intent: 'tasks.generate_plan', params: { date: parseNaturalDate(text) }, confidence: 0.9, rawText: text };
  }
  // Query tasks: "What do I have left to finish today?" / "What are my tasks?" / "Check completed tasks"
  if (/\b(?:what do i have left|remaining tasks|tasks remaining|tasks left|what are my tasks|show my tasks|what tasks)\b/i.test(c)) {
    let filter: 'all' | 'remaining' | 'completed' | 'overdue' = 'remaining';
    if (/\bcompleted\b/i.test(c)) filter = 'completed';
    else if (/\boverdue\b/i.test(c)) filter = 'overdue';
    else if (/\ball\b/i.test(c)) filter = 'all';

    return {
      intent: 'tasks.query',
      params: { filter, date: parseNaturalDate(text) },
      confidence: 0.95,
      rawText: text,
    };
  }

  // Delete task: "Delete the task named Watch tutorials" or "Delete that task"
  if (/\b(?:delete|remove|erase)\b.{0,20}\btask\b/i.test(c)) {
    let taskName = '';
    const namedMatch = /\b(?:delete|remove)\s+(?:the\s+)?task\s+(?:named|called)\s+(.+)$/i.exec(text);
    const simpleMatch = /\b(?:delete|remove)\s+(?:the\s+)?task\s+(.+)$/i.exec(text);

    if (namedMatch && namedMatch[1]) {
      taskName = namedMatch[1].trim();
    } else if (simpleMatch && simpleMatch[1]) {
      taskName = simpleMatch[1].trim();
    } else if (/\b(?:that|this|it)\b/i.test(c) && context.lastReferencedTaskTitle) {
      taskName = context.lastReferencedTaskTitle;
    }

    if (taskName) {
      return {
        intent: 'tasks.delete',
        params: { taskQuery: taskName, taskId: context.lastReferencedTaskId },
        requiresConfirmation: true,
        confirmationPrompt: `I found "${taskName}". Do you want me to delete it?`,
        confidence: 0.95,
        rawText: text,
      };
    }
  }

  // Complete task: "Mark my editing task as complete" / "Finish task Record podcast"
  if (/\b(?:mark|finish|complete|check off)\b.{0,30}\b(?:complete|done|finished)\b/i.test(c) ||
      /\bfinish\s+task\b/i.test(c)) {
    let taskName = '';
    const markMatch = /\b(?:mark|check off)\s+(?:my\s+|the\s+)?(?:current\s+)?(.+?)\s+(?:as\s+)?(?:complete|done|finished)\b/i.exec(text);
    const finishMatch = /\bfinish\s+(?:task\s+)?(.+)$/i.exec(text);

    if (markMatch && markMatch[1]) {
      taskName = markMatch[1].replace(/\btask\b/i, '').trim();
    } else if (finishMatch && finishMatch[1]) {
      taskName = finishMatch[1].trim();
    } else if (context.lastReferencedTaskTitle) {
      taskName = context.lastReferencedTaskTitle;
    }

    return {
      intent: 'tasks.complete',
      params: { taskQuery: taskName, taskId: context.lastReferencedTaskId },
      confidence: 0.9,
      rawText: text,
    };
  }

  // Uncomplete task
  if (/\b(?:uncomplete|mark incomplete|mark as not done)\b/i.test(c)) {
    let taskName = '';
    const match = /\b(?:uncomplete|mark incomplete)\s+(?:task\s+)?(.+)$/i.exec(text);
    if (match && match[1]) taskName = match[1].trim();
    else if (context.lastReferencedTaskTitle) taskName = context.lastReferencedTaskTitle;

    return {
      intent: 'tasks.uncomplete',
      params: { taskQuery: taskName, taskId: context.lastReferencedTaskId },
      confidence: 0.9,
      rawText: text,
    };
  }

  // Reschedule / Move task: "Move my deep-work session to three in the afternoon"
  if (/\b(?:move|reschedule|shift)\b.{0,30}\b(?:to|at)\b.{0,20}\b(?:\d+|pm|am|tomorrow|afternoon|morning)\b/i.test(c)) {
    const moveMatch = /\b(?:move|reschedule|shift)\s+(?:my\s+|the\s+)?(.+?)\s+(?:session|task)?\s+to\s+(.+)$/i.exec(text);
    const taskName = moveMatch && moveMatch[1] ? moveMatch[1].replace(/\btask\b/i, '').trim() : (context.lastReferencedTaskTitle || '');
    const time = parseNaturalTime(text);
    const date = parseNaturalDate(text);

    return {
      intent: 'tasks.reschedule',
      params: { taskQuery: taskName, newTime: time, newDate: date, taskId: context.lastReferencedTaskId },
      confidence: 0.9,
      rawText: text,
    };
  }

  // Create task: "Create a task called Edit my next Short for 2 hours this afternoon"
  if (/\b(?:create|add|new)\s+(?:a\s+)?task\b/i.test(c) ||
      /\badd\s+task\b/i.test(c)) {
    let title = '';
    const calledMatch = /\b(?:create|add|new)\s+(?:a\s+)?task\s+(?:called|named)\s+(.+?)(?:\s+for|\s+at|\s+with|\s+under|\s+this|\s*$)/i.exec(text);
    const simpleCreateMatch = /\b(?:create|add|new)\s+(?:a\s+)?task\s+(.+?)(?:\s+for|\s+at|\s+with|\s+under|\s+this|\s*$)/i.exec(text);

    if (calledMatch && calledMatch[1]) {
      title = calledMatch[1].trim();
    } else if (simpleCreateMatch && simpleCreateMatch[1]) {
      title = simpleCreateMatch[1].trim();
    }

    const durationMinutes = parseDurationMinutes(text) || 60;
    const startTime = parseNaturalTime(text);
    const date = parseNaturalDate(text);
    const isHigh = /\bhigh priority\b/i.test(c);
    const isLow = /\blow priority\b/i.test(c);
    const priority = isHigh ? 'High' : isLow ? 'Low' : 'Medium';
    const mustDo = /\bmust do|must-do|critical\b/i.test(c);

    // Category / Section extraction
    let category: string | undefined;
    const catMatch = /\b(?:in|under|category)\s+([a-zA-Z\s]+?)(?:\s+category|\s+section|\s*$)/i.exec(text);
    if (catMatch && catMatch[1]) {
      category = catMatch[1].trim();
    }

    return {
      intent: 'tasks.create',
      params: {
        title: title || 'New Spoken Task',
        scheduledMinutes: durationMinutes,
        startTime: startTime || undefined,
        date,
        priority,
        mustDo,
        category,
      },
      confidence: 0.95,
      rawText: text,
    };
  }

  // 8. Open-ended conversational query fallback
  return {
    intent: 'assistant.chat',
    params: { prompt: text },
    confidence: 0.5,
    rawText: text,
  };
}
