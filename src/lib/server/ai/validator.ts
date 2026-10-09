import type { ProposedTask, Section, Task } from '@/types';

function parseMinutes(t: string): number {
  if (!t || typeof t !== 'string') return 0;
  const parts = t.split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function isValidTime(t: string): boolean {
  if (!t || typeof t !== 'string') return false;
  const match = t.match(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/);
  return Boolean(match);
}

export interface ValidationResult {
  valid: boolean;
  tasks: ProposedTask[];
  conflicts: string[];
  totalScheduledMinutes: number;
}

export function validateAndCleanAIPlan(
  rawJson: string,
  budgetHours: number,
  availableSections: Section[],
  existingTasks: Task[]
): {
  rationale: string;
  recommendations: string[];
  conflicts: string[];
  proposedTasks: ProposedTask[];
} {
  // 1. Clean markdown code fences if present
  let cleaned = rawJson.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err: any) {
    throw new Error(`AI generated invalid JSON: ${err.message}`);
  }

  const rationale: string = typeof parsed.rationale === 'string' ? parsed.rationale : 'Generated schedule based on your weekly goals and focus budget.';
  const recommendations: string[] = Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String) : [];
  const conflicts: string[] = Array.isArray(parsed.conflicts) ? parsed.conflicts.map(String) : [];

  const rawTasks = Array.isArray(parsed.proposedTasks) ? parsed.proposedTasks : [];
  const validTasks: ProposedTask[] = [];

  const budgetMinutes = budgetHours * 60;
  let accumulatedMinutes = 0;

  const validSectionIds = new Set(availableSections.map(s => s.id));
  const fallbackSectionId = availableSections[0]?.id || 'default-sec-1';

  // Existing occupied time slots
  const occupiedSlots = existingTasks
    .filter(t => t.startTime && t.endTime && !t.deleted)
    .map(t => ({
      title: t.title,
      start: parseMinutes(t.startTime!),
      end: parseMinutes(t.endTime!),
    }));

  for (let i = 0; i < rawTasks.length; i++) {
    const raw = rawTasks[i];
    if (!raw.title || typeof raw.title !== 'string') continue;

    let start = raw.startTime;
    let end = raw.endTime;

    // Fallback times if missing or invalid
    if (!isValidTime(start) || !isValidTime(end)) {
      const nextStartMin = 9 * 60 + accumulatedMinutes;
      const nextEndMin = nextStartMin + (raw.scheduledMinutes || 60);
      const sh = Math.floor(nextStartMin / 60);
      const sm = nextStartMin % 60;
      const eh = Math.floor(nextEndMin / 60);
      const em = nextEndMin % 60;
      start = `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
      end = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
    }

    const startMin = parseMinutes(start);
    const endMin = parseMinutes(end);

    if (endMin <= startMin) {
      conflicts.push(`Task "${raw.title}" had end time before start time. Corrected duration to 45m.`);
      const fixedEndMin = startMin + 45;
      const eh = Math.floor(fixedEndMin / 60);
      const em = fixedEndMin % 60;
      end = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
    }

    const duration = parseMinutes(end) - parseMinutes(start);

    // Overlap check with already approved/processed proposed tasks
    const hasInternalOverlap = validTasks.some(t => {
      const s = parseMinutes(t.startTime);
      const e = parseMinutes(t.endTime);
      return startMin < e && endMin > s;
    });

    if (hasInternalOverlap) {
      conflicts.push(`Time slot for "${raw.title}" (${start}–${end}) overlapped with another task in the proposal.`);
      // Shift start time after previous task
      const prev = validTasks[validTasks.length - 1];
      const prevEnd = parseMinutes(prev.endTime) + 15;
      const newEndMin = prevEnd + duration;
      const sh = Math.floor(prevEnd / 60);
      const sm = prevEnd % 60;
      const eh = Math.floor(newEndMin / 60);
      const em = newEndMin % 60;
      start = `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
      end = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
    }

    // Overlap check with fixed existing commitments on calendar
    const hasExternalOverlap = occupiedSlots.some(slot => {
      return parseMinutes(start) < slot.end && parseMinutes(end) > slot.start;
    });

    if (hasExternalOverlap) {
      conflicts.push(`"${raw.title}" conflicted with an existing task already on your calendar.`);
    }

    // Budget check
    if (accumulatedMinutes + duration > budgetMinutes) {
      conflicts.push(`Proposed schedule exceeded daily focus budget (${budgetHours}h). Stopped adding further tasks.`);
      break;
    }

    accumulatedMinutes += duration;

    // Category matching
    const sectionId = validSectionIds.has(raw.sectionId) ? raw.sectionId : fallbackSectionId;
    const sec = availableSections.find(s => s.id === sectionId);

    validTasks.push({
      title: raw.title.trim(),
      startTime: start,
      endTime: end,
      scheduledMinutes: duration,
      sectionId,
      sectionName: sec?.name,
      description: typeof raw.description === 'string' ? raw.description : '',
      strategy: typeof raw.strategy === 'string' ? raw.strategy : '',
      priority: raw.priority === 'High' || raw.priority === 'Low' ? raw.priority : 'Medium',
      mustDo: Boolean(raw.mustDo),
      status: 'not_started',
    });
  }

  return {
    rationale,
    recommendations,
    conflicts,
    proposedTasks: validTasks,
  };
}
