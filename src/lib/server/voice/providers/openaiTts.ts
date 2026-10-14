import type { TTSOptions, TTSResult, TTSVoiceInfo } from '../types';
import { cleanMarkdownForSpeech, splitTextIntoSpeechChunks } from '../textChunker';

export const OPENAI_TTS_VOICES: TTSVoiceInfo[] = [
  {
    id: 'coral',
    name: 'OpenAI Coral (Warm & Expressive)',
    provider: 'openai',
    gender: 'female',
    accent: 'American',
    description: 'Conversational, warm, and natural pacing with subtle emotive modulation',
    isDefault: true,
  },
  {
    id: 'alloy',
    name: 'OpenAI Alloy (Neutral Balanced)',
    provider: 'openai',
    gender: 'neutral',
    accent: 'American',
    description: 'Versatile and clear general-purpose voice',
  },
  {
    id: 'nova',
    name: 'OpenAI Nova (Energetic & Modern)',
    provider: 'openai',
    gender: 'female',
    accent: 'American',
    description: 'Lively, crisp, and engaging conversational voice',
  },
  {
    id: 'onyx',
    name: 'OpenAI Onyx (Authoritative Male)',
    provider: 'openai',
    gender: 'male',
    accent: 'American',
    description: 'Deep, resonant, and calm narration voice',
  },
  {
    id: 'fable',
    name: 'OpenAI Fable (British Accent)',
    provider: 'openai',
    gender: 'neutral',
    accent: 'British',
    description: 'Expressive and animated storytelling voice',
  },
  {
    id: 'shimmer',
    name: 'OpenAI Shimmer (Gentle & Clear)',
    provider: 'openai',
    gender: 'female',
    accent: 'American',
    description: 'Soft, gentle, and peaceful voice',
  },
];

export function isOpenAIConfigured(): boolean {
  const key = process.env.OPENAI_API_KEY?.trim();
  return Boolean(key && key.length > 5 && !key.includes('your_openai'));
}

export async function synthesizeOpenAI(options: TTSOptions): Promise<TTSResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || !isOpenAIConfigured()) {
    const error: any = new Error(
      'OpenAI API key is not configured. Please add OPENAI_API_KEY in your environment (.env.local).'
    );
    error.code = 'CONFIG_MISSING';
    error.provider = 'openai';
    throw error;
  }

  const cleanText = cleanMarkdownForSpeech(options.text);
  if (!cleanText) {
    const error: any = new Error('No synthesizable text was provided.');
    error.code = 'EMPTY_TEXT';
    throw error;
  }

  const voiceId = options.voiceId || 'coral';
  const voice = OPENAI_TTS_VOICES.find(v => v.id === voiceId) || {
    id: voiceId,
    name: `OpenAI (${voiceId})`,
    provider: 'openai' as const,
  };

  const chunks = splitTextIntoSpeechChunks(cleanText, 3500);
  const audioBuffers: Buffer[] = [];

  for (const chunk of chunks) {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: options.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL || 'tts-1',
        voice: voice.id,
        input: chunk,
        response_format: 'mp3',
        speed: options.speed || 1.0,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => `HTTP ${response.status}`);
      const err: any = new Error(`OpenAI TTS synthesis failed (${response.status}): ${errText}`);
      err.code = 'PROVIDER_ERROR';
      err.provider = 'openai';
      throw err;
    }

    const arrayBuffer = await response.arrayBuffer();
    audioBuffers.push(Buffer.from(arrayBuffer));
  }

  const concatenated = Buffer.concat(audioBuffers);

  return {
    audioBuffer: concatenated,
    contentType: 'audio/mpeg',
    provider: 'OpenAI Neural TTS',
    providerId: 'openai',
    voiceId: voice.id,
    voiceName: voice.name,
    characterCount: cleanText.length,
  };
}
