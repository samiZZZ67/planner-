import { describe, it, expect } from 'vitest';
import { resolveRecordConflict, mergeServerChanges, calculateBackoffDelay, type SyncableRecord } from './syncLogic';

describe('Sync Logic Tests', () => {
  describe('Conflict Resolution (Newest updatedAt wins)', () => {
    it('should let incoming remote record win when remote is newer than local', () => {
      const localTask: SyncableRecord = {
        id: 'task-1',
        title: 'Draft Task Title',
        updatedAt: 1000,
        deleted: false,
        synced: 1,
      };

      const remoteTask: SyncableRecord = {
        id: 'task-1',
        title: 'Updated Task Title on PC',
        updatedAt: 2000,
        deleted: false,
      };

      const result = resolveRecordConflict(localTask, remoteTask);
      expect(result.source).toBe('remote');
      expect(result.recordToSave.title).toBe('Updated Task Title on PC');
      expect(result.recordToSave.synced).toBe(1);
    });

    it('should keep local unsynced record when local is strictly newer than remote', () => {
      const localTask: SyncableRecord = {
        id: 'task-2',
        title: 'Edited on Phone Offline',
        updatedAt: 5000,
        deleted: false,
        synced: 0, // Unsynced local edit
      };

      const remoteTask: SyncableRecord = {
        id: 'task-2',
        title: 'Older Server Version',
        updatedAt: 4000,
        deleted: false,
      };

      const result = resolveRecordConflict(localTask, remoteTask);
      expect(result.source).toBe('local');
      expect(result.recordToSave.title).toBe('Edited on Phone Offline');
      expect(result.recordToSave.synced).toBe(0);
    });

    it('should insert brand new remote record if local does not have it yet', () => {
      const remoteTask: SyncableRecord = {
        id: 'task-3',
        title: 'Brand New Task from PC',
        updatedAt: 3000,
        deleted: false,
      };

      const result = resolveRecordConflict(undefined, remoteTask);
      expect(result.source).toBe('remote');
      expect(result.recordToSave.id).toBe('task-3');
      expect(result.recordToSave.synced).toBe(1);
    });
  });

  describe('Soft Delete Propagation', () => {
    it('should apply soft delete when remote record is deleted and newer', () => {
      const localTask: SyncableRecord = {
        id: 'task-4',
        title: 'Active Task',
        updatedAt: 1000,
        deleted: false,
        synced: 1,
      };

      const remoteDeletedTask: SyncableRecord = {
        id: 'task-4',
        title: 'Active Task',
        updatedAt: 2500,
        deleted: true, // soft-deleted on another client
      };

      const result = resolveRecordConflict(localTask, remoteDeletedTask);
      expect(result.source).toBe('remote');
      expect(result.recordToSave.deleted).toBe(true);
      expect(result.recordToSave.updatedAt).toBe(2500);
    });

    it('should keep local resurrected/updated task if local updatedAt is newer than remote delete', () => {
      const localTask: SyncableRecord = {
        id: 'task-5',
        title: 'Re-activated Task',
        updatedAt: 4000,
        deleted: false,
        synced: 0,
      };

      const remoteDeletedTask: SyncableRecord = {
        id: 'task-5',
        title: 'Task deleted earlier',
        updatedAt: 3000,
        deleted: true,
      };

      const result = resolveRecordConflict(localTask, remoteDeletedTask);
      expect(result.source).toBe('local');
      expect(result.recordToSave.deleted).toBe(false);
    });
  });

  describe('Batch Merging & Idempotence', () => {
    it('merging the same remote records multiple times produces identical state without duplicates', () => {
      const localRecords: SyncableRecord[] = [
        { id: '1', title: 'Task 1', updatedAt: 1000, deleted: false, synced: 1 },
      ];

      const remoteChanges: SyncableRecord[] = [
        { id: '1', title: 'Task 1 Updated', updatedAt: 2000, deleted: false },
        { id: '2', title: 'Task 2 New', updatedAt: 2000, deleted: false },
      ];

      const pass1 = mergeServerChanges(localRecords, remoteChanges);
      expect(pass1.merged).toHaveLength(2);
      expect(pass1.merged.find(r => r.id === '1')?.title).toBe('Task 1 Updated');

      // Second identical sync pass (retrying)
      const pass2 = mergeServerChanges(pass1.merged, remoteChanges);
      expect(pass2.merged).toHaveLength(2);
      expect(pass2.merged.find(r => r.id === '1')?.title).toBe('Task 1 Updated');
      expect(pass2.merged.find(r => r.id === '2')?.title).toBe('Task 2 New');
    });
  });

  describe('Retry Backoff Logic', () => {
    it('exponentially increases delay up to a max limit', () => {
      const delay0 = calculateBackoffDelay(0, 3000, 60000);
      const delay1 = calculateBackoffDelay(1, 3000, 60000);
      const delay2 = calculateBackoffDelay(2, 3000, 60000);
      const delay10 = calculateBackoffDelay(10, 3000, 60000);

      expect(delay0).toBe(3000);
      expect(delay1).toBe(6000);
      expect(delay2).toBe(12000);
      expect(delay10).toBe(60000); // capped at max
    });
  });
});
