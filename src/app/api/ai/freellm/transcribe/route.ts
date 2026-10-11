import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudioWithGroq } from '@/lib/server/freellm/multimodal';

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    let audioBuffer: Buffer | null = null;
    let filename = 'recording.webm';
    let mimeType = 'audio/webm';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ ok: false, error: 'No audio file provided in form data.' }, { status: 400 });
      }
      filename = file.name || 'recording.webm';
      mimeType = file.type || 'audio/webm';
      const arrayBuffer = await file.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuffer);
    } else {
      const body = await req.json().catch(() => null);
      if (!body?.audioBase64) {
        return NextResponse.json(
          { ok: false, error: 'audioBase64 string or multipart form data is required.' },
          { status: 400 }
        );
      }
      let base64 = body.audioBase64;
      if (base64.includes(';base64,')) {
        const parts = base64.split(';base64,');
        mimeType = parts[0].replace('data:', '');
        base64 = parts[1];
      }
      if (body.filename) filename = body.filename;
      if (body.mimeType) mimeType = body.mimeType;
      audioBuffer = Buffer.from(base64, 'base64');
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      return NextResponse.json({ ok: false, error: 'Empty audio data received.' }, { status: 400 });
    }

    const transcribedText = await transcribeAudioWithGroq(audioBuffer, filename, mimeType);

    return NextResponse.json({
      ok: true,
      text: transcribedText,
      model: 'whisper-large-v3-turbo',
      provider: 'Groq Cloud Whisper',
    });
  } catch (err: any) {
    console.error('[Transcribe Route] Error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err.message || 'Audio transcription failed.',
      },
      { status: 500 }
    );
  }
}
