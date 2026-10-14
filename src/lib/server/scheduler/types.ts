export type ScheduledMessageType = 'book_reading' | 'daily_plan' | 'weekly_report' | 'custom_message';
export type ScheduledMessageStatus = 'scheduled' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface ScheduledMessageRecord {
  id: string;
  userId: string;
  type: ScheduledMessageType;
  title?: string;
  content: string; // The message text, or prompt/context for AI generation
  scheduledAt: number; // Target UTC epoch milliseconds
  timezone: string;
  status: ScheduledMessageStatus;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt: number | null;
  lastError: string;
  telegramMessageIds: number[];
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface SchedulerExecutionResult {
  timestamp: number;
  isoTime: string;
  automaticPreparation?: any;
  bookJobs: {
    claimed: number;
    completed: number;
    retried: number;
    failed: number;
    alreadyCompleted: number;
  };
  scheduledMessages: {
    claimed: number;
    completed: number;
    retried: number;
    failed: number;
  };
  durationMs: number;
}

export interface SchedulerStatus {
  initialized: boolean;
  running: boolean;
  pid: number;
  cronExpression: string;
  startedAt: number | null;
  lastRunAt: number | null;
  lastResult: SchedulerExecutionResult | null;
  consecutiveErrors: number;
  isCycleRunning: boolean;
}
