export interface FreeLLMGatewayConfig {
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SendChatOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  customUrl?: string;
  customKey?: string;
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
  error?: string;
}

/**
 * Standard recommended models supported across FreeLLMAPI providers
 */
export const POPULAR_FREE_MODELS = [
  { id: 'auto', name: 'Auto (Fastest Free Model)' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Google)' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Google)' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Groq)' },
  { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 70B (Groq)' },
  { id: 'mistral-small-latest', name: 'Mistral Small (Mistral AI)' },
  { id: 'cerebras-llama3.3-70b', name: 'Llama 3.3 70B (Cerebras Ultra-Fast)' },
  { id: 'qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B' },
];

/**
 * Get server-configured FreeLLMAPI Gateway settings
 */
export function getGatewayConfig(): FreeLLMGatewayConfig {
  let url =
    process.env.FREE_LLM_API_URL ||
    process.env.FREE_LLM_GATEWAY_URL ||
    process.env.FREE_LLM_API_BASE_URL ||
    'http://localhost:3001';

  // Normalize: remove trailing slash
  url = url.trim().replace(/\/+$/, '');

  const apiKey =
    process.env.FREE_LLM_API_KEY ||
    process.env.FREE_LLM_GATEWAY_KEY ||
    '';

  const defaultModel = process.env.FREE_LLM_MODEL || 'auto';

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
 * Check if the FreeLLMAPI Gateway is online and reachable
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
    'Accept': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000); // 6s timeout

    const res = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      // Some gateways might require auth or return non-200 for models, test root or health
      return {
        online: false,
        gatewayUrl: targetBaseUrl,
        latencyMs,
        models: POPULAR_FREE_MODELS.map(m => m.id),
        error: `Gateway returned HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const data = await res.json().catch(() => null);
    let models: string[] = [];

    if (data && Array.isArray(data.data)) {
      models = data.data.map((item: any) => item.id || item.name).filter(Boolean);
    } else if (data && Array.isArray(data.models)) {
      models = data.models.map((item: any) => item.id || item.name || String(item)).filter(Boolean);
    }

    if (models.length === 0) {
      models = POPULAR_FREE_MODELS.map(m => m.id);
    }

    return {
      online: true,
      gatewayUrl: targetBaseUrl,
      latencyMs,
      models,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      online: false,
      gatewayUrl: targetBaseUrl,
      latencyMs,
      models: POPULAR_FREE_MODELS.map(m => m.id),
      error: err.name === 'AbortError' ? 'Connection timed out after 6 seconds.' : (err.message || 'Gateway unreachable'),
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
    'Accept': 'application/json',
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
  const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout for large completions

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
      throw new Error(`FreeLLMAPI Gateway request timed out after 60 seconds (${endpoint}).`);
    }
    throw err;
  }
}
