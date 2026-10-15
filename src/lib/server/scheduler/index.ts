import cron, { ScheduledTask } from 'node-cron';
import { runScheduledDeliveryCycle, isSchedulerCycleRunning } from './service';
import type { SchedulerExecutionResult, SchedulerStatus } from './types';

export * from './types';
export * from './scheduledMessages';
export * from './briefs';
export * from './service';

const GLOBAL_SCHEDULER_KEY = Symbol.for('__NIGHTPLANNER_CRON_SCHEDULER__');

interface GlobalSchedulerState {
  initialized: boolean;
  running: boolean;
  task: ScheduledTask | null;
  pid: number;
  cronExpression: string;
  startedAt: number | null;
  lastRunAt: number | null;
  lastResult: SchedulerExecutionResult | null;
  consecutiveErrors: number;
}

function getGlobalState(): GlobalSchedulerState {
  const g = globalThis as any;
  if (!g[GLOBAL_SCHEDULER_KEY]) {
    g[GLOBAL_SCHEDULER_KEY] = {
      initialized: false,
      running: false,
      task: null,
      pid: process.pid,
      cronExpression: '* * * * *',
      startedAt: null,
      lastRunAt: null,
      lastResult: null,
      consecutiveErrors: 0,
    };
  }
  return g[GLOBAL_SCHEDULER_KEY];
}

export interface InitSchedulerOptions {
  runImmediately?: boolean;
  cronExpression?: string;
}

/**
 * Initialize the background cron scheduler.
 * Guaranteed to be called exactly once per running Node.js process.
 */
export function initScheduler(options: InitSchedulerOptions = {}): SchedulerStatus {
  const state = getGlobalState();

  if (state.initialized && state.running) {
    console.log(`[Scheduler] ℹ️ Scheduler is already active (PID: ${process.pid}). Ignoring duplicate init.`);
    return getSchedulerStatus();
  }

  const cronExpression = options.cronExpression || '* * * * *';
  state.cronExpression = cronExpression;
  state.pid = process.pid;
  state.startedAt = Date.now();
  state.initialized = true;

  console.log(`[Scheduler] 🚀 Initializing NightPlanner Background Scheduler...`);
  console.log(`[Scheduler] • Schedule: "${cronExpression}" (every minute)`);
  console.log(`[Scheduler] • Process ID: ${process.pid}`);
  console.log(`[Scheduler] • Node version: ${process.version}`);
  console.log(`[Scheduler] • Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

  // Schedule task every minute
  const task = cron.schedule(
    cronExpression,
    async () => {
      try {
        state.lastRunAt = Date.now();
        const res = await runScheduledDeliveryCycle(state.lastRunAt);
        state.lastResult = res;
        state.consecutiveErrors = 0;
      } catch (err: any) {
        state.consecutiveErrors++;
        console.error(`[Scheduler] ❌ Unhandled error during scheduled cycle (streak: ${state.consecutiveErrors}):`, err);
      }
    },
    {
      noOverlap: true,
    }
  );

  state.task = task;
  state.running = true;

  // Graceful shutdown hooks
  const shutdown = () => {
    if (state.running) {
      console.log(`[Scheduler] 🛑 Stopping background scheduler on process termination (PID: ${process.pid})...`);
      stopScheduler();
    }
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  console.log(`[Scheduler] ✅ Background scheduler successfully registered and running!`);

  // Run an initial sweep 3 seconds after startup to immediately process any overdue messages
  if (options.runImmediately !== false) {
    setTimeout(async () => {
      try {
        console.log(`[Scheduler] ⚡ Running startup sweep for overdue messages...`);
        state.lastRunAt = Date.now();
        state.lastResult = await runScheduledDeliveryCycle(state.lastRunAt);
      } catch (err: any) {
        console.error('[Scheduler] ❌ Error in startup sweep:', err.message);
      }
    }, 3000);
  }

  return getSchedulerStatus();
}

/**
 * Stop the background scheduler
 */
export function stopScheduler(): void {
  const state = getGlobalState();
  if (state.task) {
    state.task.stop();
    state.task = null;
  }
  state.running = false;
  state.initialized = false;
  console.log(`[Scheduler] ⏹️ Scheduler stopped (PID: ${process.pid}).`);
}

/**
 * Retrieve current status of the background scheduler
 */
export function getSchedulerStatus(): SchedulerStatus {
  const state = getGlobalState();
  return {
    initialized: state.initialized,
    running: state.running,
    pid: state.pid,
    cronExpression: state.cronExpression,
    startedAt: state.startedAt,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    consecutiveErrors: state.consecutiveErrors,
    isCycleRunning: isSchedulerCycleRunning(),
  };
}
