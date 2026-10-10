import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/server/auth';
import { executeAIRequestWithFallback } from '@/lib/server/ai/providers';
import {
  constructDayPlanSystemInstruction,
  constructDayPlanUserPrompt,
  generateAlgorithmicDayPlan,
  type PlanGenerationContext
} from '@/lib/server/ai/prompts';
import { validateAndCleanAIPlan } from '@/lib/server/ai/validator';
import type { AIPlanGenerationResult } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const isAuth = await verifySession(req);
    if (!isAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      targetDate,
      focusBudgetHours = 8,
      monthlyPlan,
      weeklyPlan,
      previousDayTasks = [],
      existingDayTasks = [],
      sections = [],
      preferredProvider,
      interviewAnswers = [],
    } = body;

    if (!targetDate) {
      return NextResponse.json({ error: 'targetDate is required' }, { status: 400 });
    }

    const context: PlanGenerationContext = {
      targetDate,
      focusBudgetHours: Number(focusBudgetHours) || 8,
      monthlyPlan: monthlyPlan || null,
      weeklyPlan: weeklyPlan || null,
      previousDayTasks: Array.isArray(previousDayTasks) ? previousDayTasks : [],
      existingDayTasks: Array.isArray(existingDayTasks) ? existingDayTasks : [],
      sections: Array.isArray(sections) ? sections : [],
      interviewAnswers: Array.isArray(interviewAnswers) ? interviewAnswers : [],
    };

    const systemInstruction = constructDayPlanSystemInstruction();
    const userPrompt = constructDayPlanUserPrompt(context);

    let result: AIPlanGenerationResult;

    try {
      const startTime = Date.now();
      const aiResponse = await executeAIRequestWithFallback(
        userPrompt,
        systemInstruction,
        preferredProvider
      );

      // Validate & sanitize the model output
      const validated = validateAndCleanAIPlan(
        aiResponse.text,
        context.focusBudgetHours,
        context.sections,
        context.existingDayTasks
      );

      result = {
        ok: true,
        provider: aiResponse.provider,
        model: aiResponse.model,
        keyIndex: aiResponse.keyIndex,
        tokensUsed: aiResponse.tokensUsed,
        latencyMs: aiResponse.latencyMs || (Date.now() - startTime),
        rationale: validated.rationale,
        recommendations: validated.recommendations,
        conflicts: validated.conflicts,
        proposedTasks: validated.proposedTasks,
        weeklyContextUsed: Boolean(context.weeklyPlan),
        monthlyContextUsed: Boolean(context.monthlyPlan),
        fallbackUsed: aiResponse.fallbackUsed,
      };
    } catch (err: any) {
      if (err.message === 'NO_CONFIGURED_KEYS') {
        // Fallback gracefully to algorithmic connected schedule generator
        const fallbackPlan = generateAlgorithmicDayPlan(context);
        result = {
          ok: true,
          provider: 'Template AI Engine (Add GEMINI_API_KEY_1 or GROQ_API_KEY_1 in .env.local for live LLM)',
          model: 'rule-based-hierarchy-scheduler',
          latencyMs: 15,
          rationale: fallbackPlan.rationale,
          recommendations: fallbackPlan.recommendations,
          conflicts: fallbackPlan.conflicts,
          proposedTasks: fallbackPlan.proposedTasks,
          weeklyContextUsed: Boolean(context.weeklyPlan),
          monthlyContextUsed: Boolean(context.monthlyPlan),
          fallbackUsed: false,
        };
      } else {
        // Provider failure
        console.warn('AI Generation provider error:', err);
        // Fallback to algorithmic generator with a warning
        const fallbackPlan = generateAlgorithmicDayPlan(context);
        result = {
          ok: true,
          provider: `Fallback Engine (${err.message.slice(0, 100)})`,
          model: 'fallback-scheduler',
          latencyMs: 30,
          rationale: `AI provider encountered an error (${err.message.slice(0, 80)}). Generated emergency fallback schedule based on your weekly goals and budget.`,
          recommendations: fallbackPlan.recommendations,
          conflicts: [...fallbackPlan.conflicts, `Live provider error: ${err.message.slice(0, 120)}`],
          proposedTasks: fallbackPlan.proposedTasks,
          weeklyContextUsed: Boolean(context.weeklyPlan),
          monthlyContextUsed: Boolean(context.monthlyPlan),
          fallbackUsed: true,
          error: err.message,
        };
      }
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Day Plan API Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
