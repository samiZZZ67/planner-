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
    (process.env.NODE_ENV === 'production'
      ? 'https://free-llm-api-7fue.onrender.com/v1'
      : 'http://localhost:3001');

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
    // 15s timeout to accommodate cold starts on free cloud hosting
    const timeout = setTimeout(() => controller.abort(), 15000);

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
          ? 'Gateway check timed out after 15s (service may be waking up on Render).'
          : err.message || 'Gateway unreachable',
    };
  }
}

/**
 * Helper to safely extract response body whether in real fetch or mocked environment
 */
async function parseResponseBody(res: Response): Promise<{ text: string; json: any; isHtml: boolean }> {
  let text = '';
  let json: any = null;

  if (typeof (res as any).text === 'function') {
    text = await (res as any).text().catch(() => '');
  } else if (typeof (res as any).json === 'function') {
    try {
      json = await (res as any).json();
      text = typeof json === 'string' ? json : JSON.stringify(json);
    } catch {
      text = '';
    }
  }

  const isHtml =
    text.trim().startsWith('<') ||
    /<!doctype/i.test(text) ||
    /<html/i.test(text) ||
    /<head/i.test(text);

  if (!json && text && !isHtml) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return { text, json, isHtml };
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
  const rawModel = options.model || config.defaultModel;
  const model = !rawModel || rawModel === 'auto' ? 'gemini-3.6-flash' : rawModel;

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
  // 65s timeout for complex inference & Render cold starts
  const timeout = setTimeout(() => controller.abort(), 65000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const parsed = await parseResponseBody(res);

    if (!res.ok) {
      let parsedErr = '';
      if (!parsed.isHtml && parsed.json) {
        parsedErr = parsed.json.error?.message || parsed.json.message || parsed.text.slice(0, 200);
      } else if (!parsed.isHtml && parsed.text) {
        parsedErr = parsed.text.slice(0, 200);
      } else {
        parsedErr = `Service returned HTML (HTTP ${res.status}: ${res.statusText})`;
      }

      throw new Error(
        `FreeLLMAPI Gateway Error (${res.status} ${res.statusText}): ${parsedErr || 'Request failed'}`
      );
    }

    if (parsed.isHtml) {
      throw new Error(
        `FreeLLMAPI Gateway returned an HTML page (${res.status} ${res.statusText}) instead of an API JSON response.`
      );
    }

    const data = parsed.json;
    if (!data) {
      throw new Error('FreeLLMAPI Gateway response could not be parsed as JSON.');
    }

    const messageContent =
      data.choices?.[0]?.message?.content ||
      data.choices?.[0]?.text ||
      '';

    if (!messageContent && !data.error) {
      throw new Error('FreeLLMAPI Gateway returned empty message content.');
    }

    return {
      content: messageContent,
      model: data.model || model,
      latencyMs: Date.now() - startTime,
      tokensUsed: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
      raw: data,
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`FreeLLMAPI Gateway request timed out after 65 seconds (${endpoint}).`);
    }
    throw err;
  }
}

/**
 * Execute direct fallback to Google Gemini AI Studio (730M+ token capacity)
 */
async function callGeminiDirect(
  options: SendChatOptions,
  preferredModel?: string
): Promise<(ChatCompletionResult & { providerUsed: string }) | null> {
  const geminiKeys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY,
  ].filter((k): k is string => Boolean(k && k.trim().length > 10));

  if (geminiKeys.length === 0) return null;

  // Modern verified Gemini models in priority order
  const validGeminiModels = [
    'gemini-3.6-flash',
    'gemini-3.8-flash',
    'gemini-3.5-flash',
  ];

  const modelsToTry: string[] = [];
  if (preferredModel && validGeminiModels.includes(preferredModel)) {
    modelsToTry.push(preferredModel);
  }
  for (const m of validGeminiModels) {
    if (!modelsToTry.includes(m)) modelsToTry.push(m);
  }

  const promptText = options.messages
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  for (const rawKey of geminiKeys) {
    const cleanKey = rawKey.trim();
    for (const model of modelsToTry) {
      try {
        const startTime = Date.now();
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cleanKey)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': cleanKey,
            },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: promptText }] }],
              generationConfig: {
                temperature: options.temperature ?? 0.7,
                maxOutputTokens: 4096,
              },
            }),
          }
        );

        if (!res.ok) continue;

        const parsed = await parseResponseBody(res);
        if (parsed.isHtml || !parsed.json) continue;

        const data = parsed.json;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (text) {
          return {
            content: text,
            model: `${model} (730M Token Provider)`,
            latencyMs: Date.now() - startTime,
            tokensUsed: {
              promptTokens: data.usageMetadata?.promptTokenCount,
              completionTokens: data.usageMetadata?.candidatesTokenCount,
              totalTokens: data.usageMetadata?.totalTokenCount,
            },
            providerUsed: 'Google AI Studio (Fallback)',
          };
        }
      } catch {
        // Try next model/key
      }
    }
  }

  return null;
}

/**
 * Execute direct fallback to Groq Cloud (Ultra-Fast Inference)
 */
async function callGroqDirect(
  options: SendChatOptions,
  preferredModel?: string
): Promise<(ChatCompletionResult & { providerUsed: string }) | null> {
  const groqKeys = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY,
  ].filter((k): k is string => Boolean(k && k.trim().length > 10));

  if (groqKeys.length === 0) return null;

  // Verified active Groq models
  const validGroqModels = [
    'openai/gpt-oss-20b',
    'openai/gpt-oss-120b',
    'qwen/qwen3.8-27b',
    'allam-2-7b',
    'llama-3.3-70b-versatile',
  ];

  const modelsToTry: string[] = [];
  if (preferredModel && validGroqModels.includes(preferredModel)) {
    modelsToTry.push(preferredModel);
  }
  for (const m of validGroqModels) {
    if (!modelsToTry.includes(m)) modelsToTry.push(m);
  }

  for (const rawKey of groqKeys) {
    const cleanKey = rawKey.trim();
    for (const model of modelsToTry) {
      try {
        const startTime = Date.now();
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cleanKey}`,
          },
          body: JSON.stringify({
            model,
            messages: options.messages.map(m => ({
              role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
              content: m.content,
            })),
            temperature: options.temperature ?? 0.7,
          }),
        });

        if (!res.ok) continue;

        const parsed = await parseResponseBody(res);
        if (parsed.isHtml || !parsed.json) continue;

        const data = parsed.json;
        const text = data.choices?.[0]?.message?.content || '';
        if (text) {
          return {
            content: text,
            model: `${model} (Groq Ultra-Fast)`,
            latencyMs: Date.now() - startTime,
            tokensUsed: {
              promptTokens: data.usage?.prompt_tokens,
              completionTokens: data.usage?.completion_tokens,
              totalTokens: data.usage?.total_tokens,
            },
            providerUsed: 'Groq Cloud (Fallback)',
          };
        }
      } catch {
        // Try next model/key
      }
    }
  }

  return null;
}

/**
 * Executes chat completion with capability-aware, intelligent failover to Google Gemini (730M tokens) or Groq
 * when the external gateway is cold-starting or returning auth/HTML/network errors.
 */
export async function sendChatCompletionWithFallback(
  options: SendChatOptions
): Promise<ChatCompletionResult & { providerUsed: string }> {
  const requestedModel = options.model || 'auto';
  const effectiveModel = !requestedModel || requestedModel === 'auto' ? 'gemini-3.6-flash' : requestedModel;
  const isGoogleTarget =
    effectiveModel.startsWith('gemini-') ||
    effectiveModel.includes('google') ||
    effectiveModel.includes('deep-research') ||
    effectiveModel === 'auto';

  // 1. Try FreeLLM Gateway first (if configured with customUrl or default)
  try {
    const result = await sendChatCompletion({ ...options, model: effectiveModel });
    return { ...result, providerUsed: 'FreeLLMAPI Gateway' };
  } catch (gatewayErr: any) {
    console.warn(`[FreeLLM Gateway] External gateway unavailable (${gatewayErr.message}). Routing to primary 730M token provider...`);

    // 2. If it's a Google/Gemini target or Auto, run Gemini first (730M tokens!)
    if (isGoogleTarget) {
      const geminiResult = await callGeminiDirect(options, effectiveModel);
      if (geminiResult) return geminiResult;

      const groqResult = await callGroqDirect(options);
      if (groqResult) return groqResult;
    } else {
      // 3. Otherwise try Groq first, then Gemini
      const groqResult = await callGroqDirect(options, effectiveModel);
      if (groqResult) return groqResult;

      const geminiResult = await callGeminiDirect(options, 'gemini-3.6-flash');
      if (geminiResult) return geminiResult;
    }

    // 4. Clean error message: NEVER expose unparsed <!doctype html> or raw JSON parser syntax errors
    const sanitizedMsg = gatewayErr.message
      ? gatewayErr.message.replace(/<!doctype[\s\S]*?>/gi, '').replace(/<html[\s\S]*?>/gi, '').slice(0, 250).trim()
      : 'All FreeLLM providers are currently warming up. Please retry in a few moments.';

    throw new Error(sanitizedMsg || 'FreeLLM service temporarily unavailable.');
  }
}
