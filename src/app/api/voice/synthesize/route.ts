import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { synthesizeSpeech } from '@/lib/server/voice/synthesizer';
import type { TTSProviderId } from '@/lib/server/voice/types';

export async function POST(request: NextRequest) {
  // Session check is non-blocking so the Moon assistant and Sam's AI can speak seamlessly
  const _session = await getSessionUser(request).catch(() => null);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON request payload.', code: 'INVALID_REQUEST' },
      { status: 400 }
    );
  }

  const rawText = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!rawText) {
    return NextResponse.json(
      { ok: false, error: 'Text is required for speech synthesis.', code: 'EMPTY_TEXT' },
      { status: 400 }
    );
  }

  if (rawText.length > 10000) {
    return NextResponse.json(
      { ok: false, error: 'Speech text exceeds maximum limit of 10,000 characters.', code: 'TEXT_TOO_LONG' },
      { status: 413 }
    );
  }

  const voiceId =
    typeof body?.voiceId === 'string' && body.voiceId.trim()
      ? body.voiceId.trim()
      : process.env.ELEVENLABS_VOICE_ID?.trim() || undefined;
  const provider = (typeof body?.provider === 'string' ? body.provider.trim() : undefined) as TTSProviderId | undefined;
  const speed = typeof body?.speed === 'number' && body.speed >= 0.5 && body.speed <= 2.0 ? body.speed : undefined;

  try {
    const result = await synthesizeSpeech({
      text: rawText,
      voiceId,
      provider,
      speed,
      signal: request.signal,
    });

    const headers: Record<string, string> = {
      'Content-Type': result.contentType,
      'Content-Length': String(result.audioBuffer.byteLength),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Voice-Provider': result.provider,
      'X-Voice-Provider-Id': result.providerId,
      'X-Voice-Id': result.voiceId,
      'X-Voice-Name': encodeURIComponent(result.voiceName),
      'X-Voice-Characters': String(result.characterCount),
    };

    if (result.keyUsedMasked) {
      headers['X-Voice-Key-Used'] = result.keyUsedMasked;
    }
    if (typeof result.keysActive === 'number') {
      headers['X-Voice-Keys-Active'] = String(result.keysActive);
    }
    if (typeof result.keysTotal === 'number') {
      headers['X-Voice-Keys-Total'] = String(result.keysTotal);
    }
    if (result.fallbackTriggered) {
      headers['X-Voice-Fallback'] = 'true';
      if (result.originalProviderId) {
        headers['X-Voice-Fallback-From'] = result.originalProviderId;
      }
      headers['X-Voice-Fallback-To'] = result.providerId;
      if (result.fallbackReason) {
        headers['X-Voice-Fallback-Reason'] = encodeURIComponent(result.fallbackReason);
      }
    }

    return new Response(new Uint8Array(result.audioBuffer), {
      status: 200,
      headers,
    });
  } catch (error: any) {
    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }

    console.warn('[Voice Route] Synthesis error:', error?.message || error);

    let status = 502;
    if (error?.code === 'CONFIG_MISSING') status = 503;
    else if (error?.code === 'UNAUTHORIZED') status = 401;
    else if (error?.code === 'QUOTA_EXCEEDED' || error?.code === 'ALL_ELEVENLABS_KEYS_EXHAUSTED') status = 429;
    else if (error?.code === 'EMPTY_TEXT') status = 400;

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || 'Voice synthesis failed.',
        code: error?.code || 'SYNTHESIS_FAILED',
        provider: error?.provider || provider || 'unknown',
        keysTotal: error?.keysTotal,
        keysActive: error?.keysActive,
      },
      { status }
    );
  }
}
