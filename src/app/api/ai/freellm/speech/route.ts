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

    const headers: Record<string, string> = {
      'Content-Type': result.contentType,
      'Content-Length': String(result.audioBuffer.byteLength),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Speech-Provider': result.provider,
      'X-Voice-Provider': result.provider,
      'X-Voice-Provider-Id': result.providerId,
      'X-Voice-Id': result.voiceId,
      'X-Voice-Name': encodeURIComponent(result.voiceName),
      'X-Voice-Characters': String(result.characterCount),
    };

    if (result.keyUsedMasked) headers['X-Voice-Key-Used'] = result.keyUsedMasked;
    if (typeof result.keysActive === 'number') headers['X-Voice-Keys-Active'] = String(result.keysActive);
    if (typeof result.keysTotal === 'number') headers['X-Voice-Keys-Total'] = String(result.keysTotal);
    if (result.fallbackTriggered) {
      headers['X-Voice-Fallback'] = 'true';
      if (result.originalProviderId) headers['X-Voice-Fallback-From'] = result.originalProviderId;
      headers['X-Voice-Fallback-To'] = result.providerId;
      if (result.fallbackReason) headers['X-Voice-Fallback-Reason'] = encodeURIComponent(result.fallbackReason);
    }
    if (result.notice) headers['X-Voice-Notice'] = encodeURIComponent(result.notice);
    if (result.autoHealedVoice) {
      headers['X-Voice-Auto-Healed'] = 'true';
      if (result.originalVoiceId) headers['X-Voice-Original-Id'] = encodeURIComponent(result.originalVoiceId);
    }

    return new Response(new Uint8Array(result.audioBuffer), {
      status: 200,
      headers,
    });
  } catch (error: any) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.warn('[Speech Route] Neural speech request failed:', error?.message || error);
    let status = 502;
    if (error?.code === 'CONFIG_MISSING') status = 503;
    else if (error?.code === 'UNAUTHORIZED' || error?.code === 'MISSING_PERMISSIONS') status = 401;
    else if (error?.code === 'QUOTA_EXCEEDED' || error?.code === 'ALL_ELEVENLABS_KEYS_EXHAUSTED') status = 429;
    else if (error?.code === 'EMPTY_TEXT') status = 400;
    else if (error?.code === 'PAID_VOICE_REQUIRED') status = 402;
    return NextResponse.json(
      { ok: false, error: error?.message || 'Neural speech request failed.', code: error?.code },
      { status }
    );
  }
}
