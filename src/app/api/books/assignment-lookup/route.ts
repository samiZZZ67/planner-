import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getDb } from '@/lib/server/neon';
import { getBook, listBooks } from '@/lib/server/books';
import { listBookAssignments, findBookAssignmentById } from '@/lib/server/bookAssignments';

export async function GET(request: Request) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to access book assignments.' }, { status: 401 });

  const url = new URL(request.url);
  const assignmentId = url.searchParams.get('assignmentId') || url.searchParams.get('quiz');
  if (!assignmentId) {
    return NextResponse.json({ error: 'assignmentId parameter is required.' }, { status: 400 });
  }

  // 1. Direct assignment lookup by ID if present
  if (assignmentId) {
    const directAssignment = await findBookAssignmentById(assignmentId);
    if (directAssignment && directAssignment.userId === session.userId) {
      const book = await getBook(session.userId, directAssignment.bookId);
      if (book) {
        const assignments = await listBookAssignments(session.userId, book.id);
        return NextResponse.json({
          ok: true,
          book,
          assignment: directAssignment,
          assignments,
        });
      }
    }
  }

  let bookId: string | null = null;
  const sql = getDb();
  if (sql) {
    try {
      const rows = await sql`SELECT book_id FROM book_assignments WHERE id = ${assignmentId} AND user_id = ${session.userId} LIMIT 1`;
      if (rows[0]?.book_id) {
        bookId = rows[0].book_id;
      }
    } catch {}
  }

  if (!bookId) {
    const allBooks = await listBooks(session.userId);
    for (const b of allBooks) {
      const assigns = await listBookAssignments(session.userId, b.id);
      if (assigns.some(a => a.id === assignmentId)) {
        bookId = b.id;
        break;
      }
    }
  }

  if (!bookId) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
  }

  const book = await getBook(session.userId, bookId);
  if (!book) {
    return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  }

  const assignments = await listBookAssignments(session.userId, bookId);
  const assignment = assignments.find(a => a.id === assignmentId);

  return NextResponse.json({
    ok: true,
    book,
    assignment,
    assignments,
  });
}
