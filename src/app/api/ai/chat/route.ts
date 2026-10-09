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
      return NextResponse.json({ error: 'Unauthorized. Please log in with your app password to use the AI assistant.' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
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
        { jsonMode: false } // Normal natural language text response
      );
    } catch (err: any) {
      console.warn('AI Chat dispatch notice:', err.message);

      // Scenario A: No API keys configured or only placeholder values
      if (err.message === 'NO_CONFIGURED_KEYS') {
        let content = `I am your AI Planning Assistant. To connect to live cloud models (Google Gemini or Groq), please add your API key into \`.env.local\`:\n\n\`\`\`bash\nGEMINI_API_KEY_1="AIza..."\n# or\nGROQ_API_KEY="gsk_..."\n\`\`\``;

        if (action === 'review_plan' && currentPlanContext) {
          const totalMins = (currentPlanContext.tasks || []).reduce((acc: number, t: any) => acc + (t.scheduledMinutes || t.estimatedMinutes || 0), 0);
          const budgetHours = currentPlanContext.focusBudgetHours || 8;
          const completedCount = (currentPlanContext.tasks || []).filter((t: any) => t.isCompleted).length;

          content += `\n\n---\n### 📋 Local Focus Plan Review (${currentPlanContext.date})\n`;
          content += `- **Daily Focus Budget:** ${budgetHours}h (${budgetHours * 60}m)\n`;
          content += `- **Planned Focus Work:** ${Math.round(totalMins / 60 * 10) / 10}h (${totalMins}m)\n`;
          content += `- **Scheduled Tasks:** ${(currentPlanContext.tasks || []).length} (${completedCount} completed)\n\n`;

          if (totalMins > budgetHours * 60) {
            content += `⚠️ **Overallocated**: Your planned duration exceeds your budget by ${Math.round((totalMins - budgetHours * 60) / 60 * 10) / 10}h. Consider deferring lower priority tasks.\n`;
          } else {
            content += `✅ **Budget Balanced**: Your tasks fit comfortably within your daily focus hours.\n`;
          }
          content += `\n*Tip: Connect a Gemini or Groq API key to activate deep cognitive pacing and break recommendations.*`;
        }

        return NextResponse.json({
          ok: true,
          message: {
            role: 'assistant',
            content,
          },
          provider: 'System AI Engine (Offline Guide)',
          model: 'local-assistant',
        });
      }

      // Scenario B: Plan review requested but live providers failed (rate limit, invalid key, timeout)
      if (action === 'review_plan' && currentPlanContext) {
        const totalMins = (currentPlanContext.tasks || []).reduce((acc: number, t: any) => acc + (t.scheduledMinutes || t.estimatedMinutes || 0), 0);
        const budgetHours = currentPlanContext.focusBudgetHours || 8;
        const budgetMins = budgetHours * 60;
        const completedCount = (currentPlanContext.tasks || []).filter((t: any) => t.isCompleted).length;

        let content = `⚠️ **Provider Notice**: Live AI models were temporarily unreachable (${err.message.slice(0, 100)}).\n`;
        content += `Here is your **Local Cognitive Schedule Review**:\n\n`;
        content += `- **Date:** ${currentPlanContext.date}\n`;
        content += `- **Focus Budget:** ${budgetHours}h available\n`;
        content += `- **Allocated Work:** ${Math.round(totalMins / 60 * 10) / 10}h across ${(currentPlanContext.tasks || []).length} tasks (${completedCount} completed)\n\n`;

        if (totalMins > budgetMins) {
          content += `⚠️ **Budget Alert**: Total planned tasks exceed your focus budget by ${Math.round((totalMins - budgetMins) / 60 * 10) / 10}h. Trim or reschedule non-critical tasks.\n`;
        } else {
          content += `✅ **Budget Status**: Healthy workload balance (${Math.round((budgetMins - totalMins) / 60 * 10) / 10}h buffer remaining).\n`;
        }

        content += `\n💡 **Productivity Recommendation**: Remember the Ultradian rhythm rule — after every 90 minutes of focused effort, take a 10–15 minute cognitive rest to prevent cognitive fatigue.`;

        return NextResponse.json({
          ok: true,
          message: {
            role: 'assistant',
            content,
          },
          provider: 'Local Scheduler (Cognitive Rule Engine)',
          model: 'rule-based-evaluator',
        });
      }

      // Scenario C: General chat error with live providers (Rate limits, invalid keys, timeouts)
      const isRateLimit = err.status === 429 || err.message?.includes('rate-limited') || err.message?.includes('429');
      const statusCode = isRateLimit ? 429 : (err.status || 502);

      return NextResponse.json({
        ok: false,
        error: err.message || 'AI provider request failed',
        details: err.attempts || undefined,
        retryAfter: err.retryAfter || undefined,
      }, { status: statusCode });
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
