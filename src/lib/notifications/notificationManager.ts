'use client';

export type NotificationStatus = 'granted' | 'denied' | 'default' | 'unsupported';

export type PomodoroEventType =
  | 'focus_start'
  | 'break_start'
  | 'break_end'
  | 'task_complete'
  | 'test';

// Web Audio API chime generator for Pomodoro alerts
export function playPomodoroSound(eventType: PomodoroEventType) {
  if (typeof window === 'undefined') return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (eventType === 'break_start') {
      // Gentle ascending 2-tone chime for break
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.3); // G5
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.8);
    } else if (eventType === 'task_complete') {
      // Celebratory fanfare tone
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, ctx.currentTime); // A4
      osc.frequency.setValueAtTime(554.37, ctx.currentTime + 0.15); // C#5
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.3); // E5
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 1.0);
    } else {
      // Focus start / prompt beep
      osc.type = 'sine';
      osc.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.2); // A5
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    }
  } catch {
    // AudioContext blocked by browser autoplay policy if no interaction
  }
}

export function getNotificationStatus(): NotificationStatus {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission as NotificationStatus;
}

export async function requestNotificationPermission(): Promise<NotificationStatus> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const res = await Notification.requestPermission();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('night_planner_notification_prompted', 'true');
    }
    return res as NotificationStatus;
  } catch {
    return 'denied';
  }
}

export function hasUserBeenPromptedForNotifications(): boolean {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
  return localStorage.getItem('night_planner_notification_prompted') === 'true';
}

export interface PomodoroNotificationPayload {
  taskTitle: string;
  sessionIndex?: number;
  totalSessions?: number;
  expectedCompletion?: string;
}

export async function sendPomodoroNotification(
  eventType: PomodoroEventType,
  payload: PomodoroNotificationPayload
): Promise<boolean> {
  // Always play the crisp audio sound chime immediately
  playPomodoroSound(eventType);

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  if (Notification.permission !== 'granted') {
    return false;
  }

  let title = 'Night Planner';
  let body = '';
  const sessionText = payload.sessionIndex && payload.totalSessions 
    ? ` (Session ${payload.sessionIndex}/${payload.totalSessions})`
    : '';

  switch (eventType) {
    case 'focus_start':
      title = `🎯 Focus Session Started${sessionText}`;
      body = `25 minutes of deep focus on: "${payload.taskTitle}". Phone silenced.`;
      break;
    case 'break_start':
      title = `☕ Focus Complete — Break Time!`;
      body = `Well done! 25m focus done for "${payload.taskTitle}". Take a 5-minute break.`;
      break;
    case 'break_end':
      title = `🔔 Break Over — Next Session Ready`;
      body = `Break finished. Ready for your next focus session on "${payload.taskTitle}"!`;
      break;
    case 'task_complete':
      title = `🎉 Target Time Reached!`;
      body = `All Pomodoro sessions complete for "${payload.taskTitle}". Excellent work!`;
      break;
    case 'test':
      title = `✅ Notifications Enabled!`;
      body = `Night Planner Pomodoro alerts will notify you both online and offline.`;
      break;
  }

  const options: NotificationOptions = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: `pomodoro-${eventType}`,
    requireInteraction: false,
    silent: false,
  };

  try {
    // 1. Try Service Worker showNotification if active (works better in background / PWA)
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, options);
      return true;
    }

    // 2. Fallback to standard Window Notification
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}
