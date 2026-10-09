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
  activeProviderId: string; // 'auto' | 'gemini-1' | 'gemini-2' | 'gemini-3' | 'groq' | 'xai-grok'
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
export const VERIFIED_GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'];
export const VERIFIED_XAI_MODELS = ['grok-2-latest', 'grok-2-mini', 'grok-beta'];

export function getDefaultGeminiModel(): string {
  return (process.env.GEMINI_MODEL || '').trim() || 'gemini-3.5-flash';
}

export function getStoredAIConfig(): StoredAIConfig {
  const defaultGemini = getDefaultGeminiModel();
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      // Migrate away from deprecated legacy models like gemini-1.5-flash that return 404
      if (parsed.modelOverrides) {
        for (const k of Object.keys(parsed.modelOverrides)) {
          if (parsed.modelOverrides[k] === 'gemini-1.5-flash' || parsed.modelOverrides[k] === 'gemini-2.0-flash') {
            parsed.modelOverrides[k] = defaultGemini;
          }
        }
      }
      return parsed;
    }
  } catch {}

  return {
    activeProviderId: 'auto',
    fallbackEnabled: true,
    modelOverrides: {
      'gemini-1': defaultGemini,
      'gemini-2': defaultGemini,
      'gemini-3': defaultGemini,
      'groq': 'llama-3.3-70b-versatile',
      'xai-grok': 'grok-2-latest',
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
    trimmed === 'your-xai-grok-api-key'
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
  const now = Date.now();

  const geminiKey1 = process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY || '';
  const geminiKey2 = process.env.GEMINI_API_KEY_2 || '';
  const geminiKey3 = process.env.GEMINI_API_KEY_3 || '';
  const groqKey = process.env.GROQ_API_KEY || '';
  const xaiKey = process.env.XAI_API_KEY || '';

  const providers: AIProviderInfo[] = [
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
    {
      id: 'groq',
      name: 'Groq Cloud',
      provider: 'gemini', // Grouped as high-speed fallback provider
      configured: isValidApiKey(groqKey),
      model: config.modelOverrides['groq'] || 'llama-3.3-70b-versatile',
      availableModels: VERIFIED_GROQ_MODELS,
      isRateLimited: (cooldowns.get('groq')?.until || 0) > now,
    },
    {
      id: 'xai-grok',
      name: 'xAI Grok',
      provider: 'xai',
      configured: isValidApiKey(xaiKey),
      model: config.modelOverrides['xai-grok'] || 'grok-2-latest',
      availableModels: VERIFIED_XAI_MODELS,
      isRateLimited: (cooldowns.get('xai-grok')?.until || 0) > now,
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
  const targetModel = VERIFIED_GROQ_MODELS.includes(model) ? model : 'llama-3.3-70b-versatile';
  const url = 'https://api.groq.com/openai/v1/chat/completions';

  const messages: any[] = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }
  messages.push({ role: 'user', content: prompt });

  if (jsonMode) {
    const hasJsonWord = messages.some(m => /json/i.test(m.content));
    if (!hasJsonWord) {
      messages[0].content += ' Respond strictly in valid JSON format.';
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: targetModel,
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
      finalModel: targetModel,
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      const timeoutErr: any = new Error('Groq API request timed out after 20 seconds');
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Execute call to xAI Grok API (OpenAI-compatible)
 */
async function callXAI(
  apiKey: string,
  model: string,
  prompt: string,
  systemInstruction?: string,
  jsonMode: boolean = true
): Promise<{ text: string; tokens?: { prompt: number; completion: number; total: number }; finalModel: string }> {
  const targetModel = VERIFIED_XAI_MODELS.includes(model) ? model : 'grok-2-latest';
  const url = 'https://api.x.ai/v1/chat/completions';

  const messages: any[] = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }
  messages.push({ role: 'user', content: prompt });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: targetModel,
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
      const error: any = new Error(`xAI Grok API error (${res.status}): ${errorMessage}`);
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
      finalModel: targetModel,
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      const timeoutErr: any = new Error('xAI API request timed out after 20 seconds');
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Core AI Dispatch with Ordered Fallback Pipeline (Gemini 1-3 -> Groq -> xAI)
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

  const geminiKeys: Record<string, string> = {
    'gemini-1': process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY || '',
    'gemini-2': process.env.GEMINI_API_KEY_2 || '',
    'gemini-3': process.env.GEMINI_API_KEY_3 || '',
  };
  const groqKey = process.env.GROQ_API_KEY || '';
  const xaiKey = process.env.XAI_API_KEY || '';

  // Candidate order: Gemini 1 -> Gemini 2 -> Gemini 3 -> Groq -> xAI Grok
  const allProviderIds = ['gemini-1', 'gemini-2', 'gemini-3', 'groq', 'xai-grok'];
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
    if (id.startsWith('gemini')) hasKey = isValidApiKey(geminiKeys[id]);
    else if (id === 'groq') hasKey = isValidApiKey(groqKey);
    else if (id === 'xai-grok') hasKey = isValidApiKey(xaiKey);

    if (!hasKey) return false;

    const cooldown = cooldowns.get(id);
    if (cooldown && cooldown.until > now) {
      return false; // Skip currently rate-limited provider
    }
    return true;
  });

  const allConfiguredCount = [
    geminiKeys['gemini-1'],
    geminiKeys['gemini-2'],
    geminiKeys['gemini-3'],
    groqKey,
    xaiKey,
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
    if (candidateId.startsWith('gemini')) candidateKey = geminiKeys[candidateId];
    else if (candidateId === 'groq') candidateKey = groqKey;
    else if (candidateId === 'xai-grok') candidateKey = xaiKey;

    const trimmedKey = (candidateKey || '').trim();
    if (trimmedKey && attemptedKeyStrings.has(trimmedKey)) {
      // Skip redundant attempt on identical API key if it already failed all healthy models
      continue;
    }
    if (trimmedKey) {
      attemptedKeyStrings.add(trimmedKey);
    }

    const startTime = Date.now();
    isFallback = i > 0;
    try {
      if (candidateId.startsWith('gemini')) {
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
      } else if (candidateId === 'groq') {
        const model = config.modelOverrides['groq'] || 'llama-3.3-70b-versatile';
        const res = await callGroq(groqKey, model, prompt, systemInstruction, jsonMode);
        const latencyMs = Date.now() - startTime;

        if (res.tokens) {
          tokenUsage.prompt += res.tokens.prompt;
          tokenUsage.completion += res.tokens.completion;
          tokenUsage.total += res.tokens.total;
        }

        return {
          text: res.text,
          provider: 'Groq Cloud',
          model: res.finalModel,
          tokensUsed: res.tokens,
          latencyMs,
          fallbackUsed: isFallback,
        };
      } else if (candidateId === 'xai-grok') {
        const model = config.modelOverrides['xai-grok'] || 'grok-2-latest';
        const res = await callXAI(xaiKey, model, prompt, systemInstruction, jsonMode);
        const latencyMs = Date.now() - startTime;

        if (res.tokens) {
          tokenUsage.prompt += res.tokens.prompt;
          tokenUsage.completion += res.tokens.completion;
          tokenUsage.total += res.tokens.total;
        }

        return {
          text: res.text,
          provider: 'xAI Grok',
          model: res.finalModel,
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
      // Proceed to next candidate in fallback pipeline
    }
  }

  const error: any = new Error(`All configured AI providers failed. Attempts: ${errorsEncountered.join(' | ')}`);
  error.status = 502;
  error.attempts = errorsEncountered;
  throw error;
}
