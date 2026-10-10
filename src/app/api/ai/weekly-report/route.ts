import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/server/auth';
import { executeAIRequestWithFallback } from '@/lib/server/ai/providers';

export async function POST(req: NextRequest) {
  try {
    const isAuth = await verifySession(req);
    if (!isAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { weeklyPlan, tasks = [], timeLogs = [] } = body;

    if (!weeklyPlan) {
      return NextResponse.json({ error: 'weeklyPlan is required' }, { status: 400 });
    }

    const completedTasks = tasks.filter((t: any) => t.isCompleted);
    const totalMinutesLogged = timeLogs.reduce((acc: number, l: any) => acc + (l.minutes || 0), 0);
    const totalHoursLogged = Math.round((totalMinutesLogged / 60) * 10) / 10;

    const prompt = `You are an elite productivity executive coach.
Generate a structured Weekly Progress Report evaluating the following week:
Date range: ${weeklyPlan.startDate} to ${weeklyPlan.endDate}

WEEKLY GOALS & PROMPT:
${weeklyPlan.prompt}

MAIN COMMITMENTS:
- Goals: ${weeklyPlan.goals}
- AASTU Academic Commitments: ${weeklyPlan.aastuCommitments}
- Deep Work & Video Editing Targets: ${weeklyPlan.deepWorkTargets}
- Expected Outcomes: ${weeklyPlan.outcomes}

ACTUAL EXECUTION METRICS:
- Total Tasks Completed: ${completedTasks.length} / ${tasks.length}
- Total Focus Hours Logged: ${totalHoursLogged} hours
- Completed Task Titles: ${completedTasks.map((t: any) => t.title).join(', ') || 'None logged'}
- Incomplete Tasks: ${tasks.filter((t: any) => !t.isCompleted).map((t: any) => t.title).join(', ') || 'None'}

Please provide a concise, sharp weekly review report with:
1. Executive Summary & Deliverables Score (0-100%)
2. Academic & Coursework Progress (AASTU highlights)
3. Deep Work & Video Production Output
4. Bottlenecks & Slippages
5. Next Week's Strategic Priorities

Return clean markdown text.`;

    try {
      const response = await executeAIRequestWithFallback(prompt);
      return NextResponse.json({
        ok: true,
        report: response.text,
        provider: response.provider,
        model: response.model,
        tokensUsed: response.tokensUsed,
      });
    } catch (err: any) {
      // Fallback template report if offline or no keys
      const fallbackReport = `### Weekly Progress Report (${weeklyPlan.startDate} – ${weeklyPlan.endDate})

**1. Executive Summary**
* **Completed Tasks:** ${completedTasks.length} / ${tasks.length} (${tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0}%)
* **Logged Focus Time:** ${totalHoursLogged} hours

**2. Academic Commitments (AASTU)**
* Planned: ${weeklyPlan.aastuCommitments || 'Core coursework'}
* Review: Maintained steady focus on coursework and scheduled syllabus milestones.

**3. Deep Work & Creative Deliverables**
* Planned: ${weeklyPlan.deepWorkTargets || 'Editing & project blocks'}
* Execution: Completed designated focus blocks.

**4. Recommendations for Next Week**
* Continue protecting early morning deep work slots before academic lectures.
* Ensure buffer time between intense sprints to prevent cognitive fatigue.`;

      return NextResponse.json({
        ok: true,
        report: fallbackReport,
        provider: 'System Summary Engine',
        model: 'rule-based',
      });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to generate report' }, { status: 500 });
  }
}
