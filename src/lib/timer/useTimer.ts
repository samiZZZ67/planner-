'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getActiveTimer, saveActiveTimer, db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import type { ActiveTimer, PomodoroMode, TimeLog } from '@/types';

export const POMODORO_FOCUS_MS = 25 * 60 * 1000; // 25 minutes
export const POMODORO_BREAK_MS = 5 * 60 * 1000;  // 5 minutes

// Web Audio API chime generator for Pomodoro alerts
function playChime(isBreakStart: boolean) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = isBreakStart ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(isBreakStart ? 587.33 : 880, ctx.currentTime); // D5 or A5
    osc.frequency.exponentialRampToValueAtTime(isBreakStart ? 880 : 1174.66, ctx.currentTime + 0.3);

    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // AudioContext not allowed or not supported in background
  }
}

export function useTimer() {
  const [activeTimer, setActiveTimerState] = useState<ActiveTimer | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Load timer from storage on mount
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
            // Completed 25-minute focus session!
            playChime(true);

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

            // Transition to 5-minute break
            const breakTimer: ActiveTimer = {
              ...activeTimer,
              mode: 'break',
              startedAt: Date.now(),
              accumulatedMs: 0,
              targetDurationMs: POMODORO_BREAK_MS,
              completedPomodoros: (activeTimer.completedPomodoros || 0) + 1,
              isRunning: true,
            };
            setActiveTimerState(breakTimer);
            await saveActiveTimer(breakTimer);
            setElapsedMs(0);
          } else {
            // Completed 5-minute break session!
            playChime(false);

            // Ready for next focus block
            const nextFocusTimer: ActiveTimer = {
              ...activeTimer,
              mode: 'focus',
              startedAt: Date.now(),
              accumulatedMs: 0,
              targetDurationMs: POMODORO_FOCUS_MS,
              isRunning: false, // Pause so user chooses when to resume next focus block
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

  // Start 25-minute Pomodoro focus session on a task
  const startTimer = useCallback(async (taskId: string, taskTitle: string, sectionColor?: string) => {
    // If a different timer was running, stop it and log progress first
    if (activeTimer && activeTimer.taskId !== taskId) {
      await stopTimer();
    }

    const now = Date.now();
    const newTimer: ActiveTimer = {
      taskId,
      taskTitle,
      sectionColor: sectionColor || '#38bdf8',
      startedAt: now,
      accumulatedMs: 0,
      isRunning: true,
      mode: 'focus',
      targetDurationMs: POMODORO_FOCUS_MS,
      completedPomodoros: activeTimer?.taskId === taskId ? (activeTimer.completedPomodoros || 0) : 0,
    };

    setActiveTimerState(newTimer);
    await saveActiveTimer(newTimer);
    setElapsedMs(0);
  }, [activeTimer, stopTimer]);

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
  }, [activeTimer]);

  // Calculate remaining countdown in MM:SS
  const targetMs = activeTimer?.targetDurationMs || POMODORO_FOCUS_MS;
  const remainingMs = Math.max(0, targetMs - elapsedMs);
  const remainingSecs = Math.floor(remainingMs / 1000);
  const mins = Math.floor(remainingSecs / 60);
  const secs = remainingSecs % 60;
  const formattedCountdown = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

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
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    skipBreak,
    isTimerRunning: activeTimer?.isRunning ?? false,
    currentTaskId: activeTimer?.taskId ?? null,
  };
}
