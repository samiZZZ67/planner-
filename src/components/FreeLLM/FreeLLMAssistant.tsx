'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Moon,
  Sparkles,
  Send,
  X,
  Minimize2,
  Maximize2,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  Bot,
  Paperclip,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Image as ImageIcon,
  Video as VideoIcon,
  Play,
  Pause,
  LoaderCircle,
  AlertTriangle,
  Sliders,
  Square,
  Download,
  Eye,
  FileText,
  Music,
  Headphones,
  Radio,
  Sparkle,
  Search,
  Filter,
  Zap,
  Code,
  Brain,
  Info,
  RotateCcw,
  Settings,
  Menu,
  Plus,
  Edit2,
} from 'lucide-react';
import { FormattedMessage } from '@/components/Chat/FormattedMessage';
import { TelegramQuickSend } from './TelegramQuickSend';
import { apiFetch } from '@/lib/api/apiClient';
import {
  WakeWordManager,
  type VoiceAssistantLifecycleState,
} from '@/lib/voice/wakeWordManager';
import {
  DEFAULT_WAKE_WORDS,
  STORAGE_KEY_WAKE_ENABLED,
  STORAGE_KEY_WAKE_CHIME,
  STORAGE_KEY_VOICE_REPLIES,
  loadSavedWakeWords,
  saveWakeWords,
  getRandomGreeting,
} from '@/lib/voice/wakeWordMatcher';
import {
  CatalogModel,
  VERIFIED_FREE_MODELS,
  mergeDiscoveredModels,
  ModelCapability,
  isImageGenModel,
  isVideoGenModel,
  isImageGenerationRequest,
  isVideoGenerationRequest,
} from '@/lib/freellm/catalog';

export interface AttachmentItem {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  textContent?: string;
  url?: string;
}

export interface GeneratedMedia {
  type: 'image' | 'video';
  url: string;
  prompt: string;
  model?: string;
  width?: number;
  height?: number;
  duration?: number;
}

export interface FreeLLMMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: string;
  provider?: string;
  fallbackFrom?: string;
  latencyMs?: number;
  attachments?: AttachmentItem[];
  generatedMedia?: GeneratedMedia;
}

export interface FreeLLMConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: FreeLLMMessage[];
}

const STORAGE_KEY_CONVERSATIONS = 'np_freellm_conversations';
const STORAGE_KEY_ACTIVE_CONV = 'np_freellm_active_conv_id';
const STORAGE_KEY_HISTORY = 'np_freellm_chat_history';
const STORAGE_KEY_MODEL = 'np_freellm_selected_model';
const STORAGE_KEY_POS = 'np_freellm_moon_btn_pos';

export function getDefaultGreeting(): FreeLLMMessage {
  return {
    id: 'msg-greeting',
    role: 'assistant',
    content:
      '👋 Hello! I am your multimodal **FreeLLM Moon Assistant**.\n\nNow equipped with full multimodal power:\n• 🎙️ **Voice dictation and spoken replies**\n• 👁️ **Visual question answering & photo analysis**\n• 📄 **PDF, document, and source code understanding**\n• 🎨 **High-resolution image generation (Flux)**\n• 🎬 **Text & prompt video generation**\n• 🔊 **Neural speech when configured, with browser voice fallback**\n\nHow can I help you today?',
    timestamp: Date.now(),
    model: 'auto',
  };
}

export function generateConversationTitle(prompt: string): string {
  const cleaned = prompt
    .replace(/^[\s\p{P}]+/u, '')
    .replace(/[#*`_~]/g, '')
    .trim();
  if (!cleaned) return 'New Chat';
  const firstLine = cleaned.split('\n')[0].trim();
  if (firstLine.length <= 34) return firstLine;
  return firstLine.slice(0, 32) + '...';
}

export function formatConversationDate(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

const STARTER_PROMPTS = [
  '🎨 Generate an image of a cybernetic lunar city',
  '🎬 Create a video showing galaxy nebulas and stars',
  '🎙️ Start voice conversation mode',
  'Compare Gemini 2.5 Flash vs Llama 3.3 70B',
];

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 60000): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

function formatFetchError(err: any): string {
  if (err?.name === 'AbortError') {
    return '⏱️ Request timed out (60s). The FreeLLM API service may still be booting up (free tier cold start). Please click Retry in a few moments.';
  }
  const msg = err?.message || String(err);
  if (/unexpected token '<'/i.test(msg) || /<!doctype/i.test(msg) || /<html/i.test(msg)) {
    return '🔄 The external gateway returned a temporary web service page while initializing. Your 730M token Gemini engine is actively connected — please send your message again or click Retry.';
  }
  if (/failed to fetch/i.test(msg) || err instanceof TypeError) {
    return '⚠️ Unable to reach the FreeLLM service endpoint ("Failed to fetch"). If your deployed backend on Render is waking up from sleep, it typically takes 30-50s. Please wait a moment and click Retry.';
  }
  return msg;
}

export function FreeLLMAssistant({
  isPhone = false,
  theme: propTheme,
  currentTab,
  onNavigateTab,
  currentDate,
}: {
  isPhone?: boolean;
  theme?: 'dark' | 'light';
  currentTab?: string;
  onNavigateTab?: (tab: any) => void;
  currentDate?: string;
}) {
  // ── Theme State & Observer ──
  const [theme, setTheme] = useState<'dark' | 'light'>(propTheme || 'dark');

  useEffect(() => {
    if (propTheme) setTheme(propTheme);
  }, [propTheme]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const current = (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark';
    if (!propTheme && current) setTheme(current);

    const observer = new MutationObserver(() => {
      const updated = (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark';
      setTheme(updated);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [propTheme]);

  const isDark = theme !== 'light';

  // ── 1. Assistant Visibility & Window States ──
  const [windowState, setWindowState] = useState<'collapsed' | 'expanded' | 'maximized'>('collapsed');

  // ── 2. Conversations & Hamburger Sidebar State ──
  const [conversations, setConversations] = useState<FreeLLMConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>('');
  const activeConversationIdRef = useRef<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [conversationSearch, setConversationSearch] = useState('');
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editingTitleText, setEditingTitleText] = useState('');
  const [deletingConvId, setDeletingConvId] = useState<string | null>(null);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  // ── 3. Draggable Position for AI Moon Button ──
  const [btnPos, setBtnPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragInfoRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
    shouldOpen: boolean;
  } | null>(null);
  const ignoreNextTelegramTriggerClickRef = useRef(false);

  // ── 4. Chat Messages & Input ──
  const [messages, setMessages] = useState<FreeLLMMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lifecycleState, setLifecycleState] = useState<
    'idle' | 'submitting' | 'connecting' | 'thinking' | 'using_tool' | 'streaming' | 'completed' | 'failed' | 'cancelled'
  >('idle');
  const [activityLabel, setActivityLabel] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // ── 4. Multimodal Attachments ──
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── 5. Voice Dictation & Text-to-Speech ──
  const [isDictating, setIsDictating] = useState(false);
  const [dictationInterim, setDictationInterim] = useState('');
  const [isSpeakingMessageId, setIsSpeakingMessageId] = useState<string | null>(null);
  const [speechState, setSpeechState] = useState<{
    status: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
    messageId: string | null;
    providerName?: string;
    voiceName?: string;
    errorMessage?: string;
    canFallbackToBrowser?: boolean;
    fallbackTriggered?: boolean;
    fallbackReason?: string;
    keyUsedMasked?: string;
  }>({ status: 'idle', messageId: null });
  const [selectedVoiceProvider, setSelectedVoiceProvider] = useState<string>('elevenlabs');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('pNInz6obpgDQGcFmaJgB');
  const [voiceSpeed, setVoiceSpeed] = useState<number>(1.0);
  const [voiceConfigData, setVoiceConfigData] = useState<any>(null);
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [settingsActiveTab, setSettingsActiveTab] = useState<'gateway' | 'voice' | 'wake'>('gateway');

  const saveVoiceSettings = useCallback((provider: string, voiceId: string, speed: number) => {
    setSelectedVoiceProvider(provider);
    setSelectedVoiceId(voiceId);
    setVoiceSpeed(speed);
    try {
      localStorage.setItem('np_voice_provider', provider);
      localStorage.setItem('np_voice_id', voiceId);
      localStorage.setItem('np_voice_speed', String(speed));
    } catch {}
  }, []);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const speechQueueRef = useRef<Array<{ text: string; messageId: string | null; generation: number }>>([]);
  const speechQueueRunningRef = useRef(false);
  const speechGenerationRef = useRef(0);
  const speechAbortRef = useRef<AbortController | null>(null);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechPlaybackStopRef = useRef<(() => void) | null>(null);
  const speechObjectUrlRef = useRef<string | null>(null);
  const voiceSpeechEnabledRef = useRef(false);
  const voiceTranscriptRef = useRef('');
  const voiceEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceSubmitRef = useRef<(text: string) => void>(() => {});
  const voiceModeActiveRef = useRef(false);

  // ── 6. Voice Mode ──
  const [isVoiceModeActive, setIsVoiceModeActive] = useState(false);
  const [voiceModeStatus, setVoiceModeStatus] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [voiceSubtitle, setVoiceSubtitle] = useState<string>('Listening to your voice...');

  // ── Always-Available Wake-Word & Voice Assistant ──
  const [wakeWordEnabled, setWakeWordEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(STORAGE_KEY_WAKE_ENABLED) === 'true';
    } catch {
      return false;
    }
  });
  const [voiceRepliesEnabled, setVoiceRepliesEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return localStorage.getItem(STORAGE_KEY_VOICE_REPLIES) !== 'false';
    } catch {
      return true;
    }
  });
  const [wakeChimeEnabled, setWakeChimeEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return localStorage.getItem(STORAGE_KEY_WAKE_CHIME) !== 'false';
    } catch {
      return true;
    }
  });
  const [wakeWordsList, setWakeWordsList] = useState<string[]>(() => loadSavedWakeWords());
  const [newWakeWordInput, setNewWakeWordInput] = useState('');
  const [voiceLifecycleState, setVoiceLifecycleState] = useState<VoiceAssistantLifecycleState>('disabled');
  const [voiceLifecycleDetail, setVoiceLifecycleDetail] = useState('');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    action: string;
    targetId?: string;
    targetTitle?: string;
    message: string;
    confirmationPrompt?: string;
  } | null>(null);

  const wakeWordManagerRef = useRef<WakeWordManager | null>(null);
  const lastReferencedTaskIdRef = useRef<string | null>(null);
  const lastReferencedTaskTitleRef = useRef<string | null>(null);

  // ── 7. Image Lightbox / Zoom Modal ──
  const [zoomedImage, setZoomedImage] = useState<{ url: string; prompt: string } | null>(null);

  // ── 8. Gateway Connection & Model ──
  const [selectedModel, setSelectedModel] = useState<string>('auto');
  const [gatewayOnline, setGatewayOnline] = useState<boolean | null>(null);
  const [gatewayLatency, setGatewayLatency] = useState<number | null>(null);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelSearch, setModelSearch] = useState<string>('');
  const [showModelSearch, setShowModelSearch] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [isTestingGateway, setIsTestingGateway] = useState(false);
  const [configUrl, setConfigUrl] = useState<string>('https://free-llm-api-7fue.onrender.com/v1');
  const [configKeyInput, setConfigKeyInput] = useState<string>('');
  const [keyConfigured, setKeyConfigured] = useState<boolean>(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);

  // ── Clamp position inside viewport ──
  const clampPosition = useCallback((x: number, y: number) => {
    const btnSize = 52;
    const margin = 12;
    const maxX = typeof window !== 'undefined' ? window.innerWidth - btnSize - margin : 500;
    const maxY = typeof window !== 'undefined' ? window.innerHeight - btnSize - margin : 500;
    return {
      x: Math.max(margin, Math.min(maxX, x)),
      y: Math.max(margin, Math.min(maxY, y)),
    };
  }, []);

  // ── Load saved state on mount ──
  useEffect(() => {
    // 1. Position
    try {
      const savedPos = localStorage.getItem(STORAGE_KEY_POS);
      if (savedPos) {
        const parsed = JSON.parse(savedPos);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          setBtnPos(clampPosition(parsed.x, parsed.y));
        }
      }
    } catch {}

    // 2. Selected Model
    try {
      const savedModel = localStorage.getItem(STORAGE_KEY_MODEL);
      if (savedModel) {
        setSelectedModel(savedModel);
      }
    } catch {}

    // 3. Conversation History & Migration
    try {
      const savedConvs = localStorage.getItem(STORAGE_KEY_CONVERSATIONS);
      const savedActiveId = localStorage.getItem(STORAGE_KEY_ACTIVE_CONV);
      let parsedConvs: FreeLLMConversation[] = [];

      if (savedConvs) {
        parsedConvs = JSON.parse(savedConvs);
      }

      if (!Array.isArray(parsedConvs) || parsedConvs.length === 0) {
        const legacyHistory = localStorage.getItem(STORAGE_KEY_HISTORY);
        if (legacyHistory) {
          const parsedMsgs = JSON.parse(legacyHistory);
          if (Array.isArray(parsedMsgs) && parsedMsgs.length > 0) {
            const firstUser = parsedMsgs.find((m: FreeLLMMessage) => m.role === 'user');
            const title = firstUser ? generateConversationTitle(firstUser.content) : 'Previous Chat';
            const initialConv: FreeLLMConversation = {
              id: `conv-${Date.now()}`,
              title,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messages: parsedMsgs,
            };
            parsedConvs = [initialConv];
            try {
              localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(parsedConvs));
            } catch {}
          }
        }
      }

      if (Array.isArray(parsedConvs) && parsedConvs.length > 0) {
        setConversations(parsedConvs);
        const target = parsedConvs.find(c => c.id === savedActiveId) || parsedConvs[0];
        setActiveConversationId(target.id);
        activeConversationIdRef.current = target.id;
        setMessages(target.messages || [getDefaultGreeting()]);
      } else {
        const defaultGreeting = getDefaultGreeting();
        const initialConv: FreeLLMConversation = {
          id: `conv-${Date.now()}`,
          title: 'New Chat',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [defaultGreeting],
        };
        setConversations([initialConv]);
        setActiveConversationId(initialConv.id);
        activeConversationIdRef.current = initialConv.id;
        setMessages([defaultGreeting]);
        try {
          localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify([initialConv]));
          localStorage.setItem(STORAGE_KEY_ACTIVE_CONV, initialConv.id);
        } catch {}
      }
    } catch {
      const defaultGreeting = getDefaultGreeting();
      setMessages([defaultGreeting]);
    }

    // Fetch and merge server conversations for cross-device persistence
    apiFetch('/api/ai/history?assistant=freellm')
      .then(res => res.json())
      .then(data => {
        if (data?.ok && Array.isArray(data.conversations)) {
          const serverConvs: FreeLLMConversation[] = data.conversations;
          setConversations(prev => {
            const map = new Map<string, FreeLLMConversation>();
            for (const c of prev) {
              map.set(c.id, c);
            }
            for (const sc of serverConvs) {
              const cur = map.get(sc.id);
              if (!cur || (sc.updatedAt || 0) >= (cur.updatedAt || 0)) {
                map.set(sc.id, sc);
              }
            }
            const merged = Array.from(map.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            try {
              localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(merged));
            } catch {}

            // If local had conversations not on server, sync up
            const localOnly = prev.filter(p => !serverConvs.some(sc => sc.id === p.id));
            if (localOnly.length > 0) {
              apiFetch('/api/ai/history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  assistant: 'freellm',
                  action: 'sync',
                  conversations: merged,
                }),
              }).catch(() => null);
            }

            const currentActive = activeConversationIdRef.current;
            const target = merged.find(c => c.id === currentActive) || merged[0];
            if (target) {
              setActiveConversationId(target.id);
              activeConversationIdRef.current = target.id;
              setMessages(target.messages || [getDefaultGreeting()]);
            }
            return merged;
          });
        }
      })
      .catch(() => null);

    // 4. Custom Gateway URL & Key
    // Gateway settings and unified API keys are persisted securely in backend database

    const onResize = () => {
      setBtnPos(prev => (prev ? clampPosition(prev.x, prev.y) : null));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampPosition]);

  // ── Load saved voice configuration on mount ──
  useEffect(() => {
    try {
      const savedProvider = localStorage.getItem('np_voice_provider');
      if (savedProvider) setSelectedVoiceProvider(savedProvider);
      const savedVoice = localStorage.getItem('np_voice_id');
      if (savedVoice) setSelectedVoiceId(savedVoice);
      const savedSpeed = localStorage.getItem('np_voice_speed');
      if (savedSpeed) setVoiceSpeed(Number(savedSpeed) || 1.0);
    } catch {}

    apiFetch('/api/voice/config')
      .then(res => res.json())
      .then(data => {
        if (data?.ok) {
          setVoiceConfigData(data);
          try {
            const savedProv = localStorage.getItem('np_voice_provider');
            if (!savedProv && data.activeProvider) {
              setSelectedVoiceProvider(data.activeProvider);
            }
            const savedV = localStorage.getItem('np_voice_id');
            if (!savedV && data.activeVoiceId) {
              setSelectedVoiceId(data.activeVoiceId);
            }
          } catch {}
        }
      })
      .catch(() => null);
  }, []);

  // ── Check Gateway Status (Render Backend) ──
  const applyStatusPayload = useCallback((data: any) => {
    setGatewayOnline(Boolean(data.online));
    setGatewayLatency(data.latencyMs ?? null);
    if (typeof data.gatewayUrl === 'string' && data.gatewayUrl.trim()) {
      setConfigUrl(data.gatewayUrl.trim());
    } else if (typeof data.defaultGatewayUrl === 'string' && data.defaultGatewayUrl.trim()) {
      setConfigUrl(data.defaultGatewayUrl.trim());
    }
    setKeyConfigured(Boolean(data.keyConfigured));
    setMaskedKey(data.maskedKey || null);

    let readyCatalog: CatalogModel[] = [];
    if (Array.isArray(data.catalog) && data.catalog.length > 0) {
      readyCatalog = data.catalog.filter((m: CatalogModel) => m && m.id && m.id !== 'auto');
    } else if (Array.isArray(data.models) && data.models.length > 0) {
      const liveIds = data.models.filter((id: string) => typeof id === 'string' && id.length > 0 && id !== 'auto');
      readyCatalog = mergeDiscoveredModels(liveIds).filter(m => liveIds.includes(m.id));
    }

    if (readyCatalog.length > 0) {
      setCatalogModels(readyCatalog);
      const readyIds = readyCatalog.map(m => m.id);
      setAvailableModels(['auto', ...readyIds]);
      setSelectedModel(prev => {
        if (prev === 'auto' || readyIds.includes(prev)) return prev;
        try {
          localStorage.setItem(STORAGE_KEY_MODEL, 'auto');
        } catch {}
        return 'auto';
      });
    } else if (data.online === false) {
      setCatalogModels([]);
      setAvailableModels(['auto']);
    }

    if (data.error && !data.online) {
      setGatewayError(data.error);
    } else {
      setGatewayError(null);
    }
  }, []);

  const testGatewayConnection = useCallback(async () => {
    setIsTestingGateway(true);
    setGatewayError(null);
    try {
      const res = await fetchWithTimeout('/api/ai/freellm/status', {}, 45000);
      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok) {
        applyStatusPayload(data);
      } else {
        setGatewayOnline(false);
        setGatewayError(data?.error || `Gateway returned HTTP ${res.status}`);
      }
    } catch (err: any) {
      setGatewayOnline(false);
      setGatewayError(formatFetchError(err));
    } finally {
      setIsTestingGateway(false);
    }
  }, [applyStatusPayload]);

  const saveGatewaySettings = useCallback(async (clear = false) => {
    setIsTestingGateway(true);
    setGatewayError(null);
    try {
      const res = await fetchWithTimeout(
        '/api/ai/freellm/status',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            clear
              ? { clear: true }
              : {
                  baseUrl: configUrl.trim(),
                  ...(configKeyInput.trim() ? { apiKey: configKeyInput.trim() } : {}),
                }
          ),
        },
        45000
      );
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setConfigKeyInput('');
        applyStatusPayload(data);
      } else {
        setGatewayOnline(false);
        setGatewayError(data?.error || `Failed to save settings (HTTP ${res.status})`);
      }
    } catch (err: any) {
      setGatewayOnline(false);
      setGatewayError(formatFetchError(err));
    } finally {
      setIsTestingGateway(false);
    }
  }, [configUrl, configKeyInput, applyStatusPayload]);

  useEffect(() => {
    testGatewayConnection();
  }, [testGatewayConnection]);

  useEffect(() => {
    if (windowState !== 'collapsed') {
      testGatewayConnection();
    }
  }, [windowState, testGatewayConnection]);

  // Scroll to bottom on new message
  useEffect(() => {
    if (windowState !== 'collapsed') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, windowState]);

  // Save messages to localStorage and active conversation
  const updateMessages = (newMsgs: FreeLLMMessage[] | ((prev: FreeLLMMessage[]) => FreeLLMMessage[])) => {
    setMessages(prev => {
      const next = typeof newMsgs === 'function' ? newMsgs(prev) : newMsgs;

      setConversations(convs => {
        const currentId = activeConversationIdRef.current;
        const exists = convs.find(c => c.id === currentId);
        let nextConvs: FreeLLMConversation[];
        let targetConv: FreeLLMConversation | undefined;

        if (exists) {
          const hasDefaultTitle = exists.title === 'New Chat' || exists.title === 'Welcome Chat';
          const firstUser = next.find(m => m.role === 'user');
          const newTitle = hasDefaultTitle && firstUser ? generateConversationTitle(firstUser.content) : exists.title;

          nextConvs = convs.map(c => {
            if (c.id === currentId) {
              const u = { ...c, messages: next, updatedAt: Date.now(), title: newTitle };
              targetConv = u;
              return u;
            }
            return c;
          });
        } else {
          const newConv: FreeLLMConversation = {
            id: currentId || `conv-${Date.now()}`,
            title: 'New Chat',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: next,
          };
          targetConv = newConv;
          nextConvs = [newConv, ...convs];
        }

        try {
          localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(nextConvs));
        } catch {}

        if (targetConv) {
          apiFetch('/api/ai/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              assistant: 'freellm',
              action: 'save_conversation',
              conversation: targetConv,
            }),
          }).catch(() => null);
        }

        return nextConvs;
      });

      try {
        localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleNewChat = () => {
    const newId = `conv-${Date.now()}`;
    const initialMessages: FreeLLMMessage[] = [getDefaultGreeting()];
    const newConv: FreeLLMConversation = {
      id: newId,
      title: 'New Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: initialMessages,
    };
    setConversations(prev => {
      const next = [newConv, ...prev];
      try {
        localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(next));
        localStorage.setItem(STORAGE_KEY_ACTIVE_CONV, newId);
      } catch {}
      return next;
    });
    setActiveConversationId(newId);
    activeConversationIdRef.current = newId;
    setMessages(initialMessages);
    if (isPhone) setIsSidebarOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);

    apiFetch('/api/ai/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistant: 'freellm',
        action: 'save_conversation',
        conversation: newConv,
      }),
    }).catch(() => null);
  };

  const handleSelectConversation = (convId: string) => {
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;
    setActiveConversationId(convId);
    activeConversationIdRef.current = convId;
    setMessages(conv.messages || [getDefaultGreeting()]);
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE_CONV, convId);
    } catch {}
    if (isPhone) setIsSidebarOpen(false);
  };

  const handleRenameConversation = (convId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) {
      setEditingConvId(null);
      return;
    }
    setConversations(prev => {
      let targetConv: FreeLLMConversation | undefined;
      const updated = prev.map(c => {
        if (c.id === convId) {
          const u = { ...c, title: trimmed, updatedAt: Date.now() };
          targetConv = u;
          return u;
        }
        return c;
      });
      try {
        localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(updated));
      } catch {}

      if (targetConv) {
        apiFetch('/api/ai/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assistant: 'freellm',
            action: 'save_conversation',
            conversation: targetConv,
          }),
        }).catch(() => null);
      }

      return updated;
    });
    setEditingConvId(null);
  };

  const handleDeleteConversation = (convId: string) => {
    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== convId);
      try {
        localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(filtered));
      } catch {}
      if (convId === activeConversationId) {
        if (filtered.length > 0) {
          const nextTarget = filtered[0];
          setActiveConversationId(nextTarget.id);
          activeConversationIdRef.current = nextTarget.id;
          setMessages(nextTarget.messages || [getDefaultGreeting()]);
          try {
            localStorage.setItem(STORAGE_KEY_ACTIVE_CONV, nextTarget.id);
          } catch {}
        } else {
          handleNewChat();
        }
      }
      return filtered;
    });
    setDeletingConvId(null);

    apiFetch('/api/ai/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistant: 'freellm',
        action: 'delete_conversation',
        conversationId: convId,
      }),
    }).catch(() => null);
  };

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    try {
      localStorage.setItem(STORAGE_KEY_MODEL, model);
    } catch {}
  };

  // ── Drag Handlers for Floating AI Moon Button ──
  const handlePointerDown = (e: React.PointerEvent, shouldOpen = true) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const currentPos =
      btnPos ||
      clampPosition(
        window.innerWidth - (isPhone ? 76 : 88) - 52,
        window.innerHeight - (isPhone ? 84 : 28) - 52
      );

    dragInfoRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: currentPos.x,
      origY: currentPos.y,
      moved: false,
      shouldOpen,
    };

    const handlePointerMove = (moveEvt: PointerEvent) => {
      if (!dragInfoRef.current) return;
      const dx = moveEvt.clientX - dragInfoRef.current.startX;
      const dy = moveEvt.clientY - dragInfoRef.current.startY;

      if (Math.hypot(dx, dy) > 5) {
        dragInfoRef.current.moved = true;
        setIsDragging(true);
        const newPos = clampPosition(
          dragInfoRef.current.origX + dx,
          dragInfoRef.current.origY + dy
        );
        setBtnPos(newPos);
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      setIsDragging(false);

      if (dragInfoRef.current) {
        if (!dragInfoRef.current.shouldOpen && dragInfoRef.current.moved) {
          ignoreNextTelegramTriggerClickRef.current = true;
          window.setTimeout(() => { ignoreNextTelegramTriggerClickRef.current = false; }, 0);
        }
        if (!dragInfoRef.current.moved && dragInfoRef.current.shouldOpen) {
          setWindowState('expanded');
        } else if (btnPos) {
          try {
            localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(btnPos));
          } catch {}
        }
      }
      dragInfoRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // ── File Attachment Processing ──
  const processFiles = async (files: FileList | File[]) => {
    const newItems: AttachmentItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 25 * 1024 * 1024) {
        alert(`File "${file.name}" exceeds the 25MB limit.`);
        continue;
      }

      const id = `att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const isText =
        file.type.startsWith('text/') ||
        /\.(txt|md|json|csv|js|ts|tsx|jsx|py|html|css|sql|sh)$/i.test(file.name);

      if (isText) {
        const text = await file.text();
        newItems.push({
          id,
          name: file.name,
          type: file.type || 'text/plain',
          size: file.size,
          textContent: text,
        });
      } else {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        newItems.push({
          id,
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl,
        });
      }
    }

    setAttachments(prev => [...prev, ...newItems]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  // ── Voice Dictation (Microphone) ──
  const startDictation = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
          setIsDictating(true);
          setDictationInterim('');
        };

        recognition.onresult = (event: any) => {
          let interim = '';
          let final = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              final += event.results[i][0].transcript;
            } else {
              interim += event.results[i][0].transcript;
            }
          }

          if (final) {
            if (voiceModeActiveRef.current) {
              voiceTranscriptRef.current = `${voiceTranscriptRef.current} ${final}`.trim();
              setVoiceSubtitle(voiceTranscriptRef.current);
              if (voiceEndTimerRef.current) clearTimeout(voiceEndTimerRef.current);
              voiceEndTimerRef.current = setTimeout(() => {
                const spokenPrompt = voiceTranscriptRef.current.trim();
                if (!spokenPrompt) return;
                voiceTranscriptRef.current = '';
                recognitionRef.current?.stop();
                recognitionRef.current = null;
                setVoiceModeStatus('thinking');
                setVoiceSubtitle('Thinking about what you said...');
                voiceSubmitRef.current(spokenPrompt);
              }, 1500);
            } else {
              setInput(prev => (prev ? `${prev} ${final}` : final).trim());
            }
          }
          setDictationInterim(interim);
        };

        recognition.onerror = (event: any) => {
          console.warn('[Speech Recognition] Error:', event.error);
          stopDictation();
        };

        recognition.onend = () => {
          setIsDictating(false);
          setDictationInterim('');
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (err) {
        console.warn('Speech recognition failed, trying audio recording fallback...', err);
        startAudioRecorderFallback();
      }
    } else {
      startAudioRecorderFallback();
    }
  };

  const startAudioRecorderFallback = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());

        const formData = new FormData();
        formData.append('file', audioBlob, 'recording.webm');

        try {
          const res = await fetchWithTimeout('/api/ai/freellm/transcribe', {
            method: 'POST',
            body: formData,
          }, 30000);
          const data = await res.json().catch(() => null);
          if (data?.ok && data?.text) {
            if (voiceModeActiveRef.current) {
              setVoiceModeStatus('thinking');
              setVoiceSubtitle('Transcription complete. Preparing a reply...');
              voiceSubmitRef.current(data.text);
              return;
            }
            setInput(prev => (prev ? `${prev} ${data.text}` : data.text).trim());
          } else if (data?.error) {
            console.warn('[Transcription Warning]:', data.error);
          }
        } catch (err) {
          console.error('Transcription error:', formatFetchError(err));
        } finally {
          setIsDictating(false);
        }
      };

      // Hands-free VAD silence detection on audio stream
      if (voiceModeActiveRef.current && (typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined')) {
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AudioContextClass();
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          let silenceStartTime: number | null = null;
          let speechDetected = false;
          const vadInterval = setInterval(() => {
            if (recorder.state !== 'recording') {
              clearInterval(vadInterval);
              try { audioCtx.close(); } catch {}
              return;
            }
            analyser.getByteFrequencyData(dataArray);
            const sum = dataArray.reduce((acc, val) => acc + val, 0);
            const avg = sum / dataArray.length;

            if (avg > 15) {
              speechDetected = true;
              silenceStartTime = null;
            } else if (speechDetected) {
              if (!silenceStartTime) silenceStartTime = Date.now();
              else if (Date.now() - silenceStartTime > 1600) {
                clearInterval(vadInterval);
                try { audioCtx.close(); } catch {}
                if (recorder.state === 'recording') {
                  recorder.stop();
                }
              }
            }
          }, 150);
        } catch (e) {
          console.warn('[VAD] AudioContext error, falling back to manual recording:', e);
        }
      }

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsDictating(true);
      if (voiceModeActiveRef.current) {
        setVoiceSubtitle('Listening... Speak naturally, silence auto-submits.');
      }
    } catch (err) {
      alert('Microphone permission was denied or is unavailable.');
      setIsDictating(false);
    }
  };

  const stopDictation = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsDictating(false);
    setDictationInterim('');
  };

  const toggleDictation = () => {
    if (isDictating) {
      stopDictation();
    } else {
      startDictation();
    }
  };

  useEffect(() => {
    if (isVoiceModeActive && !isMicMuted && voiceModeStatus === 'listening' && !isDictating) {
      startDictation();
    }
    if ((!isVoiceModeActive || isMicMuted) && isDictating) stopDictation();
  }, [isVoiceModeActive, isMicMuted, voiceModeStatus, isDictating]);

  // ── Text-to-Speech Response Playback (Neural TTS) ──
  const cleanMarkdownForSpeech = (text: string): string => {
    return text
      .replace(/```[\s\S]*?```/g, ' [Code snippet omitted] ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .trim();
  };

  const stopSpeechPlayback = useCallback(() => {
    speechGenerationRef.current += 1;
    speechQueueRef.current = [];
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    if (speechAudioRef.current) {
      speechAudioRef.current.pause();
      speechAudioRef.current.src = '';
      speechAudioRef.current = null;
    }
    speechPlaybackStopRef.current?.();
    if (speechObjectUrlRef.current) URL.revokeObjectURL(speechObjectUrlRef.current);
    speechObjectUrlRef.current = null;
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    setIsSpeakingMessageId(null);
    setSpeechState({ status: 'idle', messageId: null });
    wakeWordManagerRef.current?.returnToWakeListening(300);
  }, []);

  const pauseSpeechPlayback = useCallback(() => {
    if (speechAudioRef.current && !speechAudioRef.current.paused) {
      speechAudioRef.current.pause();
      setSpeechState(prev => ({ ...prev, status: 'paused' }));
    }
  }, []);

  const resumeSpeechPlayback = useCallback(() => {
    if (speechAudioRef.current && speechAudioRef.current.paused) {
      speechAudioRef.current.play().then(() => {
        setSpeechState(prev => ({ ...prev, status: 'playing' }));
      }).catch(err => {
        console.warn('[Voice] Audio resume failed:', err);
      });
    }
  }, []);

  const playSpeech = useCallback(
    async (text: string, messageId: string | null = null, forceBrowser = false) => {
      // Toggle pause/resume if clicking the same currently active message
      if (speechState.messageId === messageId && speechState.status !== 'idle' && speechState.status !== 'error') {
        if (speechState.status === 'playing') {
          pauseSpeechPlayback();
          return;
        } else if (speechState.status === 'paused') {
          resumeSpeechPlayback();
          return;
        }
      }

      stopSpeechPlayback();

      const cleanText = cleanMarkdownForSpeech(text);
      if (!cleanText) return;

      const generation = speechGenerationRef.current;

      // ── Explicit Browser Voice Fallback (Only if explicitly clicked by user) ──
      if (forceBrowser) {
        if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
          setSpeechState({
            status: 'error',
            messageId,
            errorMessage: 'Browser system speech synthesis is not supported in this browser.',
          });
          return;
        }

        setSpeechState({
          status: 'playing',
          messageId,
          providerName: 'Browser System Voice (Explicit Fallback)',
          voiceName: 'System Voice',
        });
        setIsSpeakingMessageId(messageId);

        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.rate = voiceSpeed;
        utterance.onend = () => {
          if (generation !== speechGenerationRef.current) return;
          stopSpeechPlayback();
        };
        utterance.onerror = () => {
          if (generation !== speechGenerationRef.current) return;
          stopSpeechPlayback();
        };
        window.speechSynthesis.speak(utterance);
        return;
      }

      // ── Neural Voice Synthesis ──
      setSpeechState({
        status: 'loading',
        messageId,
      });
      setIsSpeakingMessageId(messageId);

      if (isVoiceModeActive) {
        setVoiceModeStatus('speaking');
        setVoiceSubtitle('Synthesizing neural voice...');
      }

      const controller = new AbortController();
      speechAbortRef.current = controller;

      try {
        const response = await apiFetch('/api/voice/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            text: cleanText,
            voiceId: selectedVoiceId,
            provider: selectedVoiceProvider,
            speed: voiceSpeed,
          }),
        });

        if (!response.ok) {
          let errorMsg = 'Neural voice synthesis failed.';
          try {
            const errJson = await response.json();
            errorMsg = errJson.error || errorMsg;
          } catch {
            errorMsg = `Server error ${response.status}: ${response.statusText}`;
          }
          throw new Error(errorMsg);
        }

        const audioBlob = await response.blob();
        if (controller.signal.aborted || generation !== speechGenerationRef.current) return;

        const providerName = response.headers.get('X-Voice-Provider') || 'Neural Voice';
        const voiceName = decodeURIComponent(response.headers.get('X-Voice-Name') || '');
        const fallbackTriggered = response.headers.get('X-Voice-Fallback') === 'true';
        const fallbackReason = decodeURIComponent(response.headers.get('X-Voice-Fallback-Reason') || '');
        const keyUsedMasked = response.headers.get('X-Voice-Key-Used') || undefined;

        const url = URL.createObjectURL(audioBlob);
        speechObjectUrlRef.current = url;
        const audio = new Audio(url);
        speechAudioRef.current = audio;
        audio.playbackRate = voiceSpeed;

        audio.onplay = () => {
          if (generation !== speechGenerationRef.current) return;
          setSpeechState({
            status: 'playing',
            messageId,
            providerName,
            voiceName,
            fallbackTriggered,
            fallbackReason,
            keyUsedMasked,
          });
          setIsSpeakingMessageId(messageId);
          if (isVoiceModeActive) {
            setVoiceModeStatus('speaking');
            setVoiceSubtitle(
              fallbackTriggered
                ? `Speaking (${providerName} fallback: ElevenLabs quota reached)...`
                : `Speaking with ${voiceName || providerName}...`
            );
          }
        };

        audio.onpause = () => {
          if (generation !== speechGenerationRef.current) return;
          setSpeechState(prev => (prev.messageId === messageId && prev.status === 'playing' ? { ...prev, status: 'paused' } : prev));
        };

        audio.onended = () => {
          if (generation !== speechGenerationRef.current) return;
          stopSpeechPlayback();
          if (isVoiceModeActive) {
            setVoiceModeStatus(isMicMuted ? 'idle' : 'listening');
            setVoiceSubtitle('Listening for your next phrase...');
          }
        };

        audio.onerror = () => {
          if (generation !== speechGenerationRef.current) return;
          setSpeechState({
            status: 'error',
            messageId,
            errorMessage: 'Audio element failed to decode or play the voice stream.',
            canFallbackToBrowser: typeof window !== 'undefined' && 'speechSynthesis' in window,
          });
          setIsSpeakingMessageId(null);
          if (isVoiceModeActive) {
            setVoiceModeStatus('idle');
            setVoiceSubtitle('⚠️ Audio playback failed.');
          }
          wakeWordManagerRef.current?.returnToWakeListening(500);
        };

        await audio.play();
      } catch (err: any) {
        if (controller.signal.aborted || generation !== speechGenerationRef.current) return;
        console.warn('[Voice] Neural voice synthesis error:', err);
        setSpeechState({
          status: 'error',
          messageId,
          errorMessage: err?.message || 'Neural voice unavailable.',
          canFallbackToBrowser: typeof window !== 'undefined' && 'speechSynthesis' in window,
        });
        setIsSpeakingMessageId(null);
        if (isVoiceModeActive) {
          setVoiceModeStatus('idle');
          setVoiceSubtitle(`⚠️ Voice error: ${err?.message || 'Synthesis failed.'}`);
        }
        wakeWordManagerRef.current?.returnToWakeListening(500);
      } finally {
        if (speechAbortRef.current === controller) {
          speechAbortRef.current = null;
        }
      }
    },
    [isMicMuted, isVoiceModeActive, pauseSpeechPlayback, resumeSpeechPlayback, selectedVoiceId, selectedVoiceProvider, speechState.messageId, speechState.status, stopSpeechPlayback, voiceSpeed]
  );

  const handleSpeakMessage = (msg: FreeLLMMessage) => {
    if (speechState.messageId === msg.id && (speechState.status === 'playing' || speechState.status === 'paused')) {
      stopSpeechPlayback();
      return;
    }
    void playSpeech(msg.content, msg.id);
  };

  // ── Always-Available Voice Command Assistant Execution ──
  const executeVoiceAssistantCommand = useCallback(
    async (commandText: string) => {
      if (!commandText || !commandText.trim()) return;

      const trimmedCommand = commandText.trim();
      setLiveTranscript(trimmedCommand);
      wakeWordManagerRef.current?.notifyExternalState('understanding');

      // Expand window if collapsed so user sees the assistant acting
      setWindowState(prev => (prev === 'collapsed' ? 'expanded' : prev));

      try {
        wakeWordManagerRef.current?.notifyExternalState('executing');

        const res = await apiFetch('/api/ai/voice-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: trimmedCommand,
            context: {
              currentTab,
              currentDate,
              lastReferencedTaskId: lastReferencedTaskIdRef.current || undefined,
              lastReferencedTaskTitle: lastReferencedTaskTitleRef.current || undefined,
              pendingConfirmation: pendingConfirmation
                ? {
                    intent: pendingConfirmation.action,
                    targetId: pendingConfirmation.targetId,
                    targetTitle: pendingConfirmation.targetTitle,
                    expiresAt: Date.now() + 30000,
                  }
                : null,
            },
          }),
        });

        const data: any = await res.json();

        if (data.targetTask) {
          lastReferencedTaskIdRef.current = data.targetTask.id;
          lastReferencedTaskTitleRef.current = data.targetTask.title;
        }

        if (data.needsConfirmation) {
          setPendingConfirmation({
            action: data.action,
            targetId: data.targetTask?.id,
            targetTitle: data.targetTask?.title,
            message: data.message,
            confirmationPrompt: data.confirmationPrompt || 'Are you sure you want to proceed?',
          });
          wakeWordManagerRef.current?.notifyExternalState('confirming_result');

          const userMsg: FreeLLMMessage = {
            id: `msg-${Date.now()}-user`,
            role: 'user',
            content: trimmedCommand,
            timestamp: Date.now(),
          };
          const assistantMsg: FreeLLMMessage = {
            id: `msg-${Date.now()}-assistant`,
            role: 'assistant',
            content: `${data.message}\n\n⚠️ **${data.confirmationPrompt || 'Say "yes" to confirm or "cancel" to abort.'}**`,
            timestamp: Date.now(),
            model: 'Sami Voice Assistant',
          };
          updateMessages(prev => [...prev, userMsg, assistantMsg]);

          if (voiceRepliesEnabled && data.spokenText) {
            wakeWordManagerRef.current?.notifyExternalState('speaking_response');
            await playSpeech(data.spokenText, assistantMsg.id);
          }
          return;
        }

        // Action completed or rejected
        setPendingConfirmation(null);

        if (data.navigationTab) {
          onNavigateTab?.(data.navigationTab);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('np-navigate', {
                detail: { tab: data.navigationTab, date: currentDate },
              })
            );
          }
        }

        const userMsg: FreeLLMMessage = {
          id: `msg-${Date.now()}-user`,
          role: 'user',
          content: trimmedCommand,
          timestamp: Date.now(),
        };
        const assistantMsg: FreeLLMMessage = {
          id: `msg-${Date.now()}-assistant`,
          role: 'assistant',
          content: data.message || 'Action executed.',
          timestamp: Date.now(),
          model: 'Sami Voice Assistant',
        };
        updateMessages(prev => [...prev, userMsg, assistantMsg]);

        if (voiceRepliesEnabled && data.spokenText) {
          wakeWordManagerRef.current?.notifyExternalState('speaking_response');
          await playSpeech(data.spokenText, assistantMsg.id);
        } else {
          wakeWordManagerRef.current?.returnToWakeListening(500);
        }
      } catch (err: any) {
        console.error('[VoiceAssistant] Command execution failed:', err);
        const errMsg: FreeLLMMessage = {
          id: `msg-${Date.now()}-err`,
          role: 'assistant',
          content: `⚠️ Failed to execute voice command: ${err?.message || 'Network error'}`,
          timestamp: Date.now(),
          model: 'Sami Voice Assistant',
        };
        updateMessages(prev => [...prev, errMsg]);
        wakeWordManagerRef.current?.returnToWakeListening(800);
      } finally {
        setTimeout(() => setLiveTranscript(''), 4000);
      }
    },
    [currentTab, currentDate, pendingConfirmation, voiceRepliesEnabled, onNavigateTab, playSpeech, updateMessages]
  );

  const handleConfirmAction = useCallback(
    async (confirmed: boolean) => {
      if (!pendingConfirmation) return;
      const targetPending = pendingConfirmation;
      setPendingConfirmation(null);

      try {
        wakeWordManagerRef.current?.notifyExternalState('executing');
        const res = await apiFetch('/api/ai/voice-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            confirmation: {
              confirmed,
              action: targetPending.action,
              targetId: targetPending.targetId,
              targetTitle: targetPending.targetTitle,
            },
            context: {
              currentTab,
              currentDate,
            },
          }),
        });

        const data: any = await res.json();
        const assistantMsg: FreeLLMMessage = {
          id: `msg-${Date.now()}-confirm`,
          role: 'assistant',
          content: data.message || (confirmed ? 'Action confirmed and executed.' : 'Action cancelled.'),
          timestamp: Date.now(),
          model: 'Sami Voice Assistant',
        };
        updateMessages(prev => [...prev, assistantMsg]);

        if (voiceRepliesEnabled && data.spokenText) {
          wakeWordManagerRef.current?.notifyExternalState('speaking_response');
          await playSpeech(data.spokenText, assistantMsg.id);
        } else {
          wakeWordManagerRef.current?.returnToWakeListening(500);
        }
      } catch (err: any) {
        console.error('[VoiceAssistant] Confirmation error:', err);
        wakeWordManagerRef.current?.returnToWakeListening(800);
      }
    },
    [pendingConfirmation, currentTab, currentDate, voiceRepliesEnabled, playSpeech, updateMessages]
  );

  // Keep ref to executeVoiceAssistantCommand to avoid stale closures in Web Speech callbacks
  const executeVoiceCommandRef = useRef(executeVoiceAssistantCommand);
  useEffect(() => {
    executeVoiceCommandRef.current = executeVoiceAssistantCommand;
  }, [executeVoiceAssistantCommand]);

  // Initialize WakeWordManager on mount
  useEffect(() => {
    const manager = new WakeWordManager({
      onStateChange: (state, detail) => {
        setVoiceLifecycleState(state);
        setVoiceLifecycleDetail(detail || '');
      },
      onWakeWordDetected: (wakeWord, immediateCommand) => {
        if (wakeChimeEnabled) {
          manager.playWakeChime();
        }
        if (immediateCommand && immediateCommand.trim()) {
          executeVoiceCommandRef.current(immediateCommand.trim());
        } else {
          setWindowState(prev => (prev === 'collapsed' ? 'expanded' : prev));
          const greeting = getRandomGreeting();
          setLiveTranscript(greeting);
        }
      },
      onCommandFinalized: (commandText) => {
        executeVoiceCommandRef.current(commandText);
      },
      onInterimTranscript: (interim) => {
        setLiveTranscript(interim);
      },
      onError: (errorMsg) => {
        console.warn('[WakeWordManager]:', errorMsg);
      },
    });

    wakeWordManagerRef.current = manager;

    if (wakeWordEnabled && !isMicMuted) {
      manager.enable();
    }

    return () => {
      manager.disable();
      wakeWordManagerRef.current = null;
    };
  }, []);

  // Synchronize wakeWordEnabled & isMicMuted with WakeWordManager
  useEffect(() => {
    if (!wakeWordManagerRef.current) return;
    if (wakeWordEnabled && !isMicMuted) {
      wakeWordManagerRef.current.enable();
    } else if (wakeWordEnabled && isMicMuted) {
      wakeWordManagerRef.current.setMuted(true);
    } else {
      wakeWordManagerRef.current.disable();
    }
  }, [wakeWordEnabled, isMicMuted]);

  // Synchronize configured wake words list with WakeWordManager
  useEffect(() => {
    wakeWordManagerRef.current?.updateWakeWords(wakeWordsList);
  }, [wakeWordsList]);

  // ── Send Message to FreeLLMAPI Gateway & Multimodal Router ──
  const handleSendMessage = async (customPrompt?: string, mode?: 'chat' | 'image_gen' | 'video_gen', isFromVoice = false) => {
    const text = (customPrompt || input).trim();
    if ((!text && attachments.length === 0) || isLoading) return;

    const userMsg: FreeLLMMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? [...attachments] : undefined,
    };

    const updated = [...messages, userMsg];
    updateMessages(updated);
    if (!customPrompt) setInput('');
    setAttachments([]);
    setIsLoading(true);

    let initialLabel = 'Thinking...';
    let initialLifecycle: 'submitting' | 'connecting' | 'thinking' | 'using_tool' = 'connecting';
    if (mode === 'image_gen' || isImageGenModel(selectedModel) || isImageGenerationRequest(text)) {
      initialLabel = 'Generating illustration (Flux)...';
      initialLifecycle = 'using_tool';
    } else if (mode === 'video_gen' || isVideoGenModel(selectedModel) || isVideoGenerationRequest(text)) {
      initialLabel = 'Generating video stream...';
      initialLifecycle = 'using_tool';
    } else if (attachments.some(a => a.dataUrl && (a.type?.startsWith('image/') || a.type?.includes('pdf') || a.dataUrl?.startsWith('data:image/')))) {
      initialLabel = 'Analyzing attachment with Gemini...';
      initialLifecycle = 'using_tool';
    } else if (/\b(?:telegram|post to telegram|send to telegram)\b/i.test(text)) {
      initialLabel = 'Posting to Telegram...';
      initialLifecycle = 'using_tool';
    } else {
      initialLabel = 'Connecting to FreeLLM...';
      initialLifecycle = 'connecting';
    }
    setLifecycleState(initialLifecycle);
    setActivityLabel(initialLabel);

    // Only speak out response if user specifically spoke via microphone voice input.
    // Typed messages never auto-speak to protect ElevenLabs quota.
    const speakThisResponse = Boolean(isFromVoice && isVoiceModeActive);
    if (speakThisResponse) {
      stopSpeechPlayback();
      voiceSpeechEnabledRef.current = true;
      setVoiceModeStatus('thinking');
      setVoiceSubtitle('Preparing a spoken reply...');
    }
    const requestController = new AbortController();
    activeRequestRef.current = requestController;

    try {
      const chatHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        const sessionToken = localStorage.getItem('np_session_token');
        if (sessionToken) chatHeaders.Authorization = `Bearer ${sessionToken}`;
      } catch {
        // The same-origin session cookie remains available when browser storage is restricted.
      }
      setLifecycleState('thinking');
      setActivityLabel(initialLifecycle === 'using_tool' ? initialLabel : 'Thinking...');
      const response = await fetchWithTimeout(
        '/api/ai/freellm/chat',
        {
          method: 'POST',
          signal: requestController.signal,
          headers: chatHeaders,
          credentials: 'include',
          body: JSON.stringify({
            messages: updated
              .filter(m => m.id !== 'msg-greeting' && !m.id.startsWith('err-'))
              .map(m => ({
                role: m.role,
                content: m.content,
                attachments: m.attachments,
              })),
            model: selectedModel || 'auto',
            mode: mode || undefined,
            stream: true,
          }),
        },
        600000
      );

      let data: any;
      let streamedMessageId: string | null = null;
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        if (!response.ok || !response.body) {
          throw new Error(`Gateway stream failed with HTTP ${response.status}.`);
        }
        streamedMessageId = `asst-${Date.now()}`;
        let streamedContent = '';
        let streamedModel = selectedModel;
        let pendingSpeechText = '';
        const responseSpeechGeneration = speechGenerationRef.current;
        updateMessages(prev => [...prev, {
          id: streamedMessageId!, role: 'assistant', content: '', timestamp: Date.now(), model: streamedModel,
        }]);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let ended = false;
        const handleLine = (line: string) => {
          if (!line.startsWith('data:')) return;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') { ended = true; return; }
          try {
            const event = JSON.parse(payload);
            if (typeof event.model === 'string') streamedModel = event.model;
            const delta = event.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta) {
              setLifecycleState('streaming');
              streamedContent += delta;
              updateMessages(prev => prev.map(message => message.id === streamedMessageId
                ? { ...message, content: streamedContent, model: streamedModel }
                : message));
            }
            if (event.error?.message) throw new Error(event.error.message);
          } catch (error: unknown) {
            if (error instanceof SyntaxError) return;
            throw error;
          }
        };
        while (!ended) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) handleLine(line);
        }
        buffer += decoder.decode();
        if (buffer.trim()) handleLine(buffer);
        if (requestController.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
        if (speakThisResponse && voiceSpeechEnabledRef.current && streamedContent.trim()) {
          void playSpeech(streamedContent, streamedMessageId);
        }
        data = { ok: true, message: { content: streamedContent }, model: streamedModel, provider: 'FreeLLMAPI Gateway' };
      } else {
        data = await response.json().catch(() => null);
      }

      if (!response.ok || !data?.ok) {
        const errorText =
          data?.error ||
          `Gateway Error (${response.status}): Could not get response from FreeLLMAPI.`;
        throw new Error(errorText);
      }

      const assistantMsg: FreeLLMMessage = {
        id: streamedMessageId || `asst-${Date.now()}`,
        role: 'assistant',
        content: data.message?.content || 'No text content returned.',
        timestamp: Date.now(),
        model: data.model || selectedModel,
        provider: data.provider,
        fallbackFrom: data.fallbackFrom,
        latencyMs: data.latencyMs,
        generatedMedia: data.generatedMedia,
      };

      updateMessages(prev => streamedMessageId
        ? prev.map(message => message.id === streamedMessageId ? assistantMsg : message)
        : [...prev, assistantMsg]);
      setGatewayOnline(true);
      if (data.latencyMs) setGatewayLatency(data.latencyMs);
      setLifecycleState('completed');

      // If in Voice Mode, automatically speak out the response
      if (speakThisResponse && !streamedMessageId && assistantMsg.content) {
        setVoiceSubtitle(assistantMsg.content.slice(0, 120));
        void playSpeech(assistantMsg.content, assistantMsg.id);
      }
    } catch (err: any) {
      if (requestController.signal.aborted) {
        setLifecycleState('cancelled');
        return;
      }
      setLifecycleState('failed');
      const friendlyError = formatFetchError(err);
      const errorMsg: FreeLLMMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ **FreeLLM Notice:**\n${friendlyError}`,
        timestamp: Date.now(),
        model: selectedModel,
      };
      updateMessages(prev => [...prev, errorMsg]);
      setGatewayOnline(false);
      setGatewayError(friendlyError);
    } finally {
      activeRequestRef.current = null;
      setIsLoading(false);
      setActivityLabel('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleClearHistory = () => {
    if (window.confirm('Clear all FreeLLM chat history and media?')) {
      const defaultMsg = getDefaultGreeting();
      const newConvId = `conv-${Date.now()}`;
      const newConv: FreeLLMConversation = {
        id: newConvId,
        title: 'New Chat',
        messages: [defaultMsg],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setConversations([newConv]);
      setActiveConversationId(newConvId);
      activeConversationIdRef.current = newConvId;
      setMessages([defaultMsg]);
      try {
        localStorage.removeItem(STORAGE_KEY_HISTORY);
        localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify([newConv]));
        localStorage.setItem(STORAGE_KEY_ACTIVE_CONV, newConvId);
      } catch {}
    }
  };

  const toggleVoiceMode = () => {
    if (isVoiceModeActive) {
      voiceModeActiveRef.current = false;
      voiceSpeechEnabledRef.current = false;
      if (voiceEndTimerRef.current) clearTimeout(voiceEndTimerRef.current);
      voiceTranscriptRef.current = '';
      stopSpeechPlayback();
      stopDictation();
      setVoiceModeStatus('idle');
      setIsVoiceModeActive(false);
      return;
    }
    voiceModeActiveRef.current = true;
    voiceTranscriptRef.current = '';
    setIsMicMuted(false);
    setVoiceSubtitle('Listening for your next phrase...');
    setVoiceModeStatus('listening');
    setIsVoiceModeActive(true);
  };

  voiceSubmitRef.current = (prompt: string) => {
    void handleSendMessage(prompt, 'chat', true);
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ── Drag & Drop Event Handlers ──
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = () => {
    setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // RENDER: Collapsed State (Movable Floating AI Moon Button)
  // ─────────────────────────────────────────────────────────────
  if (windowState === 'collapsed') {
    return (
      <>
      <TelegramQuickSend
        isPhone={isPhone}
        theme={isDark ? 'dark' : 'light'}
        anchor={btnPos}
        isDragging={isDragging}
        onTriggerPointerDown={event => handlePointerDown(event, false)}
        shouldSuppressTriggerClick={() => {
          if (!ignoreNextTelegramTriggerClickRef.current) return false;
          ignoreNextTelegramTriggerClickRef.current = false;
          return true;
        }}
      />
      <button
        onPointerDown={handlePointerDown}
        className="freellm-moon-button"
        aria-label={
          wakeWordEnabled && !isMicMuted
            ? `Sami Voice Assistant listening ("${wakeWordsList[0] || 'Sami'}") - Click to expand`
            : 'Open Multimodal FreeLLM Assistant (Movable AI Moon Button)'
        }
        title={
          wakeWordEnabled && !isMicMuted
            ? `🎙️ Sami Voice Assistant is actively listening for "${wakeWordsList[0] || 'Sami'}" or "Wake up"`
            : '🌙 FreeLLM Multimodal AI Assistant • Drag to reposition, click to expand'
        }
        style={{
          position: 'fixed',
          ...(btnPos
            ? { left: btnPos.x, top: btnPos.y, right: 'auto', bottom: 'auto' }
            : {
                right: isPhone ? 76 : 88,
                bottom: isPhone ? 84 : 28,
              }),
          zIndex: 44,
          width: 52,
          height: 52,
          borderRadius: '50%',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isDark
            ? 'rgba(24, 24, 32, 0.72)'
            : 'rgba(255, 255, 255, 0.78)',
          backdropFilter: 'blur(24px) saturate(170%)',
          WebkitBackdropFilter: 'blur(24px) saturate(170%)',
          border: isDark
            ? '1.5px solid rgba(255, 255, 255, 0.22)'
            : '1.5px solid rgba(15, 23, 42, 0.18)',
          boxShadow: isDragging
            ? (isDark
                ? '0 16px 36px rgba(0, 0, 0, 0.7), 0 0 28px var(--accent-glow)'
                : '0 16px 36px rgba(15, 23, 42, 0.18), 0 0 24px var(--accent-glow)')
            : wakeWordEnabled && !isMicMuted
            ? (isDark
                ? '0 0 24px rgba(16, 185, 129, 0.6), 0 8px 24px rgba(0, 0, 0, 0.5)'
                : '0 0 20px rgba(16, 185, 129, 0.5), 0 8px 24px rgba(15, 23, 42, 0.15)')
            : (isDark
                ? '0 8px 24px rgba(0, 0, 0, 0.4), 0 0 16px var(--accent-glow)'
                : '0 8px 24px rgba(15, 23, 42, 0.1), 0 0 14px var(--accent-glow)'),
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease',
          transform: isDragging ? 'scale(1.14)' : undefined,
        }}
        onMouseEnter={e => {
          if (!isDragging) e.currentTarget.style.transform = 'scale(1.08)';
        }}
        onMouseLeave={e => {
          if (!isDragging) e.currentTarget.style.transform = 'scale(1)';
        }}
      >
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* Lighter Translucent Crescent Moon */}
          <Moon
            style={{
              width: 25,
              height: 25,
              color: isDark ? 'var(--accent-color)' : '#0284c7',
              filter: 'drop-shadow(0 0 6px var(--accent-glow))',
              transform: 'rotate(-15deg)',
            }}
          />
          {/* Sparkle Badge */}
          <Sparkles
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              width: 14,
              height: 14,
              color: isDark ? '#bae6fd' : '#0369a1',
              filter: 'drop-shadow(0 0 4px var(--accent-glow))',
              animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            }}
          />
          {/* Live Online Dot */}
          <span
            style={{
              position: 'absolute',
              bottom: -4,
              left: -4,
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: gatewayOnline === false ? '#ef4444' : '#10b981',
              border: isDark ? '1.5px solid #0d0d11' : '1.5px solid #ffffff',
              boxShadow: gatewayOnline === false ? '0 0 6px #ef4444' : '0 0 6px #10b981',
            }}
          />
          {/* Always-Available Voice Listening Indicator Badge */}
          {wakeWordEnabled && !isMicMuted && (
            <span
              title={`Voice assistant listening for "${wakeWordsList[0] || 'Sami'}" or "Wake up"`}
              style={{
                position: 'absolute',
                top: -6,
                left: -6,
                width: 17,
                height: 17,
                borderRadius: '50%',
                background: voiceLifecycleState === 'listening_wake_word' ? '#10b981' : '#38bdf8',
                border: isDark ? '1.5px solid #0d0d11' : '1.5px solid #ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 10px rgba(16, 185, 129, 0.8)',
                animation: 'pulse 1.8s infinite',
              }}
            >
              <Mic style={{ width: 10, height: 10, color: '#ffffff' }} />
            </span>
          )}
        </div>
      </button>
      </>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER: Expanded / Maximized State (Interactive Multimodal Chat Window)
  // ─────────────────────────────────────────────────────────────
  const isMax = windowState === 'maximized';

  return (
    <>
    <TelegramQuickSend
      isPhone={isPhone}
      theme={isDark ? 'dark' : 'light'}
      anchor={btnPos}
      showTrigger={false}
    />
    <div
      role="dialog"
      aria-label="FreeLLM Multimodal Assistant Window"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        position: 'fixed',
        inset: isPhone || isMax ? 0 : 'auto',
        right: isPhone || isMax ? 0 : 20,
        bottom: isPhone || isMax ? 0 : 20,
        width: isPhone || isMax ? '100vw' : isSidebarOpen ? 'min(760px, calc(100vw - 32px))' : 'min(500px, calc(100vw - 32px))',
        height: isPhone || isMax ? '100vh' : 'min(730px, calc(100vh - 40px))',
        zIndex: 85,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--v-glass-bg-card)',
        backdropFilter: 'blur(32px) saturate(180%)',
        WebkitBackdropFilter: 'blur(32px) saturate(180%)',
        border: isPhone ? 'none' : isDragOver ? '2px dashed var(--accent-color)' : '1.5px solid var(--v-glass-border)',
        borderRadius: isPhone || isMax ? 0 : 24,
        boxShadow: 'var(--v-shadow-spatial)',
        overflow: 'hidden',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-system)',
        transition: 'width 0.2s cubic-bezier(0.16, 1, 0.3, 1), height 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* ── Hidden File Picker ── */}
      <input
        type="file"
        ref={fileInputRef}
        multiple
        accept="image/*,.pdf,.txt,.md,.json,.csv,.js,.ts,.tsx,.py,.html,.css,audio/*,video/*"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {/* ── Header ── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: isDark ? 'rgba(20, 20, 28, 0.72)' : 'rgba(248, 250, 252, 0.88)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--v-glass-border-subtle)',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Hamburger Menu Toggle Button */}
          <button
            onClick={() => setIsSidebarOpen(prev => !prev)}
            aria-label="Toggle Conversation History"
            title={isSidebarOpen ? 'Close chat sidebar' : 'Open chat history'}
            style={{
              background: isSidebarOpen
                ? 'var(--accent-glow)'
                : 'var(--v-glass-bg-subtle)',
              border: isSidebarOpen
                ? '1px solid var(--accent-color)'
                : '1px solid var(--v-glass-border-subtle)',
              borderRadius: 8,
              padding: 6,
              color: isSidebarOpen
                ? 'var(--accent-color)'
                : 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            <Menu style={{ width: 16, height: 16 }} />
          </button>

          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: 'var(--accent-glow)',
              border: '1.5px solid var(--accent-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 14px var(--accent-glow)',
            }}
          >
            <Moon style={{ width: 17, height: 17, color: 'var(--accent-color)', transform: 'rotate(-15deg)' }} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13.5, letterSpacing: '0.01em', color: 'var(--text-primary)' }}>
                FreeLLM Moon Assistant
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  padding: '1px 5px',
                  borderRadius: 6,
                  background: 'var(--v-glass-bg-subtle)',
                  border: '1px solid var(--v-glass-border-subtle)',
                  color: 'var(--accent-color)',
                  letterSpacing: '0.05em',
                }}
              >
                Multimodal
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: gatewayOnline === true ? '#10b981' : gatewayOnline === false ? '#ef4444' : '#f59e0b',
                  boxShadow: gatewayOnline === true ? '0 0 6px #10b981' : undefined,
                }}
              />
              <span>
                {gatewayOnline === true
                  ? `Online ${gatewayLatency ? `(${gatewayLatency}ms)` : ''}`
                  : gatewayOnline === false
                  ? 'Fallback Ready (Gemini/Groq)'
                  : 'Checking Service...'}
              </span>
            </div>
          </div>
        </div>

        {/* Window Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Voice Mode Toggle */}
          <button
            onClick={toggleVoiceMode}
            aria-label="Toggle Voice Mode"
            title="Toggle Voice Mode"
            style={{
              background: isVoiceModeActive
                ? 'var(--accent-glow)'
                : 'var(--v-glass-bg-subtle)',
              border: isVoiceModeActive
                ? '1px solid var(--accent-color)'
                : '1px solid var(--v-glass-border-subtle)',
              borderRadius: 8,
              padding: '5px 8px',
              color: isVoiceModeActive ? 'var(--accent-color)' : 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              fontWeight: 600,
              transition: 'all 0.15s ease',
            }}
          >
            <Headphones style={{ width: 14, height: 14 }} />
            {!isPhone && <span>Voice</span>}
          </button>

          {/* Dedicated Neural Voice Model Selector Button */}
          <button
            onClick={() => {
              setSettingsActiveTab('voice');
              setShowSettingsModal(prev => (showSettingsModal && settingsActiveTab === 'voice' ? false : true));
            }}
            aria-label="Change Neural Voice Model"
            title="Change AI Voice Model & Persona (ElevenLabs 20+ Voices)"
            style={{
              background: showSettingsModal && settingsActiveTab === 'voice'
                ? 'var(--accent-glow)'
                : 'var(--v-glass-bg-subtle)',
              border: showSettingsModal && settingsActiveTab === 'voice'
                ? '1px solid var(--accent-color)'
                : '1px solid var(--v-glass-border-subtle)',
              borderRadius: 8,
              padding: '5px 8px',
              color: showSettingsModal && settingsActiveTab === 'voice' ? 'var(--accent-color)' : 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              fontWeight: 600,
              transition: 'all 0.15s ease',
            }}
          >
            <Volume2 style={{ width: 14, height: 14, color: '#c084fc' }} />
            {!isPhone && (
              <span style={{ maxWidth: 85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(() => {
                  const currentProv = voiceConfigData?.providers?.find((p: any) => p.id === selectedVoiceProvider);
                  const matched = currentProv?.voices?.find((v: any) => v.id === selectedVoiceId);
                  if (matched) return matched.name.split(' ')[0];
                  if (selectedVoiceId) return selectedVoiceId.slice(0, 6);
                  return 'Voice';
                })()}
              </span>
            )}
          </button>

          {/* Settings Button */}
          <button
            onClick={() => setShowSettingsModal(prev => !prev)}
            aria-label="FreeLLM Gateway Settings"
            title="Configure Gateway URL & Unified API Key"
            style={{
              background: showSettingsModal
                ? 'var(--accent-glow)'
                : 'var(--v-glass-bg-subtle)',
              border: showSettingsModal
                ? '1px solid var(--accent-color)'
                : '1px solid var(--v-glass-border-subtle)',
              borderRadius: 8,
              padding: 6,
              color: showSettingsModal ? 'var(--accent-color)' : 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            <Settings style={{ width: 14, height: 14 }} />
          </button>

          {/* Clear History */}
          <button
            onClick={handleClearHistory}
            aria-label="Clear chat history"
            title="Clear chat messages"
            style={{
              background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.06)',
              border: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.1)'),
              borderRadius: 8,
              padding: 6,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Trash2 style={{ width: 14, height: 14 }} />
          </button>

          {/* Maximize / Restore Toggle (desktop) */}
          {!isPhone && (
            <button
              onClick={() => setWindowState(prev => (prev === 'maximized' ? 'expanded' : 'maximized'))}
              aria-label={isMax ? 'Restore window size' : 'Maximize window'}
              title={isMax ? 'Restore' : 'Maximize'}
              style={{
                background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.06)',
                border: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.1)'),
                borderRadius: 8,
                padding: 6,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isMax ? <Minimize2 style={{ width: 14, height: 14 }} /> : <Maximize2 style={{ width: 14, height: 14 }} />}
            </button>
          )}

          {/* Minimize / Collapse to Moon Button */}
          <button
            onClick={() => setWindowState('collapsed')}
            aria-label="Collapse to floating Moon button"
            title="Collapse to Moon button"
            style={{
              background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.06)',
              border: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.1)'),
              borderRadius: 8,
              padding: 6,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </header>

      {/* ── Main Workspace Body (Sidebar + Chat Area) ── */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* ── Collapsible & Slide-Over Conversation History Sidebar ── */}
        {isSidebarOpen && (
          <aside
            style={{
              width: isPhone ? '100%' : 240,
              position: isPhone ? 'absolute' : 'relative',
              inset: isPhone ? 0 : 'auto',
              zIndex: isPhone ? 50 : 1,
              display: 'flex',
              flexDirection: 'column',
              background: isDark ? 'rgba(18, 14, 34, 0.96)' : 'rgba(248, 250, 252, 0.97)',
              borderRight: isPhone ? 'none' : '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)'),
              padding: '12px 10px',
              boxSizing: 'border-box',
              overflow: 'hidden',
              backdropFilter: isPhone ? 'blur(20px)' : undefined,
              boxShadow: isPhone ? '0 10px 30px rgba(0,0,0,0.5)' : undefined,
            }}
          >
            {/* Sidebar Top: New Chat + Close on mobile */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <button
                onClick={handleNewChat}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: isDark
                    ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.35), rgba(99, 102, 241, 0.35))'
                    : 'linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(99, 102, 241, 0.18))',
                  border: isDark ? '1px solid rgba(168, 85, 247, 0.5)' : '1px solid rgba(168, 85, 247, 0.35)',
                  color: isDark ? '#ffffff' : '#6d28d9',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <Plus style={{ width: 14, height: 14 }} />
                <span>New Chat</span>
              </button>
              {isPhone && (
                <button
                  onClick={() => setIsSidebarOpen(false)}
                  style={{
                    background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.06)',
                    border: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.1)'),
                    color: 'var(--text-muted)',
                    padding: 6,
                    cursor: 'pointer',
                    borderRadius: 8,
                    display: 'flex',
                  }}
                  title="Close sidebar"
                >
                  <X style={{ width: 16, height: 16 }} />
                </button>
              )}
            </div>

            {/* Search Chats Input */}
            <div style={{ position: 'relative', marginBottom: 10 }}>
              <Search
                style={{
                  position: 'absolute',
                  left: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 12,
                  height: 12,
                  color: 'var(--text-muted)',
                }}
              />
              <input
                type="text"
                value={conversationSearch}
                onChange={e => setConversationSearch(e.target.value)}
                placeholder="Search chats..."
                style={{
                  width: '100%',
                  padding: '5px 8px 5px 26px',
                  borderRadius: 8,
                  background: isDark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(15, 23, 42, 0.05)',
                  border: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 23, 42, 0.1)'),
                  color: 'var(--text-primary)',
                  fontSize: 11,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Conversation List */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                paddingRight: 2,
              }}
            >
              {(() => {
                const filtered = conversations.filter(c =>
                  !conversationSearch.trim() || c.title.toLowerCase().includes(conversationSearch.toLowerCase().trim())
                );
                if (filtered.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '24px 8px', color: 'var(--text-muted)', fontSize: 11 }}>
                      {conversationSearch ? 'No chats match search' : 'No previous chats yet'}
                    </div>
                  );
                }
                return filtered.map(conv => {
                  const isActive = conv.id === activeConversationId;
                  const isEditing = editingConvId === conv.id;

                  if (isEditing) {
                    return (
                      <div
                        key={conv.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 6px',
                          borderRadius: 8,
                          background: isDark ? 'rgba(168, 85, 247, 0.2)' : 'rgba(168, 85, 247, 0.12)',
                        }}
                      >
                        <input
                          type="text"
                          value={editingTitleText}
                          onChange={e => setEditingTitleText(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRenameConversation(conv.id, editingTitleText);
                            if (e.key === 'Escape') setEditingConvId(null);
                          }}
                          autoFocus
                          style={{
                            flex: 1,
                            background: isDark ? 'rgba(0, 0, 0, 0.4)' : '#ffffff',
                            border: '1px solid #a855f7',
                            borderRadius: 4,
                            padding: '3px 6px',
                            color: 'var(--text-primary)',
                            fontSize: 11,
                            outline: 'none',
                          }}
                        />
                        <button
                          onClick={() => handleRenameConversation(conv.id, editingTitleText)}
                          style={{ background: 'none', border: 'none', color: '#10b981', cursor: 'pointer', padding: 2 }}
                          title="Save title"
                        >
                          <Check style={{ width: 13, height: 13 }} />
                        </button>
                        <button
                          onClick={() => setEditingConvId(null)}
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}
                          title="Cancel"
                        >
                          <X style={{ width: 13, height: 13 }} />
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={conv.id}
                      onClick={() => handleSelectConversation(conv.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '7px 8px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        background: isActive
                          ? (isDark ? 'rgba(168, 85, 247, 0.22)' : 'rgba(168, 85, 247, 0.14)')
                          : 'transparent',
                        border: isActive
                          ? (isDark ? '1px solid rgba(192, 132, 252, 0.4)' : '1px solid rgba(168, 85, 247, 0.35)')
                          : '1px solid transparent',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={e => {
                        if (!isActive) {
                          e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 23, 42, 0.05)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'transparent';
                        }
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0, paddingRight: 6 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: isActive ? 600 : 500,
                            color: isActive ? (isDark ? '#f8fafc' : '#581c87') : 'var(--text-primary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {conv.title || 'Untitled Chat'}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                          {formatConversationDate(conv.updatedAt || conv.createdAt)}
                        </div>
                      </div>

                      {/* Actions: Rename & Delete */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setEditingConvId(conv.id);
                            setEditingTitleText(conv.title);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: 3,
                            borderRadius: 4,
                          }}
                          title="Rename chat"
                        >
                          <Edit2 style={{ width: 11, height: 11 }} />
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            if (deletingConvId === conv.id) {
                              handleDeleteConversation(conv.id);
                            } else {
                              setDeletingConvId(conv.id);
                              setTimeout(() => setDeletingConvId(null), 3000);
                            }
                          }}
                          style={{
                            background: deletingConvId === conv.id ? 'rgba(239, 68, 68, 0.2)' : 'none',
                            border: deletingConvId === conv.id ? '1px solid rgba(239, 68, 68, 0.4)' : 'none',
                            color: deletingConvId === conv.id ? '#ef4444' : 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: 3,
                            borderRadius: 4,
                          }}
                          title={deletingConvId === conv.id ? 'Click to confirm delete' : 'Delete chat'}
                        >
                          <Trash2 style={{ width: 11, height: 11 }} />
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </aside>
        )}

        {/* ── Primary Chat Area ── */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* ── Settings Panel / Override Drawer ── */}
          {showSettingsModal && (
            <div
              style={{
                padding: '12px 16px',
                background: isDark ? 'rgba(20, 16, 36, 0.98)' : 'rgba(248, 250, 252, 0.98)',
                borderBottom: '1px solid ' + (isDark ? 'rgba(168, 85, 247, 0.35)' : 'rgba(168, 85, 247, 0.25)'),
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setSettingsActiveTab('gateway')}
                    style={{
                      background: settingsActiveTab === 'gateway' ? (isDark ? 'rgba(168, 85, 247, 0.25)' : 'rgba(168, 85, 247, 0.15)') : 'transparent',
                      border: '1px solid ' + (settingsActiveTab === 'gateway' ? 'rgba(168, 85, 247, 0.4)' : 'transparent'),
                      borderRadius: 6,
                      padding: '4px 8px',
                      color: settingsActiveTab === 'gateway' ? '#c084fc' : 'var(--text-muted)',
                      fontWeight: settingsActiveTab === 'gateway' ? 600 : 400,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11.5,
                    }}
                  >
                    <Settings style={{ width: 13, height: 13 }} />
                    LLM Gateway
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettingsActiveTab('voice')}
                    style={{
                      background: settingsActiveTab === 'voice' ? (isDark ? 'rgba(168, 85, 247, 0.25)' : 'rgba(168, 85, 247, 0.15)') : 'transparent',
                      border: '1px solid ' + (settingsActiveTab === 'voice' ? 'rgba(168, 85, 247, 0.4)' : 'transparent'),
                      borderRadius: 6,
                      padding: '4px 8px',
                      color: settingsActiveTab === 'voice' ? '#c084fc' : 'var(--text-muted)',
                      fontWeight: settingsActiveTab === 'voice' ? 600 : 400,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11.5,
                    }}
                  >
                    <Volume2 style={{ width: 13, height: 13 }} />
                    Neural Voice (TTS)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettingsActiveTab('wake')}
                    style={{
                      background: settingsActiveTab === 'wake' ? (isDark ? 'rgba(168, 85, 247, 0.25)' : 'rgba(168, 85, 247, 0.15)') : 'transparent',
                      border: '1px solid ' + (settingsActiveTab === 'wake' ? 'rgba(168, 85, 247, 0.4)' : 'transparent'),
                      borderRadius: 6,
                      padding: '4px 8px',
                      color: settingsActiveTab === 'wake' ? '#c084fc' : 'var(--text-muted)',
                      fontWeight: settingsActiveTab === 'wake' ? 600 : 400,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11.5,
                    }}
                  >
                    <Mic style={{ width: 13, height: 13 }} />
                    Wake Word & Assistant
                  </button>
                </div>
                <button
                  onClick={() => setShowSettingsModal(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 2,
                  }}
                >
                  <X style={{ width: 14, height: 14 }} />
                </button>
              </div>

              {settingsActiveTab === 'gateway' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
                        FreeLLM API Base URL (`/v1`):
                      </label>
                      <input
                        type="text"
                        value={configUrl}
                        onChange={e => setConfigUrl(e.target.value)}
                        placeholder="https://free-llm-api-7fue.onrender.com/v1"
                        style={{
                          width: '100%',
                          background: isDark ? 'rgba(0, 0, 0, 0.45)' : '#ffffff',
                          border: '1px solid ' + (isDark ? 'rgba(168, 85, 247, 0.35)' : 'rgba(15, 23, 42, 0.18)'),
                          color: 'var(--text-primary)',
                          borderRadius: 6,
                          padding: '6px 8px',
                          fontSize: 11.5,
                          outline: 'none',
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
                          Unified API Key (`FREELLM_API_KEY` / `UNIFIED_API_KEY`):
                        </label>
                        <span
                          style={{
                            fontSize: 10.5,
                            color: keyConfigured ? '#10b981' : '#f59e0b',
                            fontWeight: 600,
                          }}
                        >
                          {keyConfigured ? `✓ Server Key Active (${maskedKey || '••••'})` : '⚠️ Key Not Set'}
                        </span>
                      </div>
                      <input
                        type="password"
                        value={configKeyInput}
                        onChange={e => setConfigKeyInput(e.target.value)}
                        placeholder={
                          keyConfigured
                            ? 'Paste a new Unified API Key to replace current key...'
                            : 'Paste your FreeLLMAPI Unified API Key here...'
                        }
                        style={{
                          width: '100%',
                          background: isDark ? 'rgba(0, 0, 0, 0.45)' : '#ffffff',
                          border: '1px solid ' + (isDark ? 'rgba(168, 85, 247, 0.35)' : 'rgba(15, 23, 42, 0.18)'),
                          color: 'var(--text-primary)',
                          borderRadius: 6,
                          padding: '6px 8px',
                          fontSize: 11.5,
                          outline: 'none',
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2, gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: gatewayOnline ? '#10b981' : gatewayError ? '#ef4444' : '#94a3b8', flex: 1, minWidth: 160 }}>
                      {isTestingGateway
                        ? 'Testing connection...'
                        : gatewayOnline
                        ? `● Online (${gatewayLatency ?? 0}ms · ${catalogModels.length} ready models)`
                        : gatewayError
                        ? `⚠️ ${gatewayError.slice(0, 85)}${gatewayError.length > 85 ? '...' : ''}`
                        : '● Ready'}
                    </span>

                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => saveGatewaySettings(true)}
                        disabled={isTestingGateway}
                        style={{
                          background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)',
                          border: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(15, 23, 42, 0.15)'),
                          borderRadius: 6,
                          padding: '4px 10px',
                          color: 'var(--text-secondary)',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        Reset
                      </button>

                      <button
                        onClick={() => saveGatewaySettings(false)}
                        disabled={isTestingGateway}
                        style={{
                          background: 'linear-gradient(135deg, #a855f7, #6366f1)',
                          border: 'none',
                          borderRadius: 6,
                          padding: '4px 12px',
                          color: '#fff',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: isTestingGateway ? 'default' : 'pointer',
                        }}
                      >
                        {isTestingGateway ? 'Connecting...' : 'Save & Connect'}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {settingsActiveTab === 'voice' && (
                /* ── Neural Voice (TTS) Settings Tab ── */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
                        TTS Provider:
                      </label>
                      <select
                        value={selectedVoiceProvider}
                        onChange={e => {
                          const newProv = e.target.value;
                          const defaultVoice =
                            newProv === 'elevenlabs'
                              ? (voiceConfigData?.activeVoiceId || 'pNInz6obpgDQGcFmaJgB')
                              : newProv === 'piper'
                              ? 'en_US-lessac-medium'
                              : newProv === 'openai'
                              ? 'coral'
                              : 'en-US';
                          saveVoiceSettings(newProv, defaultVoice, voiceSpeed);
                        }}
                        style={{
                          width: '100%',
                          background: isDark ? 'rgba(0, 0, 0, 0.45)' : '#ffffff',
                          border: '1px solid ' + (isDark ? 'rgba(168, 85, 247, 0.35)' : 'rgba(15, 23, 42, 0.18)'),
                          color: 'var(--text-primary)',
                          borderRadius: 6,
                          padding: '6px 8px',
                          fontSize: 11.5,
                          outline: 'none',
                        }}
                      >
                        <option value="elevenlabs">ElevenLabs Neural (Free Tier: 10k chars/mo)</option>
                        <option value="piper">Piper Self-Hosted (Offline, Zero Quota)</option>
                        <option value="free_tts">Free Neural Audio (Zero Setup Required)</option>
                        <option value="openai">OpenAI Audio Speech (TTS-1)</option>
                      </select>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
                        Voice Persona:
                      </label>
                      <select
                        value={selectedVoiceId}
                        onChange={e => saveVoiceSettings(selectedVoiceProvider, e.target.value, voiceSpeed)}
                        style={{
                          width: '100%',
                          background: isDark ? 'rgba(0, 0, 0, 0.45)' : '#ffffff',
                          border: '1px solid ' + (isDark ? 'rgba(168, 85, 247, 0.35)' : 'rgba(15, 23, 42, 0.18)'),
                          color: 'var(--text-primary)',
                          borderRadius: 6,
                          padding: '6px 8px',
                          fontSize: 11.5,
                          outline: 'none',
                        }}
                      >
                        {(() => {
                          const currentProviderInfo = voiceConfigData?.providers?.find(
                            (p: any) => p.id === selectedVoiceProvider
                          );
                          const voices = currentProviderInfo?.voices || [];
                          const hasSelectedInList = voices.some((v: any) => v.id === selectedVoiceId);
                          return (
                            <>
                              {!hasSelectedInList && selectedVoiceId && (
                                <option value={selectedVoiceId}>
                                  Custom Voice ({selectedVoiceId.slice(0, 8)}...)
                                </option>
                              )}
                              {voices.map((v: any) => (
                                <option key={v.id} value={v.id}>
                                  {v.freeTierReady ? `🌟 ${v.name} (Free API)` : v.requiresPaidPlan ? `💎 ${v.name} (Paid Plan)` : v.name}
                                </option>
                              ))}
                            </>
                          );
                        })()}
                      </select>

                      {/* Direct Custom Voice ID Input */}
                      {selectedVoiceProvider === 'elevenlabs' && (
                        <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                          <input
                            type="text"
                            placeholder="Or enter custom Voice ID (e.g. C1npRmjB19a6yNkEucvx)"
                            id="np-custom-voice-id-input"
                            style={{
                              flex: 1,
                              background: isDark ? 'rgba(0, 0, 0, 0.45)' : '#ffffff',
                              border: '1px solid ' + (isDark ? 'rgba(168, 85, 247, 0.25)' : 'rgba(15, 23, 42, 0.15)'),
                              color: 'var(--text-primary)',
                              borderRadius: 6,
                              padding: '4px 8px',
                              fontSize: 10.5,
                              outline: 'none',
                              fontFamily: 'monospace',
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const inputEl = document.getElementById('np-custom-voice-id-input') as HTMLInputElement;
                              const val = inputEl?.value?.trim();
                              if (val && val.length > 5) {
                                saveVoiceSettings(selectedVoiceProvider, val, voiceSpeed);
                                inputEl.value = '';
                              }
                            }}
                            style={{
                              background: 'rgba(168, 85, 247, 0.2)',
                              border: '1px solid rgba(168, 85, 247, 0.4)',
                              borderRadius: 6,
                              padding: '3px 8px',
                              color: '#c084fc',
                              fontSize: 10.5,
                              fontWeight: 500,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Set Voice ID
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
                        Speaking Speed:
                      </label>
                      <select
                        value={voiceSpeed}
                        onChange={e => saveVoiceSettings(selectedVoiceProvider, selectedVoiceId, Number(e.target.value) || 1.0)}
                        style={{
                          background: isDark ? 'rgba(0, 0, 0, 0.45)' : '#ffffff',
                          border: '1px solid ' + (isDark ? 'rgba(168, 85, 247, 0.35)' : 'rgba(15, 23, 42, 0.18)'),
                          color: 'var(--text-primary)',
                          borderRadius: 6,
                          padding: '4px 6px',
                          fontSize: 11,
                          outline: 'none',
                        }}
                      >
                        <option value={0.8}>0.8x (Slower)</option>
                        <option value={1.0}>1.0x (Normal)</option>
                        <option value={1.2}>1.2x (Faster)</option>
                        <option value={1.5}>1.5x (Fast)</option>
                      </select>
                    </div>

                    {/* Preview Test Voice Button */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {speechState.messageId === 'voice-settings-test' && (speechState.status === 'playing' || speechState.status === 'paused') ? (
                        <>
                          <button
                            type="button"
                            onClick={speechState.status === 'playing' ? pauseSpeechPlayback : resumeSpeechPlayback}
                            style={{
                              background: 'rgba(168, 85, 247, 0.2)',
                              border: '1px solid rgba(168, 85, 247, 0.4)',
                              borderRadius: 6,
                              padding: '4px 8px',
                              color: '#c084fc',
                              fontSize: 11,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            {speechState.status === 'playing' ? <Pause size={12} /> : <Play size={12} />}
                            {speechState.status === 'playing' ? 'Pause' : 'Resume'}
                          </button>
                          <button
                            type="button"
                            onClick={stopSpeechPlayback}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--text-muted)',
                              fontSize: 11,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 3,
                            }}
                          >
                            <VolumeX size={12} /> Stop
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void playSpeech('Hello! This is a preview of your NightPlanner neural voice assistant.', 'voice-settings-test')}
                          disabled={speechState.status === 'loading'}
                          style={{
                            background: 'rgba(168, 85, 247, 0.15)',
                            border: '1px solid rgba(168, 85, 247, 0.35)',
                            borderRadius: 6,
                            padding: '4px 10px',
                            color: '#c084fc',
                            fontSize: 11,
                            fontWeight: 500,
                            cursor: speechState.status === 'loading' ? 'wait' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          {speechState.status === 'loading' && speechState.messageId === 'voice-settings-test' ? (
                            <>
                              <LoaderCircle size={12} style={{ animation: 'sams-action-spin .8s linear infinite' }} />
                              <span>Synthesizing...</span>
                            </>
                          ) : (
                            <>
                              <Volume2 size={12} />
                              <span>Test Voice Audio</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Provider Setup & Status Badge */}
                  {(() => {
                    const currentProv = voiceConfigData?.providers?.find((p: any) => p.id === selectedVoiceProvider);
                    const isConfigured = currentProv?.isConfigured;
                    return (
                      <div
                        style={{
                          padding: '8px 10px',
                          borderRadius: 8,
                          background: isConfigured ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                          border: '1px solid ' + (isConfigured ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.25)'),
                          fontSize: 11,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <strong style={{ color: isConfigured ? '#34d399' : '#fbbf24' }}>
                            {isConfigured ? `✓ ${currentProv?.name || 'Provider'} Active` : `⚠️ ${currentProv?.name || 'Provider'} Not Configured`}
                          </strong>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            Server-Side Credential
                          </span>
                        </div>
                        <span style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                          {currentProv?.freeTierNote}
                        </span>
                        {currentProv?.setupDocs && !isConfigured && (
                          <span style={{ color: '#fbbf24', fontSize: 10.5, marginTop: 2 }}>
                            {currentProv.setupDocs}
                          </span>
                        )}

                        {/* ElevenLabs Key Rotation Pool Telemetry */}
                        {currentProv?.id === 'elevenlabs' && currentProv?.keyPool && (
                          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 10.5 }}>
                                Key Rotation Pool ({currentProv.keyPool.activeKeys}/{currentProv.keyPool.totalKeys} Active)
                              </span>
                              <span style={{ fontSize: 10, color: currentProv.keyPool.exhaustedKeys > 0 ? '#f87171' : '#34d399' }}>
                                {currentProv.keyPool.exhaustedKeys > 0
                                  ? `${currentProv.keyPool.exhaustedKeys} in cooldown`
                                  : 'All keys available'}
                              </span>
                            </div>
                            {Array.isArray(currentProv.keyPool.keys) && currentProv.keyPool.keys.length > 0 && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {currentProv.keyPool.keys.map((k: any) => {
                                  const isKeyActive = k.status === 'active';
                                  const statusColor = isKeyActive
                                    ? '#34d399'
                                    : k.status === 'rate_limited'
                                    ? '#fbbf24'
                                    : '#f87171';
                                  return (
                                    <div
                                      key={k.index}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        background: 'rgba(0, 0, 0, 0.15)',
                                        padding: '2px 6px',
                                        borderRadius: 4,
                                        fontSize: 10,
                                      }}
                                    >
                                      <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                                        Key #{k.index} ({k.maskedKey})
                                      </span>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {k.characterCount > 0 && (
                                          <span style={{ color: 'var(--text-muted)' }}>
                                            {k.characterCount.toLocaleString()} chars
                                          </span>
                                        )}
                                        <span style={{ color: statusColor, fontWeight: 500 }}>
                                          {isKeyActive
                                            ? 'Active'
                                            : k.status === 'quota_exceeded'
                                            ? `Quota Exhausted${k.cooldownRemainingSeconds ? ` (${k.cooldownRemainingSeconds}s)` : ''}`
                                            : k.status === 'rate_limited'
                                            ? `Rate Limited${k.cooldownRemainingSeconds ? ` (${k.cooldownRemainingSeconds}s)` : ''}`
                                            : k.status === 'invalid'
                                            ? (k.lastError ? `⚠️ ${k.lastError}` : 'Invalid (401)')
                                            : 'Failed'}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            <span style={{ display: 'block', fontSize: 9.5, color: 'var(--text-muted)', marginTop: 4 }}>
                              Configure 5+ keys in Render as ELEVENLABS_API_KEY_1..5. Keys automatically rotate on 429 quota exhaustion.
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {settingsActiveTab === 'wake' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Wake-Word Always-On Toggle */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(15, 23, 42, 0.04)',
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)'),
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-primary)' }}>
                        Always-Available Wake Word Listening
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                        Listens locally while the tab is open without streaming audio to paid remote models.
                      </div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', position: 'relative' }}>
                      <input
                        type="checkbox"
                        checked={wakeWordEnabled}
                        onChange={e => {
                          const val = e.target.checked;
                          setWakeWordEnabled(val);
                          try {
                            localStorage.setItem(STORAGE_KEY_WAKE_ENABLED, String(val));
                          } catch {}
                          if (val) {
                            wakeWordManagerRef.current?.enable();
                          } else {
                            wakeWordManagerRef.current?.disable();
                          }
                        }}
                        style={{ width: 18, height: 18, accentColor: '#a855f7', cursor: 'pointer' }}
                      />
                    </label>
                  </div>

                  {/* Wake Words & Aliases Chip Manager */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
                        Active Wake Words & Spoken Aliases:
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setWakeWordsList(DEFAULT_WAKE_WORDS);
                          saveWakeWords(DEFAULT_WAKE_WORDS);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#a855f7',
                          fontSize: 10.5,
                          cursor: 'pointer',
                          padding: 0,
                          textDecoration: 'underline',
                        }}
                      >
                        Reset Defaults
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {wakeWordsList.map(word => (
                        <span
                          key={word}
                          style={{
                            background: isDark ? 'rgba(168, 85, 247, 0.2)' : 'rgba(168, 85, 247, 0.1)',
                            border: '1px solid ' + (isDark ? 'rgba(168, 85, 247, 0.4)' : 'rgba(168, 85, 247, 0.3)'),
                            borderRadius: 16,
                            padding: '3px 8px',
                            fontSize: 11,
                            color: isDark ? '#e9d5ff' : '#6b21a8',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          "{word}"
                          {wakeWordsList.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = wakeWordsList.filter(w => w !== word);
                                setWakeWordsList(next);
                                saveWakeWords(next);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'inherit',
                                cursor: 'pointer',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                              }}
                              title={`Remove "${word}"`}
                            >
                              <X style={{ width: 11, height: 11 }} />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>

                    {/* Add Wake Word Input */}
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <input
                        type="text"
                        value={newWakeWordInput}
                        onChange={e => setNewWakeWordInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const val = newWakeWordInput.trim().toLowerCase();
                            if (val && !wakeWordsList.includes(val)) {
                              const next = [...wakeWordsList, val];
                              setWakeWordsList(next);
                              saveWakeWords(next);
                              setNewWakeWordInput('');
                            }
                          }
                        }}
                        placeholder="Add new wake alias (e.g. 'assistant')..."
                        style={{
                          flex: 1,
                          background: isDark ? 'rgba(0, 0, 0, 0.4)' : '#ffffff',
                          border: '1px solid ' + (isDark ? 'rgba(168, 85, 247, 0.35)' : 'rgba(15, 23, 42, 0.18)'),
                          color: 'var(--text-primary)',
                          borderRadius: 6,
                          padding: '5px 8px',
                          fontSize: 11,
                          outline: 'none',
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const val = newWakeWordInput.trim().toLowerCase();
                          if (val && !wakeWordsList.includes(val)) {
                            const next = [...wakeWordsList, val];
                            setWakeWordsList(next);
                            saveWakeWords(next);
                            setNewWakeWordInput('');
                          }
                        }}
                        style={{
                          background: 'rgba(168, 85, 247, 0.25)',
                          border: '1px solid rgba(168, 85, 247, 0.4)',
                          borderRadius: 6,
                          padding: '4px 10px',
                          color: '#c084fc',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Neural Voice Output Toggle & Audio Chime */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(15, 23, 42, 0.03)',
                        padding: '6px 10px',
                        borderRadius: 6,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)' }}>
                          Spoken Neural Voice Replies
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          Assistant responds aloud using neural voice. Turn off for silent text-only responses to protect ElevenLabs quota.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={voiceRepliesEnabled}
                        onChange={e => {
                          const val = e.target.checked;
                          setVoiceRepliesEnabled(val);
                          try {
                            localStorage.setItem(STORAGE_KEY_VOICE_REPLIES, String(val));
                          } catch {}
                        }}
                        style={{ width: 16, height: 16, accentColor: '#a855f7', cursor: 'pointer' }}
                      />
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(15, 23, 42, 0.03)',
                        padding: '6px 10px',
                        borderRadius: 6,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)' }}>
                          Wake Tone Chime (520Hz → 780Hz)
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          Plays a subtle dual-tone chime when a wake word is recognized.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={wakeChimeEnabled}
                        onChange={e => {
                          const val = e.target.checked;
                          setWakeChimeEnabled(val);
                          try {
                            localStorage.setItem(STORAGE_KEY_WAKE_CHIME, String(val));
                          } catch {}
                        }}
                        style={{ width: 16, height: 16, accentColor: '#a855f7', cursor: 'pointer' }}
                      />
                    </div>
                  </div>

                  {/* Status & Test Chime / Mic */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: isDark ? 'rgba(0, 0, 0, 0.2)' : 'rgba(15, 23, 42, 0.04)',
                      fontSize: 11,
                    }}
                  >
                    <span style={{ color: 'var(--text-secondary)' }}>
                      Status: <strong>{voiceLifecycleState}</strong> {voiceLifecycleDetail ? `(${voiceLifecycleDetail})` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => wakeWordManagerRef.current?.playWakeChime()}
                      style={{
                        background: 'rgba(168, 85, 247, 0.2)',
                        border: '1px solid rgba(168, 85, 247, 0.4)',
                        borderRadius: 4,
                        padding: '3px 8px',
                        color: '#c084fc',
                        fontSize: 10.5,
                        cursor: 'pointer',
                      }}
                    >
                      Test Chime
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

      {/* ── Model Selector Bar ── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(15, 23, 42, 0.03)',
          borderBottom: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)'),
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 14px',
            fontSize: 12,
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 64 }}>
            <Bot style={{ width: 13, height: 13, color: '#a855f7' }} />
            <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Model:</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
            {/* Search Toggle / Input */}
            {showModelSearch ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, maxWidth: 220 }}>
                <input
                  type="text"
                  value={modelSearch}
                  onChange={e => setModelSearch(e.target.value)}
                  placeholder="Filter configured models..."
                  autoFocus
                  style={{
                    width: '100%',
                    background: isDark ? 'rgba(0, 0, 0, 0.4)' : '#ffffff',
                    border: '1px solid rgba(168, 85, 247, 0.4)',
                    color: 'var(--text-primary)',
                    borderRadius: 6,
                    padding: '2px 6px',
                    fontSize: 11,
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => {
                    setShowModelSearch(false);
                    setModelSearch('');
                  }}
                  title="Close search filter"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 2,
                    display: 'flex',
                  }}
                >
                  <X style={{ width: 12, height: 12 }} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowModelSearch(true)}
                title="Filter configured ready models from your FreeLLMAPI"
                style={{
                  background: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.05)',
                  border: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.1)'),
                  borderRadius: 6,
                  padding: '3px 6px',
                  color: 'var(--text-secondary)',
                  fontSize: 10,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Search style={{ width: 11, height: 11 }} />
                <span>{catalogModels.length} ready</span>
              </button>
            )}

            <select
              value={selectedModel}
              onChange={e => handleModelChange(e.target.value)}
              style={{
                background: isDark ? 'rgba(20, 16, 36, 0.95)' : '#ffffff',
                border: '1px solid ' + (isDark ? 'rgba(168, 85, 247, 0.35)' : 'rgba(168, 85, 247, 0.4)'),
                color: 'var(--text-primary)',
                fontSize: 12,
                borderRadius: 8,
                padding: '3px 8px',
                outline: 'none',
                cursor: 'pointer',
                maxWidth: isPhone ? '160px' : '260px',
              }}
            >
              <optgroup label="⚡ Automatic Switching (Playground Mode)">
                <option value="auto" style={{ background: isDark ? '#171426' : '#ffffff', color: isDark ? '#fff' : '#0f172a' }}>
                  ⚡ Auto (Smart Switch — Configured Models)
                </option>
              </optgroup>

              {modelSearch.trim() ? (
                <optgroup label={`Search Matches (${catalogModels.filter(m => m.name.toLowerCase().includes(modelSearch.toLowerCase()) || m.id.toLowerCase().includes(modelSearch.toLowerCase()) || m.provider.toLowerCase().includes(modelSearch.toLowerCase())).length})`}>
                  {catalogModels
                    .filter(m =>
                      m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
                      m.id.toLowerCase().includes(modelSearch.toLowerCase()) ||
                      m.provider.toLowerCase().includes(modelSearch.toLowerCase())
                    )
                    .map(m => (
                      <option key={m.id} value={m.id} style={{ background: isDark ? '#171426' : '#ffffff', color: isDark ? '#fff' : '#0f172a' }}>
                        {m.name} ({m.provider})
                      </option>
                    ))}
                </optgroup>
              ) : catalogModels.length > 0 ? (
                <optgroup label={`✅ Configured Ready Models (${catalogModels.length})`}>
                  {catalogModels.map(m => (
                    <option key={m.id} value={m.id} style={{ background: isDark ? '#171426' : '#ffffff', color: isDark ? '#fff' : '#0f172a' }}>
                      {m.name} ({m.provider})
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>
        </div>

        {/* Active Model Capabilities & Routing Specs Bar */}
        {(() => {
          const activeModelObj =
            catalogModels.find(m => m.id === selectedModel) ||
            VERIFIED_FREE_MODELS.find(m => m.id === selectedModel);
          const hasImageAttachment = attachments.some(a => a.type.startsWith('image/'));
          const modelSupportsVision = activeModelObj?.capabilities.includes('vision') || selectedModel === 'auto';

          return (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '3px 14px 5px',
                background: isDark ? 'rgba(0, 0, 0, 0.2)' : 'rgba(15, 23, 42, 0.04)',
                fontSize: 10,
                color: 'var(--text-secondary)',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: isDark ? '#d8b4fe' : '#7c3aed', fontWeight: 600 }}>
                  {selectedModel === 'auto'
                    ? `FreeLLM Auto Router (${catalogModels.length} ready models)`
                    : activeModelObj?.provider || 'FreeLLM Gateway'}
                </span>
                {activeModelObj?.contextWindow && (
                  <span style={{ background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)', color: 'var(--text-secondary)', padding: '1px 5px', borderRadius: 4, fontSize: 9 }}>
                    {activeModelObj.contextWindow >= 1000000
                      ? `${Math.round(activeModelObj.contextWindow / 1000000)}M ctx`
                      : `${Math.round(activeModelObj.contextWindow / 1000)}K ctx`}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {activeModelObj?.capabilities.map(cap => (
                  <span
                    key={cap}
                    style={{
                      fontSize: 9,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background:
                        cap === 'vision'
                          ? 'rgba(56, 189, 248, 0.2)'
                          : cap === 'code'
                          ? 'rgba(34, 197, 94, 0.2)'
                          : cap === 'reasoning'
                          ? 'rgba(234, 179, 8, 0.2)'
                          : cap === 'image_gen'
                          ? 'rgba(236, 72, 153, 0.2)'
                          : cap === 'video_gen'
                          ? 'rgba(244, 63, 94, 0.2)'
                          : isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.06)',
                      color:
                        cap === 'vision'
                          ? '#0284c7'
                          : cap === 'code'
                          ? '#16a34a'
                          : cap === 'reasoning'
                          ? '#ca8a04'
                          : cap === 'image_gen'
                          ? '#db2777'
                          : cap === 'video_gen'
                          ? '#e11d48'
                          : 'var(--text-primary)',
                      border: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 23, 42, 0.1)'),
                      textTransform: 'capitalize',
                    }}
                  >
                    {cap === 'vision' && '👁️ '}
                    {cap === 'code' && '💻 '}
                    {cap === 'reasoning' && '🧠 '}
                    {cap === 'image_gen' && '🎨 '}
                    {cap === 'video_gen' && '🎬 '}
                    {cap}
                  </span>
                ))}
              </div>

              {hasImageAttachment && !modelSupportsVision && (
                <div
                  style={{
                    width: '100%',
                    marginTop: 2,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'rgba(56, 189, 248, 0.15)',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    color: '#7dd3fc',
                    fontSize: 10,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Eye style={{ width: 11, height: 11, flexShrink: 0 }} />
                  <span>Image attached: Capability router will automatically use Gemini 2.5 Flash for vision analysis.</span>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Pending Voice Action Confirmation Banner ── */}
      {pendingConfirmation && (
        <div
          style={{
            padding: '10px 14px',
            background: isDark ? 'rgba(239, 68, 68, 0.15)' : 'rgba(254, 226, 226, 0.95)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            fontSize: 12,
            backdropFilter: 'blur(10px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
            <AlertTriangle style={{ width: 16, height: 16, color: '#ef4444', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: isDark ? '#fca5a5' : '#b91c1c', fontSize: 12 }}>
                {pendingConfirmation.confirmationPrompt || 'Confirmation Required'}
              </div>
              <div style={{ fontSize: 11, color: isDark ? '#f87171' : '#dc2626', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pendingConfirmation.targetTitle ? `Target: "${pendingConfirmation.targetTitle}"` : pendingConfirmation.message}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => handleConfirmAction(false)}
              style={{
                background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)',
                border: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(15, 23, 42, 0.15)'),
                borderRadius: 6,
                padding: '4px 10px',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => handleConfirmAction(true)}
              style={{
                background: '#ef4444',
                border: 'none',
                borderRadius: 6,
                padding: '4px 12px',
                color: '#ffffff',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 11,
                boxShadow: '0 0 10px rgba(239, 68, 68, 0.4)',
              }}
            >
              Confirm
            </button>
          </div>
        </div>
      )}

      {/* ── Active Wake-Word Assistant Status Strip ── */}
      {wakeWordEnabled && !isMicMuted && (
        <div
          style={{
            padding: '5px 12px',
            background: isDark ? 'rgba(16, 185, 129, 0.08)' : 'rgba(236, 253, 245, 0.9)',
            borderBottom: '1px solid ' + (isDark ? 'rgba(16, 185, 129, 0.2)' : 'rgba(16, 185, 129, 0.25)'),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 11,
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background:
                  voiceLifecycleState === 'listening_wake_word'
                    ? '#10b981'
                    : voiceLifecycleState === 'listening_command' || voiceLifecycleState === 'transcribing'
                    ? '#38bdf8'
                    : voiceLifecycleState === 'executing' || voiceLifecycleState === 'understanding'
                    ? '#a855f7'
                    : voiceLifecycleState === 'speaking_response'
                    ? '#f59e0b'
                    : '#94a3b8',
                boxShadow: '0 0 6px currentColor',
                animation: 'pulse 1.8s infinite',
              }}
            />
            <span style={{ fontWeight: 600, color: isDark ? '#34d399' : '#059669', flexShrink: 0 }}>
              {voiceLifecycleState === 'listening_wake_word'
                ? `Listening for "${wakeWordsList[0] || 'Sami'}"`
                : voiceLifecycleState === 'listening_command'
                ? 'Listening for command...'
                : voiceLifecycleState === 'understanding'
                ? 'Understanding command...'
                : voiceLifecycleState === 'executing'
                ? 'Executing...'
                : voiceLifecycleState === 'speaking_response'
                ? 'Speaking response...'
                : 'Wake Word Active'}
            </span>

            {liveTranscript && (
              <span
                style={{
                  color: 'var(--text-muted)',
                  fontStyle: 'italic',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                "{liveTranscript}"
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsMicMuted(true)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: 10,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              padding: '2px 4px',
            }}
            title="Mute microphone"
          >
            <MicOff style={{ width: 11, height: 11 }} />
            <span>Mute</span>
          </button>
        </div>
      )}

      {/* ── Voice Mode Overlay ── */}
      {isVoiceModeActive && (
        <div
          style={{
            padding: '16px 20px',
            background: 'linear-gradient(180deg, rgba(30, 16, 50, 0.95), rgba(18, 12, 34, 0.98))',
            borderBottom: '1px solid rgba(168, 85, 247, 0.3)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            position: 'relative',
          }}
        >
          {/* Animated Cosmic Voice Orb */}
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: '50%',
              background:
                voiceModeStatus === 'speaking'
                  ? 'radial-gradient(circle, #38bdf8 0%, #6366f1 70%, #a855f7 100%)'
                  : isMicMuted
                  ? 'radial-gradient(circle, #64748b 0%, #334155 100%)'
                  : 'radial-gradient(circle, #c084fc 0%, #a855f7 60%, #4f46e5 100%)',
              boxShadow: isMicMuted
                ? '0 0 10px rgba(100, 116, 139, 0.3)'
                : '0 0 35px rgba(168, 85, 247, 0.8), 0 0 50px rgba(56, 189, 248, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: isMicMuted ? 'none' : 'pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
              transition: 'all 0.3s ease',
            }}
          >
            <Radio style={{ width: 30, height: 30, color: '#ffffff' }} />
          </div>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>
              {isMicMuted
                ? 'Microphone Muted'
                : voiceModeStatus === 'speaking'
                ? 'Moon Assistant is speaking...'
                : voiceModeStatus === 'thinking'
                ? 'Thinking...'
                : isDictating
                ? 'Listening for your voice...'
                : 'Voice Mode Ready'}
            </div>
            <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2, maxWidth: 360, fontStyle: 'italic' }}>
              {dictationInterim || voiceSubtitle}
            </div>
          </div>

          {/* Voice Mode Action Controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap', maxWidth: '100%' }}>
            <button
              onClick={() => {
                const muted = !isMicMuted;
                setIsMicMuted(muted);
              }}
              style={{
                background: isMicMuted ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.1)',
                border: isMicMuted ? '1px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: 20,
                padding: '6px 14px',
                color: isMicMuted ? '#f87171' : '#ffffff',
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {isMicMuted ? <MicOff style={{ width: 14, height: 14 }} /> : <Mic style={{ width: 14, height: 14 }} />}
              {isMicMuted ? 'Unmute' : 'Mute'}
            </button>

            {/* Interrupt Button */}
            <button
              onClick={() => {
                voiceSpeechEnabledRef.current = false;
                stopSpeechPlayback();
                activeRequestRef.current?.abort();
                setVoiceSubtitle('Reply interrupted. Listening again...');
                setVoiceModeStatus(isVoiceModeActive ? 'listening' : 'idle');
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: 20,
                padding: '6px 14px',
                color: '#ffffff',
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Square style={{ width: 13, height: 13 }} />
              Interrupt
            </button>

            {/* Exit Voice Mode */}
            <button
              onClick={toggleVoiceMode}
              style={{
                background: 'rgba(168, 85, 247, 0.2)',
                border: '1px solid rgba(168, 85, 247, 0.4)',
                borderRadius: 20,
                padding: '6px 14px',
                color: '#d8b4fe',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Exit Voice
            </button>
          </div>
        </div>
      )}

      {/* ── Messages Feed ── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {messages.map(msg => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isUser ? 'flex-end' : 'flex-start',
                gap: 4,
                maxWidth: '100%',
              }}
            >
              {/* Message Header Badge */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  color: isUser ? (isDark ? '#cbd5e1' : '#64748b') : '#a855f7',
                  padding: '0 4px',
                }}
              >
                {isUser ? (
                  <span>You</span>
                ) : (
                  <>
                    <Moon style={{ width: 12, height: 12 }} />
                    <span style={{ fontWeight: 600 }}>Moon Assistant</span>
                  </>
                )}
              </div>

              {/* Message Body Bubble */}
              <div
                style={{
                  maxWidth: isUser ? '85%' : '94%',
                  padding: '10px 14px',
                  borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: isUser
                    ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.55), rgba(99, 102, 241, 0.6))'
                    : isDark
                    ? 'rgba(255, 255, 255, 0.05)'
                    : 'rgba(255, 255, 255, 0.95)',
                  border: isUser
                    ? '1px solid rgba(216, 180, 254, 0.4)'
                    : isDark
                    ? '1px solid rgba(255, 255, 255, 0.1)'
                    : '1px solid rgba(15, 23, 42, 0.1)',
                  color: isUser ? '#ffffff' : 'var(--text-primary)',
                  fontSize: 13,
                  lineHeight: 1.55,
                  wordBreak: 'break-word',
                  boxShadow: isUser
                    ? '0 4px 14px rgba(168, 85, 247, 0.2)'
                    : isDark
                    ? '0 4px 14px rgba(0, 0, 0, 0.25)'
                    : '0 2px 10px rgba(0, 0, 0, 0.06)',
                }}
              >
                {/* 1. Attached Files (if any) */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {msg.attachments.map(att => (
                      <div
                        key={att.id}
                        style={{
                          background: isDark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(15, 23, 42, 0.05)',
                          border: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(15, 23, 42, 0.1)'),
                          borderRadius: 8,
                          padding: '4px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 11,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {att.type.startsWith('image/') && att.dataUrl ? (
                          <img
                            src={att.dataUrl}
                            alt={att.name}
                            onClick={() => setZoomedImage({ url: att.dataUrl!, prompt: att.name })}
                            style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', cursor: 'pointer' }}
                          />
                        ) : att.type.startsWith('audio/') ? (
                          <Music style={{ width: 14, height: 14, color: '#38bdf8' }} />
                        ) : att.type.startsWith('video/') ? (
                          <VideoIcon style={{ width: 14, height: 14, color: '#f43f5e' }} />
                        ) : (
                          <FileText style={{ width: 14, height: 14, color: '#a855f7' }} />
                        )}
                        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {att.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 2. Text Content */}
                {isUser ? (
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</div>
                ) : (
                  <div style={{ color: 'inherit' }}>
                    <FormattedMessage content={msg.content} />
                  </div>
                )}

                {/* 3. Generated Image Card */}
                {msg.generatedMedia && msg.generatedMedia.type === 'image' && (
                  <div
                    style={{
                      marginTop: 10,
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(168, 85, 247, 0.3)',
                    }}
                  >
                    <div style={{ position: 'relative' }}>
                      <img
                        src={msg.generatedMedia.url}
                        alt={msg.generatedMedia.prompt}
                        onClick={() =>
                          setZoomedImage({
                            url: msg.generatedMedia!.url,
                            prompt: msg.generatedMedia!.prompt,
                          })
                        }
                        style={{
                          width: '100%',
                          maxHeight: 320,
                          objectFit: 'cover',
                          display: 'block',
                          cursor: 'pointer',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          display: 'flex',
                          gap: 6,
                        }}
                      >
                        <button
                          onClick={() =>
                            setZoomedImage({
                              url: msg.generatedMedia!.url,
                              prompt: msg.generatedMedia!.prompt,
                            })
                          }
                          title="Zoom In"
                          style={{
                            background: 'rgba(0, 0, 0, 0.7)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            borderRadius: 6,
                            padding: 5,
                            color: '#ffffff',
                            cursor: 'pointer',
                          }}
                        >
                          <Eye style={{ width: 14, height: 14 }} />
                        </button>
                        <a
                          href={msg.generatedMedia.url}
                          download={`image-${Date.now()}.jpg`}
                          target="_blank"
                          rel="noreferrer"
                          title="Download Image"
                          style={{
                            background: 'rgba(0, 0, 0, 0.7)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            borderRadius: 6,
                            padding: 5,
                            color: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Download style={{ width: 14, height: 14 }} />
                        </a>
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. Generated Video Card */}
                {msg.generatedMedia && msg.generatedMedia.type === 'video' && (
                  <div
                    style={{
                      marginTop: 10,
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                    }}
                  >
                    <video
                      src={msg.generatedMedia.url}
                      controls
                      playsInline
                      style={{
                        width: '100%',
                        maxHeight: 280,
                        display: 'block',
                        background: '#000',
                      }}
                    />
                    <div
                      style={{
                        padding: '6px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 11,
                        color: '#94a3b8',
                      }}
                    >
                      <span>🎬 Video Stream</span>
                      <a
                        href={msg.generatedMedia.url}
                        download={`video-${Date.now()}.mp4`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#38bdf8', textDecoration: 'none' }}
                      >
                        Download Video
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {/* Message Bottom Action Toolbar */}
              {!isUser && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4, flexWrap: 'wrap' }}>
                  {/* FreeLLM Playground-style model & latency badge */}
                  {(msg.model || selectedModel) && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 10,
                        fontWeight: 500,
                        padding: '2px 8px',
                        borderRadius: 12,
                        background: isDark ? 'rgba(168, 85, 247, 0.12)' : 'rgba(168, 85, 247, 0.1)',
                        border: isDark ? '1px solid rgba(168, 85, 247, 0.28)' : '1px solid rgba(168, 85, 247, 0.25)',
                        color: isDark ? '#d8b4fe' : '#7c3aed',
                        letterSpacing: '0.01em',
                      }}
                    >
                      <span style={{ color: isDark ? '#c084fc' : '#9333ea', fontSize: 10 }}>✦</span>
                      <span>{msg.model || selectedModel}</span>
                      {msg.provider && (
                        <span style={{ opacity: 0.7 }}>
                          via {msg.provider}
                          {msg.fallbackFrom ? ` · ⚡ Auto-switched from ${msg.fallbackFrom}` : ''}
                        </span>
                      )}
                      {msg.latencyMs ? (
                        <>
                          <span style={{ opacity: 0.45 }}>·</span>
                          <span style={{ color: isDark ? '#a5b4fc' : '#4f46e5', fontFamily: 'monospace', fontSize: 9.5 }}>{msg.latencyMs}ms</span>
                        </>
                      ) : null}
                    </span>
                  )}

                  {/* Copy Button */}
                  <button
                    onClick={() => handleCopy(msg.content, msg.id)}
                    title="Copy message"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: copiedId === msg.id ? '#10b981' : 'var(--text-muted)',
                      fontSize: 11,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: 2,
                    }}
                  >
                    {copiedId === msg.id ? (
                      <>
                        <Check style={{ width: 12, height: 12 }} /> Copied
                      </>
                    ) : (
                      <>
                        <Copy style={{ width: 12, height: 12 }} /> Copy
                      </>
                    )}
                  </button>

                  {/* Upgraded Neural Voice Playback Controls & Status */}
                  {speechState.messageId === msg.id && speechState.status === 'loading' ? (
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 11,
                        color: '#c084fc',
                        padding: '2px 4px',
                      }}
                    >
                      <LoaderCircle style={{ width: 12, height: 12, animation: 'sams-action-spin .8s linear infinite' }} />
                      <span>Synthesizing voice...</span>
                    </span>
                  ) : speechState.messageId === msg.id && (speechState.status === 'playing' || speechState.status === 'paused') ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {speechState.status === 'playing' ? (
                        <button
                          type="button"
                          onClick={pauseSpeechPlayback}
                          title="Pause voice reading"
                          style={{
                            background: 'rgba(168, 85, 247, 0.15)',
                            border: '1px solid rgba(168, 85, 247, 0.3)',
                            borderRadius: 6,
                            color: '#c084fc',
                            fontSize: 11,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 6px',
                          }}
                        >
                          <Pause style={{ width: 12, height: 12 }} /> Pause
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={resumeSpeechPlayback}
                          title="Resume voice reading"
                          style={{
                            background: 'rgba(168, 85, 247, 0.15)',
                            border: '1px solid rgba(168, 85, 247, 0.3)',
                            borderRadius: 6,
                            color: '#c084fc',
                            fontSize: 11,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 6px',
                          }}
                        >
                          <Play style={{ width: 12, height: 12 }} /> Resume
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={stopSpeechPlayback}
                        title="Stop speech"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-muted)',
                          fontSize: 11,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                          padding: 2,
                        }}
                      >
                        <VolumeX style={{ width: 12, height: 12 }} /> Stop
                      </button>
                      {speechState.voiceName && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.8 }}>
                          ({speechState.voiceName})
                        </span>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSpeakMessage(msg)}
                      title="Read aloud with neural voice"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: 11,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: 2,
                      }}
                    >
                      <Volume2 style={{ width: 12, height: 12 }} /> Listen
                    </button>
                  )}

                  {/* Neural Speech Fallback Notice Banner with Browser Voice Option */}
                  {speechState.messageId === msg.id && speechState.fallbackTriggered && (speechState.status === 'playing' || speechState.status === 'paused') && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                        flexWrap: 'wrap',
                        fontSize: 10.5,
                        color: '#fbbf24',
                        background: 'rgba(245, 158, 11, 0.1)',
                        border: '1px solid rgba(245, 158, 11, 0.25)',
                        borderRadius: 6,
                        padding: '3px 8px',
                        width: '100%',
                        marginTop: 4,
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 140 }}>
                        ⚠️ ElevenLabs quota reached on all keys. Playing via {speechState.providerName} fallback.
                      </span>
                      <button
                        type="button"
                        onClick={() => void playSpeech(msg.content, msg.id, true)}
                        title="Switch to system browser voice"
                        style={{
                          background: 'rgba(245, 158, 11, 0.2)',
                          border: 'none',
                          borderRadius: 4,
                          padding: '1px 6px',
                          color: '#fef3c7',
                          fontSize: 10,
                          cursor: 'pointer',
                        }}
                      >
                        Use browser voice
                      </button>
                    </div>
                  )}

                  {/* Explicit Neural Speech Error Banner with Retry & Browser Fallback */}
                  {speechState.messageId === msg.id && speechState.status === 'error' && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexWrap: 'wrap',
                        fontSize: 11,
                        color: '#f87171',
                        background: 'rgba(239, 68, 68, 0.12)',
                        border: '1px solid rgba(239, 68, 68, 0.25)',
                        borderRadius: 6,
                        padding: '4px 8px',
                        width: '100%',
                        marginTop: 4,
                      }}
                    >
                      <AlertTriangle style={{ width: 12, height: 12, flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 140 }}>{speechState.errorMessage || 'Voice synthesis failed.'}</span>
                      <button
                        type="button"
                        onClick={() => void playSpeech(msg.content, msg.id)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.2)',
                          border: 'none',
                          borderRadius: 4,
                          padding: '2px 6px',
                          color: '#fca5a5',
                          fontSize: 10.5,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Retry
                      </button>
                      {speechState.canFallbackToBrowser && (
                        <button
                          type="button"
                          onClick={() => void playSpeech(msg.content, msg.id, true)}
                          title="Speak using system browser voice"
                          style={{
                            background: 'transparent',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            borderRadius: 4,
                            padding: '2px 6px',
                            color: 'var(--text-secondary)',
                            fontSize: 10.5,
                            cursor: 'pointer',
                          }}
                        >
                          Use browser voice
                        </button>
                      )}
                    </div>
                  )}

                  {/* Retry Button on Error */}
                  {msg.id.startsWith('err-') && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button
                        onClick={() => {
                          const lastUser = [...messages].reverse().find(m => m.role === 'user');
                          if (lastUser) {
                            updateMessages(prev => prev.filter(m => m.id !== msg.id && m.id !== lastUser.id));
                            handleSendMessage(lastUser.content);
                          } else {
                            testGatewayConnection();
                          }
                        }}
                        title="Retry this request"
                        style={{
                          background: 'rgba(239, 68, 68, 0.2)',
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          color: '#fca5a5',
                          fontSize: 11,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 8px',
                          borderRadius: 6,
                        }}
                      >
                        <RotateCcw style={{ width: 11, height: 11 }} /> Retry
                      </button>
                      <button
                        onClick={() => {
                          const lastUser = [...messages].reverse().find(m => m.role === 'user');
                          if (lastUser) {
                            setInput(lastUser.content);
                            updateMessages(prev => prev.filter(m => m.id !== msg.id && m.id !== lastUser.id));
                          }
                        }}
                        title="Edit original prompt"
                        style={{
                          background: 'var(--v-glass-bg-subtle)',
                          border: '1px solid var(--v-glass-border-subtle)',
                          color: 'var(--text-secondary)',
                          fontSize: 11,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 8px',
                          borderRadius: 6,
                        }}
                      >
                        <Edit2 style={{ width: 11, height: 11 }} /> Edit prompt
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Starter Prompt Suggestions */}
        {messages.length <= 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, padding: '0 4px' }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
              Quick prompts to get started:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {STARTER_PROMPTS.map(prompt => (
                <button
                  key={prompt}
                  onClick={() => {
                    if (prompt.includes('image')) {
                      handleSendMessage(prompt.replace('🎨 ', ''), 'image_gen');
                    } else if (prompt.includes('video')) {
                      handleSendMessage(prompt.replace('🎬 ', ''), 'video_gen');
                    } else if (prompt.includes('voice')) {
                      setIsVoiceModeActive(true);
                    } else {
                      handleSendMessage(prompt);
                    }
                  }}
                  style={{
                    background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.85)',
                    border: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.12)'),
                    borderRadius: 12,
                    padding: '5px 10px',
                    fontSize: 11,
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = isDark ? 'rgba(168, 85, 247, 0.2)' : 'rgba(168, 85, 247, 0.12)';
                    e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.4)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.85)';
                    e.currentTarget.style.borderColor = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.12)';
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Polished Activity / Typing Indicator */}
        {isLoading && lifecycleState !== 'streaming' && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 14px',
              borderRadius: 16,
              background: 'var(--v-glass-bg-subtle)',
              border: '1px solid var(--v-glass-border)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              alignSelf: 'flex-start',
              color: 'var(--text-primary)',
              fontSize: 12,
              marginTop: 4,
              marginBottom: 4,
              boxShadow: 'var(--v-shadow-glass)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#a855f7' }} />
              <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#818cf8', animationDelay: '0.2s' }} />
              <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8', animationDelay: '0.4s' }} />
            </div>
            <span style={{ fontStyle: 'normal', color: 'var(--text-secondary)', fontWeight: 500 }}>
              {activityLabel || 'Thinking...'}
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Lightbox Image Zoom Modal ── */}
      {zoomedImage && (
        <div
          onClick={() => setZoomedImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(10px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '90vh',
              borderRadius: 16,
              overflow: 'hidden',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.9)',
            }}
          >
            <img
              src={zoomedImage.url}
              alt={zoomedImage.prompt}
              style={{
                width: '100%',
                maxHeight: '85vh',
                objectFit: 'contain',
                display: 'block',
              }}
            />
            <button
              onClick={() => setZoomedImage(null)}
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                background: 'rgba(0, 0, 0, 0.75)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                borderRadius: '50%',
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>
      )}

      {/* ── Quick Multimodal Action Chips ── */}
      <div
        style={{
          padding: '6px 14px',
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          whiteSpace: 'nowrap',
          borderTop: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 23, 42, 0.08)'),
          background: isDark ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.6)',
        }}
      >
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            fontSize: 11,
            padding: '4px 9px',
            borderRadius: 10,
            background: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.05)',
            border: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(15, 23, 42, 0.12)'),
            color: 'var(--text-primary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Paperclip style={{ width: 12, height: 12, color: '#38bdf8' }} />
          Attach Files
        </button>

        <button
          onClick={() => {
            setInput(prev => (prev.trim() ? `Generate an image of ${prev.trim()}` : 'Generate an image of '));
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          title="Compose an image generation prompt"
          style={{
            fontSize: 11,
            padding: '4px 9px',
            borderRadius: 10,
            background: 'rgba(168, 85, 247, 0.15)',
            border: '1px solid rgba(168, 85, 247, 0.35)',
            color: isDark ? '#d8b4fe' : '#7c3aed',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <ImageIcon style={{ width: 12, height: 12 }} />
          Image Gen
        </button>

        <button
          onClick={() => {
            setInput(prev => (prev.trim() ? `Generate a video clip of ${prev.trim()}` : 'Generate a video clip of '));
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          title="Compose a video clip generation prompt"
          style={{
            fontSize: 11,
            padding: '4px 9px',
            borderRadius: 10,
            background: 'rgba(56, 189, 248, 0.15)',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            color: isDark ? '#7dd3fc' : '#0284c7',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <VideoIcon style={{ width: 12, height: 12 }} />
          Video Gen
        </button>

        <button
          onClick={toggleVoiceMode}
          style={{
            fontSize: 11,
            padding: '4px 9px',
            borderRadius: 10,
            background: 'rgba(236, 72, 153, 0.15)',
            border: '1px solid rgba(236, 72, 153, 0.35)',
            color: isDark ? '#f472b6' : '#db2777',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Headphones style={{ width: 12, height: 12 }} />
          Voice Mode
        </button>
      </div>

      {/* ── Pending Selected Attachments Preview Strip ── */}
      {attachments.length > 0 && (
        <div
          style={{
            padding: '6px 14px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            background: isDark ? 'rgba(20, 16, 36, 0.9)' : 'rgba(241, 245, 249, 0.95)',
            borderTop: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)'),
          }}
        >
          {attachments.map(att => (
            <div
              key={att.id}
              style={{
                background: isDark ? 'rgba(168, 85, 247, 0.2)' : 'rgba(168, 85, 247, 0.12)',
                border: '1px solid ' + (isDark ? 'rgba(168, 85, 247, 0.4)' : 'rgba(168, 85, 247, 0.3)'),
                borderRadius: 8,
                padding: '3px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                color: 'var(--text-primary)',
              }}
            >
              <FileText style={{ width: 12, height: 12, color: '#c084fc' }} />
              <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {att.name}
              </span>
              <button
                onClick={() => handleRemoveAttachment(att.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                }}
              >
                <X style={{ width: 12, height: 12 }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Input Bar ── */}
      <footer
        style={{
          padding: '10px 14px',
          background: isDark ? 'rgba(20, 16, 36, 0.95)' : 'rgba(255, 255, 255, 0.95)',
          borderTop: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 23, 42, 0.1)'),
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
        }}
      >
        {/* Attach File Button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach file or image"
          title="Attach photos, PDFs, docs, audio, or code"
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.05)',
            border: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(15, 23, 42, 0.1)'),
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Paperclip style={{ width: 16, height: 16 }} />
        </button>

        {/* Text Input Area */}
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          placeholder={
            isDictating
              ? 'Listening to your voice...'
              : 'Ask, analyze file, generate image/video...'
          }
          rows={1}
          style={{
            flex: 1,
            maxHeight: 120,
            minHeight: 36,
            padding: '8px 12px',
            borderRadius: 10,
            background: isDark ? 'rgba(255, 255, 255, 0.06)' : '#f8fafc',
            border: isDictating
              ? '1px solid #ef4444'
              : '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(15, 23, 42, 0.15)'),
            color: 'var(--text-primary)',
            fontSize: 13,
            outline: 'none',
            resize: 'none',
            lineHeight: 1.4,
            fontFamily: 'inherit',
          }}
        />

        {/* Voice Dictation (Microphone) Button */}
        <button
          onClick={toggleDictation}
          aria-label={isDictating ? 'Stop microphone dictation' : 'Start microphone dictation'}
          title={isDictating ? 'Stop Recording' : 'Dictate with Voice'}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: isDictating
              ? 'linear-gradient(135deg, #ef4444, #dc2626)'
              : isDark
              ? 'rgba(255, 255, 255, 0.08)'
              : 'rgba(15, 23, 42, 0.05)',
            border: isDictating ? '1px solid #f87171' : '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(15, 23, 42, 0.1)'),
            color: isDictating ? '#ffffff' : 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            animation: isDictating ? 'pulse 1.2s infinite' : 'none',
          }}
        >
          <Mic style={{ width: 16, height: 16 }} />
        </button>

        {/* Send Button */}
        <button
          onClick={() => isLoading ? activeRequestRef.current?.abort() : handleSendMessage()}
          disabled={!isLoading && !input.trim() && attachments.length === 0}
          aria-label={isLoading ? 'Stop response' : 'Send message'}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background:
              (input.trim() || attachments.length > 0) && !isLoading
                ? 'linear-gradient(135deg, #a855f7, #6366f1)'
                : isDark
                ? 'rgba(255, 255, 255, 0.08)'
                : 'rgba(15, 23, 42, 0.05)',
            border: 'none',
            color: (input.trim() || attachments.length > 0) && !isLoading ? '#ffffff' : 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: (input.trim() || attachments.length > 0) && !isLoading ? 'pointer' : 'default',
            transition: 'all 0.15s ease',
            flexShrink: 0,
            boxShadow:
              (input.trim() || attachments.length > 0) && !isLoading
                ? '0 0 12px rgba(168, 85, 247, 0.5)'
                : 'none',
          }}
        >
          {isLoading ? <Square style={{ width: 14, height: 14 }} /> : <Send style={{ width: 15, height: 15 }} />}
        </button>
      </footer>
        </div>
      </div>
    </div>
    </>
  );
}
