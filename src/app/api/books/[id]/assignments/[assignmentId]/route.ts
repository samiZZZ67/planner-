import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getBook, listBookPages } from '@/lib/server/books';
import { listBookAssignments } from '@/lib/server/bookAssignments';

export async function GET(request: Request, context: RouteContext<'/api/books/[id]/assignments/[assignmentId]'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to access this reading assignment.' }, { status: 401 });
  const { id, assignmentId } = await context.params;
  const book = await getBook(session.userId, id);
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  const assignment = (await listBookAssignments(session.userId, id)).find(item => item.id === assignmentId);
  if (!assignment) return NextResponse.json({ error: 'Reading assignment not found.' }, { status: 404 });
  const originalPages = await listBookPages(session.userId, id, assignment.startPdfPage, assignment.endPdfPage);
  return NextResponse.json({ book: { title: book.title, author: book.author }, assignment, originalPages });
}
