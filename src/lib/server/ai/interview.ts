import type { Task, Section, WeeklyPlan, MonthlyPlan } from '@/types';
import { executeAIRequestWithFallback } from './providers';
import type { PlanGenerationContext } from './prompts';

export interface AdaptiveQuestion {
  id: string;
  question: string;
  options: string[];
  defaultAnswer?: string;
  category?: 'goal' | 'priority' | 'hours' | 'obstacle' | 'carryover';
}

export interface PlanInterviewResult {
  ok: boolean;
  summary: string;
  questions: AdaptiveQuestion[];
  provider?: string;
  model?: string;
}

/**
 * Algorithmic fallback interview questions based on actual Dexie data hierarchy
 */
export function generateAlgorithmicPlanInterview(context: PlanGenerationContext): PlanInterviewResult {
  const { targetDate, focusBudgetHours, monthlyPlan, weeklyPlan, previousDayTasks } = context;

  const incompletePrev = previousDayTasks.filter(t => !t.isCompleted);
  const questions: AdaptiveQuestion[] = [];

  // Summary briefing
  let summary = `Reviewed your connected hierarchy for ${targetDate}. Focus budget: ${focusBudgetHours} hours.`;
  if (weeklyPlan?.goals) {
    summary += ` Active weekly goal: "${weeklyPlan.goals.slice(0, 60)}${weeklyPlan.goals.length > 60 ? '…' : ''}".`;
  }
  if (incompletePrev.length > 0) {
    summary += ` Notice: ${incompletePrev.length} unfinished task${incompletePrev.length > 1 ? 's' : ''} from yesterday.`;
  }

  // 1. Incomplete carryover question (if any unfinished tasks from yesterday)
  if (incompletePrev.length > 0) {
    const topIncomplete = incompletePrev[0].title;
    questions.push({
      id: 'q_carryover',
      category: 'carryover',
      question: `You have ${incompletePrev.length} unfinished task${incompletePrev.length > 1 ? 's' : ''} from yesterday, including "${topIncomplete}". How should we prioritize this today?`,
      options: [
        `Prioritize "${topIncomplete}" first this morning`,
        'Reschedule to later this week',
        'Work on it only if time permits',
        'Drop it for today',
      ],
      defaultAnswer: `Prioritize "${topIncomplete}" first this morning`,
    });
  }

  // 2. Goal / Outcome alignment question
  if (weeklyPlan?.aastuCommitments || weeklyPlan?.goals) {
    const commitmentPreview = weeklyPlan.aastuCommitments || weeklyPlan.goals;
    const shortGoal = commitmentPreview.length > 45 ? commitmentPreview.slice(0, 42) + '…' : commitmentPreview;
    questions.push({
      id: 'q_goal',
      category: 'goal',
      question: `Your weekly plan highlights: "${shortGoal}". What specific result do you want to accomplish today?`,
      options: [
        `Advance "${shortGoal}" substantially`,
        'Focus on deep-work / creative deliverables',
        'Study coursework & review lectures',
        'Complete high-urgency tasks first',
      ],
      defaultAnswer: `Advance "${shortGoal}" substantially`,
    });
  } else {
    questions.push({
      id: 'q_goal',
      category: 'goal',
      question: 'What is your primary goal and biggest priority for today?',
      options: [
        'Intense deep work and study block',
        'Finish overdue and pending deliverables',
        'Balanced, steady progress across all categories',
        'Creative focus & video editing',
      ],
      defaultAnswer: 'Intense deep work and study block',
    });
  }

  // 3. Realistic hours question
  const budget = focusBudgetHours || 8;
  questions.push({
    id: 'q_hours',
    category: 'hours',
    question: 'How many hours can you realistically dedicate to focused deep work today?',
    options: [
      `${budget} hours (standard planned budget)`,
      `${Math.max(2, budget - 2)} hours (lighter day / buffer needed)`,
      `${Math.min(12, budget + 2)} hours (extended deep focus sprint)`,
      '4 hours (half-day focused effort)',
    ],
    defaultAnswer: `${budget} hours (standard planned budget)`,
  });

  // 4. Obstacles / unexpected changes question
  questions.push({
    id: 'q_obstacle',
    category: 'obstacle',
    question: 'Are there any unexpected roadblocks, schedule changes, or constraints today?',
    options: [
      'Clear day, full focus with no unexpected interruptions',
      'Low energy / need frequent cognitive breaks',
      'Fixed class/meeting schedule to work around',
      'Tight deadline this evening',
    ],
    defaultAnswer: 'Clear day, full focus with no unexpected interruptions',
  });

  return {
    ok: true,
    summary,
    questions: questions.slice(0, 4), // Keep concise: 3-4 questions max
    provider: 'Algorithmic Hierarchy Coach',
    model: 'adaptive-rule-engine',
  };
}

/**
 * Generate adaptive interview questions using live LLM or algorithmic fallback
 */
export async function generatePlanInterview(
  context: PlanGenerationContext,
  preferredProvider?: string
): Promise<PlanInterviewResult> {
  const systemInstruction = `You are Sam'Space's elite AI Productivity Coach.
Before generating a daily schedule, you conduct a quick, highly adaptive planning interview.
Your goal is to ask 2 to 4 concise, relevant questions about the user's goals, available hours, top priorities, and potential obstacles.

Rules:
1. REVIEW CONTEXT: Use the user's monthly goals, weekly commitments, yesterday's results (completed vs missed tasks), and focus budget.
2. ADAPTIVE & RELEVANT: Only ask what is genuinely relevant.
   - If yesterday had unfinished tasks, ask specifically how to handle them.
   - If weekly plan has key deliverables, ask what concrete result is expected today.
   - Ask about realistic available hours or energy.
   - Ask about unexpected roadblocks or changes.
3. CONCISE: Questions must be brief, conversational, and direct.
4. SUGGESTED OPTIONS: For each question, provide 3-4 concise, clickable options with one defaultAnswer.
5. JSON ONLY: Output must strictly be valid JSON matching the requested schema.`;

  const prompt = JSON.stringify({
    task: 'GENERATE_PLANNING_INTERVIEW',
    targetDate: context.targetDate,
    focusBudgetHours: context.focusBudgetHours,
    monthlyPlanContext: context.monthlyPlan ? {
      title: context.monthlyPlan.title,
      academicPriorities: context.monthlyPlan.academicPriorities,
      editingTargets: context.monthlyPlan.editingTargets,
    } : null,
    weeklyPlanContext: context.weeklyPlan ? {
      goals: context.weeklyPlan.goals,
      aastuCommitments: context.weeklyPlan.aastuCommitments,
      deepWorkTargets: context.weeklyPlan.deepWorkTargets,
      constraints: context.weeklyPlan.constraints,
    } : null,
    yesterdayIncompleteTasks: context.previousDayTasks.filter(t => !t.isCompleted).map(t => t.title),
    yesterdayCompletedTasks: context.previousDayTasks.filter(t => t.isCompleted).map(t => t.title),
    requiredJsonSchema: {
      summary: "1-2 sentence context summary of what was reviewed",
      questions: [
        {
          id: "q1",
          question: "string",
          options: ["string", "string", "string"],
          defaultAnswer: "string"
        }
      ]
    }
  }, null, 2);

  try {
    const aiResponse = await executeAIRequestWithFallback(prompt, systemInstruction, preferredProvider, { jsonMode: true });
    
    // Parse JSON
    let text = aiResponse.text.trim();
    if (text.startsWith('```json')) {
      text = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (text.startsWith('```')) {
      text = text.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(text);
    if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
      return {
        ok: true,
        summary: parsed.summary || `Reviewed plan hierarchy for ${context.targetDate}.`,
        questions: parsed.questions.map((q: any, idx: number) => ({
          id: q.id || `q_${idx + 1}`,
          question: q.question,
          options: Array.isArray(q.options) && q.options.length > 0 ? q.options : ['Yes', 'No'],
          defaultAnswer: q.defaultAnswer || (Array.isArray(q.options) ? q.options[0] : ''),
        })),
        provider: aiResponse.provider,
        model: aiResponse.model,
      };
    }
  } catch (err: any) {
    // If provider fails or NO_CONFIGURED_KEYS, gracefully fall back to algorithmic generator
    console.warn('AI Interview provider fallback:', err.message);
  }

  return generateAlgorithmicPlanInterview(context);
}
