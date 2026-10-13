import fs from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { getBookPagePreviewPath } from '@/lib/server/books';

export async function GET(request: Request, context: RouteContext<'/api/books/[id]/pages/[page]/preview'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to view this page.' }, { status: 401 });
  const { id, page: rawPage } = await context.params;
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1) return NextResponse.json({ error: 'Invalid PDF page.' }, { status: 400 });
  const filePath = await getBookPagePreviewPath(session.userId, id, page);
  if (!filePath) return NextResponse.json({ error: 'Visual page preview is not available. Re-extract this book to create it.' }, { status: 404 });
  try {
    const image = await fs.readFile(filePath);
    return new Response(image, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  } catch {
    return NextResponse.json({ error: 'Visual page preview is missing. Re-extract this book to create it.' }, { status: 404 });
  }
}
