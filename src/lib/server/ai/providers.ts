import fs from 'fs';
import path from 'path';
import type { AIProviderInfo, AIConfigState } from '@/types';

// Rate limit cooldown state in memory
interface CooldownInfo {
  until: number;
  reason: string;
}

const cooldowns = new Map<string, CooldownInfo>();

// Token usage accumulator in memory
const tokenUsage = {
  prompt: 0,
  completion: 0,
  total: 0,
};

const CONFIG_PATH = path.join(process.cwd(), '.data', 'ai_config.json');

export interface StoredAIConfig {
  activeProviderId: string; // 'auto' | 'groq-1' | 'groq-2' | 'groq-3' | 'gemini-1' | 'gemini-2' | 'gemini-3'
  fallbackEnabled: boolean;
  modelOverrides: Record<string, string>;
}

// Verified and currently supported models on Google Gemini API v1beta
export const VERIFIED_GEMINI_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];
export const VERIFIED_GROQ_MODELS = [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'allam-2-7b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
];

export function getDefaultGeminiModel(): string {
  return (process.env.GEMINI_MODEL || '').trim() || 'gemini-3.5-flash';
}

export function getDefaultGroqModel(): string {
  return (process.env.GROQ_MODEL || '').trim() || 'openai/gpt-oss-20b';
}

export function getStoredAIConfig(): StoredAIConfig {
  const defaultGemini = getDefaultGeminiModel();
  const defaultGroq = getDefaultGroqModel();
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      // Migrate away from deprecated legacy models
      if (parsed.modelOverrides) {
        for (const k of Object.keys(parsed.modelOverrides)) {
          if (parsed.modelOverrides[k] === 'gemini-1.5-flash' || parsed.modelOverrides[k] === 'gemini-2.0-flash') {
            parsed.modelOverrides[k] = defaultGemini;
          }
        }
        if (parsed.modelOverrides['groq'] && !parsed.modelOverrides['groq-1']) {
          parsed.modelOverrides['groq-1'] = parsed.modelOverrides['groq'];
          delete parsed.modelOverrides['groq'];
        }
        if (parsed.modelOverrides['xai-grok']) {
          delete parsed.modelOverrides['xai-grok'];
        }
      }
      if (parsed.activeProviderId === 'groq' || parsed.activeProviderId === 'xai-grok') {
        parsed.activeProviderId = 'auto';
      }
      return parsed;
    }
  } catch {}

  return {
    activeProviderId: 'auto',
    fallbackEnabled: true,
    modelOverrides: {
      'groq-1': defaultGroq,
      'groq-2': defaultGroq,
      'groq-3': defaultGroq,
      'gemini-1': defaultGemini,
      'gemini-2': defaultGemini,
      'gemini-3': defaultGemini,
    },
  };
}

export function saveStoredAIConfig(config: Partial<StoredAIConfig>): StoredAIConfig {
  const current = getStoredAIConfig();
  const updated: StoredAIConfig = {
    ...current,
    ...config,
    modelOverrides: {
      ...current.modelOverrides,
      ...(config.modelOverrides || {}),
    },
  };

  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not persist ai_config.json:', err);
  }

  return updated;
}

/**
 * Validate that an API key is non-empty, reasonably sized, and not a template placeholder
 */
export function isValidApiKey(key: string | undefined): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  if (trimmed.length < 8) return false;
  if (
    trimmed.startsWith('your-') ||
    trimmed.includes('placeholder') ||
    trimmed.includes('example') ||
    trimmed === 'your-google-gemini-api-key-1' ||
    trimmed === 'your-groq-api-key' ||
    trimmed === 'your-groq-api-key-1' ||
    trimmed === 'your-groq-api-key-2' ||
    trimmed === 'your-groq-api-key-3'
  ) {
    return false;
  }
  return true;
}

/**
 * Returns available provider definitions and their status (NEVER exposes API keys)
 */
export function getAIProvidersStatus(): AIConfigState {
  const config = getStoredAIConfig();
  const defaultGemini = getDefaultGeminiModel();
  const defaultGroq = getDefaultGroqModel();
  const now = Date.now();

  const geminiKey1 = process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY || '';
  const geminiKey2 = process.env.GEMINI_API_KEY_2 || '';
  const geminiKey3 = process.env.GEMINI_API_KEY_3 || '';

  const groqKey1 = process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY || '';
  const groqKey2 = process.env.GROQ_API_KEY_2 || '';
  const groqKey3 = process.env.GROQ_API_KEY_3 || '';

  const providers: AIProviderInfo[] = [
    {
      id: 'groq-1',
      name: 'Groq Cloud (Key 1 - Ultra Fast)',
      provider: 'groq',
      configured: isValidApiKey(groqKey1),
      model: config.modelOverrides['groq-1'] || defaultGroq,
      availableModels: VERIFIED_GROQ_MODELS,
      isRateLimited: (cooldowns.get('groq-1')?.until || 0) > now,
    },
    {
      id: 'groq-2',
      name: 'Groq Cloud (Key 2)',
      provider: 'groq',
      configured: isValidApiKey(groqKey2),
      model: config.modelOverrides['groq-2'] || defaultGroq,
      availableModels: VERIFIED_GROQ_MODELS,
      isRateLimited: (cooldowns.get('groq-2')?.until || 0) > now,
    },
    {
      id: 'groq-3',
      name: 'Groq Cloud (Key 3)',
      provider: 'groq',
      configured: isValidApiKey(groqKey3),
      model: config.modelOverrides['groq-3'] || defaultGroq,
      availableModels: VERIFIED_GROQ_MODELS,
      isRateLimited: (cooldowns.get('groq-3')?.until || 0) > now,
    },
    {
      id: 'gemini-1',
      name: 'Google Gemini (Key 1)',
      provider: 'gemini',
      configured: isValidApiKey(geminiKey1),
      model: config.modelOverrides['gemini-1'] || defaultGemini,
      availableModels: VERIFIED_GEMINI_MODELS,
      isRateLimited: (cooldowns.get('gemini-1')?.until || 0) > now,
    },
    {
      id: 'gemini-2',
      name: 'Google Gemini (Key 2)',
      provider: 'gemini',
      configured: isValidApiKey(geminiKey2),
      model: config.modelOverrides['gemini-2'] || defaultGemini,
      availableModels: VERIFIED_GEMINI_MODELS,
      isRateLimited: (cooldowns.get('gemini-2')?.until || 0) > now,
    },
    {
      id: 'gemini-3',
      name: 'Google Gemini (Key 3)',
      provider: 'gemini',
      configured: isValidApiKey(geminiKey3),
      model: config.modelOverrides['gemini-3'] || defaultGemini,
      availableModels: VERIFIED_GEMINI_MODELS,
      isRateLimited: (cooldowns.get('gemini-3')?.until || 0) > now,
    },
  ];

  return {
    providers,
    activeProviderId: config.activeProviderId,
    fallbackEnabled: config.fallbackEnabled,
    totalTokensUsed: { ...tokenUsage },
  };
}

interface ProviderCallResult {
  text: string;
  provider: string;
  model: string;
  keyIndex?: number;
  tokensUsed?: { prompt?: number; completion?: number; total?: number };
  latencyMs: number;
  fallbackUsed: boolean;
}

/**
 * Execute call to Google Gemini API with verified endpoints and 404 auto-healing
 */
async function callGemini(
  apiKey: string,
  model: string,
  prompt: string,
  systemInstruction?: string,
  jsonMode: boolean = true
): Promise<{ text: string; tokens?: { prompt: number; completion: number; total: number }; finalModel: string }> {
  const defaultGemini = getDefaultGeminiModel();
  let targetModel = (model || defaultGemini).trim();
  if (!VERIFIED_GEMINI_MODELS.includes(targetModel)) {
    targetModel = defaultGemini;
  }

  const makeRequest = async (m: string) => {
    const cleanKey = apiKey.trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(cleanKey)}`;

    const body: any = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2500,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cleanKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errorMessage = `HTTP ${res.status}`;
        try {
          const errData = await res.json();
          if (errData?.error?.message) {
            errorMessage = errData.error.message;
          }
        } catch {
          const errText = await res.text().catch(() => '');
          if (errText) errorMessage = errText.slice(0, 200);
        }
        const error: any = new Error(`Gemini API error (${res.status}): ${errorMessage}`);
        error.status = res.status;
        throw error;
      }

      const data = await res.json();
      const candidate = data.candidates?.[0];
      let text = candidate?.content?.parts?.[0]?.text || '';

      if (!text && candidate?.finishReason && candidate.finishReason !== 'STOP') {
        text = `[Response blocked by Gemini filter: ${candidate.finishReason}]`;
      }

      if (!text && data.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked prompt: ${data.promptFeedback.blockReason}`);
      }

      const promptTokens = data.usageMetadata?.promptTokenCount || 0;
      const completionTokens = data.usageMetadata?.candidatesTokenCount || 0;
      const totalTokens = data.usageMetadata?.totalTokenCount || promptTokens + completionTokens;

      return {
        text,
        tokens: { prompt: promptTokens, completion: completionTokens, total: totalTokens },
        finalModel: m,
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        const timeoutErr: any = new Error(`Gemini API request timed out after 12 seconds on model ${m}`);
        timeoutErr.status = 504;
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  };

  const isFailoverEligible = (err: any) => {
    const status = err?.status;
    const msg = (err?.message || '').toLowerCase();
    return (
      status === 404 ||
      status === 503 ||
      status === 504 ||
      status === 408 ||
      (status === 429 && (msg.includes('quota') || msg.includes('exhausted') || msg.includes('demand') || msg.includes('rate'))) ||
      msg.includes('timed out') ||
      msg.includes('high demand') ||
      msg.includes('temporary')
    );
  };

  try {
    return await makeRequest(targetModel);
  } catch (err: any) {
    if (isFailoverEligible(err)) {
      // Auto-healing fallback chain across distinct Google clusters:
      // gemini-3.5-flash (fast & unaffected by 3.8 spikes), gemini-flash-latest, gemini-3.8-flash, gemini-3.1-flash-lite
      const candidateFallbacks = [
        'gemini-3.5-flash',
        'gemini-flash-latest',
        'gemini-3.8-flash',
        'gemini-3.1-flash-lite',
      ].filter(fb => fb !== targetModel);

      for (const fallbackModel of candidateFallbacks) {
        try {
          console.warn(
            `Gemini model ${targetModel} encountered ${err.status || 500} (${err.message?.slice(0, 80)}). Auto-healing fallback to verified ${fallbackModel}...`
          );
          return await makeRequest(fallbackModel);
        } catch (healErr: any) {
          if (isFailoverEligible(healErr)) {
            continue;
          }
          throw healErr;
        }
      }
    }
    throw err;
  }
}

/**
 * Execute call to Groq Cloud API (Ultra-fast OpenAI-compatible)
 */
async function callGroq(
  apiKey: string,
  model: string,
  prompt: string,
  systemInstruction?: string,
  jsonMode: boolean = true
): Promise<{ text: string; tokens?: { prompt: number; completion: number; total: number }; finalModel: string }> {
  const defaultGroq = getDefaultGroqModel();
  const targetModel = VERIFIED_GROQ_MODELS.includes(model) ? model : defaultGroq;
  const url = 'https://api.groq.com/openai/v1/chat/completions';

  const makeRequest = async (m: string, timeoutMs: number = 15000) => {
    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: prompt });

    if (jsonMode) {
      const hasJsonWord = messages.some(msg => /json/i.test(msg.content));
      if (!hasJsonWord) {
        messages[0].content += ' Respond strictly in valid JSON format.';
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: m,
          messages,
          temperature: 0.3,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errorMessage = `HTTP ${res.status}`;
        try {
          const errData = await res.json();
          if (errData?.error?.message) {
            errorMessage = errData.error.message;
          }
        } catch {
          const errText = await res.text().catch(() => '');
          if (errText) errorMessage = errText.slice(0, 200);
        }
        const error: any = new Error(`Groq API error (${res.status}): ${errorMessage}`);
        error.status = res.status;
        throw error;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';

      const promptTokens = data.usage?.prompt_tokens || 0;
      const completionTokens = data.usage?.completion_tokens || 0;
      const totalTokens = data.usage?.total_tokens || promptTokens + completionTokens;

      return {
        text,
        tokens: { prompt: promptTokens, completion: completionTokens, total: totalTokens },
        finalModel: m,
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        const timeoutErr: any = new Error(`Groq API request timed out after ${timeoutMs / 1000}s on model ${m}`);
        timeoutErr.status = 504;
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    return await makeRequest(targetModel);
  } catch (err: any) {
    if ((err.status === 404 || err.status === 429 || err.status === 503) && targetModel !== 'llama-3.1-8b-instant') {
      console.warn(`Groq model ${targetModel} encountered ${err.status}. Auto-healing fallback to llama-3.1-8b-instant...`);
      return await makeRequest('llama-3.1-8b-instant');
    }
    throw err;
  }
}

/**
 * Core AI Dispatch with Ordered Fallback Pipeline (Groq 1-3 -> Gemini 1-3)
 */
export async function executeAIRequestWithFallback(
  prompt: string,
  systemInstruction?: string,
  requestedProviderId?: string,
  options?: { jsonMode?: boolean }
): Promise<ProviderCallResult> {
  const jsonMode = options?.jsonMode ?? true;
  const config = getStoredAIConfig();
  const chosenProvider = requestedProviderId || config.activeProviderId;
  const now = Date.now();

  const groqKeys: Record<string, string> = {
    'groq-1': process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY || '',
    'groq-2': process.env.GROQ_API_KEY_2 || '',
    'groq-3': process.env.GROQ_API_KEY_3 || '',
  };
  const geminiKeys: Record<string, string> = {
    'gemini-1': process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY || '',
    'gemini-2': process.env.GEMINI_API_KEY_2 || '',
    'gemini-3': process.env.GEMINI_API_KEY_3 || '',
  };

  // High-performance candidate sequence: Groq (ultra-fast, zero-delay) + Gemini (deep reasoning)
  const allProviderIds = ['groq-1', 'groq-2', 'groq-3', 'gemini-1', 'gemini-2', 'gemini-3'];
  let candidateOrder: string[] = [];

  if (chosenProvider && chosenProvider !== 'auto') {
    if (config.fallbackEnabled) {
      candidateOrder = [chosenProvider, ...allProviderIds.filter(id => id !== chosenProvider)];
    } else {
      candidateOrder = [chosenProvider];
    }
  } else {
    candidateOrder = allProviderIds;
  }

  // Filter candidates to those with configured, valid keys and not in active cooldown
  const availableCandidates = candidateOrder.filter(id => {
    let hasKey = false;
    if (id.startsWith('groq')) hasKey = isValidApiKey(groqKeys[id]);
    else if (id.startsWith('gemini')) hasKey = isValidApiKey(geminiKeys[id]);

    if (!hasKey) return false;

    const cooldown = cooldowns.get(id);
    if (cooldown && cooldown.until > now) {
      return false; // Skip currently rate-limited provider
    }
    return true;
  });

  const allConfiguredCount = [
    groqKeys['groq-1'],
    groqKeys['groq-2'],
    groqKeys['groq-3'],
    geminiKeys['gemini-1'],
    geminiKeys['gemini-2'],
    geminiKeys['gemini-3'],
  ].filter(k => isValidApiKey(k)).length;

  if (allConfiguredCount === 0) {
    throw new Error('NO_CONFIGURED_KEYS');
  }

  if (availableCandidates.length === 0) {
    const cooldownEntries = Array.from(cooldowns.entries());
    const nextExpiry = Math.min(...cooldownEntries.map(([_, c]) => c.until));
    const waitSeconds = Math.max(1, Math.ceil((nextExpiry - now) / 1000));
    const error: any = new Error(`All configured AI providers are temporarily rate-limited. Please retry in ${waitSeconds}s.`);
    error.status = 429;
    error.retryAfter = waitSeconds;
    throw error;
  }

  const errorsEncountered: string[] = [];
  let isFallback = false;
  const attemptedKeyStrings = new Set<string>();

  for (let i = 0; i < availableCandidates.length; i++) {
    const candidateId = availableCandidates[i];
    let candidateKey = '';
    if (candidateId.startsWith('groq')) candidateKey = groqKeys[candidateId];
    else if (candidateId.startsWith('gemini')) candidateKey = geminiKeys[candidateId];

    const trimmedKey = (candidateKey || '').trim();
    if (trimmedKey && attemptedKeyStrings.has(trimmedKey)) {
      // Skip redundant attempt on identical API key if it already failed
      continue;
    }
    if (trimmedKey) {
      attemptedKeyStrings.add(trimmedKey);
    }

    const startTime = Date.now();
    isFallback = i > 0;
    try {
      if (candidateId.startsWith('groq')) {
        const key = groqKeys[candidateId];
        const defaultGroq = getDefaultGroqModel();
        const model = config.modelOverrides[candidateId] || defaultGroq;
        const keyIndex = parseInt(candidateId.replace('groq-', ''), 10) || 1;

        const res = await callGroq(key, model, prompt, systemInstruction, jsonMode);
        const latencyMs = Date.now() - startTime;

        if (res.tokens) {
          tokenUsage.prompt += res.tokens.prompt;
          tokenUsage.completion += res.tokens.completion;
          tokenUsage.total += res.tokens.total;
        }

        return {
          text: res.text,
          provider: `Groq Cloud (Key ${keyIndex})`,
          model: res.finalModel,
          keyIndex,
          tokensUsed: res.tokens,
          latencyMs,
          fallbackUsed: isFallback,
        };
      } else if (candidateId.startsWith('gemini')) {
        const key = geminiKeys[candidateId];
        const defaultGemini = getDefaultGeminiModel();
        const model = config.modelOverrides[candidateId] || defaultGemini;
        const keyIndex = parseInt(candidateId.replace('gemini-', ''), 10) || 1;

        const res = await callGemini(key, model, prompt, systemInstruction, jsonMode);
        const latencyMs = Date.now() - startTime;

        if (res.tokens) {
          tokenUsage.prompt += res.tokens.prompt;
          tokenUsage.completion += res.tokens.completion;
          tokenUsage.total += res.tokens.total;
        }

        return {
          text: res.text,
          provider: `Google Gemini (Key ${keyIndex})`,
          model: res.finalModel,
          keyIndex,
          tokensUsed: res.tokens,
          latencyMs,
          fallbackUsed: isFallback,
        };
      }
    } catch (err: any) {
      const status = err.status || 500;
      const isRateLimit = status === 429 || err.message?.includes('RESOURCE_EXHAUSTED') || err.message?.includes('rate');

      // Set cooldown for rate limits (60 seconds)
      if (isRateLimit) {
        cooldowns.set(candidateId, {
          until: Date.now() + 60000,
          reason: 'Rate limit or quota exhausted (cooldown 60s)',
        });
      }

      errorsEncountered.push(`${candidateId} (${status}): ${err.message?.slice(0, 150)}`);
      console.warn(`Provider ${candidateId} failed:`, err.message);
    }
  }

  const error: any = new Error(`All configured AI providers failed. Attempts: ${errorsEncountered.join(' | ')}`);
  error.status = 502;
  error.attempts = errorsEncountered;
  throw error;
}

export interface StreamAIResult {
  stream: ReadableStream<Uint8Array>;
  provider: string;
  model: string;
}

/**
 * Executes a streaming AI request through Groq or Gemini with automatic provider failover.
 * Yields standard OpenAI-compatible SSE events: data: {"choices":[{"delta":{"content":"..."}}]}\n\n
 */
export async function streamAIRequestWithFallback(
  prompt: string,
  systemInstruction?: string,
  requestedProviderId?: string,
  clientSignal?: AbortSignal
): Promise<StreamAIResult> {
  const config = getStoredAIConfig();
  const chosenProvider = requestedProviderId || config.activeProviderId;
  const now = Date.now();

  const groqKeys: Record<string, string> = {
    'groq-1': process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY || '',
    'groq-2': process.env.GROQ_API_KEY_2 || '',
    'groq-3': process.env.GROQ_API_KEY_3 || '',
  };
  const geminiKeys: Record<string, string> = {
    'gemini-1': process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY || '',
    'gemini-2': process.env.GEMINI_API_KEY_2 || '',
    'gemini-3': process.env.GEMINI_API_KEY_3 || '',
  };

  const allProviderIds = ['groq-1', 'groq-2', 'groq-3', 'gemini-1', 'gemini-2', 'gemini-3'];
  let candidateOrder: string[] = [];

  if (chosenProvider && chosenProvider !== 'auto') {
    if (config.fallbackEnabled) {
      candidateOrder = [chosenProvider, ...allProviderIds.filter(id => id !== chosenProvider)];
    } else {
      candidateOrder = [chosenProvider];
    }
  } else {
    candidateOrder = allProviderIds;
  }

  const availableCandidates = candidateOrder.filter(id => {
    let hasKey = false;
    if (id.startsWith('groq')) hasKey = isValidApiKey(groqKeys[id]);
    else if (id.startsWith('gemini')) hasKey = isValidApiKey(geminiKeys[id]);
    if (!hasKey) return false;
    const cooldown = cooldowns.get(id);
    if (cooldown && cooldown.until > now) return false;
    return true;
  });

  const attemptedKeyStrings = new Set<string>();

  for (const candidateId of availableCandidates) {
    let candidateKey = '';
    if (candidateId.startsWith('groq')) candidateKey = groqKeys[candidateId];
    else if (candidateId.startsWith('gemini')) candidateKey = geminiKeys[candidateId];
    const trimmedKey = (candidateKey || '').trim();
    if (trimmedKey && attemptedKeyStrings.has(trimmedKey)) continue;
    if (trimmedKey) attemptedKeyStrings.add(trimmedKey);

    const controller = new AbortController();
    const abortHandler = () => controller.abort(clientSignal?.reason);
    if (clientSignal?.aborted) abortHandler();
    else clientSignal?.addEventListener('abort', abortHandler, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error('AI stream provider timed out')), 35000);

    const cleanup = () => {
      clearTimeout(timeout);
      clientSignal?.removeEventListener('abort', abortHandler);
    };

    try {
      if (candidateId.startsWith('groq')) {
        const defaultGroq = getDefaultGroqModel();
        const model = config.modelOverrides[candidateId] || defaultGroq;
        const keyIndex = parseInt(candidateId.replace('groq-', ''), 10) || 1;
        const messages: any[] = [];
        if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
        messages.push({ role: 'user', content: prompt });

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${candidateKey.trim()}`,
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.3,
            stream: true,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          cleanup();
          continue;
        }

        const reader = res.body.getReader();
        const stream = new ReadableStream<Uint8Array>({
          async pull(streamController) {
            try {
              const { value, done } = await reader.read();
              if (done) {
                cleanup();
                streamController.close();
              } else {
                streamController.enqueue(value);
              }
            } catch (err) {
              cleanup();
              streamController.error(err);
            }
          },
          async cancel(reason) {
            cleanup();
            controller.abort(reason);
            await reader.cancel(reason).catch(() => undefined);
          },
        });

        return {
          stream,
          provider: `Groq Cloud (Key ${keyIndex})`,
          model,
        };
      } else if (candidateId.startsWith('gemini')) {
        const defaultGemini = getDefaultGeminiModel();
        const model = config.modelOverrides[candidateId] || defaultGemini;
        const keyIndex = parseInt(candidateId.replace('gemini-', ''), 10) || 1;
        const body: any = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2500 },
        };
        if (systemInstruction) {
          body.systemInstruction = { parts: [{ text: systemInstruction }] };
        }

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(candidateKey.trim())}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': candidateKey.trim(),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          }
        );

        if (!res.ok || !res.body) {
          cleanup();
          continue;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let buffer = '';

        const stream = new ReadableStream<Uint8Array>({
          async pull(streamController) {
            try {
              const { value, done } = await reader.read();
              if (done) {
                streamController.enqueue(encoder.encode('data: [DONE]\n\n'));
                cleanup();
                streamController.close();
                return;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split(/\r?\n/);
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === '[DONE]') continue;
                try {
                  const data = JSON.parse(payload);
                  const deltaText = data.candidates?.[0]?.content?.parts?.[0]?.text;
                  if (typeof deltaText === 'string' && deltaText) {
                    const sseChunk = `data: ${JSON.stringify({
                      choices: [{ delta: { content: deltaText } }],
                      provider: `Google Gemini (Key ${keyIndex})`,
                      model,
                    })}\n\n`;
                    streamController.enqueue(encoder.encode(sseChunk));
                  }
                } catch {}
              }
            } catch (err) {
              cleanup();
              streamController.error(err);
            }
          },
          async cancel(reason) {
            cleanup();
            controller.abort(reason);
            await reader.cancel(reason).catch(() => undefined);
          },
        });

        return {
          stream,
          provider: `Google Gemini (Key ${keyIndex})`,
          model,
        };
      }
    } catch {
      cleanup();
      continue;
    }
  }

  // Fallback to static call wrapped in SSE
  const staticResult = await executeAIRequestWithFallback(prompt, systemInstruction, requestedProviderId, { jsonMode: false });
  const encoder = new TextEncoder();
  const chunkText = staticResult.text || '';
  let emitted = false;

  const fallbackStream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!emitted) {
        emitted = true;
        const sseLine = `data: ${JSON.stringify({
          choices: [{ delta: { content: chunkText } }],
          provider: staticResult.provider,
          model: staticResult.model,
        })}\n\n`;
        controller.enqueue(encoder.encode(sseLine));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      }
      controller.close();
    },
  });

  return {
    stream: fallbackStream,
    provider: staticResult.provider,
    model: staticResult.model,
  };
}
