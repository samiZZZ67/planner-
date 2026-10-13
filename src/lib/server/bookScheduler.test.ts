import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBookPublishJob, zonedDateTimeToTimestamp } from './bookScheduler';
import type { BookAssignmentRecord, BookRecord } from '../books/types';

const book: BookRecord = {
  id: 'book-1', userId: 'owner', title: 'Reading', author: '', metadata: '', originalFilename: 'book.pdf', storedFilename: 'book.pdf',
  fileSize: 1, startPage: 1, endPage: 2, durationDays: 1, startDate: '2026-10-13', studyMinutes: 20, postingTime: '08:15', timezone: 'Africa/Nairobi',
  currentPage: 1, status: 'ready', extractionStatus: 'completed', extractionMessage: '', createdAt: 1, updatedAt: 1,
};
const assignment: BookAssignmentRecord = {
  id: 'assignment-1', userId: 'owner', bookId: 'book-1', dayNumber: 1, scheduledDate: '2026-10-13', startPdfPage: 1, endPdfPage: 2,
  concepts: [], estimatedMinutes: 20, rationale: '', status: 'approved', updatedAt: 1,
};

describe('book publishing scheduler', () => {
  afterEach(() => vi.resetModules());

  it('converts local posting time in a configured timezone to UTC', () => {
    expect(new Date(zonedDateTimeToTimestamp('2026-10-13', '08:15', 'Africa/Nairobi')).toISOString()).toBe('2026-10-13T05:15:00.000Z');
  });

  it('persists assignment scheduling date, timezone, and due timestamp in the job shape', () => {
    const job = makeBookPublishJob(book, assignment);
    expect(job.assignmentId).toBe('assignment-1');
    expect(job.scheduledAt).toBe(zonedDateTimeToTimestamp('2026-10-13', '08:15', 'Africa/Nairobi'));
    expect(job.timezone).toBe('Africa/Nairobi');
    expect(job.status).toBe('scheduled');
  });

  it('rejects invalid timezones and malformed local dates', () => {
    expect(() => zonedDateTimeToTimestamp('2026-10-13', '08:15', 'Mars/Olympus')).toThrow();
    expect(() => zonedDateTimeToTimestamp('2026/10/13', '08:15', 'UTC')).toThrow(/valid/i);
  });

  it('persists jobs, respects pause state, and atomically claims due local-fallback jobs once', async () => {
    const previousDir = process.env.BOOK_DATA_DIR;
    const previousDatabase = process.env.DATABASE_URL;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightplanner-scheduler-'));
    process.env.BOOK_DATA_DIR = tempDir;
    process.env.DATABASE_URL = '';
    vi.resetModules();
    try {
      const scheduler = await import('./bookScheduler');
      const dueAssignment = { ...assignment, scheduledDate: '2020-01-01' };
      await scheduler.upsertBookPublishJob(book, dueAssignment);
      expect((await scheduler.listBookPublishJobs('owner')).map(job => job.status)).toEqual(['scheduled']);
      await scheduler.setPublishingPaused('owner', true);
      expect(await scheduler.claimDueBookPublishJobs()).toEqual([]);
      await scheduler.setPublishingPaused('owner', false);
      const claimed = await scheduler.claimDueBookPublishJobs();
      expect(claimed).toHaveLength(1);
      expect(claimed[0].status).toBe('processing');
      expect(await scheduler.claimDueBookPublishJobs()).toEqual([]);
    } finally {
      if (previousDir === undefined) delete process.env.BOOK_DATA_DIR; else process.env.BOOK_DATA_DIR = previousDir;
      if (previousDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabase;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
