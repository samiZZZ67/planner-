import fs from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getBook, getBookPdfPath } from '@/lib/server/books';

export async function GET(request: Request, context: RouteContext<'/api/books/[id]/pdf'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to access this PDF.' }, { status: 401 });
  const { id } = await context.params;
  const book = getBook(session.userId, id);
  const filePath = getBookPdfPath(session.userId, id);
  if (!book || !filePath) return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  try {
    const bytes = await fs.readFile(filePath);
    const safeName = book.originalFilename.replace(/[\r\n"\\]/g, '_');
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'The stored PDF is unavailable.' }, { status: 404 });
  }
}
