export interface SyncableRecord {
  id: string;
  updatedAt: number;
  deleted: boolean;
  synced?: number;
  [key: string]: any;
}

/**
 * Deterministic Conflict Resolution Rule: Newest updatedAt wins.
 * If local has unsaved offline modifications that are NEWER than the incoming remote record,
 * local is kept and marked to be pushed on the next sync.
 * Otherwise, remote record wins and is accepted as synced.
 */
export function resolveRecordConflict<T extends SyncableRecord>(
  local: T | undefined,
  remote: T
): { recordToSave: T; source: 'local' | 'remote' } {
  if (!local) {
    return {
      recordToSave: { ...remote, synced: 1 },
      source: 'remote',
    };
  }

  // If local has unsynced changes and local is strictly newer than remote:
  if (local.synced === 0 && local.updatedAt > remote.updatedAt) {
    return {
      recordToSave: local,
      source: 'local',
    };
  }

  // Otherwise, remote record is equal or newer, so remote wins:
  return {
    recordToSave: { ...remote, synced: 1 },
    source: 'remote',
  };
}

/**
 * Merge an array of incoming server changes into a local collection of records.
 */
export function mergeServerChanges<T extends SyncableRecord>(
  localRecords: T[],
  remoteChanges: T[]
): {
  merged: T[];
  appliedCount: number;
} {
  const localMap = new Map<string, T>(localRecords.map(r => [r.id, r]));
  let appliedCount = 0;

  for (const remote of remoteChanges) {
    const local = localMap.get(remote.id);
    const { recordToSave, source } = resolveRecordConflict(local, remote);
    localMap.set(remote.id, recordToSave);
    if (source === 'remote') {
      appliedCount += 1;
    }
  }

  return {
    merged: Array.from(localMap.values()),
    appliedCount,
  };
}

/**
 * Exponential backoff calculation for sync retries
 */
export function calculateBackoffDelay(attempt: number, baseMs = 3000, maxMs = 60000): number {
  const exp = Math.min(attempt, 6);
  const delay = Math.min(baseMs * Math.pow(2, exp), maxMs);
  // Add a small deterministic pseudo-jitter
  return Math.round(delay);
}
