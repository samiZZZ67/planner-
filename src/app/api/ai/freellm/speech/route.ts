import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';

export async function POST(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Sign in to use speech playback.' }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'Neural speech is not configured.' }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return NextResponse.json({ ok: false, error: 'Text is required.' }, { status: 400 });
  if (text.length > 4096) return NextResponse.json({ ok: false, error: 'Speech text is too long.' }, { status: 413 });

  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const requestSpeech = (model: string, instructions?: string) => fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers,
    signal: request.signal,
    body: JSON.stringify({
      model,
      voice: 'coral',
      input: text,
      response_format: 'mp3',
      ...(instructions ? { instructions } : {}),
    }),
  });

  try {
    let response = await requestSpeech(
      'gpt-4o-mini-tts',
      'Speak conversationally and warmly, with natural pacing, clear pronunciation, expressive but restrained intonation, and short pauses between thoughts. Do not sound like a formal announcement.'
    );
    let provider = 'OpenAI gpt-4o-mini-tts';
    if (!response.ok) {
      response = await requestSpeech('tts-1-hd');
      provider = 'OpenAI tts-1-hd fallback';
    }
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => 'Speech provider failed.');
      console.warn('[Speech Route] Neural speech providers failed:', response.status, detail.slice(0, 500));
      return NextResponse.json({ ok: false, error: 'Neural speech providers are unavailable.' }, { status: 502 });
    }

    return new Response(response.body, {
      headers: {
        'Content-Type': response.headers.get('content-type') || 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-Speech-Provider': provider,
      },
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.warn('[Speech Route] Neural speech request failed:', error);
    return NextResponse.json({ ok: false, error: 'Neural speech request failed.' }, { status: 502 });
  }
}
