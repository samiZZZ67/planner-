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
} from 'lucide-react';
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
  latencyMs?: number;
  attachments?: AttachmentItem[];
  generatedMedia?: GeneratedMedia;
}

const STORAGE_KEY_HISTORY = 'np_freellm_chat_history';
const STORAGE_KEY_MODEL = 'np_freellm_selected_model';
const STORAGE_KEY_POS = 'np_freellm_moon_btn_pos';

const STARTER_PROMPTS = [
  '🎨 Generate an image of a cybernetic lunar city',
  '🎬 Create a video showing galaxy nebulas and stars',
  '🎙️ Start voice conversation mode',
  'Compare Gemini 2.5 Flash vs Llama 3.3 70B',
];

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 60000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

function formatFetchError(err: any): string {
  if (err?.name === 'AbortError') {
    return '⏱️ Request timed out (60s). The FreeLLM API or Render service may still be booting up (free tier cold start). Please click Retry in a few moments.';
  }
  const msg = err?.message || String(err);
  if (/failed to fetch/i.test(msg) || err instanceof TypeError) {
    return '⚠️ Unable to reach the FreeLLM service endpoint ("Failed to fetch"). If your deployed backend on Render is waking up from sleep, it typically takes 30-50s. Please wait a moment and click Retry.';
  }
  return msg;
}

export function FreeLLMAssistant({ isPhone = false }: { isPhone?: boolean }) {
  // ── 1. Assistant Visibility & Window States ──
  const [windowState, setWindowState] = useState<'collapsed' | 'expanded' | 'maximized'>('collapsed');

  // ── 2. Draggable Position for AI Moon Button ──
  const [btnPos, setBtnPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragInfoRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  // ── 3. Chat Messages & Input ──
  const [messages, setMessages] = useState<FreeLLMMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
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
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>(VERIFIED_FREE_MODELS);
  const [availableModels, setAvailableModels] = useState<string[]>(
    VERIFIED_FREE_MODELS.map(m => m.id)
  );
  const [modelSearch, setModelSearch] = useState<string>('');
  const [showModelSearch, setShowModelSearch] = useState<boolean>(false);
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

    // 3. History
    try {
      const savedHistory = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (savedHistory) {
        const parsed = JSON.parse(savedHistory);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        } else {
          loadDefaultGreeting();
        }
      } else {
        loadDefaultGreeting();
      }
    } catch {
      loadDefaultGreeting();
    }

    const onResize = () => {
      setBtnPos(prev => (prev ? clampPosition(prev.x, prev.y) : null));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampPosition]);

  const loadDefaultGreeting = () => {
    setMessages([
      {
        id: 'msg-greeting',
        role: 'assistant',
        content:
          '👋 Hello! I am your multimodal **FreeLLM Moon Assistant**.\n\nNow equipped with full multimodal power:\n• 🎙️ **Voice dictation & real-time voice conversation**\n• 👁️ **Visual question answering & photo analysis**\n• 📄 **PDF, document, and source code understanding**\n• 🎨 **High-resolution image generation (Flux)**\n• 🎬 **Text & prompt video generation**\n• 🔊 **Voice response narration**\n\nHow can I help you today?',
        timestamp: Date.now(),
        model: 'auto',
      },
    ]);
  };

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

  // Save messages to localStorage
  const updateMessages = (newMsgs: FreeLLMMessage[] | ((prev: FreeLLMMessage[]) => FreeLLMMessage[])) => {
    setMessages(prev => {
      const next = typeof newMsgs === 'function' ? newMsgs(prev) : newMsgs;
      try {
        localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(next));
      } catch {}
      return next;
    });
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

    try {
      const response = await fetchWithTimeout(
        '/api/ai/freellm/chat',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: updated
              .filter(m => m.id !== 'msg-greeting')
              .map(m => ({
                role: m.role,
                content: m.content,
                attachments: m.attachments,
              })),
            model: selectedModel || 'auto',
            mode: mode || undefined,
          }),
        },
        60000
      );

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.ok) {
        const errorText =
          data?.error ||
          `Gateway Error (${response.status}): Could not get response from FreeLLMAPI.`;
        throw new Error(errorText);
      }

      const assistantMsg: FreeLLMMessage = {
        id: `asst-${Date.now()}`,
        role: 'assistant',
        content: data.message?.content || 'No text content returned.',
        timestamp: Date.now(),
        model: data.model || selectedModel,
        latencyMs: data.latencyMs,
        generatedMedia: data.generatedMedia,
      };

      updateMessages(prev => [...prev, assistantMsg]);
      setGatewayOnline(true);
      if (data.latencyMs) setGatewayLatency(data.latencyMs);

      // If in Voice Mode, automatically speak out the response
      if (isVoiceModeActive) {
        handleSpeakMessage(assistantMsg);
        setVoiceSubtitle(assistantMsg.content.slice(0, 100) + '...');
        setVoiceModeStatus('speaking');
      }
    } catch (err: any) {
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
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleClearHistory = () => {
    if (window.confirm('Clear all FreeLLM chat history and media?')) {
      loadDefaultGreeting();
      try {
        localStorage.removeItem(STORAGE_KEY_HISTORY);
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
          background: 'linear-gradient(135deg, rgba(28, 20, 50, 0.88), rgba(15, 12, 30, 0.95))',
          border: '1.5px solid rgba(192, 132, 252, 0.45)',
          boxShadow: isDragging
            ? '0 16px 36px rgba(0, 0, 0, 0.7), 0 0 30px rgba(168, 85, 247, 0.65)'
            : '0 8px 24px rgba(0, 0, 0, 0.45), 0 0 20px rgba(168, 85, 247, 0.35)',
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
              color: '#e9d5ff',
              filter: 'drop-shadow(0 0 6px rgba(216, 180, 254, 0.9))',
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
              color: '#38bdf8',
              filter: 'drop-shadow(0 0 4px rgba(56, 189, 248, 0.9))',
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
              border: '1.5px solid #0d0d11',
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
        width: isPhone || isMax ? '100vw' : 'min(500px, calc(100vw - 32px))',
        height: isPhone || isMax ? '100vh' : 'min(730px, calc(100vh - 40px))',
        zIndex: 85,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(13, 11, 24, 0.94)',
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border: isPhone ? 'none' : isDragOver ? '2px dashed #a855f7' : '1.5px solid rgba(192, 132, 252, 0.3)',
        borderRadius: isPhone || isMax ? 0 : 24,
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8), 0 0 40px rgba(168, 85, 247, 0.25)',
        overflow: 'hidden',
        color: '#f8fafc',
        fontFamily: 'var(--font-system)',
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
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
          background: 'rgba(24, 20, 42, 0.75)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.35), rgba(56, 189, 248, 0.35))',
              border: '1px solid rgba(216, 180, 254, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 14px rgba(168, 85, 247, 0.3)',
            }}
          >
            <Moon style={{ width: 18, height: 18, color: '#e9d5ff', transform: 'rotate(-15deg)' }} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 14, letterSpacing: '0.01em', color: '#ffffff' }}>
                FreeLLM Moon Assistant
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  padding: '1px 6px',
                  borderRadius: 6,
                  background: 'rgba(168, 85, 247, 0.25)',
                  border: '1px solid rgba(168, 85, 247, 0.45)',
                  color: '#d8b4fe',
                  letterSpacing: '0.05em',
                }}
              >
                Multimodal
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
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
                : 'rgba(255, 255, 255, 0.08)',
              border: isVoiceModeActive
                ? '1px solid rgba(216, 180, 254, 0.6)'
                : '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 8,
              padding: '5px 8px',
              color: isVoiceModeActive ? '#ffffff' : '#cbd5e1',
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

          {/* Clear History */}
          <button
            onClick={handleClearHistory}
            aria-label="Clear chat history"
            title="Clear chat and media history"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 8,
              padding: 6,
              color: '#cbd5e1',
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
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 8,
                padding: 6,
                color: '#cbd5e1',
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
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 8,
              padding: 6,
              color: '#cbd5e1',
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

      {/* ── Model Selector Bar ── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(255, 255, 255, 0.03)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
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
            <span style={{ color: '#94a3b8', fontWeight: 500 }}>Model:</span>
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
                    background: 'rgba(0, 0, 0, 0.35)',
                    border: '1px solid rgba(168, 85, 247, 0.4)',
                    color: '#fff',
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
                    color: '#94a3b8',
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
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: 6,
                  padding: '3px 6px',
                  color: '#94a3b8',
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
                background: 'rgba(20, 16, 36, 0.95)',
                border: '1px solid rgba(168, 85, 247, 0.35)',
                color: '#f8fafc',
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
                      <option key={m.id} value={m.id} style={{ background: '#171426', color: '#fff' }}>
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
                        <option key={m.id} value={m.id} style={{ background: '#171426', color: '#fff' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="👁️ Vision & Multimodal">
                    {catalogModels
                      .filter(m => m.capabilities.includes('vision') && !m.isPopular)
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: '#171426', color: '#fff' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="💻 Coding Specialists">
                    {catalogModels
                      .filter(m => m.capabilities.includes('code') && !m.isPopular && !m.capabilities.includes('vision'))
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: '#171426', color: '#fff' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="🧠 Deep Reasoning & Math">
                    {catalogModels
                      .filter(m => m.capabilities.includes('reasoning') && !m.isPopular && !m.capabilities.includes('vision'))
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: '#171426', color: '#fff' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="🎨 Image & Video Generation">
                    {catalogModels
                      .filter(m => (m.capabilities.includes('image_gen') || m.capabilities.includes('video_gen')) && !m.isPopular)
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: '#171426', color: '#fff' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="⚡ Ultra-Fast LPUs & Wafer-Scale (Cerebras & Groq)">
                    {catalogModels
                      .filter(m => (m.provider === 'Cerebras' || m.provider === 'Groq') && !m.isPopular && !m.capabilities.includes('reasoning'))
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: '#171426', color: '#fff' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="🌐 Google Gemini & Gemma">
                    {catalogModels
                      .filter(m => m.provider === 'Google' && !m.isPopular && !m.capabilities.includes('vision'))
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: '#171426', color: '#fff' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="🌐 Mistral AI (European Open Weights)">
                    {catalogModels
                      .filter(m => m.provider === 'Mistral AI' && !m.isPopular && !m.capabilities.includes('vision') && !m.capabilities.includes('code'))
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: '#171426', color: '#fff' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="🌐 OpenRouter Free Models">
                    {catalogModels
                      .filter(m => m.provider === 'OpenRouter' && !m.isPopular)
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: '#171426', color: '#fff' }}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>

                  <optgroup label="🌐 Cohere, NVIDIA, Zhipu & Others">
                    {catalogModels
                      .filter(m => !['FreeLLM Router', 'Google', 'Groq', 'Cerebras', 'Mistral AI', 'OpenRouter'].includes(m.provider) && !m.isPopular && !m.capabilities.includes('image_gen') && !m.capabilities.includes('video_gen'))
                      .map(m => (
                        <option key={m.id} value={m.id} style={{ background: '#171426', color: '#fff' }}>
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
                background: 'rgba(0, 0, 0, 0.2)',
                fontSize: 10,
                color: '#94a3b8',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#d8b4fe', fontWeight: 600 }}>
                  {activeModelObj?.provider || 'FreeLLM Gateway'}
                </span>
                {activeModelObj?.contextWindow && (
                  <span style={{ background: 'rgba(255, 255, 255, 0.08)', padding: '1px 5px', borderRadius: 4, fontSize: 9 }}>
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
                          : 'rgba(255, 255, 255, 0.06)',
                      color:
                        cap === 'vision'
                          ? '#7dd3fc'
                          : cap === 'code'
                          ? '#86efac'
                          : cap === 'reasoning'
                          ? '#fde047'
                          : cap === 'image_gen'
                          ? '#f472b6'
                          : cap === 'video_gen'
                          ? '#fb7185'
                          : '#cbd5e1',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
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
                  color: isUser ? '#cbd5e1' : '#a855f7',
                  padding: '0 4px',
                }}
              >
                {isUser ? (
                  <span>You</span>
                ) : (
                  <>
                    <Moon style={{ width: 12, height: 12 }} />
                    <span style={{ fontWeight: 600 }}>Moon Assistant</span>
                    {msg.model && (
                      <span
                        style={{
                          fontSize: 9,
                          padding: '1px 5px',
                          borderRadius: 4,
                          background: 'rgba(255, 255, 255, 0.08)',
                          color: '#94a3b8',
                        }}
                      >
                        {msg.model}
                      </span>
                    )}
                    {msg.latencyMs && (
                      <span style={{ fontSize: 9, color: '#64748b' }}>
                        {msg.latencyMs}ms
                      </span>
                    )}
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
                    ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.45), rgba(99, 102, 241, 0.5))'
                    : 'rgba(255, 255, 255, 0.05)',
                  border: isUser
                    ? '1px solid rgba(216, 180, 254, 0.4)'
                    : '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#f8fafc',
                  fontSize: 13,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  boxShadow: isUser
                    ? '0 4px 14px rgba(168, 85, 247, 0.2)'
                    : '0 4px 14px rgba(0, 0, 0, 0.25)',
                }}
              >
                {/* 1. Attached Files (if any) */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {msg.attachments.map(att => (
                      <div
                        key={att.id}
                        style={{
                          background: 'rgba(0, 0, 0, 0.35)',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          borderRadius: 8,
                          padding: '4px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 11,
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
                <div>{msg.content}</div>

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
                <div style={{ display: 'flex', gap: 8, paddingLeft: 4 }}>
                  {/* Copy Button */}
                  <button
                    onClick={() => handleCopy(msg.content, msg.id)}
                    title="Copy message"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: copiedId === msg.id ? '#10b981' : '#64748b',
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
                      color: isSpeakingMessageId === msg.id ? '#a855f7' : '#64748b',
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
            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
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
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: 12,
                    padding: '5px 10px',
                    fontSize: 11,
                    color: '#e2e8f0',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(168, 85, 247, 0.2)';
                    e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.4)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', color: '#cbd5e1' }}>
            <Moon style={{ width: 14, height: 14, color: '#a855f7', animation: 'spin 3s linear infinite' }} />
            <span style={{ fontSize: 12, fontStyle: 'italic', color: '#94a3b8' }}>
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
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          background: 'rgba(255, 255, 255, 0.02)',
        }}
      >
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            fontSize: 11,
            padding: '4px 9px',
            borderRadius: 10,
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#e2e8f0',
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
            color: '#d8b4fe',
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
            color: '#7dd3fc',
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
            color: '#f472b6',
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
            background: 'rgba(20, 16, 36, 0.9)',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          {attachments.map(att => (
            <div
              key={att.id}
              style={{
                background: 'rgba(168, 85, 247, 0.2)',
                border: '1px solid rgba(168, 85, 247, 0.4)',
                borderRadius: 8,
                padding: '3px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                color: '#e2e8f0',
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
                  color: '#94a3b8',
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
          background: 'rgba(20, 16, 36, 0.95)',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
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
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#cbd5e1',
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
            background: 'rgba(255, 255, 255, 0.06)',
            border: isDictating
              ? '1px solid #ef4444'
              : '1px solid rgba(255, 255, 255, 0.18)',
            color: '#ffffff',
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
              : 'rgba(255, 255, 255, 0.08)',
            border: isDictating ? '1px solid #f87171' : '1px solid rgba(255, 255, 255, 0.15)',
            color: '#ffffff',
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
          onClick={() => handleSendMessage()}
          disabled={(!input.trim() && attachments.length === 0) || isLoading}
          aria-label="Send message"
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background:
              (input.trim() || attachments.length > 0) && !isLoading
                ? 'linear-gradient(135deg, #a855f7, #6366f1)'
                : 'rgba(255, 255, 255, 0.08)',
            border: 'none',
            color: (input.trim() || attachments.length > 0) && !isLoading ? '#ffffff' : '#64748b',
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
          <Send style={{ width: 15, height: 15 }} />
        </button>
      </footer>
    </div>
  );
}
