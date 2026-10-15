import fs from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { ensurePagePreview } from '@/lib/server/books';

export async function GET(request: Request, context: RouteContext<'/api/books/[id]/pages/[page]/preview'>) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in to view this page.' }, { status: 401 });
  const { id, page: rawPage } = await context.params;
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1) return NextResponse.json({ error: 'Invalid PDF page.' }, { status: 400 });
  const filePath = await ensurePagePreview(session.userId, id, page);
  if (!filePath) {
    return NextResponse.json({ error: `Visual page preview is not available for page ${page}. Check that the PDF file is available.` }, { status: 404 });
  }
  try {
    const image = await fs.readFile(filePath);
    return new Response(image, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  } catch {
    return NextResponse.json({ error: `Visual page preview for page ${page} could not be read.` }, { status: 404 });
  }
}
