import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/server/auth';
import { generatePlanInterview } from '@/lib/server/ai/interview';
import type { PlanGenerationContext } from '@/lib/server/ai/prompts';

export async function POST(req: NextRequest) {
  try {
    const isAuth = await verifySession(req);
    if (!isAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      targetDate,
      focusBudgetHours = 8,
      monthlyPlan,
      weeklyPlan,
      previousDayTasks = [],
      existingDayTasks = [],
      sections = [],
      preferredProvider,
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
    };

    const result = await generatePlanInterview(context, preferredProvider);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Plan Interview API Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
