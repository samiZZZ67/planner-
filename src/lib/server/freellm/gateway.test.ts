import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveChatCompletionsUrl,
  resolveModelsUrl,
  getGatewayConfig,
  checkGatewayStatus,
  sendChatCompletion,
  POPULAR_FREE_MODELS,
} from './gateway';

describe('FreeLLMAPI Gateway Client Suite', () => {
  describe('1. Endpoint URL Normalization', () => {
    it('should correctly format chat completions endpoint', () => {
      expect(resolveChatCompletionsUrl('http://localhost:3001')).toBe('http://localhost:3001/v1/chat/completions');
      expect(resolveChatCompletionsUrl('http://localhost:3001/')).toBe('http://localhost:3001/v1/chat/completions');
      expect(resolveChatCompletionsUrl('http://localhost:3001/v1')).toBe('http://localhost:3001/v1/chat/completions');
      expect(resolveChatCompletionsUrl('https://freellm.render.com/v1/chat/completions')).toBe(
        'https://freellm.render.com/v1/chat/completions'
      );
    });

    it('should correctly format models list endpoint', () => {
      expect(resolveModelsUrl('http://localhost:3001')).toBe('http://localhost:3001/v1/models');
      expect(resolveModelsUrl('http://localhost:3001/v1')).toBe('http://localhost:3001/v1/models');
      expect(resolveModelsUrl('http://localhost:3001/models')).toBe('http://localhost:3001/models');
    });
  });

  describe('2. Gateway Configuration & Defaults', () => {
    it('should have default auto model and fallback popular models', () => {
      const config = getGatewayConfig();
      expect(config.defaultModel).toBeDefined();
      expect(POPULAR_FREE_MODELS.length).toBeGreaterThan(0);
      expect(POPULAR_FREE_MODELS.some(m => m.id === 'auto')).toBe(true);
      expect(POPULAR_FREE_MODELS.some(m => m.id === 'gemini-2.5-flash')).toBe(true);
    });
  });

  describe('3. Offline & Error Resilience', () => {
    it('should return offline status gracefully when target gateway is unreachable', async () => {
      // Intentionally unreachable port
      const status = await checkGatewayStatus('http://127.0.0.1:59999');
      expect(status.online).toBe(false);
      expect(status.gatewayUrl).toBe('http://127.0.0.1:59999');
      expect(status.models.length).toBeGreaterThan(0); // Falls back to standard model list
      expect(status.error).toBeDefined();
    });

    it('should throw clear error when chat request cannot connect', async () => {
      await expect(
        sendChatCompletion({
          messages: [{ role: 'user', content: 'Hello' }],
          customUrl: 'http://127.0.0.1:59999',
        })
      ).rejects.toThrow();
    });
  });

  describe('4. Mocked Gateway Chat Completion Response', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should parse valid OpenAI-compatible wire response from FreeLLMAPI gateway', async () => {
      const mockApiResponse = {
        id: 'chatcmpl-test-123',
        object: 'chat.completion',
        created: 1728639200,
        model: 'auto (gemini-2.5-flash)',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'FreeLLMAPI: All 34 free providers are online and operational.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 15,
          total_tokens: 25,
        },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      } as Response);

      const result = await sendChatCompletion({
        messages: [{ role: 'user', content: 'Ping' }],
        customUrl: 'http://localhost:3001',
      });

      expect(result.content).toBe('FreeLLMAPI: All 34 free providers are online and operational.');
      expect(result.model).toBe('auto (gemini-2.5-flash)');
      expect(result.tokensUsed?.totalTokens).toBe(25);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });
});
