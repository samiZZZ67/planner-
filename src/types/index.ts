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
}

export interface Day {
  id: string; // YYYY-MM-DD
  date: string;
  freeHours: number;
  review: DayReview;
  updatedAt: number;
  deleted: boolean;
  isSample: boolean;
  synced?: number;
  serverSeq?: number;
}

export interface ActiveTimer {
  taskId: string;
  taskTitle: string;
  sectionColor: string;
  startedAt: number;
  accumulatedMs: number;
  isRunning: boolean;
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

export interface SyncPayload {
  lastServerSeq: number;
  sections: Section[];
  tasks: Task[];
  timeLogs: TimeLog[];
  days: Day[];
}

export interface SyncResponse {
  ok: boolean;
  currentServerSeq: number;
  acknowledgedIds: {
    sections: string[];
    tasks: string[];
    timeLogs: string[];
    days: string[];
  };
  serverChanges: {
    sections: Section[];
    tasks: Task[];
    timeLogs: TimeLog[];
    days: Day[];
  };
  error?: string;
}
