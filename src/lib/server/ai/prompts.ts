import type { Task, Section, WeeklyPlan, MonthlyPlan, ProposedTask } from '@/types';

export interface PlanGenerationContext {
  targetDate: string;
  focusBudgetHours: number;
  monthlyPlan?: MonthlyPlan | null;
  weeklyPlan?: WeeklyPlan | null;
  previousDayTasks: Task[];
  existingDayTasks: Task[];
  sections: Section[];
}

export function constructDayPlanSystemInstruction(): string {
  return `You are an elite, realistic, executive-functioning AI planner.
Your job is to build a structured, high-priority daily schedule following the connected hierarchy:
Monthly goals → Weekly commitments → Daily schedules → Actual results → AI review.

Rules:
1. STRICT FOCUS-TIME BUDGET: The total duration of all proposed tasks must NOT exceed the specified focus budget.
2. NO TIME OVERLAPS: Each task must have a distinct "startTime" (e.g. "09:00") and "endTime" (e.g. "11:30") in 24-hour HH:MM format. Tasks must not overlap each other or any existing fixed commitments.
3. CONTEXT INTEGRATION:
   - Prioritize AASTU academic classes, assignments, and approaching deadlines.
   - Respect deep-work and video-editing targets defined in the weekly and monthly plans.
   - Address unfinished/missed tasks from previous days if critical, or reschedule them reasonably.
4. REALISTIC PACING: Leave realistic buffers between intense deep work blocks.
5. JSON OUTPUT ONLY: You must respond ONLY with a valid JSON object matching the requested schema.`;
}

export function constructDayPlanUserPrompt(context: PlanGenerationContext): string {
  const { targetDate, focusBudgetHours, monthlyPlan, weeklyPlan, previousDayTasks, existingDayTasks, sections } = context;

  const incompletePrev = previousDayTasks.filter(t => !t.isCompleted);
  const completedPrev = previousDayTasks.filter(t => t.isCompleted);

  return JSON.stringify({
    task: "GENERATE_DAY_SCHEDULE",
    targetDate,
    availableFocusBudgetHours: focusBudgetHours,
    availableFocusBudgetMinutes: focusBudgetHours * 60,

    monthlyPlanContext: monthlyPlan ? {
      month: monthlyPlan.month,
      title: monthlyPlan.title,
      academicPriorities: monthlyPlan.academicPriorities,
      editingTargets: monthlyPlan.editingTargets,
      commitments: monthlyPlan.commitments,
      goals: monthlyPlan.goals,
    } : "No monthly plan set for this month.",

    weeklyPlanContext: weeklyPlan ? {
      dateRange: `${weeklyPlan.startDate} to ${weeklyPlan.endDate}`,
      planningPrompt: weeklyPlan.prompt,
      mainGoals: weeklyPlan.goals,
      aastuCommitments: weeklyPlan.aastuCommitments,
      deepWorkTargets: weeklyPlan.deepWorkTargets,
      constraints: weeklyPlan.constraints,
      endOfWeekOutcomes: weeklyPlan.outcomes,
    } : "No weekly plan set for this week.",

    previousDayResults: {
      completedTasks: completedPrev.map(t => ({
        title: t.title,
        estimatedMinutes: t.estimatedMinutes,
        actualMinutes: t.actualMinutes || t.estimatedMinutes,
      })),
      missedOrIncompleteTasks: incompletePrev.map(t => ({
        title: t.title,
        priority: t.priority,
        estimatedMinutes: t.estimatedMinutes,
      })),
    },

    alreadyScheduledForTargetDate: existingDayTasks.map(t => ({
      title: t.title,
      startTime: t.startTime,
      endTime: t.endTime,
      scheduledMinutes: t.scheduledMinutes,
    })),

    availableCategories: sections.map(s => ({
      id: s.id,
      name: s.name,
      color: s.color,
    })),

    requiredJsonSchema: {
      rationale: "string explaining why these tasks and time slots were chosen given the weekly & monthly goals",
      recommendations: ["list of strategic advice, e.g. when to take breaks, study strategies"],
      conflicts: ["list of identified conflicts or tight deadlines if any"],
      proposedTasks: [
        {
          title: "string",
          startTime: "HH:MM (24-hour)",
          endTime: "HH:MM (24-hour)",
          scheduledMinutes: "number",
          sectionId: "string matching one of availableCategories",
          description: "string",
          strategy: "string execution steps",
          priority: "Low | Medium | High",
          mustDo: "boolean (top priority star)",
          status: "not_started"
        }
      ]
    }
  }, null, 2);
}

/**
 * High-quality algorithmic fallback generator if no API keys are configured,
 * ensuring users can immediately test the entire planning hierarchy!
 */
export function generateAlgorithmicDayPlan(context: PlanGenerationContext): {
  rationale: string;
  recommendations: string[];
  conflicts: string[];
  proposedTasks: ProposedTask[];
} {
  const { targetDate, focusBudgetHours, monthlyPlan, weeklyPlan, previousDayTasks, sections } = context;
  const budgetMinutes = Math.min(24 * 60, focusBudgetHours * 60);

  const deepWorkSec = sections.find(s => s.name.toLowerCase().includes('deep') || s.name.toLowerCase().includes('work')) || sections[0];
  const learningSec = sections.find(s => s.name.toLowerCase().includes('learn') || s.name.toLowerCase().includes('study')) || sections[0];
  const otherSec = sections[sections.length - 1] || sections[0];

  const tasks: ProposedTask[] = [];
  let currentStartMinutes = 9 * 60; // Start at 9:00 AM
  let allocatedMinutes = 0;

  // 1. Incomplete task carryover from previous day if critical
  const carryover = previousDayTasks.find(t => !t.isCompleted && (t.priority === 'High' || t.mustDo));
  if (carryover && allocatedMinutes + 60 <= budgetMinutes) {
    const startH = Math.floor(currentStartMinutes / 60);
    const startM = currentStartMinutes % 60;
    const endMinutes = currentStartMinutes + 60;
    const endH = Math.floor(endMinutes / 60);
    const endM = endMinutes % 60;

    tasks.push({
      title: `Finish: ${carryover.title}`,
      startTime: `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`,
      endTime: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`,
      scheduledMinutes: 60,
      sectionId: carryover.sectionId || deepWorkSec.id,
      description: `Carried over from previous day incomplete task: ${carryover.title}`,
      strategy: 'Break into 2 Pomodoro sprints. Eliminate distractions.',
      priority: 'High',
      mustDo: true,
      status: 'not_started',
    });

    currentStartMinutes = endMinutes + 15; // 15 min buffer
    allocatedMinutes += 60;
  }

  // 2. AASTU Academic Priority from Weekly / Monthly plan
  const aastuText = weeklyPlan?.aastuCommitments || monthlyPlan?.academicPriorities || 'AASTU Core Academic Study & Assignment Review';
  const aastuDuration = Math.min(120, Math.max(60, budgetMinutes - allocatedMinutes - 60));
  if (aastuDuration > 0 && allocatedMinutes + aastuDuration <= budgetMinutes) {
    const startH = Math.floor(currentStartMinutes / 60);
    const startM = currentStartMinutes % 60;
    const endMinutes = currentStartMinutes + aastuDuration;
    const endH = Math.floor(endMinutes / 60);
    const endM = endMinutes % 60;

    tasks.push({
      title: aastuText.length > 50 ? aastuText.slice(0, 48) + '…' : aastuText,
      startTime: `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`,
      endTime: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`,
      scheduledMinutes: aastuDuration,
      sectionId: learningSec.id,
      description: `Aligned with weekly academic commitments: ${weeklyPlan?.aastuCommitments || 'Coursework & lectures'}.`,
      strategy: 'Review lecture notes, complete homework problem sets, synthesize formulas.',
      priority: 'High',
      mustDo: true,
      status: 'not_started',
    });

    currentStartMinutes = endMinutes + 30; // 30 min lunch/break buffer
    allocatedMinutes += aastuDuration;
  }

  // 3. Deep Work & Video Editing Target from Weekly / Monthly plan
  const deepWorkText = weeklyPlan?.deepWorkTargets || monthlyPlan?.editingTargets || 'Video Editing & Creative Deep Work';
  const remainingForDeep = budgetMinutes - allocatedMinutes;
  const deepDuration = Math.min(120, Math.max(45, remainingForDeep));
  if (deepDuration >= 30 && allocatedMinutes + deepDuration <= budgetMinutes) {
    const startH = Math.floor(currentStartMinutes / 60);
    const startM = currentStartMinutes % 60;
    const endMinutes = currentStartMinutes + deepDuration;
    const endH = Math.floor(endMinutes / 60);
    const endM = endMinutes % 60;

    tasks.push({
      title: deepWorkText.length > 50 ? deepWorkText.slice(0, 48) + '…' : deepWorkText,
      startTime: `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`,
      endTime: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`,
      scheduledMinutes: deepDuration,
      sectionId: deepWorkSec.id,
      description: `Aligned with weekly deep work targets: ${weeklyPlan?.deepWorkTargets || 'Deliverables and video editing'}.`,
      strategy: 'Full immersion session with phone in Do Not Disturb mode. Edit timeline and export.',
      priority: 'Medium',
      mustDo: false,
      status: 'not_started',
    });

    currentStartMinutes = endMinutes + 15;
    allocatedMinutes += deepDuration;
  }

  return {
    rationale: `Schedule designed to fit your ${focusBudgetHours}h daily focus budget. Prioritizes AASTU commitments and deep-work targets drawn from your active weekly plan.`,
    recommendations: [
      'Begin the morning with your primary academic block while cognitive energy is peak.',
      'Take 15-30 minute active rest buffers between intense blocks.',
      'Log actual durations to help tomorrow’s AI schedule adapt to your real working speed.',
    ],
    conflicts: allocatedMinutes > budgetMinutes ? ['Proposed tasks exceed focus budget by ' + (allocatedMinutes - budgetMinutes) + ' min.'] : [],
    proposedTasks: tasks,
  };
}
