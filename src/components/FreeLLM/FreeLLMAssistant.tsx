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
import { apiFetch } from '@/lib/api/apiClient';
import {
  CatalogModel,
  VERIFIED_FREE_MODELS,
  mergeDiscoveredModels,
  ModelCapability,
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
      '👋 Hello! I am your multimodal **FreeLLM Moon Assistant**.\n\nNow equipped with full multimodal power:\n• 🎙️ **Voice dictation & real-time voice conversation**\n• 👁️ **Visual question answering & photo analysis**\n• 📄 **PDF, document, and source code understanding**\n• 🎨 **High-resolution image generation (Flux)**\n• 🎬 **Text & prompt video generation**\n• 🔊 **Voice response narration**\n\nHow can I help you today?',
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

export function FreeLLMAssistant({ isPhone = false, theme: propTheme }: { isPhone?: boolean; theme?: 'dark' | 'light' }) {
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
  } | null>(null);

  // ── 4. Chat Messages & Input ──
  const [messages, setMessages] = useState<FreeLLMMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // ── 6. Real-Time Interactive Voice Mode ──
  const [isVoiceModeActive, setIsVoiceModeActive] = useState(false);
  const [voiceModeStatus, setVoiceModeStatus] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [voiceSubtitle, setVoiceSubtitle] = useState<string>('Listening to your voice...');

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
    try {
      localStorage.removeItem('np_freellm_custom_url');
      localStorage.removeItem('np_freellm_custom_key');
    } catch {}

    const onResize = () => {
      setBtnPos(prev => (prev ? clampPosition(prev.x, prev.y) : null));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampPosition]);

  // ── Check Gateway Status (Render Backend) ──
  const testGatewayConnection = useCallback(async () => {
    setIsTestingGateway(true);
    setGatewayError(null);
    try {
      const res = await fetchWithTimeout('/api/ai/freellm/status', {}, 15000);
      const data = await res.json().catch(() => null);

      if (res.ok && data?.ok) {
        setGatewayOnline(Boolean(data.online));
        setGatewayLatency(data.latencyMs ?? null);
        if (Array.isArray(data.catalog) && data.catalog.length > 0) {
          setCatalogModels(data.catalog);
          setAvailableModels(data.catalog.map((m: CatalogModel) => m.id));
        } else if (Array.isArray(data.models) && data.models.length > 0) {
          const merged = mergeDiscoveredModels(data.models);
          setCatalogModels(merged);
          setAvailableModels(merged.map(m => m.id));
        }
        if (data.error && !data.online) {
          setGatewayError(data.error);
        } else {
          setGatewayError(null);
        }
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
  }, []);

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
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const currentPos =
      btnPos ||
      clampPosition(
        window.innerWidth - (isPhone ? 80 : 96),
        window.innerHeight - (isPhone ? 144 : 96)
      );

    dragInfoRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: currentPos.x,
      origY: currentPos.y,
      moved: false,
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
        if (!dragInfoRef.current.moved) {
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
            setInput(prev => (prev ? `${prev} ${final}` : final).trim());
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

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsDictating(true);
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

  // ── Text-to-Speech Response Playback ──
  const cleanMarkdownForSpeech = (text: string): string => {
    return text
      .replace(/```[\s\S]*?```/g, ' [Code snippet skipped] ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/#+\s*/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .trim();
  };

  const handleSpeakMessage = (msg: FreeLLMMessage) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    if (isSpeakingMessageId === msg.id) {
      window.speechSynthesis.cancel();
      setIsSpeakingMessageId(null);
      return;
    }

    window.speechSynthesis.cancel();
    const cleanText = cleanMarkdownForSpeech(msg.content);
    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => setIsSpeakingMessageId(msg.id);
    utterance.onend = () => setIsSpeakingMessageId(null);
    utterance.onerror = () => setIsSpeakingMessageId(null);

    window.speechSynthesis.speak(utterance);
  };

  // ── Send Message to FreeLLMAPI Gateway & Multimodal Router ──
  const handleSendMessage = async (customPrompt?: string, mode?: 'chat' | 'image_gen' | 'video_gen') => {
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
    const requestController = new AbortController();
    activeRequestRef.current = requestController;

    try {
      const response = await fetchWithTimeout(
        '/api/ai/freellm/chat',
        {
          method: 'POST',
          signal: requestController.signal,
          headers: { 'Content-Type': 'application/json' },
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
        if (!streamedContent) throw new Error('The gateway stream ended without assistant text.');
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

      // If in Voice Mode, automatically speak out the response
      if (isVoiceModeActive) {
        handleSpeakMessage(assistantMsg);
        setVoiceSubtitle(assistantMsg.content.slice(0, 100) + '...');
        setVoiceModeStatus('speaking');
      }
    } catch (err: any) {
      if (requestController.signal.aborted) return;
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
      <button
        onPointerDown={handlePointerDown}
        className="freellm-moon-button"
        aria-label="Open Multimodal FreeLLM Assistant (Movable AI Moon Button)"
        title="🌙 FreeLLM Multimodal AI Assistant • Drag to reposition, click to expand"
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
            ? 'linear-gradient(135deg, rgba(28, 20, 50, 0.88), rgba(15, 12, 30, 0.95))'
            : 'linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(243, 232, 255, 0.95))',
          border: isDark
            ? '1.5px solid rgba(192, 132, 252, 0.45)'
            : '1.5px solid rgba(168, 85, 247, 0.45)',
          boxShadow: isDragging
            ? (isDark
                ? '0 16px 36px rgba(0, 0, 0, 0.7), 0 0 30px rgba(168, 85, 247, 0.65)'
                : '0 16px 36px rgba(15, 23, 42, 0.2), 0 0 30px rgba(168, 85, 247, 0.45)')
            : (isDark
                ? '0 8px 24px rgba(0, 0, 0, 0.45), 0 0 20px rgba(168, 85, 247, 0.35)'
                : '0 8px 24px rgba(15, 23, 42, 0.12), 0 0 20px rgba(168, 85, 247, 0.25)'),
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
          {/* Glowing Cosmic Crescent Moon */}
          <Moon
            style={{
              width: 26,
              height: 26,
              color: isDark ? '#e9d5ff' : '#7c3aed',
              filter: isDark ? 'drop-shadow(0 0 6px rgba(216, 180, 254, 0.9))' : 'drop-shadow(0 0 4px rgba(124, 58, 237, 0.4))',
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
              color: isDark ? '#38bdf8' : '#0284c7',
              filter: isDark ? 'drop-shadow(0 0 4px rgba(56, 189, 248, 0.9))' : 'drop-shadow(0 0 4px rgba(2, 132, 199, 0.5))',
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
        </div>
      </button>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER: Expanded / Maximized State (Interactive Multimodal Chat Window)
  // ─────────────────────────────────────────────────────────────
  const isMax = windowState === 'maximized';

  return (
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
        background: isDark ? 'rgba(13, 11, 24, 0.95)' : 'rgba(255, 255, 255, 0.96)',
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border: isPhone ? 'none' : isDragOver ? '2px dashed #a855f7' : isDark ? '1.5px solid rgba(192, 132, 252, 0.3)' : '1.5px solid rgba(168, 85, 247, 0.3)',
        borderRadius: isPhone || isMax ? 0 : 24,
        boxShadow: isDark
          ? '0 24px 60px rgba(0, 0, 0, 0.8), 0 0 40px rgba(168, 85, 247, 0.25)'
          : '0 24px 60px rgba(15, 23, 42, 0.15), 0 0 40px rgba(168, 85, 247, 0.15)',
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
          background: isDark ? 'rgba(24, 20, 42, 0.8)' : 'rgba(248, 250, 252, 0.92)',
          borderBottom: '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 23, 42, 0.1)'),
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
                ? (isDark ? 'rgba(168, 85, 247, 0.35)' : 'rgba(168, 85, 247, 0.18)')
                : (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.06)'),
              border: isSidebarOpen
                ? (isDark ? '1px solid rgba(216, 180, 254, 0.5)' : '1px solid rgba(168, 85, 247, 0.4)')
                : (isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(15, 23, 42, 0.1)'),
              borderRadius: 8,
              padding: 6,
              color: isSidebarOpen
                ? (isDark ? '#e9d5ff' : '#7c3aed')
                : (isDark ? '#cbd5e1' : '#475569'),
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Menu style={{ width: 16, height: 16 }} />
          </button>

          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: isDark
                ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.35), rgba(56, 189, 248, 0.35))'
                : 'linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(56, 189, 248, 0.2))',
              border: isDark ? '1px solid rgba(216, 180, 254, 0.5)' : '1px solid rgba(168, 85, 247, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: isDark ? '0 0 14px rgba(168, 85, 247, 0.3)' : '0 0 10px rgba(168, 85, 247, 0.15)',
            }}
          >
            <Moon style={{ width: 17, height: 17, color: isDark ? '#e9d5ff' : '#7c3aed', transform: 'rotate(-15deg)' }} />
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
                  background: isDark ? 'rgba(168, 85, 247, 0.25)' : 'rgba(168, 85, 247, 0.15)',
                  border: isDark ? '1px solid rgba(168, 85, 247, 0.45)' : '1px solid rgba(168, 85, 247, 0.3)',
                  color: isDark ? '#d8b4fe' : '#7c3aed',
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
          {/* Real-Time Voice Mode Toggle */}
          <button
            onClick={() => setIsVoiceModeActive(prev => !prev)}
            aria-label="Toggle Voice Mode"
            title="Toggle Hands-Free Real-Time Voice Mode"
            style={{
              background: isVoiceModeActive
                ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.5), rgba(56, 189, 248, 0.5))'
                : isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.06)',
              border: isVoiceModeActive
                ? '1px solid rgba(216, 180, 254, 0.6)'
                : '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.1)'),
              borderRadius: 8,
              padding: '5px 8px',
              color: isVoiceModeActive ? '#ffffff' : 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            <Headphones style={{ width: 14, height: 14 }} />
            {!isPhone && <span>Voice</span>}
          </button>

          {/* Settings Button */}
          <button
            onClick={() => setShowSettingsModal(prev => !prev)}
            aria-label="FreeLLM Gateway Settings"
            title="Configure Gateway URL & Unified API Key"
            style={{
              background: showSettingsModal
                ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.4), rgba(56, 189, 248, 0.4))'
                : isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.06)',
              border: showSettingsModal
                ? '1px solid rgba(216, 180, 254, 0.6)'
                : '1px solid ' + (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.1)'),
              borderRadius: 8,
              padding: 6,
              color: showSettingsModal ? '#ffffff' : 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
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
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Settings style={{ width: 14, height: 14, color: '#c084fc' }} />
                  FreeLLM Gateway Connection Settings
                </span>
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




          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 11, color: gatewayOnline ? '#10b981' : gatewayError ? '#ef4444' : '#94a3b8' }}>
              {isTestingGateway
                ? 'Testing connection...'
                : gatewayOnline
                ? `● Online (${gatewayLatency ?? 0}ms · ${catalogModels.length} models)`
                : gatewayError
                ? `⚠️ ${gatewayError.slice(0, 45)}...`
                : '● Ready'}
            </span>

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => {
                  try {
                    localStorage.removeItem('np_freellm_custom_url');
                    localStorage.removeItem('np_freellm_custom_key');
                  } catch {}
                  testGatewayConnection();
                }}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 6,
                  padding: '4px 10px',
                  color: '#cbd5e1',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Reset
              </button>

              <button
                onClick={() => testGatewayConnection()}
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
                {isTestingGateway ? 'Testing...' : 'Test Connection'}
              </button>
            </div>
          </div>
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
                  placeholder="Filter 94+ models..."
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
                title="Search & filter 94+ free models"
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
                <span>{catalogModels.length} models</span>
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
              {modelSearch.trim() ? (
                // Filtered search results
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
              ) : (
                // Grouped by Category & Capability
                <>
                  <optgroup label="⭐ Recommended & Auto Routers">
                    {catalogModels
                      .filter(m => m.isPopular)
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: isDark ? '#171426' : '#ffffff', color: isDark ? '#fff' : '#0f172a' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="👁️ Vision & Multimodal">
                    {catalogModels
                      .filter(m => m.capabilities.includes('vision') && !m.isPopular)
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: isDark ? '#171426' : '#ffffff', color: isDark ? '#fff' : '#0f172a' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="💻 Coding Specialists">
                    {catalogModels
                      .filter(m => m.capabilities.includes('code') && !m.isPopular && !m.capabilities.includes('vision'))
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: isDark ? '#171426' : '#ffffff', color: isDark ? '#fff' : '#0f172a' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="🧠 Deep Reasoning & Math">
                    {catalogModels
                      .filter(m => m.capabilities.includes('reasoning') && !m.isPopular && !m.capabilities.includes('vision'))
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: isDark ? '#171426' : '#ffffff', color: isDark ? '#fff' : '#0f172a' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="🎨 Image & Video Generation">
                    {catalogModels
                      .filter(m => (m.capabilities.includes('image_gen') || m.capabilities.includes('video_gen')) && !m.isPopular)
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: isDark ? '#171426' : '#ffffff', color: isDark ? '#fff' : '#0f172a' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="⚡ Ultra-Fast LPUs & Wafer-Scale (Cerebras & Groq)">
                    {catalogModels
                      .filter(m => (m.provider === 'Cerebras' || m.provider === 'Groq') && !m.isPopular && !m.capabilities.includes('reasoning'))
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: isDark ? '#171426' : '#ffffff', color: isDark ? '#fff' : '#0f172a' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="🌐 Google Gemini & Gemma">
                    {catalogModels
                      .filter(m => m.provider === 'Google' && !m.isPopular && !m.capabilities.includes('vision'))
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: isDark ? '#171426' : '#ffffff', color: isDark ? '#fff' : '#0f172a' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="🌐 Mistral AI (European Open Weights)">
                    {catalogModels
                      .filter(m => m.provider === 'Mistral AI' && !m.isPopular && !m.capabilities.includes('vision') && !m.capabilities.includes('code'))
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: isDark ? '#171426' : '#ffffff', color: isDark ? '#fff' : '#0f172a' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="🌐 OpenRouter Free Models">
                    {catalogModels
                      .filter(m => m.provider === 'OpenRouter' && !m.isPopular)
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: isDark ? '#171426' : '#ffffff', color: isDark ? '#fff' : '#0f172a' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="🌐 Cohere, NVIDIA, Zhipu & Others">
                    {catalogModels
                      .filter(m => !['FreeLLM Router', 'Google', 'Groq', 'Cerebras', 'Mistral AI', 'OpenRouter'].includes(m.provider) && !m.isPopular && !m.capabilities.includes('image_gen') && !m.capabilities.includes('video_gen'))
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: isDark ? '#171426' : '#ffffff', color: isDark ? '#fff' : '#0f172a' }}>
                          {m.name} ({m.provider})
                        </option>
                      ))}
                  </optgroup>
                </>
              )}
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
                  {activeModelObj?.provider || 'FreeLLM Gateway'}
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

      {/* ── Real-Time Voice Mode Overlay ── */}
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
                : 'Hands-Free Voice Active'}
            </div>
            <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2, maxWidth: 360, fontStyle: 'italic' }}>
              {dictationInterim || voiceSubtitle}
            </div>
          </div>

          {/* Voice Mode Action Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setIsMicMuted(prev => !prev)}
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
                if (typeof window !== 'undefined' && window.speechSynthesis) {
                  window.speechSynthesis.cancel();
                }
                setIsSpeakingMessageId(null);
                setVoiceModeStatus('idle');
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
              onClick={() => setIsVoiceModeActive(false)}
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
                      {msg.provider && <span style={{ opacity: 0.7 }}>via {msg.provider}{msg.fallbackFrom ? ` ? fallback from ${msg.fallbackFrom}` : ''}</span>}
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

                  {/* Text-To-Speech Listen Button */}
                  <button
                    onClick={() => handleSpeakMessage(msg)}
                    title={isSpeakingMessageId === msg.id ? 'Stop Speaking' : 'Read aloud with voice'}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: isSpeakingMessageId === msg.id ? '#a855f7' : 'var(--text-muted)',
                      fontSize: 11,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: 2,
                    }}
                  >
                    {isSpeakingMessageId === msg.id ? (
                      <>
                        <VolumeX style={{ width: 12, height: 12 }} /> Stop
                      </>
                    ) : (
                      <>
                        <Volume2 style={{ width: 12, height: 12 }} /> Listen
                      </>
                    )}
                  </button>

                  {/* Retry Button on Error */}
                  {msg.id.startsWith('err-') && (
                    <button
                      onClick={() => {
                        const lastUser = [...messages].reverse().find(m => m.role === 'user');
                        if (lastUser) {
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

        {/* Loading Indicator */}
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', color: 'var(--text-secondary)' }}>
            <Moon style={{ width: 14, height: 14, color: '#a855f7', animation: 'spin 3s linear infinite' }} />
            <span style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--text-secondary)' }}>
              Moon Assistant is processing multimodal pipeline...
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
          onClick={() => setIsVoiceModeActive(prev => !prev)}
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
  );
}
