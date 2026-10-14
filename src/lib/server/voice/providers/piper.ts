import type { TTSOptions, TTSResult, TTSVoiceInfo } from '../types';
import { cleanMarkdownForSpeech, splitTextIntoSpeechChunks } from '../textChunker';

export const PIPER_VOICES: TTSVoiceInfo[] = [
  {
    id: 'en_US-lessac-medium',
    name: 'Piper Lessac (US Neutral)',
    provider: 'piper',
    gender: 'female',
    accent: 'American',
    description: 'High-speed, offline self-hosted neural voice with clear pronunciation',
    isDefault: true,
  },
  {
    id: 'en_US-amy-medium',
    name: 'Piper Amy (US Natural)',
    provider: 'piper',
    gender: 'female',
    accent: 'American',
    description: 'Expressive and friendly offline neural voice',
  },
  {
    id: 'en_US-ryan-medium',
    name: 'Piper Ryan (US Male)',
    provider: 'piper',
    gender: 'male',
    accent: 'American',
    description: 'Deep, instructional American English tone',
  },
  {
    id: 'en_GB-alan-medium',
    name: 'Piper Alan (British English)',
    provider: 'piper',
    gender: 'male',
    accent: 'British',
    description: 'Refined British English narration',
  },
];

export function isPiperConfigured(): boolean {
  const url = process.env.PIPER_TTS_URL?.trim();
  return Boolean(url && url.startsWith('http'));
}

export async function synthesizePiper(options: TTSOptions): Promise<TTSResult> {
  const piperUrl = process.env.PIPER_TTS_URL?.trim();
  if (!piperUrl || !isPiperConfigured()) {
    const error: any = new Error(
      'Piper self-hosted TTS server is not configured. Please set PIPER_TTS_URL (e.g. http://localhost:5000) in your environment.'
    );
    error.code = 'CONFIG_MISSING';
    error.provider = 'piper';
    throw error;
  }

  const cleanText = cleanMarkdownForSpeech(options.text);
  if (!cleanText) {
    const error: any = new Error('No synthesizable text was provided.');
    error.code = 'EMPTY_TEXT';
    throw error;
  }

  const voiceId = options.voiceId || process.env.PIPER_VOICE?.trim() || 'en_US-lessac-medium';
  const voice = PIPER_VOICES.find(v => v.id === voiceId) || {
    id: voiceId,
    name: `Piper (${voiceId})`,
    provider: 'piper' as const,
  };

  // Base URL normalization
  const normalizedBase = piperUrl.replace(/\/+$/, '');
  const chunks = splitTextIntoSpeechChunks(cleanText, 2500);
  const audioBuffers: Buffer[] = [];

  for (const chunk of chunks) {
    try {
      // Standard Piper HTTP server supports POST / with text or query param
      const targetUrl = new URL(normalizedBase);
      targetUrl.searchParams.set('text', chunk);
      if (voiceId) targetUrl.searchParams.set('voice', voiceId);

      const response = await fetch(targetUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          Accept: 'audio/wav, audio/x-wav, audio/*',
        },
        body: chunk,
        signal: options.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => `HTTP ${response.status}`);
        const err: any = new Error(`Piper synthesis failed (${response.status}): ${errorText}`);
        err.code = 'PROVIDER_ERROR';
        err.provider = 'piper';
        throw err;
      }

      const arrayBuffer = await response.arrayBuffer();
      audioBuffers.push(Buffer.from(arrayBuffer));
    } catch (fetchErr: any) {
      if (fetchErr.code === 'PROVIDER_ERROR') throw fetchErr;
      const err: any = new Error(
        `Unable to reach self-hosted Piper TTS server at ${normalizedBase}. Is the Piper container running? (${fetchErr.message || fetchErr})`
      );
      err.code = 'CONNECTION_FAILED';
      err.provider = 'piper';
      throw err;
    }
  }

  const concatenated = Buffer.concat(audioBuffers);

  return {
    audioBuffer: concatenated,
    contentType: 'audio/wav',
    provider: 'Piper Self-Hosted Neural TTS',
    providerId: 'piper',
    voiceId: voice.id,
    voiceName: voice.name,
    characterCount: cleanText.length,
  };
}
