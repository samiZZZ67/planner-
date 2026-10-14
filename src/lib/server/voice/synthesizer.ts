import type {
  TTSConfigResponse,
  TTSOptions,
  TTSProviderId,
  TTSProviderStatus,
  TTSResult,
} from './types';
import {
  ELEVENLABS_VOICES,
  getElevenLabsKeyPoolStatus,
  isElevenLabsConfigured,
  synthesizeElevenLabs,
} from './providers/elevenlabs';
import { PIPER_VOICES, isPiperConfigured, synthesizePiper } from './providers/piper';
import { FREE_TTS_VOICES, isFreeTtsConfigured, synthesizeFreeTts } from './providers/freeTts';
import { OPENAI_TTS_VOICES, isOpenAIConfigured, synthesizeOpenAI } from './providers/openaiTts';

/**
 * Determine the active TTS provider from environment variables and available credentials.
 */
export function getActiveTTSProvider(): TTSProviderId {
  const envProvider = (process.env.TTS_PROVIDER || '').trim().toLowerCase();

  if (envProvider === 'elevenlabs' && isElevenLabsConfigured()) return 'elevenlabs';
  if (envProvider === 'piper' && isPiperConfigured()) return 'piper';
  if (envProvider === 'openai' && isOpenAIConfigured()) return 'openai';
  if (envProvider === 'free_tts') return 'free_tts';

  // Smart Auto-Resolution:
  // 1. ElevenLabs if user configured at least one valid key
  if (isElevenLabsConfigured()) return 'elevenlabs';
  // 2. Piper if user pointed to a local/remote Piper server
  if (isPiperConfigured()) return 'piper';
  // 3. OpenAI if configured
  if (isOpenAIConfigured()) return 'openai';
  // 4. Default to zero-setup Free Neural TTS
  return 'free_tts';
}

/**
 * Retrieve comprehensive status and voice catalog across all modular TTS providers.
 * Note: Never exposes raw secret API keys.
 */
export function getTTSConfig(): TTSConfigResponse {
  const activeProvider = getActiveTTSProvider();
  const elevenLabsKeyPool = getElevenLabsKeyPoolStatus();

  const providers: TTSProviderStatus[] = [
    {
      id: 'elevenlabs',
      name: 'ElevenLabs Neural TTS',
      isConfigured: elevenLabsKeyPool.totalKeys > 0,
      isDefault: activeProvider === 'elevenlabs',
      freeTierNote:
        elevenLabsKeyPool.totalKeys > 1
          ? `Multi-key rotation enabled (${elevenLabsKeyPool.activeKeys}/${elevenLabsKeyPool.totalKeys} keys active). Automatically fails over when monthly quota is reached.`
          : '10,000 characters/month free tier with ultra-realistic human inflection. Supports 5+ rotating keys.',
      setupDocs:
        'Add ELEVENLABS_API_KEY_1..5 or ELEVENLABS_API_KEYS to your Render environment variables to enable multi-key failover.',
      voices: ELEVENLABS_VOICES,
      keyPool: elevenLabsKeyPool,
    },
    {
      id: 'piper',
      name: 'Piper Self-Hosted Neural TTS',
      isConfigured: isPiperConfigured(),
      isDefault: activeProvider === 'piper',
      freeTierNote: '100% free, private, offline neural TTS with zero character quotas or external dependencies.',
      setupDocs:
        'Run a Piper container (e.g. docker run -p 5000:5000 rhasspy/piper) and set PIPER_TTS_URL=http://localhost:5000.',
      voices: PIPER_VOICES,
    },
    {
      id: 'free_tts',
      name: 'Free Neural Audio (Zero-Config)',
      isConfigured: true,
      isDefault: activeProvider === 'free_tts',
      freeTierNote: 'Completely free out-of-the-box neural voice. Requires no API keys, accounts, or setup.',
      voices: FREE_TTS_VOICES,
    },
    {
      id: 'openai',
      name: 'OpenAI Audio Speech (TTS-1)',
      isConfigured: isOpenAIConfigured(),
      isDefault: activeProvider === 'openai',
      freeTierNote: 'High-speed natural voices via OpenAI API (requires OPENAI_API_KEY).',
      setupDocs: 'Add OPENAI_API_KEY to your .env.local file to activate.',
      voices: OPENAI_TTS_VOICES,
    },
  ];

  let activeVoiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || '21m00Tcm4TlvDq8ikWAM';
  if (activeProvider === 'free_tts') activeVoiceId = 'en-US';
  else if (activeProvider === 'piper') activeVoiceId = 'en_US-lessac-medium';
  else if (activeProvider === 'openai') activeVoiceId = 'coral';
  else if (activeProvider === 'elevenlabs') {
    activeVoiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || '21m00Tcm4TlvDq8ikWAM';
  }

  return {
    ok: true,
    activeProvider,
    activeVoiceId,
    providers,
  };
}

/**
 * Central voice synthesizer dispatcher.
 * Selects the configured or requested provider, handles chunking, and returns synthesized audio.
 * When ElevenLabs experiences quota exhaustion or all keys are depleted, automatically fails over
 * to Piper (if configured) or zero-setup Free Neural Audio, tagging the result with fallback telemetry.
 */
export async function synthesizeSpeech(options: TTSOptions): Promise<TTSResult> {
  const providerId = options.provider || getActiveTTSProvider();

  if (providerId === 'elevenlabs') {
    try {
      return await synthesizeElevenLabs(options);
    } catch (err: any) {
      const isExhausted =
        err?.code === 'ALL_ELEVENLABS_KEYS_EXHAUSTED' ||
        err?.code === 'QUOTA_EXCEEDED';

      // If keys are completely exhausted and not aborted by client, perform graceful fallback
      if (isExhausted && !options.signal?.aborted) {
        console.warn(
          `[Voice Synthesizer] All ElevenLabs keys exhausted or unavailable. Initiating graceful fallback...`
        );

        if (isPiperConfigured()) {
          try {
            const fallbackResult = await synthesizePiper(options);
            return {
              ...fallbackResult,
              fallbackTriggered: true,
              originalProviderId: 'elevenlabs',
              fallbackReason:
                'All configured ElevenLabs keys are exhausted or rate-limited. Successfully failed over to Piper.',
            };
          } catch (piperErr) {
            console.warn('[Voice Synthesizer] Piper fallback failed, trying Free Neural Audio:', piperErr);
          }
        }

        // Default zero-config fallback
        const fallbackResult = await synthesizeFreeTts(options);
        return {
          ...fallbackResult,
          fallbackTriggered: true,
          originalProviderId: 'elevenlabs',
          fallbackReason:
            'All configured ElevenLabs keys are exhausted. Successfully failed over to Free Neural Audio.',
        };
      }

      // Rethrow if other error or not eligible for automatic fallback
      throw err;
    }
  }

  switch (providerId) {
    case 'piper':
      return synthesizePiper(options);

    case 'openai':
      return synthesizeOpenAI(options);

    case 'free_tts':
      return synthesizeFreeTts(options);

    default:
      return synthesizeFreeTts(options);
  }
}
