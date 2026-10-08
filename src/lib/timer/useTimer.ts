'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getActiveTimer, saveActiveTimer, db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import type { ActiveTimer, TimeLog } from '@/types';

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

  // Calculate live clock ticks without counting ticks (always uses Date.now())
  useEffect(() => {
    if (activeTimer && activeTimer.isRunning) {
      const updateClock = () => {
        const current = activeTimer.accumulatedMs + (Date.now() - activeTimer.startedAt);
        setElapsedMs(current);
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

  const stopTimer = useCallback(async () => {
    if (!activeTimer) return;

    const currentTotalMs = activeTimer.isRunning
      ? activeTimer.accumulatedMs + (Date.now() - activeTimer.startedAt)
      : activeTimer.accumulatedMs;

    const minutes = Math.max(1, Math.round(currentTotalMs / (60 * 1000)));

    const todayDate = new Date().toISOString().split('T')[0];
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
    await saveActiveTimer(null);
    setActiveTimerState(null);
    setElapsedMs(0);

    syncEngine.notifyLocalMutation();
  }, [activeTimer]);

  const startTimer = useCallback(async (taskId: string, taskTitle: string, sectionColor?: string) => {
    // If a different timer is running, stop it first
    if (activeTimer && activeTimer.taskId !== taskId) {
      await stopTimer();
    }

    const now = Date.now();
    const newTimer: ActiveTimer = {
      taskId,
      taskTitle,
      sectionColor: sectionColor || '#8b5cf6',
      startedAt: now,
      accumulatedMs: 0,
      isRunning: true,
    };

    setActiveTimerState(newTimer);
    await saveActiveTimer(newTimer);
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

  // Format time as HH:MM:SS or MM:SS
  const formatTime = (ms: number): string => {
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');
    if (hours > 0) {
      return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  };

  return {
    activeTimer,
    elapsedMs,
    formattedTime: formatTime(elapsedMs),
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    isTimerRunning: activeTimer?.isRunning ?? false,
    currentTaskId: activeTimer?.taskId ?? null,
  };
}
