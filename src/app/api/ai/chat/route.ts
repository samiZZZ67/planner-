import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/server/auth';
import { executeAIRequestWithFallback } from '@/lib/server/ai/providers';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function POST(req: NextRequest) {
  try {
    const isAuth = await verifySession();
    if (!isAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      messages = [] as ChatMessage[],
      action = 'chat', // 'chat' | 'review_plan'
      currentPlanContext = null,
      preferredProvider,
    } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages are required' }, { status: 400 });
    }

    // Build system instructions based on whether it's a general conversation or a plan review
    let systemInstruction = `You are Night Planner's elite AI Assistant.
You are knowledgeable, concise, realistic, and friendly.
You assist with:
- Conversational questions, explanations, learning, and brainstorming.
- Productivity science (cognitive ergonomics, Ultradian rhythms, Pomodoro pacing, spacing effects).
- Planning, goal-setting, study tactics (AASTU coursework), and creative project workflows.
Always provide sharp, well-structured, actionable advice.`;

    if (action === 'review_plan' || currentPlanContext) {
      systemInstruction += `\n\nWhen reviewing daily schedules:
1. Evaluate focus-time budget compliance.
2. Evaluate cognitive workload (identify grueling back-to-back blocks without breaks; recommend 10-15m breaks after 90m deep work).
3. Check task priorities, realistic capacity, and potential time slot overlaps.
4. Provide structured, scientifically grounded feedback.
5. If suggesting adjustments, format individual concrete proposals clearly so the user can review and approve them.`;
    }

    // Construct the prompt string
    let conversationPrompt = '';

    if (currentPlanContext) {
      conversationPrompt += `[CURRENT USER DAILY PLAN CONTEXT]\n`;
      conversationPrompt += `Date: ${currentPlanContext.date}\n`;
      conversationPrompt += `Available Focus Budget: ${currentPlanContext.focusBudgetHours || 8} hours\n`;
      if (currentPlanContext.weeklyGoals) {
        conversationPrompt += `Active Weekly Goals: ${currentPlanContext.weeklyGoals}\n`;
      }
      if (currentPlanContext.monthlyGoals) {
        conversationPrompt += `Active Monthly Deliverables: ${currentPlanContext.monthlyGoals}\n`;
      }
      conversationPrompt += `Tasks Scheduled:\n`;
      if (Array.isArray(currentPlanContext.tasks) && currentPlanContext.tasks.length > 0) {
        for (const t of currentPlanContext.tasks) {
          conversationPrompt += `- [${t.isCompleted ? 'x' : ' '}] "${t.title}" (${t.startTime || 'No start'} – ${t.endTime || 'No end'}, ${t.scheduledMinutes || t.estimatedMinutes || 0}m, Priority: ${t.priority || 'Medium'}${t.mustDo ? ', Must-Do' : ''})\n`;
        }
      } else {
        conversationPrompt += `(No tasks scheduled yet on this date)\n`;
      }
      conversationPrompt += `\n[END CONTEXT]\n\n`;
    }

    // Format chat history
    for (const m of messages) {
      conversationPrompt += `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}\n`;
    }

    let response;
    try {
      response = await executeAIRequestWithFallback(
        conversationPrompt,
        systemInstruction,
        preferredProvider,
        { jsonMode: false } // Normal natural language text response!
      );
    } catch (err: any) {
      if (err.message === 'NO_CONFIGURED_KEYS') {
        return NextResponse.json({
          ok: true,
          message: {
            role: 'assistant',
            content: `I am your AI Planning Assistant. To connect to live models (Google Gemini or Groq), please add your API key (e.g. \`GEMINI_API_KEY_1\` or \`GROQ_API_KEY\`) into \`.env.local\`.\n\nIn the meantime, your tasks and focus time budget are active and fully tracking on your device!`,
          },
          provider: 'System AI Engine (Offline)',
          model: 'local-assistant',
        });
      }
      throw err;
    }

    return NextResponse.json({
      ok: true,
      message: {
        role: 'assistant',
        content: response.text,
      },
      provider: response.provider,
      model: response.model,
      tokensUsed: response.tokensUsed,
      latencyMs: response.latencyMs,
    });
  } catch (err: any) {
    console.error('AI Chat Error:', err);
    return NextResponse.json({ error: err.message || 'Chat request failed' }, { status: 500 });
  }
}
