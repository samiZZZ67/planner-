import { db, getUnsyncedChanges, getLastServerSeq, setLastServerSeq, getLastSyncedTime, setLastSyncedTime } from '@/lib/db';
import { resolveRecordConflict, calculateBackoffDelay } from './syncLogic';
import type { SyncStatus, SyncPayload, SyncResponse } from '@/types';
import { apiFetch } from '@/lib/api/apiClient';
import { getSocket, notifySyncUpdate } from './socketClient';

type SyncListener = (state: SyncEngineState) => void;

export interface SyncEngineState {
  status: SyncStatus;
  unsyncedCount: number;
  lastSyncedAt: number | null;
  errorMessage: string | null;
  warningIfStale: boolean;
  secondsUntilSync?: number;
}

class SyncEngine {
  private state: SyncEngineState = {
    status: 'idle',
    unsyncedCount: 0,
    lastSyncedAt: null,
    errorMessage: null,
    warningIfStale: false,
  };

  private listeners = new Set<SyncListener>();
  private isSyncing = false;
  private retryCount = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private countdownInterval: NodeJS.Timeout | null = null;
  private syncCountdown = 0;
  private firstUnsyncedTimestamp: number | null = null;
  private initialized = false;

  public init() {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;

    // Load last sync time
    getLastSyncedTime().then(time => {
      this.state.lastSyncedAt = time;
      this.notifyListeners();
    });

    // Check unsynced records initially
    this.refreshUnsyncedCount();

    // Listen to network changes
    window.addEventListener('online', () => {
      this.retryCount = 0;
      this.triggerSync();
    });

    window.addEventListener('offline', () => {
      this.updateState({ status: 'offline' });
    });

    // Real-time synchronization via Socket.IO across Phone and PC
    const socket = getSocket();
    if (socket) {
      socket.on('sync:remote_update', () => {
        // Another connected device updated tasks; sync immediately!
        if (navigator.onLine && !this.isSyncing) {
          this.triggerSync();
        }
      });
    }

    // Sync on focus/visibility only if not currently waiting for 30s save window
    window.addEventListener('focus', () => {
      if (navigator.onLine && !this.isSyncing && !this.debounceTimer) {
        this.triggerSync();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && navigator.onLine && !this.isSyncing && !this.debounceTimer) {
        this.triggerSync();
      }
    });

    // Periodic sync check every 30 seconds
    setInterval(() => {
      if (navigator.onLine && !this.isSyncing && !document.hidden && !this.debounceTimer) {
        this.triggerSync();
      }
    }, 30000);

    // Periodic background sync when hidden
    setInterval(() => {
      if (navigator.onLine && !this.isSyncing && document.hidden) {
        this.triggerSync();
      }
    }, 60000);

    // Stale changes check every 30 seconds
    setInterval(() => {
      this.checkStaleChanges();
    }, 30000);

    // Initial sync
    setTimeout(() => {
      this.triggerSync();
    }, 300);
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  public getState(): SyncEngineState {
    return this.state;
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private updateState(partial: Partial<SyncEngineState>) {
    this.state = { ...this.state, ...partial };
    this.notifyListeners();
  }

  public async refreshUnsyncedCount(): Promise<number> {
    try {
      const unsynced = await getUnsyncedChanges();
      const count =
        unsynced.sections.length +
        unsynced.tasks.length +
        unsynced.timeLogs.length +
        unsynced.days.length +
        (unsynced.weeklyPlans?.length || 0) +
        (unsynced.monthlyPlans?.length || 0);

      if (count > 0 && !this.firstUnsyncedTimestamp) {
        this.firstUnsyncedTimestamp = Date.now();
      } else if (count === 0) {
        this.firstUnsyncedTimestamp = null;
      }

      this.checkStaleChanges();
      this.updateState({
        unsyncedCount: count,
        status: !navigator.onLine
          ? 'offline'
          : count > 0 && this.state.status !== 'syncing'
          ? 'changes_waiting'
          : this.state.status,
      });

      return count;
    } catch {
      return 0;
    }
  }

  private checkStaleChanges() {
    if (this.state.unsyncedCount > 0 && navigator.onLine && this.firstUnsyncedTimestamp) {
      const fiveMinutesMs = 5 * 60 * 1000;
      const isStale = Date.now() - this.firstUnsyncedTimestamp > fiveMinutesMs;
      if (this.state.warningIfStale !== isStale) {
        this.updateState({ warningIfStale: isStale });
      }
    } else {
      if (this.state.warningIfStale) {
        this.updateState({ warningIfStale: false });
      }
    }
  }

  public notifyLocalMutation() {
    this.refreshUnsyncedCount();

    // Reset countdown and debounce timers
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.countdownInterval) clearInterval(this.countdownInterval);

    // Requirement: When saving, wait 2 minutes (120s) after last edit before saving to server
    this.syncCountdown = 120;
    this.updateState({
      status: 'changes_waiting',
      secondsUntilSync: 120,
    });

    this.countdownInterval = setInterval(() => {
      this.syncCountdown -= 1;
      if (this.syncCountdown > 0) {
        this.updateState({
          status: 'changes_waiting',
          secondsUntilSync: this.syncCountdown,
        });
      } else {
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
    }, 1000);

    this.debounceTimer = setTimeout(() => {
      if (this.countdownInterval) clearInterval(this.countdownInterval);
      this.countdownInterval = null;
      this.debounceTimer = null;
      this.updateState({ secondsUntilSync: 0 });
      this.triggerSync();
    }, 120000);
  }

  public async triggerSync(): Promise<void> {
    if (this.isSyncing) return;
    if (typeof window === 'undefined') return;

    // Clear 2-minute wait timers when triggerSync is called
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.syncCountdown = 0;
    this.updateState({ secondsUntilSync: 0 });

    if (!navigator.onLine) {
      this.updateState({ status: 'offline' });
      return;
    }

    this.isSyncing = true;
    this.updateState({ status: 'syncing', errorMessage: null });

    try {
      const unsynced = await getUnsyncedChanges();
      const lastServerSeq = await getLastServerSeq();

      const payload: SyncPayload = {
        lastServerSeq,
        sections: unsynced.sections,
        tasks: unsynced.tasks,
        timeLogs: unsynced.timeLogs,
        days: unsynced.days,
        weeklyPlans: unsynced.weeklyPlans,
        monthlyPlans: unsynced.monthlyPlans,
      };

      const response = await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        this.updateState({
          status: 'auth_required',
          errorMessage: 'Login required to sync',
        });
        this.isSyncing = false;
        return;
      }

      if (response.status === 503) {
        // Cloud DB not configured yet (local-only mode)
        this.updateState({
          status: 'offline',
          errorMessage: 'Cloud database not configured',
        });
        this.isSyncing = false;
        return;
      }

      if (!response.ok) {
        throw new Error(`Sync error: ${response.statusText}`);
      }

      const result: SyncResponse = await response.json();

      // 1. Mark pushed records as synced in local Dexie
      await db.transaction('rw', [db.sections, db.tasks, db.timeLogs, db.days, db.weeklyPlans, db.monthlyPlans], async () => {
        for (const id of result.acknowledgedIds.sections) {
          await db.sections.update(id, { synced: 1 });
        }
        for (const id of result.acknowledgedIds.tasks) {
          await db.tasks.update(id, { synced: 1 });
        }
        for (const id of result.acknowledgedIds.timeLogs) {
          await db.timeLogs.update(id, { synced: 1 });
        }
        for (const id of result.acknowledgedIds.days) {
          await db.days.update(id, { synced: 1 });
        }
        if (result.acknowledgedIds.weeklyPlans) {
          for (const id of result.acknowledgedIds.weeklyPlans) {
            await db.weeklyPlans.update(id, { synced: 1 });
          }
        }
        if (result.acknowledgedIds.monthlyPlans) {
          for (const id of result.acknowledgedIds.monthlyPlans) {
            await db.monthlyPlans.update(id, { synced: 1 });
          }
        }
      });

      // 2. Apply remote changes into local Dexie with conflict check
      if (result.serverChanges) {
        const { sections, tasks, timeLogs, days, weeklyPlans, monthlyPlans } = result.serverChanges;

        await db.transaction('rw', [db.sections, db.tasks, db.timeLogs, db.days, db.weeklyPlans, db.monthlyPlans], async () => {
          for (const s of sections) {
            const local = await db.sections.get(s.id);
            const { recordToSave } = resolveRecordConflict(local, s);
            await db.sections.put(recordToSave);
          }
          for (const t of tasks) {
            const local = await db.tasks.get(t.id);
            const { recordToSave } = resolveRecordConflict(local, t);
            await db.tasks.put(recordToSave);
          }
          for (const tl of timeLogs) {
            const local = await db.timeLogs.get(tl.id);
            const { recordToSave } = resolveRecordConflict(local, tl);
            await db.timeLogs.put(recordToSave);
          }
          for (const d of days) {
            const local = await db.days.get(d.id);
            const { recordToSave } = resolveRecordConflict(local, d);
            await db.days.put(recordToSave);
          }
          if (weeklyPlans) {
            for (const w of weeklyPlans) {
              const local = await db.weeklyPlans.get(w.id);
              const { recordToSave } = resolveRecordConflict(local, w);
              await db.weeklyPlans.put(recordToSave);
            }
          }
          if (monthlyPlans) {
            for (const m of monthlyPlans) {
              const local = await db.monthlyPlans.get(m.id);
              const { recordToSave } = resolveRecordConflict(local, m);
              await db.monthlyPlans.put(recordToSave);
            }
          }
        });
      }

      // 3. Update server seq and sync timestamp
      await setLastServerSeq(result.currentServerSeq);
      const now = Date.now();
      await setLastSyncedTime(now);

      // Broadcast update via WebSocket to other devices (Phone <-> PC)
      notifySyncUpdate();

      this.retryCount = 0;
      this.firstUnsyncedTimestamp = null;

      const remainingUnsynced = await this.refreshUnsyncedCount();
      this.updateState({
        status: remainingUnsynced > 0 ? 'changes_waiting' : 'all_saved',
        lastSyncedAt: now,
        warningIfStale: false,
        errorMessage: null,
      });
    } catch (err: any) {
      this.retryCount += 1;
      const retryDelay = calculateBackoffDelay(this.retryCount);
      console.warn(`Sync failed, retrying in ${retryDelay}ms`, err);

      this.updateState({
        status: !navigator.onLine ? 'offline' : 'error',
        errorMessage: err.message || 'Sync failed',
      });

      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.triggerSync();
      }, retryDelay);
    } finally {
      this.isSyncing = false;
    }
  }
}

export const syncEngine = new SyncEngine();
