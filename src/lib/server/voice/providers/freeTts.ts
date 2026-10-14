import type { TTSOptions, TTSResult, TTSVoiceInfo } from '../types';
import { cleanMarkdownForSpeech, splitTextIntoSpeechChunks } from '../textChunker';

export const FREE_TTS_VOICES: TTSVoiceInfo[] = [
  {
    id: 'en-US',
    name: 'Neural Natural (US English)',
    provider: 'free_tts',
    gender: 'female',
    accent: 'American',
    description: 'Zero-configuration, free natural neural voice with zero setup or API key required',
    isDefault: true,
  },
  {
    id: 'en-GB',
    name: 'Neural Natural (British English)',
    provider: 'free_tts',
    gender: 'female',
    accent: 'British',
    description: 'Crisp British English free neural voice',
  },
  {
    id: 'en-AU',
    name: 'Neural Natural (Australian English)',
    provider: 'free_tts',
    gender: 'female',
    accent: 'Australian',
    description: 'Warm Australian English free neural voice',
  },
];

export function isFreeTtsConfigured(): boolean {
  return true; // Always available out-of-the-box without keys
}

export async function synthesizeFreeTts(options: TTSOptions): Promise<TTSResult> {
  const cleanText = cleanMarkdownForSpeech(options.text);
  if (!cleanText) {
    const error: any = new Error('No synthesizable text was provided.');
    error.code = 'EMPTY_TEXT';
    throw error;
  }

  const rawVoiceId = (options.voiceId || '').trim();
  const matchedVoice = FREE_TTS_VOICES.find(v => v.id.toLowerCase() === rawVoiceId.toLowerCase());
  // Validate whether rawVoiceId is a valid BCP-47 language tag (e.g. 'en', 'en-US', 'en-GB', 'es')
  // This prevents passing external provider voice IDs (like ElevenLabs IDs) into Google's 'tl' parameter
  const isValidLangTag = /^[a-z]{2}(?:-[a-z]{2,4})?$/i.test(rawVoiceId);
  const targetLang = matchedVoice ? matchedVoice.id : (isValidLangTag ? rawVoiceId : 'en-US');
  const voice = matchedVoice || {
    id: targetLang,
    name: `Neural Natural (${targetLang})`,
    provider: 'free_tts' as const,
  };

  // The free web endpoint accepts up to ~180 characters per sub-request
  const chunks = splitTextIntoSpeechChunks(cleanText, 180);
  const audioBuffers: Buffer[] = [];

  for (const chunk of chunks) {
    const url = new URL('https://translate.google.com/translate_tts');
    url.searchParams.set('ie', 'UTF-8');
    url.searchParams.set('client', 'tw-ob');
    url.searchParams.set('tl', targetLang);
    url.searchParams.set('q', chunk);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'audio/mpeg, audio/*',
      },
      signal: options.signal,
    });

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
        if (errorBody.length > 200) {
          errorBody = errorBody.slice(0, 200).replace(/<[^>]*>/g, '').trim();
        }
      } catch {
        errorBody = response.statusText;
      }
      console.warn(`[Free Neural Audio] Synthesis request failed (HTTP ${response.status}): ${errorBody}`);
      const err: any = new Error(
        `Free Neural Audio synthesis request failed (HTTP ${response.status}${errorBody ? `: ${errorBody}` : ''}).`
      );
      err.code = 'PROVIDER_ERROR';
      err.provider = 'free_tts';
      err.status = response.status;
      throw err;
    }

    const arrayBuffer = await response.arrayBuffer();
    audioBuffers.push(Buffer.from(arrayBuffer));
  }

  const concatenated = Buffer.concat(audioBuffers);

  return {
    audioBuffer: concatenated,
    contentType: 'audio/mpeg',
    provider: 'Free Neural Audio (Zero-Config)',
    providerId: 'free_tts',
    voiceId: voice.id,
    voiceName: voice.name,
    characterCount: cleanText.length,
  };
}
