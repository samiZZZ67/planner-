import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveChatCompletionsUrl,
  resolveModelsUrl,
  getGatewayConfig,
  checkGatewayStatus,
  sendChatCompletion,
  sendChatCompletionWithFallback,
  openChatCompletionStream,
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
      expect(status.models).toEqual([]);
      expect(status.catalog).toEqual([]); // Offline results must not masquerade as live models
      expect(status.error).toBeDefined();
    });

    it('should reject an HTML 200 response as failed model discovery', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<!doctype html><html><title>Dashboard</title></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }));

      const status = await checkGatewayStatus('https://gateway.example/v1');
      expect(status.online).toBe(false);
      expect(status.models).toEqual([]);
      expect(status.error).toContain('https://gateway.example/v1/models');
      expect(status.error).toContain('text/html');
    });

    it('should expose only exact ids returned by the live model endpoint', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: 'vendor/exact-model:free', owned_by: 'Vendor' }],
      }), { headers: { 'content-type': 'application/json' } }));

      const status = await checkGatewayStatus('https://gateway.example/v1');
      expect(status.online).toBe(true);
      expect(status.models).toEqual(['vendor/exact-model:free']);
      expect(status.catalog.map(model => model.id)).toEqual(['vendor/exact-model:free']);
    });

    it('should not silently replace an explicitly selected invalid model', async () => {
      const priorUrl = process.env.FREE_LLM_API_URL;
      process.env.FREE_LLM_API_URL = 'https://gateway.example/v1';
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'Model bogus/model not found', type: 'model_not_found' },
      }), { status: 404, headers: { 'content-type': 'application/json' } }));
      try {
        await expect(sendChatCompletionWithFallback({
          model: 'bogus/model', messages: [{ role: 'user', content: 'Hello' }],
        })).rejects.toThrow("Selected model 'bogus/model' was rejected");
      } finally {
        if (priorUrl === undefined) delete process.env.FREE_LLM_API_URL;
        else process.env.FREE_LLM_API_URL = priorUrl;
      }
    });

    it('should expose an OpenAI SSE stream and preserve the auto model', async () => {
      const priorUrl = process.env.FREE_LLM_API_URL;
      const priorKey = process.env.FREE_LLM_API_KEY;
      process.env.FREE_LLM_API_URL = 'https://gateway.example/v1';
      process.env.FREE_LLM_API_KEY = 'unit-test-key';
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
        'data: {\"model\":\"served-model\",\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      ));
      try {
        const stream = await openChatCompletionStream({
          model: 'auto', messages: [{ role: 'user', content: 'Hello' }],
        });
        const output = await new Response(stream).text();
        expect(output).toContain('hello');
        const request = fetchMock.mock.calls[0]?.[1];
        expect(JSON.parse(String(request?.body)).model).toBe('auto');
        expect(new Headers(request?.headers).get('authorization')).toBe('Bearer unit-test-key');
      } finally {
        if (priorUrl === undefined) delete process.env.FREE_LLM_API_URL;
        else process.env.FREE_LLM_API_URL = priorUrl;
        if (priorKey === undefined) delete process.env.FREE_LLM_API_KEY;
        else process.env.FREE_LLM_API_KEY = priorKey;
      }
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

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(mockApiResponse), {
        headers: { 'content-type': 'application/json' },
      }));

      const result = await sendChatCompletion({
        messages: [{ role: 'user', content: 'Ping' }],
        customUrl: 'http://localhost:3001',
      });

      expect(result.content).toBe('FreeLLMAPI: All 34 free providers are online and operational.');
      expect(result.model).toBe('auto (gemini-2.5-flash)');
      expect(result.tokensUsed?.totalTokens).toBe(25);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should automatically switch to auto / ready models when a selected model hits rate limits (429)', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: { message: 'Rate limit exceeded on provider', type: 'rate_limit_error' },
            }),
            { status: 429, headers: { 'content-type': 'application/json' } }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 'chatcmpl-switched-456',
              object: 'chat.completion',
              model: 'llama-3.3-70b-versatile',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: 'Automatically switched to working configured model!',
                  },
                  finish_reason: 'stop',
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        );

      const result = await sendChatCompletionWithFallback({
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'Test rate limit switch' }],
        customUrl: 'https://gateway-autoswitch.example/v1',
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.content).toBe('Automatically switched to working configured model!');
      expect(result.model).toBe('llama-3.3-70b-versatile');
      expect(result.fallbackFrom).toBe('gemini-2.5-flash');
      expect(result.providerUsed).toContain('Auto-Switched');
    });
  });
});

