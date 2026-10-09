export type TargetType = 'at least' | 'at most';
export type PriorityLevel = 'Low' | 'Medium' | 'High';
export type TimeSource = 'timer' | 'manual';

export interface Section {
  id: string;
  name: string;
  color: string;
  icon: string;
  order: number;
  dailyTargetMinutes?: number | null;
  targetType: TargetType;
  updatedAt: number;
  deleted: boolean;
  isSample: boolean;
  synced?: number; // 0 = unsynced, 1 = synced
  serverSeq?: number;
}

export type TaskStatus = 'not_started' | 'in_progress' | 'completed';

export interface Task {
  id: string;
  date: string; // YYYY-MM-DD
  sectionId: string;
  title: string;
  description: string;
  strategy: string; // HTML formatted: bold, colors, highlight
  doneMeans: string;
  estimatedMinutes: number;
  priority: PriorityLevel;
  mustDo: boolean; // Top 3 star, max 3 per day
  tags: string[];
  icon: string;
  textColor?: string;
  isBold?: boolean;
  isUnderline?: boolean;
  isStrikethrough?: boolean;
  targetMinutes?: number;
  expectedCompletionTime?: string;
  image?: string | null; // compressed data URL <= 150KB
  isCompleted: boolean;
  completedAt?: number | null;
  order: number;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  isSample: boolean;
  synced?: number;
  serverSeq?: number;
  // New scheduling fields
  startTime?: string;       // e.g. "14:00" (24h format)
  endTime?: string;         // e.g. "17:00"
  scheduledMinutes?: number; // auto-calculated from startTime/endTime
  actualMinutes?: number;   // actual time spent
  status?: TaskStatus;      // not_started | in_progress | completed
  deadline?: string;        // YYYY-MM-DD
  result?: string;          // outcome/result notes
}

export interface TimeLog {
  id: string;
  taskId: string;
  date: string; // YYYY-MM-DD
  minutes: number;
  source: TimeSource;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  isSample: boolean;
  synced?: number;
  serverSeq?: number;
}

export interface DayReview {
  worked: string;
  blocked: string;
  change: string;
  // Psychological reflection questions
  obstacles?: string;
  happened?: string;
  solved?: string;
  betterTomorrow?: string;
}

export interface DaySheetData {
  notes?: string;
  schedule?: Record<string, string>;
  breakfast?: string;
  lunch?: string;
  dinner?: string;
  snacks?: string;
  waterGlasses?: number;
  exercise?: string;
}

export interface Day {
  id: string; // YYYY-MM-DD
  date: string;
  freeHours: number;
  review: DayReview;
  sheetData?: DaySheetData;
  updatedAt: number;
  deleted: boolean;
  isSample: boolean;
  synced?: number;
  serverSeq?: number;
}

export type PomodoroMode = 'focus' | 'break';

export interface ActiveTimer {
  taskId: string;
  taskTitle: string;
  sectionColor: string;
  startedAt: number;
  accumulatedMs: number;
  isRunning: boolean;
  mode?: PomodoroMode;
  targetDurationMs?: number;
  completedPomodoros?: number;
  totalTargetMinutes?: number;
  expectedCompletionEpochMs?: number;
  totalSessionsPlanned?: number;
}

export interface DraftTask {
  title: string;
  sectionId: string;
  description: string;
  strategy: string;
  doneMeans: string;
  estimatedMinutes: number;
  priority: PriorityLevel;
  mustDo: boolean;
  tags: string[];
  icon: string;
  textColor: string;
  image: string | null;
  updatedAt: number;
}

export type DeviceType = 'phone' | 'pc';

export type SyncStatus = 
  | 'idle' 
  | 'syncing' 
  | 'all_saved' 
  | 'offline' 
  | 'changes_waiting' 
  | 'error' 
  | 'auth_required';

export interface WeeklyPlan {
  id: string; // e.g. "week-2026-W41" or "2026-10-05_2026-10-11"
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  monthId: string; // YYYY-MM
  prompt: string; // Detailed planning prompt (>= 100 words)
  wordCount: number;
  goals: string; // Main goals & expected outcomes
  aastuCommitments: string; // AASTU classes, assignments, deadlines
  deepWorkTargets: string; // Deep-work & video-editing targets
  constraints: string; // Important priorities & constraints
  outcomes: string; // What must be accomplished by end of week
  aiWeeklyReport?: string | null; // Generated progress report
  status: 'active' | 'completed' | 'archived';
  completionPercentage?: number;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  synced?: number;
  serverSeq?: number;
}

export interface MonthlyGoalItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface MonthlyPlan {
  id: string; // e.g. "month-2026-10" or "2026-10"
  month: string; // YYYY-MM
  title: string;
  prompt: string; // Detailed monthly planning prompt
  academicPriorities: string; // AASTU academic priorities
  editingTargets: string; // Video editing / deep work deliverables
  commitments: string; // Personal commitments & deadlines
  goals: MonthlyGoalItem[];
  completionPercentage: number;
  status: 'active' | 'completed' | 'archived';
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  synced?: number;
  serverSeq?: number;
}

export interface AIProviderInfo {
  id: string; // 'gemini-1' | 'gemini-2' | 'gemini-3' | 'xai-grok'
  name: string;
  provider: 'gemini' | 'xai';
  configured: boolean;
  model: string;
  availableModels: string[];
  isRateLimited?: boolean;
}

export interface AIConfigState {
  providers: AIProviderInfo[];
  activeProviderId: string; // 'auto' | specific id
  fallbackEnabled: boolean;
  totalTokensUsed: { prompt: number; completion: number; total: number };
}

export interface ProposedTask {
  id?: string;
  title: string;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  scheduledMinutes: number;
  sectionId: string;
  sectionName?: string;
  description: string;
  strategy: string;
  priority: PriorityLevel;
  mustDo: boolean;
  status: TaskStatus;
}

export interface AIPlanGenerationResult {
  ok: boolean;
  provider: string;
  model: string;
  keyIndex?: number;
  tokensUsed?: { prompt?: number; completion?: number; total?: number };
  latencyMs: number;
  rationale: string;
  recommendations: string[];
  conflicts: string[];
  proposedTasks: ProposedTask[];
  weeklyContextUsed: boolean;
  monthlyContextUsed: boolean;
  fallbackUsed?: boolean;
  error?: string;
}

export interface SyncPayload {
  lastServerSeq: number;
  sections: Section[];
  tasks: Task[];
  timeLogs: TimeLog[];
  days: Day[];
  weeklyPlans?: WeeklyPlan[];
  monthlyPlans?: MonthlyPlan[];
}

export interface SyncResponse {
  ok: boolean;
  currentServerSeq: number;
  acknowledgedIds: {
    sections: string[];
    tasks: string[];
    timeLogs: string[];
    days: string[];
    weeklyPlans?: string[];
    monthlyPlans?: string[];
  };
  serverChanges: {
    sections: Section[];
    tasks: Task[];
    timeLogs: TimeLog[];
    days: Day[];
    weeklyPlans?: WeeklyPlan[];
    monthlyPlans?: MonthlyPlan[];
  };
  error?: string;
}
