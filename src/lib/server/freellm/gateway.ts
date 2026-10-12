import {
  CatalogModel,
  VERIFIED_FREE_MODELS,
  mergeDiscoveredModels,
  getModelById,
} from './catalog';

export interface FreeLLMGatewayConfig {
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  attachments?: any[];
}

export interface SendChatOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  customUrl?: string;
  customKey?: string;
  stream?: boolean;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  latencyMs: number;
  tokensUsed?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  raw?: any;
}

export interface GatewayStatusResult {
  online: boolean;
  gatewayUrl: string;
  latencyMs?: number;
  models: string[];
  catalog: CatalogModel[];
  error?: string;
  fallbackReady: boolean;
}

/**
 * Standard recommended models supported across FreeLLMAPI providers
 */
export const POPULAR_FREE_MODELS = VERIFIED_FREE_MODELS.filter(m => m.isPopular).map(m => ({
  id: m.id,
  name: m.name,
}));

/**
 * Get server-configured FreeLLMAPI Gateway settings
 */
export function getGatewayConfig(): FreeLLMGatewayConfig {
  let url =
    process.env.FREE_LLM_API_URL ||
    process.env.FREELLM_API_URL ||
    process.env.FREE_LLM_GATEWAY_URL ||
    process.env.FREE_LLM_API_BASE_URL ||
    'http://localhost:3001';

  // Normalize: remove trailing slash
  url = url.trim().replace(/\/+$/, '');

  const apiKey =
    process.env.FREE_LLM_API_KEY ||
    process.env.FREELLM_API_KEY ||
    process.env.FREE_LLM_GATEWAY_KEY ||
    process.env.UNIFIED_API_KEY ||
    process.env.FREEAPI_UNIFIED_KEY ||
    '';

  const defaultModel = process.env.FREE_LLM_MODEL || process.env.FREELLM_MODEL || 'auto';

  return { baseUrl: url, apiKey, defaultModel };
}

/**
 * Normalizes URL to target the OpenAI-compatible chat completions endpoint
 */
export function resolveChatCompletionsUrl(baseUrl: string): string {
  let clean = baseUrl.trim().replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) {
    return clean;
  }
  if (clean.endsWith('/v1')) {
    return `${clean}/chat/completions`;
  }
  return `${clean}/v1/chat/completions`;
}

/**
 * Normalizes URL to target the OpenAI-compatible models list endpoint
 */
export function resolveModelsUrl(baseUrl: string): string {
  let clean = baseUrl.trim().replace(/\/+$/, '');
  if (clean.endsWith('/models')) {
    return clean;
  }
  if (clean.endsWith('/v1')) {
    return `${clean}/models`;
  }
  return `${clean}/v1/models`;
}

/**
 * Check if the FreeLLMAPI Gateway is online and retrieve all available models dynamically
 */
export async function checkGatewayStatus(
  customUrl?: string,
  customKey?: string
): Promise<GatewayStatusResult> {
  const config = getGatewayConfig();
  const targetBaseUrl = (customUrl || config.baseUrl).trim().replace(/\/+$/, '');
  const apiKey = customKey !== undefined ? customKey : config.apiKey;

  const modelsUrl = resolveModelsUrl(targetBaseUrl);
  const startTime = Date.now();

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['Fetch-Relay-Authorization'] = `Bearer ${apiKey}`;
  }

  const hasFallback = Boolean(
    process.env.GROQ_API_KEY_1 ||
    process.env.GROQ_API_KEY ||
    process.env.GEMINI_API_KEY_1 ||
    process.env.GEMINI_API_KEY
  );

  try {
    const controller = new AbortController();
    // 12s timeout to accommodate cold starts on free cloud hosting
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        online: false,
        gatewayUrl: targetBaseUrl,
        latencyMs,
        models: VERIFIED_FREE_MODELS.map(m => m.id),
        catalog: VERIFIED_FREE_MODELS,
        fallbackReady: hasFallback,
        error: `Gateway HTTP ${res.status}: ${res.statusText} (${errText.slice(0, 100) || 'Auth or service warming up'})`,
      };
    }

    const data = await res.json().catch(() => null);
    let rawModels: any[] = [];

    if (data && Array.isArray(data.data)) {
      rawModels = data.data;
    } else if (data && Array.isArray(data.models)) {
      rawModels = data.models;
    }

    const fullCatalog = mergeDiscoveredModels(rawModels);

    return {
      online: true,
      gatewayUrl: targetBaseUrl,
      latencyMs,
      models: fullCatalog.map(m => m.id),
      catalog: fullCatalog,
      fallbackReady: hasFallback,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      online: false,
      gatewayUrl: targetBaseUrl,
      latencyMs,
      models: VERIFIED_FREE_MODELS.map(m => m.id),
      catalog: VERIFIED_FREE_MODELS,
      fallbackReady: hasFallback,
      error:
        err.name === 'AbortError'
          ? 'Gateway check timed out after 12s (service may be waking up on Render).'
          : err.message || 'Gateway unreachable',
    };
  }
}

/**
 * Execute chat completion through the FreeLLMAPI Gateway
 */
export async function sendChatCompletion(
  options: SendChatOptions
): Promise<ChatCompletionResult> {
  const config = getGatewayConfig();
  const targetBaseUrl = (options.customUrl || config.baseUrl).trim().replace(/\/+$/, '');
  const apiKey = options.customKey !== undefined ? options.customKey : config.apiKey;
  const model = options.model || config.defaultModel;

  const endpoint = resolveChatCompletionsUrl(targetBaseUrl);
  const startTime = Date.now();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['Fetch-Relay-Authorization'] = `Bearer ${apiKey}`;
  }

  const payload = {
    model,
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
    stream: false,
  };

  const controller = new AbortController();
  // 50s timeout for complex inference
  const timeout = setTimeout(() => controller.abort(), 50000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      let parsedErr = '';
      try {
        const json = JSON.parse(errBody);
        parsedErr = json.error?.message || json.message || errBody;
      } catch {
        parsedErr = errBody;
      }

      throw new Error(
        `FreeLLMAPI Gateway Error (${res.status} ${res.statusText}): ${parsedErr || 'Request failed'}`
      );
    }

    const data = await res.json();
    const messageContent =
      data.choices?.[0]?.message?.content ||
      data.choices?.[0]?.text ||
      '';

    if (!messageContent && !data.error) {
      throw new Error('FreeLLMAPI Gateway returned an empty message content.');
    }

    return {
      content: messageContent,
      model: data.model || model,
      latencyMs,
      tokensUsed: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
      raw: data,
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`FreeLLMAPI Gateway request timed out after 50 seconds (${endpoint}).`);
    }
    throw err;
  }
}

/**
 * Executes chat completion with capability-aware, intelligent failover to Groq or Gemini
 * when the external gateway is cold-starting or returning auth/network errors.
 */
export async function sendChatCompletionWithFallback(
  options: SendChatOptions
): Promise<ChatCompletionResult & { providerUsed: string }> {
  const requestedModel = options.model || 'auto';
  const modelInfo = getModelById(requestedModel);

  // 1. Try FreeLLM Gateway first
  try {
    const result = await sendChatCompletion(options);
    return { ...result, providerUsed: 'FreeLLMAPI Gateway' };
  } catch (gatewayErr: any) {
    console.warn(`[FreeLLM Gateway] Request failed (${gatewayErr.message}). Attempting capability-aware fallback...`);

    const groqKey =
      process.env.GROQ_API_KEY_1 ||
      process.env.GROQ_API_KEY_2 ||
      process.env.GROQ_API_KEY_3 ||
      process.env.GROQ_API_KEY;

    const geminiKey =
      process.env.GEMINI_API_KEY_1 ||
      process.env.GEMINI_API_KEY_2 ||
      process.env.GEMINI_API_KEY_3 ||
      process.env.GEMINI_API_KEY;

    const isGoogleTarget =
      modelInfo?.provider === 'Google' ||
      /gemini|gemma/i.test(requestedModel);

    // 2. Route directly to Google Gemini if requested model is Gemini/Google
    if (geminiKey && geminiKey.trim().length > 10 && (isGoogleTarget || !groqKey)) {
      try {
        const startTime = Date.now();
        const cleanKey = geminiKey.trim();
        const targetGeminiModel =
          requestedModel.startsWith('gemini-') && !requestedModel.includes('preview')
            ? requestedModel
            : 'gemini-2.5-flash';

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetGeminiModel)}:generateContent?key=${encodeURIComponent(cleanKey)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': cleanKey,
            },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: options.messages
                        .map(m => `${m.role.toUpperCase()}: ${m.content}`)
                        .join('\n\n'),
                    },
                  ],
                },
              ],
              generationConfig: {
                temperature: options.temperature ?? 0.7,
                maxOutputTokens: 2500,
              },
            }),
          }
        );

        if (geminiRes.ok) {
          const data = await geminiRes.json();
          const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (content) {
            return {
              content,
              model: `${targetGeminiModel} (Google Direct Fallback)`,
              latencyMs: Date.now() - startTime,
              tokensUsed: {
                promptTokens: data.usageMetadata?.promptTokenCount,
                completionTokens: data.usageMetadata?.candidatesTokenCount,
                totalTokens: data.usageMetadata?.totalTokenCount,
              },
              providerUsed: 'Google AI Studio (Direct Fallback)',
            };
          }
        }
      } catch (geminiErr) {
        console.warn('[FreeLLM Fallback] Gemini attempt failed:', geminiErr);
      }
    }

    // 3. Route to Groq Cloud (Ultra-Fast)
    if (groqKey && groqKey.trim().length > 10) {
      try {
        const startTime = Date.now();
        const groqSupportedModels = [
          'llama-3.3-70b-versatile',
          'llama-3.1-8b-instant',
          'deepseek-r1-distill-llama-70b',
          'openai/gpt-oss-20b',
          'openai/gpt-oss-120b',
          'qwen/qwen3.8-27b',
          'allam-2-7b',
          'mixtral-8x7b-32768',
        ];

        const targetGroqModel = groqSupportedModels.includes(requestedModel)
          ? requestedModel
          : 'llama-3.3-70b-versatile';

        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${groqKey.trim()}`,
          },
          body: JSON.stringify({
            model: targetGroqModel,
            messages: options.messages.map(m => ({
              role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
              content: m.content,
            })),
            temperature: options.temperature ?? 0.7,
          }),
        });

        if (groqRes.ok) {
          const data = await groqRes.json();
          const content = data.choices?.[0]?.message?.content || '';
          if (content) {
            return {
              content,
              model: `${targetGroqModel} (Groq Ultra-Fast Fallback)`,
              latencyMs: Date.now() - startTime,
              tokensUsed: {
                promptTokens: data.usage?.prompt_tokens,
                completionTokens: data.usage?.completion_tokens,
                totalTokens: data.usage?.total_tokens,
              },
              providerUsed: 'Groq Cloud (Fallback)',
            };
          }
        }
      } catch (groqErr) {
        console.warn('[FreeLLM Fallback] Groq attempt failed:', groqErr);
      }
    }

    // 4. Second pass with Gemini if Groq was tried first but failed
    if (geminiKey && geminiKey.trim().length > 10 && !isGoogleTarget) {
      try {
        const startTime = Date.now();
        const cleanKey = geminiKey.trim();
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(cleanKey)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': cleanKey,
            },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: options.messages
                        .map(m => `${m.role.toUpperCase()}: ${m.content}`)
                        .join('\n\n'),
                    },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2500,
              },
            }),
          }
        );

        if (geminiRes.ok) {
          const data = await geminiRes.json();
          const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (content) {
            return {
              content,
              model: 'gemini-2.5-flash (Google Direct Fallback)',
              latencyMs: Date.now() - startTime,
              tokensUsed: {
                promptTokens: data.usageMetadata?.promptTokenCount,
                completionTokens: data.usageMetadata?.candidatesTokenCount,
                totalTokens: data.usageMetadata?.totalTokenCount,
              },
              providerUsed: 'Google AI Studio (Fallback)',
            };
          }
        }
      } catch (geminiErr2) {
        console.warn('[FreeLLM Fallback] Final Gemini attempt failed:', geminiErr2);
      }
    }

    // If all providers and fallbacks fail, rethrow original error
    throw gatewayErr;
  }
}
