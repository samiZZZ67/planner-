import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { synthesizeSpeech } from '@/lib/server/voice/synthesizer';

export async function POST(request: NextRequest) {
  const _session = await getSessionUser(request).catch(() => null);

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return NextResponse.json({ ok: false, error: 'Text is required.' }, { status: 400 });
  if (text.length > 10000) return NextResponse.json({ ok: false, error: 'Speech text is too long.' }, { status: 413 });

  const voiceId =
    typeof body?.voiceId === 'string' && body.voiceId.trim()
      ? body.voiceId.trim()
      : process.env.ELEVENLABS_VOICE_ID?.trim() || undefined;
  const provider = typeof body?.provider === 'string' ? (body.provider as any) : undefined;
  const speed = typeof body?.speed === 'number' ? body.speed : undefined;

  try {
    const result = await synthesizeSpeech({
      text,
      voiceId,
      provider,
      speed,
      signal: request.signal,
    });

    return new Response(new Uint8Array(result.audioBuffer), {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Length': String(result.audioBuffer.byteLength),
        'Cache-Control': 'no-store',
        'X-Speech-Provider': result.provider,
        'X-Voice-Id': result.voiceId,
      },
    });
  } catch (error: any) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.warn('[Speech Route] Neural speech request failed:', error?.message || error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Neural speech request failed.', code: error?.code },
      { status: error?.code === 'CONFIG_MISSING' ? 503 : error?.code === 'QUOTA_EXCEEDED' ? 429 : 502 }
    );
  }
}
