import { describe, expect, it, vi, beforeEach } from 'vitest';
import BooksRedirectPage from '@/app/books/page';
import { GET as lookupGet } from '@/app/api/books/assignment-lookup/route';
import * as authModule from '@/lib/server/auth';
import * as booksModule from '@/lib/server/books';
import * as bookAssignmentsModule from '@/lib/server/bookAssignments';

// Mock redirect from next/navigation
const redirectMock = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectMock(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

describe('Interactive Quiz 404 Resolution & Assignment Lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Next.js /books Route Handler Redirect', () => {
    it('redirects /books?quiz=assignment-123 to /?tab=books&quiz=assignment-123 without 404', async () => {
      const searchParams = Promise.resolve({ quiz: 'assignment-123' });
      try {
        await BooksRedirectPage({ searchParams });
      } catch (err: any) {
        expect(err.message).toContain('NEXT_REDIRECT:');
      }

      expect(redirectMock).toHaveBeenCalledTimes(1);
      const targetUrl = redirectMock.mock.calls[0][0];
      expect(targetUrl).toBe('/?tab=books&quiz=assignment-123');
    });

    it('redirects /books without parameters to /?tab=books', async () => {
      const searchParams = Promise.resolve({});
      try {
        await BooksRedirectPage({ searchParams });
      } catch (err: any) {}

      expect(redirectMock).toHaveBeenCalledTimes(1);
      const targetUrl = redirectMock.mock.calls[0][0];
      expect(targetUrl).toBe('/?tab=books');
    });

    it('preserves additional parameters such as mode or date', async () => {
      const searchParams = Promise.resolve({ quiz: 'asg-77', ref: 'telegram', date: '2026-10-18' });
      try {
        await BooksRedirectPage({ searchParams });
      } catch (err: any) {}

      expect(redirectMock).toHaveBeenCalledTimes(1);
      const targetUrl = redirectMock.mock.calls[0][0];
      expect(targetUrl).toContain('tab=books');
      expect(targetUrl).toContain('quiz=asg-77');
      expect(targetUrl).toContain('ref=telegram');
      expect(targetUrl).toContain('date=2026-10-18');
    });
  });

  describe('2. Assignment Lookup API Endpoint (/api/books/assignment-lookup)', () => {
    const mockUser = { userId: 'test_user_quiz' };
    const mockBook = {
      id: 'book-quiz-101',
      userId: 'test_user_quiz',
      title: 'Atomic Habits',
      author: 'James Clear',
    };
    const mockAssignment = {
      id: 'asg-lookup-101',
      userId: 'test_user_quiz',
      bookId: 'book-quiz-101',
      dayNumber: 1,
      scheduledDate: '2026-10-18',
      status: 'approved',
    };

    it('requires authentication to lookup assignments', async () => {
      vi.spyOn(authModule, 'getSessionUser').mockResolvedValueOnce(null);
      const req = new Request('http://localhost/api/books/assignment-lookup?assignmentId=asg-1');
      const res = await lookupGet(req);
      expect(res.status).toBe(401);
    });

    it('validates assignmentId query parameter', async () => {
      vi.spyOn(authModule, 'getSessionUser').mockResolvedValueOnce(mockUser as any);
      const req = new Request('http://localhost/api/books/assignment-lookup');
      const res = await lookupGet(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('assignmentId parameter is required');
    });

    it('returns book, assignment, and full assignments list for valid assignmentId', async () => {
      vi.spyOn(authModule, 'getSessionUser').mockResolvedValueOnce(mockUser as any);
      vi.spyOn(booksModule, 'listBooks').mockResolvedValueOnce([mockBook as any]);
      vi.spyOn(booksModule, 'getBook').mockResolvedValueOnce(mockBook as any);
      vi.spyOn(bookAssignmentsModule, 'listBookAssignments').mockResolvedValue([mockAssignment as any]);

      const req = new Request('http://localhost/api/books/assignment-lookup?assignmentId=asg-lookup-101');
      const res = await lookupGet(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.book.id).toBe('book-quiz-101');
      expect(data.book.title).toBe('Atomic Habits');
      expect(data.assignment.id).toBe('asg-lookup-101');
      expect(data.assignments).toHaveLength(1);
    });
  });
});
