export type TTSProviderId = 'elevenlabs' | 'piper' | 'openai' | 'free_tts';

export interface TTSVoiceInfo {
  id: string;
  name: string;
  provider: TTSProviderId;
  gender?: 'female' | 'male' | 'neutral';
  accent?: string;
  description?: string;
  isDefault?: boolean;
  freeTierReady?: boolean;
  requiresPaidPlan?: boolean;
}

export interface TTSOptions {
  text: string;
  voiceId?: string;
  provider?: TTSProviderId;
  speed?: number;
  signal?: AbortSignal;
}

export interface TTSResult {
  audioBuffer: Buffer;
  contentType: string;
  provider: string;
  providerId: TTSProviderId;
  voiceId: string;
  voiceName: string;
  characterCount: number;
  fallbackTriggered?: boolean;
  originalProviderId?: TTSProviderId;
  fallbackReason?: string;
  keyUsedMasked?: string;
  keysActive?: number;
  keysTotal?: number;
  autoHealedVoice?: boolean;
  originalVoiceId?: string;
  notice?: string;
}

export type ElevenLabsKeyStatus = 'active' | 'quota_exceeded' | 'rate_limited' | 'invalid' | 'failed';

export interface ElevenLabsKeyTelemetry {
  index: number;
  maskedKey: string;
  status: ElevenLabsKeyStatus;
  totalRequests: number;
  characterCount: number;
  cooldownRemainingSeconds?: number;
  lastUsedAt?: number;
  lastError?: string;
}

export interface TTSProviderKeyPoolInfo {
  totalKeys: number;
  activeKeys: number;
  exhaustedKeys: number;
  keys: ElevenLabsKeyTelemetry[];
}

export interface TTSProviderStatus {
  id: TTSProviderId;
  name: string;
  isConfigured: boolean;
  isDefault: boolean;
  freeTierNote: string;
  voices: TTSVoiceInfo[];
  setupDocs?: string;
  keyPool?: TTSProviderKeyPoolInfo;
}

export interface TTSConfigResponse {
  ok: boolean;
  activeProvider: TTSProviderId;
  activeVoiceId: string;
  providers: TTSProviderStatus[];
}

