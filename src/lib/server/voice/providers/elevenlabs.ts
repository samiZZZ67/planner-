import type {
  ElevenLabsKeyStatus,
  ElevenLabsKeyTelemetry,
  TTSOptions,
  TTSProviderKeyPoolInfo,
  TTSResult,
  TTSVoiceInfo,
} from '../types';
import { cleanMarkdownForSpeech, splitTextIntoSpeechChunks } from '../textChunker';

export const ELEVENLABS_BUILTIN_VOICES: TTSVoiceInfo[] = [
  {
    id: '21m00Tcm4TlvDq8ikWAM',
    name: 'Rachel (Conversational & Warm)',
    provider: 'elevenlabs',
    gender: 'female',
    accent: 'American',
    description: 'Calm, friendly, and natural conversational voice ideal for AI assistants',
    isDefault: true,
  },
  {
    id: 'pNInz6obpgDQGcFmaJgB',
    name: 'Adam (Deep Narration)',
    provider: 'elevenlabs',
    gender: 'male',
    accent: 'American',
    description: 'Deep, clear, expressive voice well-suited for instructional and reflective responses',
  },
  {
    id: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Sarah (Clear & Articulate)',
    provider: 'elevenlabs',
    gender: 'female',
    accent: 'American',
    description: 'Crisp, professional, and articulate tone',
  },
  {
    id: 'ErXwobaYiN019PkySvjV',
    name: 'Antoni (Friendly & Modulated)',
    provider: 'elevenlabs',
    gender: 'male',
    accent: 'American',
    description: 'Engaging, warm, and well-modulated',
  },
  {
    id: 'AZnzlk1XvdvUeBnXmlld',
    name: 'Domi (Energetic & Dynamic)',
    provider: 'elevenlabs',
    gender: 'female',
    accent: 'American',
    description: 'Upbeat and lively',
  },
  {
    id: 'MF3mGyEYCl7XYWbV9V6O',
    name: 'Elli (Young & Natural)',
    provider: 'elevenlabs',
    gender: 'female',
    accent: 'American',
    description: 'Gentle, modern, and casual voice',
  },
  {
    id: 'TxGEqnHWrfWFTfGW9XjX',
    name: 'Josh (Young & Confident)',
    provider: 'elevenlabs',
    gender: 'male',
    accent: 'American',
    description: 'Natural, young, and confident American male voice',
  },
  {
    id: 'VR6AewLTigWG4xSOukaG',
    name: 'Arnold (Crisp & Commanding)',
    provider: 'elevenlabs',
    gender: 'male',
    accent: 'American',
    description: 'Crisp, articulate, and commanding executive tone',
  },
  {
    id: 'yoZ06aMxZJJ28mfd3POQ',
    name: 'Sam (Dynamic Narration)',
    provider: 'elevenlabs',
    gender: 'male',
    accent: 'American',
    description: 'Raspy, dynamic, and engaging narration',
  },
  {
    id: 'cgSgspJ2msm6clMCkdW9',
    name: 'Jessica (Playful & Warm)',
    provider: 'elevenlabs',
    gender: 'female',
    accent: 'American',
    description: 'Bright, playful, and expressive female voice',
  },
  {
    id: 'onwK4e9ZLuTAKqWW03F9',
    name: 'Daniel (Authoritative British)',
    provider: 'elevenlabs',
    gender: 'male',
    accent: 'British',
    description: 'Deep, sophisticated British presenter voice',
  },
  {
    id: 'ThT5KcBeYPX3keUQqHPh',
    name: 'Dorothy (Pleasant & Gentle)',
    provider: 'elevenlabs',
    gender: 'female',
    accent: 'British',
    description: 'Soft, pleasant, and soothing narration',
  },
  {
    id: 'bVMeCyTHy58xNoL34h3p',
    name: 'Jeremy (Excited & Irish)',
    provider: 'elevenlabs',
    gender: 'male',
    accent: 'Irish',
    description: 'Warm, animated Irish accent',
  },
  {
    id: 'N2lVS1w4EtoT3dr4eOWO',
    name: 'Callum (Intense & Characters)',
    provider: 'elevenlabs',
    gender: 'male',
    accent: 'Transatlantic',
    description: 'Dramatic, intense, and expressive pacing',
  },
  {
    id: 'XB0fDUnXU5powFXDhCwa',
    name: 'Charlotte (Seductive & Swedish)',
    provider: 'elevenlabs',
    gender: 'female',
    accent: 'Swedish',
    description: 'Calm, pleasant Swedish-accented English',
  },
  {
    id: 'IKne3meq5aSn9XLyUdCD',
    name: 'Charlie (Hyped & Australian)',
    provider: 'elevenlabs',
    gender: 'male',
    accent: 'Australian',
    description: 'Energetic, casual Australian male voice',
  },
  {
    id: 'JBFqnCBsd6RMkjVDRZzb',
    name: 'George (Warm British Storyteller)',
    provider: 'elevenlabs',
    gender: 'male',
    accent: 'British',
    description: 'Warm, mature, captivating storyteller voice',
  },
  {
    id: 'piTKgcLEGmPE4e6mEKli',
    name: 'Nicole (Whispering Audiobooks)',
    provider: 'elevenlabs',
    gender: 'female',
    accent: 'American',
    description: 'Whispering, soft, and intimate reading voice',
  },
  {
    id: 'pFZP5JQG7iQjIQuC4Bku',
    name: 'Lily (Warm & Velvety)',
    provider: 'elevenlabs',
    gender: 'female',
    accent: 'British',
    description: 'Velvety, poised, and clear British female voice',
  },
];

/**
 * Return all available ElevenLabs voice models:
 * 1. Voices dynamically configured via environment variables (ELEVENLABS_VOICE_ID, ELEVENLABS_VOICE_IDS, ELEVENLABS_VOICE_ID_1..20)
 * 2. 19 built-in curated ElevenLabs voice models spanning genders, accents, and tones
 */
export function getElevenLabsVoices(): TTSVoiceInfo[] {
  const envVoiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
  const rawCustomVoices: string[] = [];

  // Check ELEVENLABS_VOICE_ID (e.g. C1npRmjB19a6yNkEucvx)
  if (envVoiceId && !rawCustomVoices.includes(envVoiceId)) {
    rawCustomVoices.push(envVoiceId);
  }

  // Check comma / newline separated ELEVENLABS_VOICE_IDS
  const multiVoices = process.env.ELEVENLABS_VOICE_IDS;
  if (multiVoices) {
    for (const v of multiVoices.split(/[\r\n,;]+/)) {
      const clean = v.trim();
      if (clean && !rawCustomVoices.includes(clean)) {
        rawCustomVoices.push(clean);
      }
    }
  }

  // Check numbered variables: ELEVENLABS_VOICE_ID_1 through ELEVENLABS_VOICE_ID_20
  for (const envKey of Object.keys(process.env)) {
    if (/^ELEVENLABS_VOICE_ID_\d+$/i.test(envKey)) {
      const val = process.env[envKey]?.trim();
      if (val && !rawCustomVoices.includes(val)) {
        rawCustomVoices.push(val);
      }
    }
  }

  // Build custom voice descriptors
  const customVoiceItems: TTSVoiceInfo[] = rawCustomVoices.map((vid, idx) => {
    const parts = vid.split(':');
    const id = parts[0].trim();
    const isPrimaryEnv = id === envVoiceId;
    const name =
      parts[1]?.trim() ||
      (isPrimaryEnv
        ? `Configured Voice (${id.slice(0, 8)}...)`
        : `Custom Voice ${idx + 1} (${id.slice(0, 8)}...)`);
    const gender = (parts[2]?.trim().toLowerCase() as any) || 'neutral';
    const accent = parts[3]?.trim() || 'Custom';

    return {
      id,
      name,
      provider: 'elevenlabs' as const,
      gender,
      accent,
      description: isPrimaryEnv
        ? `Primary voice configured in environment (ELEVENLABS_VOICE_ID=${id}).`
        : `Custom voice model configured via environment variable.`,
      isDefault: isPrimaryEnv,
    };
  });

  const allVoices: TTSVoiceInfo[] = [...customVoiceItems];
  const seenIds = new Set(customVoiceItems.map(v => v.id));

  for (const v of ELEVENLABS_BUILTIN_VOICES) {
    if (!seenIds.has(v.id)) {
      seenIds.add(v.id);
      allVoices.push({
        ...v,
        isDefault: !envVoiceId && Boolean(v.isDefault),
      });
    }
  }

  return allVoices;
}

// Dynamic proxy array so ELEVENLABS_VOICES always reflects current environment variables
export const ELEVENLABS_VOICES: TTSVoiceInfo[] = new Proxy(ELEVENLABS_BUILTIN_VOICES, {
  get(target, prop, receiver) {
    const live = getElevenLabsVoices();
    return Reflect.get(live, prop, receiver);
  },
});

/**
 * Mask an API key so raw secrets are never printed in logs, sent over the wire, or displayed in the UI.
 * Format: `••••` + last 4 characters (e.g. `••••1a2b`).
 */
export function maskElevenLabsKey(key: string): string {
  if (!key || typeof key !== 'string') return '••••••••';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `••••${trimmed.slice(-4)}`;
}

interface KeyState {
  key: string;
  maskedKey: string;
  status: ElevenLabsKeyStatus;
  totalRequests: number;
  characterCount: number;
  cooldownUntil: number; // epoch ms; 0 if active
  consecutiveFailures: number;
  lastUsedAt?: number;
  lastError?: string;
  inFlightRequests: number;
}

// In-memory key state pool
const keyStateMap = new Map<string, KeyState>();
let rotationIndex = 0;

/**
 * Reset in-memory key state and rotation index (for tests and teardown).
 */
export function resetElevenLabsKeyPoolForTesting(): void {
  keyStateMap.clear();
  rotationIndex = 0;
}

/**
 * Extract all configured ElevenLabs API keys from environment variables.
 * Checks:
 * 1. Numbered environment variables: ELEVENLABS_API_KEY_1 through ELEVENLABS_API_KEY_50 (and dynamic ELEVENLABS_API_KEY_\d+)
 * 2. Comma or newline separated ELEVENLABS_API_KEYS
 * 3. Default ELEVENLABS_API_KEY
 */
export function getRawElevenLabsKeys(): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  const addKey = (k: any) => {
    if (typeof k !== 'string') return;
    const clean = k.trim().replace(/^['"]|['"]$/g, '');
    if (!clean) return;
    if (clean.length < 8) return;
    if (clean.toLowerCase().includes('your_elevenlabs') || clean.toLowerCase().includes('placeholder')) return;
    if (!seen.has(clean)) {
      seen.add(clean);
      keys.push(clean);
    }
  };

  // 1. Scan numbered env keys: ELEVENLABS_API_KEY_1, ELEVENLABS_API_KEY_2, etc.
  const numberedKeys: { num: number; val: string }[] = [];
  for (const envKey of Object.keys(process.env)) {
    const match = envKey.match(/^ELEVENLABS_API_KEY_(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      const val = process.env[envKey];
      if (typeof val === 'string' && val.trim()) {
        numberedKeys.push({ num, val });
      }
    }
  }
  // Sort numerically: key 1, key 2, key 3...
  numberedKeys.sort((a, b) => a.num - b.num);
  for (const item of numberedKeys) {
    addKey(item.val);
  }

  // 2. Comma / newline separated ELEVENLABS_API_KEYS
  const multiKeys = process.env.ELEVENLABS_API_KEYS;
  if (multiKeys && typeof multiKeys === 'string') {
    const parts = multiKeys.split(/[\r\n,;]+/);
    for (const p of parts) {
      addKey(p);
    }
  }

  // 3. Fallback / Single key: ELEVENLABS_API_KEY
  const singleKey = process.env.ELEVENLABS_API_KEY;
  if (singleKey && typeof singleKey === 'string') {
    addKey(singleKey);
  }

  return keys;
}

/**
 * Synchronize discovered keys with the in-memory state map.
 * Preserves historical stats (requests, characters) and auto-recovers expired cooldowns.
 */
function syncKeyStates(): KeyState[] {
  const discovered = getRawElevenLabsKeys();
  const now = Date.now();

  // Remove keys that are no longer configured
  for (const k of Array.from(keyStateMap.keys())) {
    if (!discovered.includes(k)) {
      keyStateMap.delete(k);
    }
  }

  // Add newly discovered keys or update existing
  const states: KeyState[] = [];
  for (const k of discovered) {
    let state = keyStateMap.get(k);
    if (!state) {
      state = {
        key: k,
        maskedKey: maskElevenLabsKey(k),
        status: 'active',
        totalRequests: 0,
        characterCount: 0,
        cooldownUntil: 0,
        consecutiveFailures: 0,
        inFlightRequests: 0,
      };
      keyStateMap.set(k, state);
    } else {
      // Auto-heal cooldown if expired (unless permanently invalid 401/403)
      if (state.status !== 'invalid' && state.cooldownUntil > 0 && now >= state.cooldownUntil) {
        state.status = 'active';
        state.cooldownUntil = 0;
        state.consecutiveFailures = 0;
        state.lastError = undefined;
      }
    }
    states.push(state);
  }

  return states;
}

export function isElevenLabsConfigured(): boolean {
  return getRawElevenLabsKeys().length > 0;
}

/**
 * Returns safe telemetry and quota status for the configured ElevenLabs key pool.
 * Raw API keys are never included.
 */
export function getElevenLabsKeyPoolStatus(): TTSProviderKeyPoolInfo {
  const states = syncKeyStates();
  const now = Date.now();

  let activeCount = 0;
  let exhaustedCount = 0;

  const telemetry: ElevenLabsKeyTelemetry[] = states.map((s, idx) => {
    const isReady =
      s.status === 'active' ||
      (s.status !== 'invalid' && s.cooldownUntil > 0 && now >= s.cooldownUntil);

    if (isReady) {
      activeCount++;
    } else {
      exhaustedCount++;
    }

    const remaining = s.cooldownUntil > now ? Math.ceil((s.cooldownUntil - now) / 1000) : 0;

    return {
      index: idx + 1,
      maskedKey: s.maskedKey,
      status: s.status,
      totalRequests: s.totalRequests,
      characterCount: s.characterCount,
      cooldownRemainingSeconds: remaining > 0 ? remaining : undefined,
      lastUsedAt: s.lastUsedAt,
      lastError: s.lastError,
    };
  });

  return {
    totalKeys: states.length,
    activeKeys: activeCount,
    exhaustedKeys: exhaustedCount,
    keys: telemetry,
  };
}

/**
 * Synthesizes speech using ElevenLabs with automatic multi-key rotation and failover.
 * - Rotates to next key on 429 quota exhaustion, rate limits, or upstream failures.
 * - Temporarily disables exhausted keys (6 hours for quota exceeded, backoff for rate limits).
 * - Avoids infinite loops by attempting at most each configured key once.
 * - Safely handles concurrent requests using in-flight counters.
 * - Throws `ALL_ELEVENLABS_KEYS_EXHAUSTED` when all keys are unavailable.
 */
export async function synthesizeElevenLabs(options: TTSOptions): Promise<TTSResult> {
  const states = syncKeyStates();
  if (states.length === 0) {
    const error: any = new Error(
      'ElevenLabs API key is not configured. Please add ELEVENLABS_API_KEY (or ELEVENLABS_API_KEY_1..5) to your environment or choose another voice provider.'
    );
    error.code = 'CONFIG_MISSING';
    error.provider = 'elevenlabs';
    throw error;
  }

  const voiceId = options.voiceId || process.env.ELEVENLABS_VOICE_ID?.trim() || '21m00Tcm4TlvDq8ikWAM';
  const voice = ELEVENLABS_VOICES.find(v => v.id === voiceId) || {
    id: voiceId,
    name: `Custom (${voiceId.slice(0, 8)})`,
    provider: 'elevenlabs' as const,
  };

  const modelId = process.env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_multilingual_v2';
  const cleanText = cleanMarkdownForSpeech(options.text);
  if (!cleanText) {
    const error: any = new Error('No synthesizable text was provided.');
    error.code = 'EMPTY_TEXT';
    throw error;
  }

  const chunks = splitTextIntoSpeechChunks(cleanText, 2000);

  // Maximum attempts across available keys = states.length (prevents infinite retry loops)
  const maxAttempts = states.length;
  let attempts = 0;
  let lastAttemptError: any = null;

  while (attempts < maxAttempts) {
    const now = Date.now();
    let chosenIndex = -1;

    // Find next eligible active key starting from rotationIndex
    for (let i = 0; i < states.length; i++) {
      const candidateIdx = (rotationIndex + i) % states.length;
      const candidate = states[candidateIdx];
      const isAvailable =
        candidate.status === 'active' ||
        (candidate.status !== 'invalid' && candidate.cooldownUntil > 0 && now >= candidate.cooldownUntil);

      if (isAvailable) {
        chosenIndex = candidateIdx;
        break;
      }
    }

    if (chosenIndex === -1) {
      // All keys in cooldown or permanently invalid
      const exhaustedErr: any = new Error(
        `All ${states.length} configured ElevenLabs API keys are exhausted, rate-limited, or disabled.`
      );
      exhaustedErr.code = 'ALL_ELEVENLABS_KEYS_EXHAUSTED';
      exhaustedErr.provider = 'elevenlabs';
      exhaustedErr.keysTotal = states.length;
      exhaustedErr.keysActive = 0;
      throw exhaustedErr;
    }

    const keyState = states[chosenIndex];
    keyState.inFlightRequests++;
    attempts++;

    try {
      const audioBuffers: Buffer[] = [];

      for (const chunk of chunks) {
        if (options.signal?.aborted) {
          throw new Error('Synthesis request aborted.');
        }

        const response = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
          {
            method: 'POST',
            headers: {
              'xi-api-key': keyState.key,
              'Content-Type': 'application/json',
              Accept: 'audio/mpeg',
            },
            signal: options.signal,
            body: JSON.stringify({
              text: chunk,
              model_id: modelId,
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
              },
            }),
          }
        );

        if (!response.ok) {
          let errorDetail = '';
          try {
            const errJson = await response.json();
            errorDetail = errJson?.detail?.message || errJson?.message || JSON.stringify(errJson);
          } catch {
            errorDetail = await response.text().catch(() => `HTTP ${response.status}`);
          }

          // Case 1: 401/403 Invalid API key or Missing Permissions
          if (response.status === 401 || response.status === 403) {
            keyState.status = 'invalid';
            keyState.cooldownUntil = Infinity;
            const lowerErr = errorDetail.toLowerCase();
            const isMissingPerm = lowerErr.includes('missing the permission') || lowerErr.includes('missing_permissions') || lowerErr.includes('text_to_speech');
            keyState.lastError = isMissingPerm
              ? 'Key missing text_to_speech permission in ElevenLabs dashboard'
              : `Unauthorized (${response.status}): ${errorDetail}`;
            console.warn(
              `[ElevenLabs Key Rotation] Key ${keyState.maskedKey} failed (HTTP ${response.status}): ${keyState.lastError}`
            );
            const err: any = new Error(
              isMissingPerm
                ? `ElevenLabs API key ${keyState.maskedKey} is missing the "text_to_speech" permission. Please enable Text to Speech for this key in ElevenLabs dashboard.`
                : `ElevenLabs API key ${keyState.maskedKey} is unauthorized (${response.status}): ${errorDetail}`
            );
            err.code = isMissingPerm ? 'MISSING_PERMISSIONS' : 'UNAUTHORIZED';
            err.keyMasked = keyState.maskedKey;
            throw err;
          }

          // Case 2: 429 Quota Exceeded (character allowance exhausted)
          const lowerDetail = errorDetail.toLowerCase();
          const isQuota =
            response.status === 429 &&
            (lowerDetail.includes('quota_exceeded') ||
              lowerDetail.includes('character_limit') ||
              lowerDetail.includes('quota') ||
              lowerDetail.includes('credit') ||
              lowerDetail.includes('allowance'));

          if (isQuota || lowerDetail.includes('quota_exceeded') || lowerDetail.includes('character_limit')) {
            keyState.status = 'quota_exceeded';
            keyState.cooldownUntil = Date.now() + 6 * 60 * 60 * 1000; // 6-hour cooldown
            keyState.lastError = 'Monthly character quota exceeded';
            console.warn(
              `[ElevenLabs Key Rotation] Key ${keyState.maskedKey} quota exceeded. Rotating to next key... (${attempts}/${maxAttempts} attempted)`
            );
            const err: any = new Error(
              `ElevenLabs quota exceeded for key ${keyState.maskedKey}.`
            );
            err.code = 'QUOTA_EXCEEDED';
            throw err;
          }

          // Case 3: 429 Rate Limited (concurrency / per-minute burst)
          if (response.status === 429) {
            keyState.status = 'rate_limited';
            keyState.consecutiveFailures++;
            const cooldownSec = Math.min(300, 60 * keyState.consecutiveFailures);
            keyState.cooldownUntil = Date.now() + cooldownSec * 1000;
            keyState.lastError = `Rate limit reached (${cooldownSec}s cooldown)`;
            console.warn(
              `[ElevenLabs Key Rotation] Key ${keyState.maskedKey} rate-limited. Rotating to next key...`
            );
            const err: any = new Error(`ElevenLabs rate limit reached for key ${keyState.maskedKey}.`);
            err.code = 'RATE_LIMITED';
            throw err;
          }

          // Case 4: Other upstream provider errors (500, 502, 503, etc.)
          keyState.status = 'failed';
          keyState.consecutiveFailures++;
          keyState.cooldownUntil = Date.now() + 30 * 1000; // 30s cooldown
          keyState.lastError = `HTTP ${response.status}: ${errorDetail}`;
          console.warn(
            `[ElevenLabs Key Rotation] Key ${keyState.maskedKey} failed with HTTP ${response.status}. Rotating...`
          );
          const err: any = new Error(`ElevenLabs TTS failed (${response.status}): ${errorDetail}`);
          err.code = 'PROVIDER_ERROR';
          throw err;
        }

        const arrayBuffer = await response.arrayBuffer();
        audioBuffers.push(Buffer.from(arrayBuffer));
      }

      // Success! Update metrics
      keyState.status = 'active';
      keyState.cooldownUntil = 0;
      keyState.consecutiveFailures = 0;
      keyState.lastError = undefined;
      keyState.totalRequests++;
      keyState.characterCount += cleanText.length;
      keyState.lastUsedAt = Date.now();
      keyState.inFlightRequests = Math.max(0, keyState.inFlightRequests - 1);

      // Advance rotation index for the next call to distribute load
      rotationIndex = (chosenIndex + 1) % states.length;

      const concatenated = Buffer.concat(audioBuffers);
      const activeKeysCount = states.filter(
        s => s.status === 'active' || (s.status !== 'invalid' && s.cooldownUntil > 0 && Date.now() >= s.cooldownUntil)
      ).length;

      return {
        audioBuffer: concatenated,
        contentType: 'audio/mpeg',
        provider: 'ElevenLabs Neural TTS',
        providerId: 'elevenlabs',
        voiceId: voice.id,
        voiceName: voice.name,
        characterCount: cleanText.length,
        keyUsedMasked: keyState.maskedKey,
        keysActive: activeKeysCount,
        keysTotal: states.length,
      };
    } catch (err: any) {
      keyState.inFlightRequests = Math.max(0, keyState.inFlightRequests - 1);
      lastAttemptError = err;

      // If client aborted, don't continue rotation
      if (options.signal?.aborted || err?.message === 'Synthesis request aborted.') {
        throw err;
      }

      // Advance rotation index so next attempt tries the next key
      rotationIndex = (chosenIndex + 1) % states.length;
      // Loop continues to try next key!
    }
  }

  // All configured keys were attempted and failed
  const activeCount = states.filter(
    s => s.status === 'active' && (s.cooldownUntil === 0 || Date.now() >= s.cooldownUntil)
  ).length;

  const allExhaustedError: any = new Error(
    `All ${states.length} ElevenLabs API keys are exhausted, rate-limited, or unavailable. Last error: ${lastAttemptError?.message || 'Synthesis failed'}`
  );
  allExhaustedError.code = 'ALL_ELEVENLABS_KEYS_EXHAUSTED';
  allExhaustedError.provider = 'elevenlabs';
  allExhaustedError.keysTotal = states.length;
  allExhaustedError.keysActive = activeCount;
  throw allExhaustedError;
}
