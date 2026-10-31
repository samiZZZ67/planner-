'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getActiveTimer, saveActiveTimer, db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import {
  sendPomodoroNotification,
  getNotificationStatus,
  requestNotificationPermission,
  type NotificationStatus,
} from '@/lib/notifications/notificationManager';
import type { ActiveTimer, PomodoroMode, TimeLog } from '@/types';

export const POMODORO_FOCUS_MS = 25 * 60 * 1000; // 25 minutes
export const POMODORO_BREAK_MS = 5 * 60 * 1000;  // 5 minutes

function formatEpochTime(ms?: number): string {
  if (!ms) return '';
  try {
    const d = new Date(ms);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function useTimer() {
  const [activeTimer, setActiveTimerState] = useState<ActiveTimer | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [notificationStatus, setNotificationStatus] = useState<NotificationStatus>('default');
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Check notification status on mount
  useEffect(() => {
    setNotificationStatus(getNotificationStatus());
  }, []);

  const refreshNotificationStatus = useCallback(() => {
    setNotificationStatus(getNotificationStatus());
  }, []);

  // Request permission helper
  const enableNotifications = useCallback(async () => {
    const result = await requestNotificationPermission();
    setNotificationStatus(result);
    return result;
  }, []);

  // Load timer from Dexie on mount
  useEffect(() => {
    getActiveTimer().then(timer => {
      if (timer) {
        setActiveTimerState(timer);
        if (timer.isRunning) {
          setElapsedMs(timer.accumulatedMs + (Date.now() - timer.startedAt));
        } else {
          setElapsedMs(timer.accumulatedMs);
        }
      }
    });
  }, []);

  // Live timer tick and auto Pomodoro completion
  useEffect(() => {
    if (activeTimer && activeTimer.isRunning) {
      const updateClock = async () => {
        const currentElapsed = activeTimer.accumulatedMs + (Date.now() - activeTimer.startedAt);
        setElapsedMs(currentElapsed);

        const target = activeTimer.targetDurationMs || POMODORO_FOCUS_MS;
        const mode = activeTimer.mode || 'focus';

        // Check if current Pomodoro session reached target
        if (currentElapsed >= target) {
          if (mode === 'focus') {
            const nextCompleted = (activeTimer.completedPomodoros || 0) + 1;
            const totalPlanned = activeTimer.totalSessionsPlanned || 1;
            const isAllComplete = nextCompleted >= totalPlanned;

            // Log 25 minutes to TimeLog for Analytics
            const todayDate = new Date().toLocaleDateString('en-CA');
            const newLog: TimeLog = {
              id: crypto.randomUUID(),
              taskId: activeTimer.taskId,
              date: todayDate,
              minutes: 25,
              source: 'timer',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              deleted: false,
              isSample: false,
              synced: 0,
            };
            await db.timeLogs.put(newLog);
            syncEngine.notifyLocalMutation();

            if (isAllComplete) {
              // Task target completed!
              await sendPomodoroNotification('task_complete', {
                taskTitle: activeTimer.taskTitle,
                sessionIndex: nextCompleted,
                totalSessions: totalPlanned,
              });
            } else {
              // 25m Focus done -> notify break
              await sendPomodoroNotification('break_start', {
                taskTitle: activeTimer.taskTitle,
                sessionIndex: nextCompleted,
                totalSessions: totalPlanned,
              });
            }

            // Transition to 5-minute break
            const breakTimer: ActiveTimer = {
              ...activeTimer,
              mode: 'break',
              startedAt: Date.now(),
              accumulatedMs: 0,
              targetDurationMs: POMODORO_BREAK_MS,
              completedPomodoros: nextCompleted,
              isRunning: true,
            };
            setActiveTimerState(breakTimer);
            await saveActiveTimer(breakTimer);
            setElapsedMs(0);
          } else {
            // Completed 5-minute break session!
            const totalPlanned = activeTimer.totalSessionsPlanned || 1;
            const nextSession = (activeTimer.completedPomodoros || 0) + 1;

            await sendPomodoroNotification('break_end', {
              taskTitle: activeTimer.taskTitle,
              sessionIndex: nextSession,
              totalSessions: totalPlanned,
            });

            // Ready for next focus block
            const nextFocusTimer: ActiveTimer = {
              ...activeTimer,
              mode: 'focus',
              startedAt: Date.now(),
              accumulatedMs: 0,
              targetDurationMs: POMODORO_FOCUS_MS,
              isRunning: false, // Paused so user can take a breath and hit Resume when ready
            };
            setActiveTimerState(nextFocusTimer);
            await saveActiveTimer(nextFocusTimer);
            setElapsedMs(0);
          }
        }
      };

      updateClock();
      timerRef.current = setInterval(updateClock, 500);

      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    } else if (activeTimer && !activeTimer.isRunning) {
      setElapsedMs(activeTimer.accumulatedMs);
    } else {
      setElapsedMs(0);
    }
  }, [activeTimer]);

  // Stop timer and log actual focus minutes spent
  const stopTimer = useCallback(async () => {
    if (!activeTimer) return;

    const currentTotalMs = activeTimer.isRunning
      ? activeTimer.accumulatedMs + (Date.now() - activeTimer.startedAt)
      : activeTimer.accumulatedMs;

    // Only log time if in 'focus' mode and spent at least 1 minute
    if ((activeTimer.mode || 'focus') === 'focus') {
      const minutes = Math.round(currentTotalMs / (60 * 1000));
      if (minutes >= 1) {
        const todayDate = new Date().toLocaleDateString('en-CA');
        const newLog: TimeLog = {
          id: crypto.randomUUID(),
          taskId: activeTimer.taskId,
          date: todayDate,
          minutes,
          source: 'timer',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deleted: false,
          isSample: false,
          synced: 0,
        };
        await db.timeLogs.put(newLog);
        syncEngine.notifyLocalMutation();
      }
    }

    await saveActiveTimer(null);
    setActiveTimerState(null);
    setElapsedMs(0);
  }, [activeTimer]);

  // Start Pomodoro timer on a task with target duration or section color
  const startTimer = useCallback(
    async (
      taskId: string,
      taskTitle: string,
      durationOrColor: number | string = 25,
      sectionColorParam = '#ffffff'
    ) => {
      let durationMinutes = 25;
      let sectionColor = sectionColorParam;

      if (typeof durationOrColor === 'number') {
        durationMinutes = durationOrColor;
      } else if (typeof durationOrColor === 'string') {
        sectionColor = durationOrColor;
      }

      // If a different timer was running, stop it and log progress first
      if (activeTimer && activeTimer.taskId !== taskId) {
        await stopTimer();
      }

      const sessionsNeeded = Math.max(1, Math.ceil(durationMinutes / 25));
      const totalSpanMinutes = sessionsNeeded * 25 + (sessionsNeeded - 1) * 5;
      const expectedCompletionMs = Date.now() + totalSpanMinutes * 60 * 1000;
      const now = Date.now();

      const newTimer: ActiveTimer = {
        taskId,
        taskTitle,
        sectionColor,
        startedAt: now,
        accumulatedMs: 0,
        isRunning: true,
        mode: 'focus',
        targetDurationMs: POMODORO_FOCUS_MS,
        completedPomodoros: activeTimer?.taskId === taskId ? (activeTimer.completedPomodoros || 0) : 0,
        totalTargetMinutes: durationMinutes,
        totalSessionsPlanned: sessionsNeeded,
        expectedCompletionEpochMs: expectedCompletionMs,
      };

      setActiveTimerState(newTimer);
      await saveActiveTimer(newTimer);
      setElapsedMs(0);

      // Trigger focus start notification and sound
      await sendPomodoroNotification('focus_start', {
        taskTitle,
        sessionIndex: (newTimer.completedPomodoros || 0) + 1,
        totalSessions: sessionsNeeded,
        expectedCompletion: formatEpochTime(expectedCompletionMs),
      });
    },
    [activeTimer, stopTimer]
  );

  const pauseTimer = useCallback(async () => {
    if (!activeTimer || !activeTimer.isRunning) return;

    const currentAccumulated = activeTimer.accumulatedMs + (Date.now() - activeTimer.startedAt);
    const updated: ActiveTimer = {
      ...activeTimer,
      accumulatedMs: currentAccumulated,
      isRunning: false,
    };

    setActiveTimerState(updated);
    await saveActiveTimer(updated);
  }, [activeTimer]);

  const resumeTimer = useCallback(async () => {
    if (!activeTimer || activeTimer.isRunning) return;

    const updated: ActiveTimer = {
      ...activeTimer,
      startedAt: Date.now(),
      isRunning: true,
    };

    setActiveTimerState(updated);
    await saveActiveTimer(updated);

    if (updated.mode === 'focus') {
      await sendPomodoroNotification('focus_start', {
        taskTitle: updated.taskTitle,
        sessionIndex: (updated.completedPomodoros || 0) + 1,
        totalSessions: updated.totalSessionsPlanned || 1,
      });
    }
  }, [activeTimer]);

  // Skip break and start next focus session immediately
  const skipBreak = useCallback(async () => {
    if (!activeTimer) return;
    const nextTimer: ActiveTimer = {
      ...activeTimer,
      mode: 'focus',
      startedAt: Date.now(),
      accumulatedMs: 0,
      targetDurationMs: POMODORO_FOCUS_MS,
      isRunning: true,
    };
    setActiveTimerState(nextTimer);
    await saveActiveTimer(nextTimer);
    setElapsedMs(0);

    await sendPomodoroNotification('focus_start', {
      taskTitle: nextTimer.taskTitle,
      sessionIndex: (nextTimer.completedPomodoros || 0) + 1,
      totalSessions: nextTimer.totalSessionsPlanned || 1,
    });
  }, [activeTimer]);

  // Calculate remaining countdown in MM:SS
  const targetMs = activeTimer?.targetDurationMs || POMODORO_FOCUS_MS;
  const remainingMs = Math.max(0, targetMs - elapsedMs);
  const remainingSecs = Math.floor(remainingMs / 1000);
  const mins = Math.floor(remainingSecs / 60);
  const secs = remainingSecs % 60;
  const formattedCountdown = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  const currentSessionNumber = (activeTimer?.completedPomodoros || 0) + 1;
  const totalSessions = activeTimer?.totalSessionsPlanned || 1;
  const expectedCompletionFormatted = formatEpochTime(activeTimer?.expectedCompletionEpochMs);

  return {
    activeTimer,
    elapsedMs,
    remainingMs,
    formattedCountdown,
    formattedTime: formattedCountdown,
    mode: (activeTimer?.mode || 'focus') as PomodoroMode,
    isFocus: (activeTimer?.mode || 'focus') === 'focus',
    isBreak: activeTimer?.mode === 'break',
    completedPomodoros: activeTimer?.completedPomodoros || 0,
    currentSessionNumber,
    totalSessions,
    expectedCompletionFormatted,
    notificationStatus,
    refreshNotificationStatus,
    enableNotifications,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    skipBreak,
    isTimerRunning: activeTimer?.isRunning ?? false,
    currentTaskId: activeTimer?.taskId ?? null,
  };
}
