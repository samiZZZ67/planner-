import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/server/auth';
import { executeAIRequestWithFallback } from '@/lib/server/ai/providers';
import { handleFallbackNaturalLanguage, type AIChatAction } from '@/lib/server/ai/copilot';

export type { AIChatAction };

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
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
      action = 'chat', // 'chat' | 'review_plan'
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
    let systemInstruction = `You are NightPlanner's elite AI Assistant and Authorized Website Copilot.
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
      "title": "Task title",
      "section": "Category name",
      "date": "YYYY-MM-DD or today or tomorrow",
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
  },
  {
    "action": "create_section",
    "params": {
      "name": "Category name",
      "color": "#3b82f6",
      "icon": "📌",
      "dailyTargetMinutes": 60
    }
  },
  {
    "action": "manage_plan",
    "params": {
      "planType": "day",
      "date": "YYYY-MM-DD",
      "updates": { "freeHours": 6 }
    }
  }
]

SAFETY & INTEGRITY RULES:
- If a request is ambiguous (e.g. multiple tasks match or task not found), DO NOT emit actions. Instead, ask a concise clarifying question listing the options!
- Destructive actions (like deleting a task) MUST have "requiresConfirmation": true so the user can verify before deleting.
- In your conversational text, explain what you are doing (e.g., "I've added...", "I will update...", or "Please confirm deletion of...").
- Keep responses friendly, sharp, concise, and executive.`;

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

      // Extract ACTIONS block if present
      let rawText = response.text || '';
      const actions: AIChatAction[] = [];
      const actionsRegex = /ACTIONS:\s*(\[\s*\{[\s\S]*\}\s*\])/i;
      const match = rawText.match(actionsRegex);

      if (match) {
        try {
          const parsed = JSON.parse(match[1]);
          if (Array.isArray(parsed)) {
            for (let i = 0; i < parsed.length; i++) {
              const item = parsed[i];
              actions.push({
                id: `act_${Date.now()}_${i}`,
                type: item.action,
                params: item.params,
                requiresConfirmation: item.params?.requiresConfirmation || item.action === 'delete_task' || item.action === 'delete_section',
              });
            }
          }
          // Remove ACTIONS block from visible response text
          rawText = rawText.replace(actionsRegex, '').trim();
        } catch (e) {
          console.warn('Could not parse AI actions block:', e);
        }
      }

      return NextResponse.json({
        ok: true,
        message: {
          role: 'assistant',
          content: rawText,
        },
        actions,
        provider: response.provider,
        model: response.model,
        tokensUsed: response.tokensUsed,
        latencyMs: response.latencyMs,
      });
    } catch (err: any) {
      console.warn('AI live provider dispatch notice:', err.message);

      // Fallback Engine: deterministic natural language processor
      const fallbackResult = handleFallbackNaturalLanguage(latestUserMessage, mergedContext);

      return NextResponse.json({
        ok: true,
        message: {
          role: 'assistant',
          content: fallbackResult.content,
        },
        actions: fallbackResult.actions,
        provider: 'NightPlanner Copilot (Deterministic Rule Engine)',
        model: 'local-assistant',
      });
    }
  } catch (err: any) {
    console.error('AI Chat Error:', err);
    return NextResponse.json({ error: err.message || 'Chat request failed' }, { status: 500 });
  }
}
