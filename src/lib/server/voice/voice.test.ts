import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanMarkdownForSpeech, splitTextIntoSpeechChunks } from './textChunker';
import { getActiveTTSProvider, getTTSConfig, synthesizeSpeech } from './synthesizer';
import {
  synthesizeElevenLabs,
  isElevenLabsConfigured,
  ELEVENLABS_VOICES,
  getElevenLabsVoices,
  ELEVENLABS_BUILTIN_VOICES,
  maskElevenLabsKey,
  getRawElevenLabsKeys,
  getElevenLabsKeyPoolStatus,
  resetElevenLabsKeyPoolForTesting,
} from './providers/elevenlabs';
import { synthesizePiper, isPiperConfigured, PIPER_VOICES } from './providers/piper';
import { synthesizeFreeTts, FREE_TTS_VOICES } from './providers/freeTts';

describe('Modular Neural Voice TTS System Suite', () => {
  const clearElevenLabsEnv = () => {
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEYS;
    delete process.env.ELEVENLABS_VOICE_ID;
    delete process.env.ELEVENLABS_VOICE_IDS;
    for (const k of Object.keys(process.env)) {
      if (/^ELEVENLABS_API_KEY_\d+$/i.test(k) || /^ELEVENLABS_VOICE_ID_\d+$/i.test(k)) {
        delete process.env[k];
      }
    }
    resetElevenLabsKeyPoolForTesting();
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    clearElevenLabsEnv();
  });

  describe('1. Text Cleaning & Markdown Stripping for Audio', () => {
    it('should strip markdown headers, bold, italics, and URLs cleanly', () => {
      const raw = '### Introduction to React\n\n**React** is a *popular* library. Check https://react.dev for info.';
      const cleaned = cleanMarkdownForSpeech(raw);
      expect(cleaned).not.toContain('###');
      expect(cleaned).not.toContain('**');
      expect(cleaned).not.toContain('*popular*');
      expect(cleaned).not.toContain('https://');
      expect(cleaned).toContain('Introduction to React');
      expect(cleaned).toContain('React is a popular library.');
    });

    it('should cleanly replace multiline code blocks with verbal transitions', () => {
      const raw = 'Here is the function:\n```typescript\nconst x = 42;\nconsole.log(x);\n```\nAnd that is all.';
      const cleaned = cleanMarkdownForSpeech(raw);
      expect(cleaned).not.toContain('console.log');
      expect(cleaned).toContain('[Code snippet omitted]');
      expect(cleaned).toContain('Here is the function:');
      expect(cleaned).toContain('And that is all.');
    });

    it('should convert markdown links [label](url) to just the spoken label', () => {
      const raw = 'Visit [NightPlanner Home](https://nightplanner.app) to schedule your deep work sessions.';
      const cleaned = cleanMarkdownForSpeech(raw);
      expect(cleaned).toBe('Visit NightPlanner Home to schedule your deep work sessions.');
    });
  });

  describe('2. Sentence-Boundary Aware Chunking', () => {
    it('should keep short text within a single chunk', () => {
      const text = 'Hello world, this is a short audio test.';
      const chunks = splitTextIntoSpeechChunks(text, 500);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('Hello world, this is a short audio test.');
    });

    it('should split long multi-paragraph texts without splitting across words or sentences', () => {
      const paragraph1 = 'NightPlanner helps you organize your schedule with precision. Every morning brings a new opportunity.';
      const paragraph2 = 'By following a deliberate sequence of tasks, you can achieve deep focus and minimize distractions.';
      const fullText = `${paragraph1}\n\n${paragraph2}`;

      const chunks = splitTextIntoSpeechChunks(fullText, 120);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(120);
        // Ensure words are not chopped mid-word
        expect(chunk.endsWith(' ') || chunk.endsWith('.') || chunk.endsWith('!') || chunk.endsWith('?')).toBe(true);
      }
    });

    it('should return empty array for empty or whitespace-only inputs', () => {
      expect(splitTextIntoSpeechChunks('')).toEqual([]);
      expect(splitTextIntoSpeechChunks('    \n\n   ')).toEqual([]);
    });
  });

  describe('3. Modular TTS Provider Status & Key Masking', () => {
    it('should report provider catalogs without exposing secrets', () => {
      const config = getTTSConfig();
      expect(config.ok).toBe(true);
      expect(config.activeProvider).toBeDefined();
      expect(config.providers.length).toBeGreaterThanOrEqual(3);

      const elevenlabs = config.providers.find(p => p.id === 'elevenlabs');
      expect(elevenlabs).toBeDefined();
      expect(elevenlabs?.freeTierNote).toContain('10,000 characters/month');
      expect(elevenlabs?.voices.length).toBeGreaterThanOrEqual(4);
      expect((elevenlabs as any).apiKey).toBeUndefined();

      const piper = config.providers.find(p => p.id === 'piper');
      expect(piper).toBeDefined();
      expect(piper?.voices.length).toBeGreaterThanOrEqual(3);

      const freeTts = config.providers.find(p => p.id === 'free_tts');
      expect(freeTts).toBeDefined();
      expect(freeTts?.isConfigured).toBe(true);
    });

    it('should respect TTS_PROVIDER environment variable override', () => {
      const prior = process.env.TTS_PROVIDER;
      try {
        process.env.TTS_PROVIDER = 'free_tts';
        expect(getActiveTTSProvider()).toBe('free_tts');
      } finally {
        if (prior === undefined) delete process.env.TTS_PROVIDER;
        else process.env.TTS_PROVIDER = prior;
      }
    });
  });

  describe('4. ElevenLabs Neural Provider Suite', () => {
    it('should reject synthesis with CONFIG_MISSING when API key is not configured', async () => {
      clearElevenLabsEnv();
      expect(isElevenLabsConfigured()).toBe(false);
      await expect(synthesizeElevenLabs({ text: 'Hello ElevenLabs' })).rejects.toThrow(
        'ElevenLabs API key is not configured'
      );
    });

    it('should discover 5+ keys from numbered env variables, comma-separated lists, and single keys', () => {
      process.env.ELEVENLABS_API_KEY_1 = 'eleven_key_alpha_1111';
      process.env.ELEVENLABS_API_KEY_2 = 'eleven_key_beta_2222';
      process.env.ELEVENLABS_API_KEY_3 = 'eleven_key_gamma_3333';
      process.env.ELEVENLABS_API_KEY_4 = 'eleven_key_delta_4444';
      process.env.ELEVENLABS_API_KEY_5 = 'eleven_key_epsilon_5555';
      process.env.ELEVENLABS_API_KEYS = 'eleven_key_zeta_6666, eleven_key_eta_7777';
      process.env.ELEVENLABS_API_KEY = 'eleven_key_fallback_8888';

      const keys = getRawElevenLabsKeys();
      expect(keys.length).toBe(8);
      expect(keys[0]).toBe('eleven_key_alpha_1111');
      expect(keys[1]).toBe('eleven_key_beta_2222');
      expect(keys[4]).toBe('eleven_key_epsilon_5555');
      expect(keys[5]).toBe('eleven_key_zeta_6666');
      expect(keys[6]).toBe('eleven_key_eta_7777');
      expect(keys[7]).toBe('eleven_key_fallback_8888');
      expect(isElevenLabsConfigured()).toBe(true);
    });

    it('should safely mask API keys and never expose raw secrets in telemetry or status', () => {
      expect(maskElevenLabsKey('eleven_secret_key_1234abcd')).toBe('••••abcd');
      expect(maskElevenLabsKey('short')).toBe('••••••••');

      process.env.ELEVENLABS_API_KEY_1 = 'eleven_test_secret_1111';
      process.env.ELEVENLABS_API_KEY_2 = 'eleven_test_secret_2222';

      const pool = getElevenLabsKeyPoolStatus();
      expect(pool.totalKeys).toBe(2);
      expect(pool.activeKeys).toBe(2);
      expect(pool.exhaustedKeys).toBe(0);

      // Verify no raw keys in returned telemetry JSON
      const jsonStr = JSON.stringify(pool);
      expect(jsonStr).not.toContain('eleven_test_secret_1111');
      expect(jsonStr).not.toContain('eleven_test_secret_2222');
      expect(jsonStr).toContain('••••1111');
      expect(jsonStr).toContain('••••2222');
    });

    it('should correctly format request to ElevenLabs API and handle 200 audio response', async () => {
      process.env.ELEVENLABS_API_KEY_1 = 'eleven_test_key_12345';
      const mockAudio = Buffer.from([0xff, 0xfb, 0x90, 0x64]); // Dummy MP3 sync frame

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockAudio, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        })
      );

      const result = await synthesizeElevenLabs({
        text: 'Welcome to your deep work planner.',
        voiceId: '21m00Tcm4TlvDq8ikWAM',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = fetchMock.mock.calls[0]?.[0];
      expect(String(url)).toContain('/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM');

      const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(headers['xi-api-key']).toBe('eleven_test_key_12345');

      expect(result.contentType).toBe('audio/mpeg');
      expect(result.providerId).toBe('elevenlabs');
      expect(result.voiceName).toContain('Rachel');
      expect(result.keyUsedMasked).toBe('••••2345');
    });

    it('should automatically rotate to next key when key 1 encounters 429 quota exhaustion', async () => {
      process.env.ELEVENLABS_API_KEY_1 = 'eleven_key_exhausted_1111';
      process.env.ELEVENLABS_API_KEY_2 = 'eleven_key_healthy_2222';

      const mockAudio = Buffer.from([0xff, 0xfb, 0x90, 0x64]);

      // Call 1 (Key 1) returns 429 Quota Exceeded
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: { message: 'quota_exceeded for current tier' } }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          })
        )
        // Call 2 (Key 2) succeeds with 200 OK
        .mockResolvedValueOnce(
          new Response(mockAudio, {
            status: 200,
            headers: { 'Content-Type': 'audio/mpeg' },
          })
        );

      const result = await synthesizeElevenLabs({
        text: 'Failover quota rotation test.',
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Call 1 used Key 1
      const call1Headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(call1Headers['xi-api-key']).toBe('eleven_key_exhausted_1111');

      // Call 2 rotated to Key 2
      const call2Headers = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
      expect(call2Headers['xi-api-key']).toBe('eleven_key_healthy_2222');

      expect(result.keyUsedMasked).toBe('••••2222');

      // Check pool telemetry: Key 1 in quota_exceeded cooldown, Key 2 active
      const pool = getElevenLabsKeyPoolStatus();
      expect(pool.totalKeys).toBe(2);
      expect(pool.activeKeys).toBe(1);
      expect(pool.exhaustedKeys).toBe(1);

      const k1 = pool.keys.find(k => k.maskedKey === '••••1111');
      expect(k1?.status).toBe('quota_exceeded');
      expect(k1?.cooldownRemainingSeconds).toBeGreaterThan(0);

      const k2 = pool.keys.find(k => k.maskedKey === '••••2222');
      expect(k2?.status).toBe('active');
      expect(k2?.totalRequests).toBe(1);
    });

    it('should temporarily disable rate-limited key and fail over to next key', async () => {
      process.env.ELEVENLABS_API_KEY_1 = 'eleven_key_ratelimited_1111';
      process.env.ELEVENLABS_API_KEY_2 = 'eleven_key_available_2222';

      const mockAudio = Buffer.from([0xff, 0xfb, 0x90, 0x64]);

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response('Too many requests, slow down.', {
            status: 429,
            headers: { 'Content-Type': 'text/plain' },
          })
        )
        .mockResolvedValueOnce(
          new Response(mockAudio, {
            status: 200,
            headers: { 'Content-Type': 'audio/mpeg' },
          })
        );

      const result = await synthesizeElevenLabs({ text: 'Rate limit failover test.' });
      expect(result.keyUsedMasked).toBe('••••2222');

      const pool = getElevenLabsKeyPoolStatus();
      const k1 = pool.keys.find(k => k.maskedKey === '••••1111');
      expect(k1?.status).toBe('rate_limited');
      expect(k1?.cooldownRemainingSeconds).toBeGreaterThan(0);
    });

    it('should permanently disable 401 invalid key for current process and rotate to next key', async () => {
      process.env.ELEVENLABS_API_KEY_1 = 'eleven_key_unauthorized_1111';
      process.env.ELEVENLABS_API_KEY_2 = 'eleven_key_valid_2222';

      const mockAudio = Buffer.from([0xff, 0xfb, 0x90, 0x64]);

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: { message: 'Invalid API key' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(mockAudio, {
            status: 200,
            headers: { 'Content-Type': 'audio/mpeg' },
          })
        );

      const result = await synthesizeElevenLabs({ text: 'Invalid key failover test.' });
      expect(result.keyUsedMasked).toBe('••••2222');

      const pool = getElevenLabsKeyPoolStatus();
      const k1 = pool.keys.find(k => k.maskedKey === '••••1111');
      expect(k1?.status).toBe('invalid');
    });

    it('should prevent infinite loops and throw ALL_ELEVENLABS_KEYS_EXHAUSTED when all 5 keys fail', async () => {
      process.env.ELEVENLABS_API_KEY_1 = 'eleven_key_pool_1111';
      process.env.ELEVENLABS_API_KEY_2 = 'eleven_key_pool_2222';
      process.env.ELEVENLABS_API_KEY_3 = 'eleven_key_pool_3333';
      process.env.ELEVENLABS_API_KEY_4 = 'eleven_key_pool_4444';
      process.env.ELEVENLABS_API_KEY_5 = 'eleven_key_pool_5555';

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response(JSON.stringify({ detail: { message: 'quota_exceeded' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      await expect(synthesizeElevenLabs({ text: 'All keys exhausted test.' })).rejects.toMatchObject({
        code: 'ALL_ELEVENLABS_KEYS_EXHAUSTED',
        keysTotal: 5,
        keysActive: 0,
      });

      // Exactly 5 attempts made - verified no infinite loop
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it('should safely handle concurrent requests across active keys', async () => {
      process.env.ELEVENLABS_API_KEY_1 = 'eleven_concurrent_1111';
      process.env.ELEVENLABS_API_KEY_2 = 'eleven_concurrent_2222';
      process.env.ELEVENLABS_API_KEY_3 = 'eleven_concurrent_3333';

      const mockAudio = Buffer.from([0xff, 0xfb, 0x90, 0x64]);

      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 10));
        return new Response(mockAudio, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        });
      });

      const promises = [
        synthesizeElevenLabs({ text: 'Concurrent task 1' }),
        synthesizeElevenLabs({ text: 'Concurrent task 2' }),
        synthesizeElevenLabs({ text: 'Concurrent task 3' }),
      ];

      const results = await Promise.all(promises);
      expect(results.length).toBe(3);
      for (const res of results) {
        expect(res.contentType).toBe('audio/mpeg');
        expect(res.keyUsedMasked).toBeDefined();
      }
    });
  });

  describe('5. Piper Self-Hosted Modular Provider Suite', () => {
    it('should throw CONFIG_MISSING when PIPER_TTS_URL is not set', async () => {
      const prior = process.env.PIPER_TTS_URL;
      try {
        delete process.env.PIPER_TTS_URL;
        expect(isPiperConfigured()).toBe(false);
        await expect(synthesizePiper({ text: 'Hello Piper' })).rejects.toThrow(
          'Piper self-hosted TTS server is not configured'
        );
      } finally {
        if (prior) process.env.PIPER_TTS_URL = prior;
      }
    });

    it('should dispatch to Piper HTTP server when PIPER_TTS_URL is configured', async () => {
      const prior = process.env.PIPER_TTS_URL;
      process.env.PIPER_TTS_URL = 'http://localhost:5000';
      const mockWav = Buffer.from('RIFF....WAVEfmt ');

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockWav, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        })
      );

      try {
        const result = await synthesizePiper({
          text: 'Focus session started.',
          voiceId: 'en_US-lessac-medium',
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = String(fetchMock.mock.calls[0]?.[0]);
        expect(url).toContain('http://localhost:5000');
        expect(url).toContain('en_US-lessac-medium');
        expect(result.contentType).toBe('audio/wav');
        expect(result.providerId).toBe('piper');
      } finally {
        if (prior === undefined) delete process.env.PIPER_TTS_URL;
        else process.env.PIPER_TTS_URL = prior;
      }
    });
  });

  describe('6. Zero-Config Free Neural TTS Provider Suite', () => {
    it('should synthesize audio without requiring any API keys', async () => {
      const mockAudio = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockAudio, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        })
      );

      const result = await synthesizeFreeTts({
        text: 'This is a genuinely free neural voice test.',
        voiceId: 'en-US',
      });

      expect(result.contentType).toBe('audio/mpeg');
      expect(result.providerId).toBe('free_tts');
      expect(result.audioBuffer.byteLength).toBeGreaterThan(0);
    });

    it('should successfully generate live actual playable audio without API keys', async () => {
      const mockAudio = Buffer.alloc(1200, 0xfa);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockAudio, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        })
      );

      const result = await synthesizeFreeTts({
        text: 'Live audio test for NightPlanner moon assistant.',
        voiceId: 'en-US',
      });
      expect(result.audioBuffer.byteLength).toBeGreaterThan(1000);
      expect(result.contentType).toBe('audio/mpeg');
      fetchSpy.mockRestore();
    });
  });

  describe('7. Central Dispatcher Routing & Automatic Failover', () => {
    it('should route request to specified provider in options', async () => {
      const mockAudio = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockAudio, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        })
      );

      const result = await synthesizeSpeech({
        text: 'Hello from central dispatcher.',
        provider: 'free_tts',
      });

      expect(result.providerId).toBe('free_tts');
      expect(result.contentType).toBe('audio/mpeg');
    });

    it('should automatically fail over to Free Neural Audio when all ElevenLabs keys are exhausted', async () => {
      process.env.ELEVENLABS_API_KEY_1 = 'eleven_test_key_failover_1';
      delete process.env.PIPER_TTS_URL;
      resetElevenLabsKeyPoolForTesting();

      const mockFreeAudio = Buffer.from([0xff, 0xfb, 0x90, 0x64]);

      // Fetch call 1: ElevenLabs returns 429 quota exceeded
      // Fetch call 2: Free TTS succeeds with audio
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: { message: 'quota_exceeded' } }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(mockFreeAudio, {
            status: 200,
            headers: { 'Content-Type': 'audio/mpeg' },
          })
        );

      const result = await synthesizeSpeech({
        text: 'All keys exhausted fallback test.',
        provider: 'elevenlabs',
      });

      expect(result.fallbackTriggered).toBe(true);
      expect(result.originalProviderId).toBe('elevenlabs');
      expect(result.providerId).toBe('free_tts');
      expect(result.contentType).toBe('audio/mpeg');
      expect(result.fallbackReason).toContain('ElevenLabs keys are exhausted');
    });

    it('should automatically fail over to Piper when all ElevenLabs keys are exhausted and Piper is configured', async () => {
      process.env.ELEVENLABS_API_KEY_1 = 'eleven_test_key_failover_piper';
      process.env.PIPER_TTS_URL = 'http://localhost:5000';
      resetElevenLabsKeyPoolForTesting();

      const mockWav = Buffer.from('RIFF....WAVEfmt ');

      // Fetch call 1: ElevenLabs returns 429 quota exceeded
      // Fetch call 2: Piper returns WAV audio
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: { message: 'quota_exceeded' } }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(mockWav, {
            status: 200,
            headers: { 'Content-Type': 'audio/wav' },
          })
        );

      try {
        const result = await synthesizeSpeech({
          text: 'Piper failover test.',
          provider: 'elevenlabs',
        });

        expect(result.fallbackTriggered).toBe(true);
        expect(result.originalProviderId).toBe('elevenlabs');
        expect(result.providerId).toBe('piper');
        expect(result.contentType).toBe('audio/wav');
        expect(result.fallbackReason).toContain('failed over to Piper');
      } finally {
        delete process.env.PIPER_TTS_URL;
        delete process.env.ELEVENLABS_API_KEY_1;
        resetElevenLabsKeyPoolForTesting();
      }
    });
  });

  describe('7. Voice Models & Custom ELEVENLABS_VOICE_ID Discovery (10+ Models)', () => {
    it('should provide more than 10 built-in voice models by default', () => {
      expect(ELEVENLABS_BUILTIN_VOICES.length).toBeGreaterThanOrEqual(15);
      const voices = getElevenLabsVoices();
      expect(voices.length).toBeGreaterThanOrEqual(15);

      // Verify popular personas exist in the list
      const voiceNames = voices.map(v => v.name);
      expect(voiceNames.some(n => n.includes('Rachel'))).toBe(true);
      expect(voiceNames.some(n => n.includes('Adam'))).toBe(true);
      expect(voiceNames.some(n => n.includes('Sarah'))).toBe(true);
      expect(voiceNames.some(n => n.includes('Antoni'))).toBe(true);
      expect(voiceNames.some(n => n.includes('Sam'))).toBe(true);
      expect(voiceNames.some(n => n.includes('George'))).toBe(true);
      expect(voiceNames.some(n => n.includes('Lily'))).toBe(true);
    });

    it('should prepend ELEVENLABS_VOICE_ID (e.g. C1npRmjB19a6yNkEucvx) at index 0 as default voice', () => {
      process.env.ELEVENLABS_VOICE_ID = 'C1npRmjB19a6yNkEucvx';

      const voices = getElevenLabsVoices();
      expect(voices.length).toBeGreaterThan(15);
      expect(voices[0].id).toBe('C1npRmjB19a6yNkEucvx');
      expect(voices[0].isDefault).toBe(true);
      expect(voices[0].name).toContain('Configured Voice (C1npRmjB');

      // Subsequent built-in voices should not have isDefault true
      expect(voices[1].isDefault).toBeFalsy();
    });

    it('should report activeVoiceId as C1npRmjB19a6yNkEucvx in getTTSConfig() when configured', () => {
      process.env.ELEVENLABS_VOICE_ID = 'C1npRmjB19a6yNkEucvx';
      process.env.ELEVENLABS_API_KEY_1 = 'eleven_test_key_config_voice';

      const config = getTTSConfig();
      expect(config.activeVoiceId).toBe('C1npRmjB19a6yNkEucvx');

      const elProvider = config.providers.find(p => p.id === 'elevenlabs');
      expect(elProvider).toBeDefined();
      expect(elProvider?.voices[0].id).toBe('C1npRmjB19a6yNkEucvx');
      expect(elProvider?.voices.length).toBeGreaterThanOrEqual(16);
    });

    it('should dynamically discover multiple custom voice IDs from ELEVENLABS_VOICE_IDS and ELEVENLABS_VOICE_ID_1..N', () => {
      process.env.ELEVENLABS_VOICE_ID = 'C1npRmjB19a6yNkEucvx';
      process.env.ELEVENLABS_VOICE_ID_1 = 'custom_voice_id_one';
      process.env.ELEVENLABS_VOICE_ID_2 = 'custom_voice_id_two';
      process.env.ELEVENLABS_VOICE_IDS = 'custom_voice_id_three, custom_voice_id_four';

      const voices = getElevenLabsVoices();
      const voiceIds = voices.map(v => v.id);

      expect(voiceIds).toContain('C1npRmjB19a6yNkEucvx');
      expect(voiceIds).toContain('custom_voice_id_one');
      expect(voiceIds).toContain('custom_voice_id_two');
      expect(voiceIds).toContain('custom_voice_id_three');
      expect(voiceIds).toContain('custom_voice_id_four');

      // The configured primary voice remains index 0
      expect(voices[0].id).toBe('C1npRmjB19a6yNkEucvx');
    });

    it('should default to ELEVENLABS_VOICE_ID in synthesizeElevenLabs when voiceId is omitted', async () => {
      process.env.ELEVENLABS_VOICE_ID = 'C1npRmjB19a6yNkEucvx';
      process.env.ELEVENLABS_API_KEY_1 = 'eleven_test_key_voice_call';

      const mockAudio = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockAudio, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        })
      );

      const result = await synthesizeElevenLabs({
        text: 'Speaking with custom configured voice ID.',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).toContain('/v1/text-to-speech/C1npRmjB19a6yNkEucvx');
      expect(result.voiceId).toBe('C1npRmjB19a6yNkEucvx');
      expect(result.voiceName).toContain('Configured Voice (C1npRmjB');
    });
  });

  describe('8. HTTP 400 Diagnostics, 402 Auto-Heal & Robust Fallback Suite', () => {
    it('should sanitize non-language voice IDs in synthesizeFreeTts to prevent Google TTS HTTP 400', async () => {
      const mockAudio = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockAudio, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        })
      );

      // Pass an ElevenLabs voice ID into free_tts (which previously caused HTTP 400)
      const result = await synthesizeFreeTts({
        text: 'Testing Free Neural Audio voice sanitization.',
        voiceId: 'C1npRmjB19a6yNkEucvx',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const urlStr = String(fetchMock.mock.calls[0]?.[0]);
      const url = new URL(urlStr);
      // Confirmed: tl parameter was sanitized to 'en-US' rather than invalid 'C1npRmjB19a6yNkEucvx'
      expect(url.searchParams.get('tl')).toBe('en-US');
      expect(result.voiceId).toBe('en-US');
      expect(result.providerId).toBe('free_tts');
    });

    it('should capture provider response body and attach detailed diagnostic info on Free TTS failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('<html>Custom Google Error</html>', {
          status: 400,
          statusText: 'Bad Request',
        })
      );

      await expect(
        synthesizeFreeTts({
          text: 'Triggering simulated failure.',
          voiceId: 'en-US',
        })
      ).rejects.toThrow(/Free Neural Audio synthesis request failed \(HTTP 400: <html>Custom Google Error<\/html>\)/);
    });

    it('should auto-heal to verified free-tier voice Adam when ElevenLabs returns 402 for library voice', async () => {
      process.env.ELEVENLABS_API_KEY_1 = 'eleven_test_key_autoheal';

      const mockAudio = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
      let callCount = 0;
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        callCount++;
        const urlStr = String(url);
        if (urlStr.includes('C1npRmjB19a6yNkEucvx')) {
          return new Response(
            JSON.stringify({
              detail: {
                type: 'payment_required',
                code: 'paid_plan_required',
                message: 'Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.',
                status: 'payment_required',
              },
            }),
            { status: 402, headers: { 'Content-Type': 'application/json' } }
          );
        }
        // Auto-heal retry with Adam (pNInz6obpgDQGcFmaJgB)
        if (urlStr.includes('pNInz6obpgDQGcFmaJgB')) {
          return new Response(mockAudio, {
            status: 200,
            headers: { 'Content-Type': 'audio/mpeg' },
          });
        }
        return new Response('Not found', { status: 404 });
      });

      const result = await synthesizeElevenLabs({
        text: 'This library voice requires a paid plan.',
        voiceId: 'C1npRmjB19a6yNkEucvx',
      });

      expect(callCount).toBe(2);
      expect(result.autoHealedVoice).toBe(true);
      expect(result.originalVoiceId).toBe('C1npRmjB19a6yNkEucvx');
      expect(result.voiceId).toBe('pNInz6obpgDQGcFmaJgB');
      expect(result.notice).toContain('automatically synthesized using verified free-tier voice Adam');
    });

    it('should gracefully fail over to Free Neural Audio when ElevenLabs voice cannot be synthesized', async () => {
      process.env.ELEVENLABS_API_KEY_1 = 'eleven_test_key_fallback';

      // Mock ElevenLabs failing permanently with 500 error
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('api.elevenlabs.io')) {
          return new Response('Internal Server Error', { status: 500 });
        }
        // Fallback to Google Translate TTS
        if (urlStr.includes('translate.google.com')) {
          return new Response(Buffer.from([0xff, 0xfb, 0x90, 0x64]), {
            status: 200,
            headers: { 'Content-Type': 'audio/mpeg' },
          });
        }
        return new Response('Not found', { status: 404 });
      });

      const result = await synthesizeSpeech({
        text: 'Fallback test when ElevenLabs fails with 500.',
        voiceId: 'C1npRmjB19a6yNkEucvx',
        provider: 'elevenlabs',
      });

      expect(result.fallbackTriggered).toBe(true);
      expect(result.providerId).toBe('free_tts');
      expect(result.voiceId).toBe('en-US'); // Sanitized cleanly
      expect(result.audioBuffer).toBeDefined();
    });
  });
});
