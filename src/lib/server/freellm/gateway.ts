import fs from 'fs';
import path from 'path';
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

interface SavedGatewayOverride {
  baseUrl?: string;
  apiKey?: string;
}

let runtimeOverride: SavedGatewayOverride | null = null;
const CONFIG_FILE_PATH = path.join(process.cwd(), '.data', 'freellm_config.json');

function loadRuntimeOverride(): SavedGatewayOverride {
  if (process.env.VITEST) return runtimeOverride || {};
  if (runtimeOverride) return runtimeOverride;
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        runtimeOverride = {
          baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : undefined,
          apiKey: typeof parsed.apiKey === 'string' && parsed.apiKey.trim() ? parsed.apiKey.trim() : undefined,
        };
        return runtimeOverride;
      }
    }
  } catch {
    // Ignore file read errors in serverless/test environments
  }
  runtimeOverride = {};
  return runtimeOverride;
}

export function setGatewayRuntimeConfig(update: { baseUrl?: string; apiKey?: string; clear?: boolean }): void {
  if (update.clear) {
    runtimeOverride = {};
    try {
      if (fs.existsSync(CONFIG_FILE_PATH)) fs.unlinkSync(CONFIG_FILE_PATH);
    } catch {}
    return;
  }
  const current = loadRuntimeOverride();
  runtimeOverride = {
    baseUrl: update.baseUrl !== undefined ? update.baseUrl.trim() || undefined : current.baseUrl,
    apiKey: update.apiKey !== undefined ? update.apiKey.trim() || undefined : current.apiKey,
  };
  if (process.env.VITEST) return;
  try {
    const dir = path.dirname(CONFIG_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(runtimeOverride, null, 2), 'utf8');
  } catch {
    // Ignore write errors in read-only environments
  }
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
  authError?: boolean;
  keyConfigured?: boolean;
  maskedKey?: string;
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
  const override = loadRuntimeOverride();
  let url =
    override.baseUrl ||
    process.env.FREELLM_API_BASE_URL ||
    process.env.FREE_LLM_API_URL ||
    process.env.FREELLM_API_URL ||
    process.env.FREE_LLM_GATEWAY_URL ||
    process.env.FREE_LLM_API_BASE_URL ||
    'https://free-llm-api-7fue.onrender.com/v1';

  // Normalize: remove trailing slash
  url = url.trim().replace(/\/+$/, '');

  const apiKey =
    override.apiKey ||
    process.env.FREELLM_API_KEY ||
    process.env.FREE_LLM_API_KEY ||
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
 * Normalizes URL to target the FreeLLMAPI /api/ping health check endpoint
 */
export function resolvePingUrl(baseUrl: string): string {
  const clean = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1\/(models|chat\/completions)$/i, '')
    .replace(/\/(models|chat\/completions)$/i, '')
    .replace(/\/v1$/i, '');
  return `${clean}/api/ping`;
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
  const keyConfigured = Boolean(apiKey && apiKey.trim().length > 0);
  const maskedKey = keyConfigured && apiKey ? `••••${apiKey.trim().slice(-4)}` : undefined;

  const modelsUrl = resolveModelsUrl(targetBaseUrl);
  const startTime = Date.now();

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
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
    const parsed = await parseResponseBody(res);
    const data = parsed.json;

    if (!res.ok) {
      const isAuthErr = res.status === 401 || res.status === 403;
      const detail = parsed.isHtml
        ? `HTML (${res.status}, ${res.headers?.get?.('content-type') || 'unknown content type'}): ${parsed.text.slice(0, 160)}`
        : data?.error?.message || parsed.text.slice(0, 160);
      const authHint = isAuthErr
        ? keyConfigured
          ? ' (Verify FREELLM_API_KEY matches UNIFIED_API_KEY on your FreeLLMAPI service)'
          : ' (Paste your Unified API Key in Settings or set FREELLM_API_KEY in Render)'
        : '';
      return {
        online: false,
        gatewayUrl: targetBaseUrl,
        latencyMs,
        models: [],
        catalog: [],
        authError: isAuthErr,
        keyConfigured,
        maskedKey,
        fallbackReady: hasFallback,
        error: `Model discovery failed at ${modelsUrl}: HTTP ${res.status} ${res.statusText}; ${detail || 'request failed'}${authHint}`,
      };
    }

    let rawModels: any[] = [];

    if (data && Array.isArray(data.data)) {
      rawModels = data.data;
    } else if (data && Array.isArray(data.models)) {
      rawModels = data.models;
    } else {
      const detail = parsed.isHtml
        ? `HTML (${res.status}, ${res.headers?.get?.('content-type') || 'unknown content type'}): ${parsed.text.slice(0, 160)}`
        : `invalid JSON model-list shape (${res.headers?.get?.('content-type') || 'unknown content type'})`;
      return {
        online: false,
        gatewayUrl: targetBaseUrl,
        latencyMs,
        models: [],
        catalog: [],
        keyConfigured,
        maskedKey,
        fallbackReady: hasFallback,
        error: `Model discovery at ${modelsUrl} returned HTTP ${res.status} but not a model-list JSON response: ${detail}`,
      };
    }

    // If FreeLLMAPI attaches execution_status on models, prefer ready models when available
    const readyFiltered = rawModels.filter(
      (item: any) => item && typeof item === 'object' && item.execution_status === 'ready'
    );
    const effectiveRawModels = readyFiltered.length > 0 ? readyFiltered : rawModels;

    const liveIds = effectiveRawModels
      .map((item: unknown) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'id' in item) return (item as { id?: unknown }).id;
        return undefined;
      })
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
    if (liveIds.length === 0) {
      return {
        online: false,
        gatewayUrl: targetBaseUrl,
        latencyMs,
        models: [],
        catalog: [],
        keyConfigured,
        maskedKey,
        fallbackReady: hasFallback,
        error: `Model discovery at ${modelsUrl} returned an empty model list.`,
      };
    }
    const liveCatalog = mergeDiscoveredModels(effectiveRawModels).filter(model => liveIds.includes(model.id));

    return {
      online: true,
      gatewayUrl: targetBaseUrl,
      latencyMs,
      models: liveIds,
      catalog: liveCatalog,
      keyConfigured,
      maskedKey,
      fallbackReady: hasFallback,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      online: false,
      gatewayUrl: targetBaseUrl,
      latencyMs,
      models: [],
      catalog: [],
      keyConfigured,
      maskedKey,
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
async function parseResponseBody(res: Response): Promise<{ text: string; json: any; isHtml: boolean; contentType: string }> {
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

  return { text, json, isHtml, contentType: res.headers?.get?.('content-type') || '' };
}

const DIRECT_ATTEMPT_TIMEOUT_MS = 20_000;

/** Read numbered fallback keys in their configured order, then append the
 * legacy unnumbered key if it is distinct. Key values are never logged. */
function getProviderKeys(prefix: 'GEMINI_API_KEY' | 'GROQ_API_KEY'): string[] {
  const keys: string[] = [];
  for (let slot = 1; slot <= 8; slot += 1) {
    const key = process.env[`${prefix}_${slot}`]?.trim();
    if (key && key.length > 10 && !keys.includes(key)) keys.push(key);
  }
  const legacyKey = process.env[prefix]?.trim();
  if (legacyKey && legacyKey.length > 10 && !keys.includes(legacyKey)) keys.push(legacyKey);
  return keys;
}

function getGatewayKeys(): Array<string | undefined> {
  const keys: string[] = [];
  const configuredKey = getGatewayConfig().apiKey?.trim();
  if (configuredKey && !keys.includes(configuredKey)) keys.push(configuredKey);
  for (let slot = 1; slot <= 16; slot += 1) {
    const key = process.env[`FREE_LLM_API_KEY_${slot}`]?.trim() || process.env[`FREELLM_API_KEY_${slot}`]?.trim();
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys.length ? keys : [undefined];
}

async function fetchDirect(url: string, init: RequestInit): Promise<Response> {
  // AbortSignal.timeout remains active while the response body is being read.
  return fetch(url, { ...init, signal: AbortSignal.timeout(DIRECT_ATTEMPT_TIMEOUT_MS) });
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
  const model = rawModel || 'auto';

  const endpoint = resolveChatCompletionsUrl(targetBaseUrl);
  const startTime = Date.now();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
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
        `FreeLLMAPI Gateway ${endpoint} returned HTML with HTTP ${res.status} (${parsed.contentType || 'unknown content type'}): ${parsed.text.slice(0, 160)}`
      );
    }

    const data = parsed.json;
    if (!data) {
      throw new Error('FreeLLMAPI Gateway response could not be parsed as JSON.');
    }

    if (data.error) {
      throw new Error(`FreeLLMAPI Gateway API error at ${endpoint}: ${data.error.message || JSON.stringify(data.error).slice(0, 200)}`);
    }
    const messageContent =
      data.choices?.[0]?.message?.content ??
      data.choices?.[0]?.text ??
      null;

    if (typeof messageContent !== 'string' || messageContent.length === 0) {
      throw new Error(`FreeLLMAPI Gateway returned HTTP ${res.status} but no valid chat completion choices at ${endpoint} (${parsed.contentType || 'unknown content type'}).`);
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

/** OpenAI-compatible SSE stream used by the moon assistant. The request
 * abort signal and a hard timeout both cancel the upstream fetch. */
export async function openChatCompletionStream(
  options: SendChatOptions,
  clientSignal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const config = getGatewayConfig();
  const endpoint = resolveChatCompletionsUrl(config.baseUrl);
  const apiKey = config.apiKey;
  const controller = new AbortController();
  const abortFromClient = () => controller.abort(clientSignal?.reason);
  if (clientSignal?.aborted) abortFromClient();
  else clientSignal?.addEventListener('abort', abortFromClient, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('Gateway stream timed out after 65 seconds')), 65000);
  const cleanup = () => {
    clearTimeout(timeout);
    clientSignal?.removeEventListener('abort', abortFromClient);
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: options.model || config.defaultModel || 'auto',
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        stream: true,
      }),
      signal: controller.signal,
    });

    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !res.body || !contentType.includes('text/event-stream')) {
      const parsed = await parseResponseBody(res);
      cleanup();
      const excerpt = parsed.isHtml ? parsed.text.slice(0, 160) : parsed.json?.error?.message || parsed.text.slice(0, 200);
      throw new Error(`FreeLLMAPI stream ${endpoint} returned HTTP ${res.status} (${contentType || 'unknown content type'}): ${excerpt || 'expected text/event-stream'}`);
    }

    const reader = res.body.getReader();
    return new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const item = await reader.read();
          if (item.done) { cleanup(); stream.close(); }
          else stream.enqueue(item.value);
        } catch (error) { cleanup(); stream.error(error); }
      },
      async cancel(reason) {
        controller.abort(reason);
        cleanup();
        await reader.cancel(reason).catch(() => undefined);
      },
    });
  } catch (error: unknown) {
    cleanup();
    if (error instanceof Error && error.name === 'AbortError' && !clientSignal?.aborted) {
      throw new Error(`FreeLLMAPI stream timed out after 65 seconds (${endpoint}).`);
    }
    throw error;
  }
}

/**
 * Execute direct fallback to Google Gemini AI Studio (730M+ token capacity)
 */
async function callGeminiDirect(
  options: SendChatOptions,
  preferredModel?: string
): Promise<(ChatCompletionResult & { providerUsed: string }) | null> {
  const geminiKeys = getProviderKeys('GEMINI_API_KEY');

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
        const res = await fetchDirect(
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
          console.info(`[FreeLLM Fallback] Gemini succeeded with model ${model}.`);
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
        // Continue in key/model order; avoid logging provider error payloads or keys.
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
  const groqKeys = getProviderKeys('GROQ_API_KEY');

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
        const res = await fetchDirect('https://api.groq.com/openai/v1/chat/completions', {
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
          console.info(`[FreeLLM Fallback] Groq succeeded with model ${model}.`);
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
        // Continue in key/model order; avoid logging provider error payloads or keys.
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
  let gatewayErr: unknown;
  for (const gatewayKey of getGatewayKeys()) {
    try {
      const result = await sendChatCompletion({
        ...options,
        model: requestedModel || 'auto',
        ...(gatewayKey !== undefined && options.customKey === undefined ? { customKey: gatewayKey } : {}),
      });
      console.info(`[FreeLLM Fallback] Gateway succeeded with model ${result.model}.`);
      return { ...result, providerUsed: 'FreeLLMAPI Gateway' };
    } catch (error: any) {
      gatewayErr = error;
      if (
        requestedModel !== 'auto' &&
        /model[^.]{0,40}(not found|unknown|invalid|unsupported)|model_(not_found|not_supported)/i.test(
          String(error?.message || error)
        )
      ) {
        throw new Error(
          `Selected model '${requestedModel}' was rejected by the FreeLLM gateway: ${String(error?.message || error).slice(0, 220)}`
        );
      }
    }
  }
  console.warn('[FreeLLM Gateway] Configured gateway keys failed; trying direct providers in order.');

  // For Google/Gemini selections (and Auto), try Gemini before Groq.
  if (isGoogleTarget) {
    const geminiResult = await callGeminiDirect(options, effectiveModel);
    if (geminiResult) return geminiResult;

    const groqResult = await callGroqDirect(options);
    if (groqResult) return groqResult;
  } else {
    // For other selected models, try Groq before Gemini.
    const groqResult = await callGroqDirect(options, effectiveModel);
    if (groqResult) return groqResult;

    const geminiResult = await callGeminiDirect(options, 'gemini-3.6-flash');
    if (geminiResult) return geminiResult;
  }

  console.error('[FreeLLM Fallback] All configured gateway and direct key/model attempts failed.');
  // Keep detailed upstream failures in server logs only; never return keys, URLs,
  // provider payloads, or model diagnostics to the end user.
  if (gatewayErr instanceof Error) {
    console.debug(`[FreeLLM Fallback] Last gateway failure: ${gatewayErr.name}.`);
  }
  throw new Error('The AI assistant is temporarily unavailable. Please try again shortly.');
}
