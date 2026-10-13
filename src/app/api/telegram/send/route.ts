import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { sendTelegramMediaToChannel, sendTelegramTextToChannel } from '@/lib/server/telegram';

export async function POST(request: Request) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: 'Sign in before sending a Telegram message.' }, { status: 401 });
  try {
    if (request.headers.get('content-type')?.includes('multipart/form-data')) {
      const form = await request.formData();
      const text = String(form.get('text') || '');
      const media = form.get('media');
      if (!(media instanceof File)) return NextResponse.json({ error: 'Choose an image or voice file to send.' }, { status: 400 });
      const result = await sendTelegramMediaToChannel(text, media);
      return NextResponse.json({ ok: true, ...result });
    }
    const body = await request.json();
    const text = typeof body.text === 'string' ? body.text : '';
    const result = await sendTelegramTextToChannel(text);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Telegram could not send this message.' }, { status: 422 });
  }
}
