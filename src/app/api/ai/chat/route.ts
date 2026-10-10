import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/server/auth';
import { executeAIRequestWithFallback } from '@/lib/server/ai/providers';
import {
  extractActionsAndCleanText,
  handleFallbackNaturalLanguage,
  type AIChatAction,
} from '@/lib/server/ai/copilot';
import { createTaskInDb, updateTaskInDb } from '@/lib/server/tasks';

export type { AIChatAction };

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

function resolveDateString(dateInput: string | undefined, baseDate: string): string {
  if (!dateInput) return baseDate;
  const lower = dateInput.trim().toLowerCase();
  if (lower === 'today') return baseDate;
  if (lower === 'tomorrow') {
    const [y, m, d] = baseDate.split('-').map(Number);
    const dObj = new Date(Date.UTC(y, m - 1, d + 1));
    return dObj.toISOString().split('T')[0];
  }
  if (lower === 'yesterday') {
    const [y, m, d] = baseDate.split('-').map(Number);
    const dObj = new Date(Date.UTC(y, m - 1, d - 1));
    return dObj.toISOString().split('T')[0];
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
    return lower;
  }
  return baseDate;
}

/**
 * Execute validated actions directly on the database before responding to client
 * Prevents false claims and verifies database persistence.
 */
async function executeServerActions(
  actions: AIChatAction[],
  context: any
): Promise<{ executedActions: AIChatAction[]; verifiedFeedback: string | null; errorFeedback: string | null }> {
  let verifiedFeedback: string | null = null;
  let errorFeedback: string | null = null;
  const targetDate = context?.currentDate || new Date().toISOString().split('T')[0];

  for (const act of actions) {
    if (act.type === 'create_task') {
      const p = act.params || {};
      const createInput = {
        title: p.title,
        category: p.section || p.category,
        sectionId: p.sectionId,
        date: resolveDateString(p.date, targetDate),
        startTime: p.startTime,
        endTime: p.endTime,
        scheduledMinutes: p.scheduledMinutes,
        priority: p.priority || 'Medium',
        deadline: p.deadline,
        mustDo: Boolean(p.mustDo),
        description: p.description,
      };

      console.log('[AI Chat Backend] Executing create_task on database:', createInput.title);
      const res = await createTaskInDb(createInput);

      if (res.ok && res.task) {
        act.status = 'executed';
        act.savedTask = res.task;
        act.confirmation = `Created task "${res.task.title}" (ID: ${res.task.id}) in ${createInput.category || 'Tasks'}`;

        if (res.duplicatePrevented) {
          verifiedFeedback = `Task **"${res.task.title}"** already exists in your to-do list for ${res.task.date} (ID: \`${res.task.id}\`). Duplicate creation was safely prevented.`;
        } else {
          verifiedFeedback = `I have created and saved the task **"${res.task.title}"** to your database under **${createInput.category || 'Deep Work'}** for ${res.task.date}.\n- **Duration:** ${res.task.scheduledMinutes} minutes\n- **Start/End:** ${res.task.startTime || 'Unscheduled'} – ${res.task.endTime || 'Unscheduled'}\n- **Priority:** ${res.task.priority}\n- **Database ID:** \`${res.task.id}\``;
        }
      } else {
        act.status = 'failed';
        act.error = res.error;
        errorFeedback = `❌ Failed to create task "${createInput.title}": ${res.error}. No task was added to your database.`;
      }
    } else if (act.type === 'update_task' && !act.requiresConfirmation) {
      const res = await updateTaskInDb(act.params.taskIdentifier, act.params.updates || {}, act.params.date);
      if (res.ok && res.task) {
        act.status = 'executed';
        act.savedTask = res.task;
        verifiedFeedback = `Successfully updated task **"${res.task.title}"** (ID: \`${res.task.id}\`).`;
      } else {
        act.status = 'failed';
        act.error = res.error;
        errorFeedback = `❌ Could not update task: ${res.error}`;
      }
    } else if (act.type === 'delete_task') {
      act.status = 'pending';
      act.requiresConfirmation = true;
    }
  }

  return { executedActions: actions, verifiedFeedback, errorFeedback };
}

export async function POST(req: NextRequest) {
  try {
    const isAuth = await verifySession(req);
    if (!isAuth) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in with your app password to use the AI assistant.' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const {
      messages = [] as ChatMessage[],
      action = 'chat',
      currentPlanContext = null,
      context = null,
      preferredProvider,
    } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages are required' }, { status: 400 });
    }

    const mergedContext = context || currentPlanContext;
    const latestUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    // Build system instructions for Full Authorized Copilot
    const systemInstruction = `You are NightPlanner's elite AI Assistant and Authorized Website Copilot.
You have FULL authorized access to view, analyze, and manage the user's planner data:
- Tasks (titles, categories, times, priorities, statuses, deadlines, completion)
- Categories / Sections
- Daily Focus Budget & Time Logs
- Weekly and Monthly Plans & Deliverables
- Active Pomodoro / Focus Timer

RULES FOR ANSWERING QUESTIONS:
1. Always base answers strictly on the LIVE DATA CONTEXT provided below. Never invent or hallucinate tasks.
2. If the user asks:
   - "What is my current task?": Check activeTimer first. If timer is running, state that task and elapsed time. If not running, state the first incomplete task scheduled for today.
   - "How many tasks are left?": Count the incomplete tasks for today and list their names and durations.
   - "What did I complete today?": List all completed tasks for today.
   - "How is my progress?": Give completion percentage (completed / total), focus minutes logged, and budget balance.

RULES FOR ACTIONS (MANAGING THE WEBSITE):
When the user instructs you to create, update, reschedule, delete tasks, create categories, or adjust focus budget, output an ACTIONS block at the VERY END of your response.
Schema for ACTIONS:
ACTIONS:
[
  {
    "action": "create_task",
    "params": {
      "title": "Exact task title",
      "section": "Category name (e.g. Deep Work, Learning, etc.)",
      "date": "YYYY-MM-DD or today or tomorrow",
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "scheduledMinutes": 60,
      "priority": "Low | Medium | High",
      "deadline": "YYYY-MM-DD",
      "mustDo": false,
      "description": ""
    }
  },
  {
    "action": "update_task",
    "params": {
      "taskIdentifier": "title search query or task ID",
      "updates": {
        "isCompleted": true,
        "status": "completed",
        "date": "YYYY-MM-DD",
        "scheduledMinutes": 90,
        "priority": "High"
      }
    }
  },
  {
    "action": "delete_task",
    "params": {
      "taskIdentifier": "title search query or task ID",
      "taskTitle": "Exact task title",
      "requiresConfirmation": true
    }
  }
]

SAFETY & INTEGRITY RULES:
- The backend will immediately execute the ACTIONS block in the database upon receiving your response.
- Do not invent fake task IDs.
- For destructive deletions, set "requiresConfirmation": true.`;

    // Construct the prompt string with live context
    let conversationPrompt = '';

    if (mergedContext) {
      conversationPrompt += `[LIVE WEBSITE DATA CONTEXT]\n`;
      conversationPrompt += `Current Date: ${mergedContext.currentDate || mergedContext.date}\n`;
      conversationPrompt += `Daily Focus Budget: ${mergedContext.focusBudgetHours || mergedContext.dayRecord?.freeHours || 8} hours\n`;

      if (mergedContext.activeTimer) {
        conversationPrompt += `Active Timer: Task "${mergedContext.activeTimer.taskTitle}" (Running: ${mergedContext.activeTimer.isRunning}, Elapsed: ${Math.floor((mergedContext.activeTimer.accumulatedMs || 0) / 60000)}m)\n`;
      } else {
        conversationPrompt += `Active Timer: None running\n`;
      }

      if (mergedContext.weeklyPlan) {
        conversationPrompt += `Active Weekly Plan: Goals: "${mergedContext.weeklyPlan.goals || ''}", AASTU: "${mergedContext.weeklyPlan.aastuCommitments || ''}", Deep Work: "${mergedContext.weeklyPlan.deepWorkTargets || ''}"\n`;
      }
      if (mergedContext.monthlyPlan) {
        conversationPrompt += `Active Monthly Plan: "${mergedContext.monthlyPlan.title || ''}" (${mergedContext.monthlyPlan.academicPriorities || ''})\n`;
      }

      const tasksToInclude = mergedContext.todayTasks || mergedContext.tasks || [];
      conversationPrompt += `Today's Tasks (${tasksToInclude.length}):\n`;
      if (tasksToInclude.length > 0) {
        for (const t of tasksToInclude) {
          conversationPrompt += `- [${t.isCompleted ? 'x' : ' '}] ID:${t.id} "${t.title}" (Section: ${t.sectionName || t.sectionId}, Time: ${t.startTime || 'None'} - ${t.endTime || 'None'}, Duration: ${t.scheduledMinutes || t.estimatedMinutes || 60}m, Priority: ${t.priority || 'Medium'}${t.mustDo ? ', Must-Do' : ''}, Status: ${t.status || (t.isCompleted ? 'completed' : 'not_started')}${t.deadline ? `, Deadline: ${t.deadline}` : ''})\n`;
        }
      } else {
        conversationPrompt += `(No tasks scheduled for today)\n`;
      }

      if (mergedContext.sections && mergedContext.sections.length > 0) {
        conversationPrompt += `Available Categories/Sections:\n`;
        for (const s of mergedContext.sections) {
          conversationPrompt += `- ${s.name} (ID: ${s.id}, Color: ${s.color})\n`;
        }
      }

      conversationPrompt += `[END CONTEXT]\n\n`;
    }

    // Append chat history
    for (const m of messages) {
      conversationPrompt += `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}\n`;
    }

    try {
      const response = await executeAIRequestWithFallback(
        conversationPrompt,
        systemInstruction,
        preferredProvider,
        { jsonMode: false }
      );

      // Extract ACTIONS block using robust extractor
      const { cleanText: extractedCleanText, actions: extractedActions } = extractActionsAndCleanText(response.text || '');
      let finalContent = extractedCleanText;

      // Execute actions on the backend database
      let finalActions = extractedActions;
      if (extractedActions.length > 0) {
        const { executedActions, verifiedFeedback, errorFeedback } = await executeServerActions(extractedActions, mergedContext);
        finalActions = executedActions;

        if (errorFeedback) {
          // Requirement 3: Never report success if backend failed!
          finalContent = errorFeedback;
        } else if (verifiedFeedback) {
          finalContent = verifiedFeedback;
        }
      }

      return NextResponse.json({
        ok: true,
        message: {
          role: 'assistant',
          content: finalContent,
        },
        actions: finalActions,
        provider: response.provider,
        model: response.model,
        tokensUsed: response.tokensUsed,
        latencyMs: response.latencyMs,
      });
    } catch (err: any) {
      console.warn('AI live provider dispatch notice:', err.message);

      // Fallback Engine: deterministic natural language processor
      const fallbackResult = handleFallbackNaturalLanguage(latestUserMessage, mergedContext);

      // Execute fallback actions on the database as well!
      let finalActions = fallbackResult.actions;
      let finalContent = fallbackResult.content;

      if (fallbackResult.actions.length > 0) {
        const { executedActions, verifiedFeedback, errorFeedback } = await executeServerActions(fallbackResult.actions, mergedContext);
        finalActions = executedActions;
        if (errorFeedback) {
          finalContent = errorFeedback;
        } else if (verifiedFeedback) {
          finalContent = verifiedFeedback;
        }
      }

      return NextResponse.json({
        ok: true,
        message: {
          role: 'assistant',
          content: finalContent,
        },
        actions: finalActions,
        provider: 'NightPlanner Copilot (Deterministic Rule Engine)',
        model: 'local-assistant',
      });
    }
  } catch (err: any) {
    console.error('AI Chat Error:', err);
    return NextResponse.json({ error: err.message || 'Chat request failed' }, { status: 500 });
  }
}
