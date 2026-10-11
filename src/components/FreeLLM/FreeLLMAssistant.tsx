'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Moon,
  Sparkles,
  Send,
  X,
  Minimize2,
  Maximize2,
  Settings,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  Bot,
  Zap,
  ChevronDown,
  Info,
} from 'lucide-react';
import { POPULAR_FREE_MODELS } from '@/lib/server/freellm/gateway';

export interface FreeLLMMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: string;
  latencyMs?: number;
}

interface GatewaySettings {
  gatewayUrl: string;
  apiKey: string;
  selectedModel: string;
}

const STORAGE_KEY_HISTORY = 'np_freellm_chat_history';
const STORAGE_KEY_SETTINGS = 'np_freellm_settings';
const STORAGE_KEY_POS = 'np_freellm_moon_btn_pos';

const DEFAULT_SETTINGS: GatewaySettings = {
  gatewayUrl: '',
  apiKey: '',
  selectedModel: 'auto',
};

const STARTER_PROMPTS = [
  'Explain how the FreeLLMAPI router works',
  'Write a TypeScript function with error handling',
  'What are the best techniques for deep focus work?',
  'Compare Gemini 2.5 Flash vs Llama 3.3 70B',
];

export function FreeLLMAssistant({ isPhone = false }: { isPhone?: boolean }) {
  // ── 1. Assistant Visibility & Expansion States ──
  // 'collapsed': Only floating AI Moon button visible
  // 'expanded': Floating chat window visible
  // 'maximized': Full-height expanded workspace
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

  // ── 4. Gateway Connection & Settings ──
  const [settings, setSettings] = useState<GatewaySettings>(DEFAULT_SETTINGS);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [gatewayOnline, setGatewayOnline] = useState<boolean | null>(null);
  const [gatewayLatency, setGatewayLatency] = useState<number | null>(null);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>(
    POPULAR_FREE_MODELS.map(m => m.id)
  );
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

    // 2. Settings
    try {
      const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (savedSettings) {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) });
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
          '👋 Hello! I am your independent **FreeLLMAPI Assistant**.\n\nI connect directly to the **Free LLM API Gateway**, dynamically routing across **34+ free-tier AI providers** (Google Gemini, Groq, Cerebras, Mistral, and more) with automatic failover and zero quota walls.\n\nHow can I help you today?',
        timestamp: Date.now(),
        model: 'auto',
      },
    ]);
  };

  // ── Check Gateway Status ──
  const testGatewayConnection = useCallback(
    async (customUrl?: string, customKey?: string) => {
      setIsTestingGateway(true);
      setGatewayError(null);
      try {
        const targetUrl = customUrl !== undefined ? customUrl : settings.gatewayUrl;
        const targetKey = customKey !== undefined ? customKey : settings.apiKey;

        const params = new URLSearchParams();
        if (targetUrl) params.set('url', targetUrl);
        if (targetKey) params.set('apiKey', targetKey);

        const res = await fetch(`/api/ai/freellm/status?${params.toString()}`);
        const data = await res.json().catch(() => null);

        if (res.ok && data?.ok) {
          setGatewayOnline(Boolean(data.online));
          setGatewayLatency(data.latencyMs ?? null);
          if (Array.isArray(data.models) && data.models.length > 0) {
            setAvailableModels(data.models);
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
        setGatewayError(err.message || 'Could not connect to gateway endpoint.');
      } finally {
        setIsTestingGateway(false);
      }
    },
    [settings.gatewayUrl, settings.apiKey]
  );

  // Check gateway status when assistant is expanded
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

  // Save settings to localStorage
  const updateSettings = (newSettings: Partial<GatewaySettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...newSettings };
      try {
        localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // ── Drag Handlers for the Floating Moon Button ──
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
          // It was a click -> Expand Assistant!
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

  // ── Send Message to FreeLLMAPI Gateway ──
  const handleSendMessage = async (customPrompt?: string) => {
    const text = (customPrompt || input).trim();
    if (!text || isLoading) return;

    const userMsg: FreeLLMMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const updated = [...messages, userMsg];
    updateMessages(updated);
    if (!customPrompt) setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/ai/freellm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updated
            .filter(m => m.id !== 'msg-greeting')
            .map(m => ({ role: m.role, content: m.content })),
          model: settings.selectedModel || 'auto',
          gatewayUrl: settings.gatewayUrl || undefined,
          apiKey: settings.apiKey || undefined,
        }),
      });

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
        model: data.model || settings.selectedModel,
        latencyMs: data.latencyMs,
      };

      updateMessages(prev => [...prev, assistantMsg]);
      setGatewayOnline(true);
      if (data.latencyMs) setGatewayLatency(data.latencyMs);
    } catch (err: any) {
      const errorMsg: FreeLLMMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ **FreeLLMAPI Connection Notice:**\n${err.message || 'Failed to reach FreeLLMAPI gateway.'}\n\n*Check your gateway URL or network in the settings (⚙️ icon above).*`,
        timestamp: Date.now(),
        model: settings.selectedModel,
      };
      updateMessages(prev => [...prev, errorMsg]);
      setGatewayOnline(false);
      setGatewayError(err.message);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleClearHistory = () => {
    if (window.confirm('Clear all FreeLLMAPI chat history?')) {
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

  // ─────────────────────────────────────────────────────────────
  // RENDER: Collapsed State (Movable Floating AI Moon Button)
  // ─────────────────────────────────────────────────────────────
  if (windowState === 'collapsed') {
    return (
      <button
        onPointerDown={handlePointerDown}
        className="freellm-moon-button"
        aria-label="Open FreeLLMAPI Assistant (Movable AI Moon Button)"
        title="🌙 FreeLLM AI Assistant • Drag to reposition, click to expand"
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
  // RENDER: Expanded / Maximized State (Interactive Chat Window)
  // ─────────────────────────────────────────────────────────────
  const isMax = windowState === 'maximized';

  return (
    <div
      role="dialog"
      aria-label="FreeLLMAPI Assistant Window"
      style={{
        position: 'fixed',
        inset: isPhone || isMax ? 0 : 'auto',
        right: isPhone || isMax ? 0 : 20,
        bottom: isPhone || isMax ? 0 : 20,
        width: isPhone || isMax ? '100vw' : 'min(480px, calc(100vw - 32px))',
        height: isPhone || isMax ? '100vh' : 'min(700px, calc(100vh - 40px))',
        zIndex: 85,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(13, 11, 24, 0.92)',
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border: isPhone ? 'none' : '1.5px solid rgba(192, 132, 252, 0.3)',
        borderRadius: isPhone || isMax ? 0 : 24,
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8), 0 0 40px rgba(168, 85, 247, 0.25)',
        overflow: 'hidden',
        color: '#f8fafc',
        fontFamily: 'var(--font-system)',
        transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* ── Header ── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          background: 'rgba(24, 20, 42, 0.7)',
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
              <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '0.01em', color: '#ffffff' }}>
                FreeLLM Assistant
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  padding: '1px 6px',
                  borderRadius: 6,
                  background: 'rgba(168, 85, 247, 0.2)',
                  border: '1px solid rgba(168, 85, 247, 0.4)',
                  color: '#d8b4fe',
                  letterSpacing: '0.05em',
                }}
              >
                Gateway
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
                  ? 'Offline / Not Connected'
                  : 'Checking Gateway...'}
              </span>
            </div>
          </div>
        </div>

        {/* Window Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Settings Toggle */}
          <button
            onClick={() => setIsSettingsOpen(prev => !prev)}
            aria-label="Gateway Settings"
            title="Gateway Settings & Model Config"
            style={{
              background: isSettingsOpen ? 'rgba(168, 85, 247, 0.3)' : 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 8,
              padding: 6,
              color: isSettingsOpen ? '#d8b4fe' : '#cbd5e1',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Settings style={{ width: 15, height: 15 }} />
          </button>

          {/* Clear History */}
          <button
            onClick={handleClearHistory}
            aria-label="Clear chat history"
            title="Clear FreeLLM chat history"
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
            <Trash2 style={{ width: 15, height: 15 }} />
          </button>

          {/* Maximize / Restore Toggle (desktop) */}
          {!isPhone && (
            <button
              onClick={() => setWindowState(prev => (prev === 'maximized' ? 'expanded' : 'maximized'))}
              aria-label={isMax ? 'Restore window size' : 'Maximize window'}
              title={isMax ? 'Restore' : 'Maximize to full screen'}
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
              {isMax ? <Minimize2 style={{ width: 15, height: 15 }} /> : <Maximize2 style={{ width: 15, height: 15 }} />}
            </button>
          )}

          {/* Minimize / Collapse to Moon Button */}
          <button
            onClick={() => setWindowState('collapsed')}
            aria-label="Collapse to floating Moon button"
            title="Collapse to floating Moon button"
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
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>
      </header>

      {/* ── Optional Gateway Settings Dropdown Panel ── */}
      {isSettingsOpen && (
        <div
          style={{
            padding: '14px 18px',
            background: 'rgba(18, 14, 32, 0.95)',
            borderBottom: '1px solid rgba(168, 85, 247, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            fontSize: 13,
            animation: 'fadeIn 0.15s ease-out',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Zap style={{ width: 14, height: 14, color: '#38bdf8' }} />
              Gateway Connection Configuration
            </span>
            <button
              onClick={() => testGatewayConnection()}
              disabled={isTestingGateway}
              style={{
                fontSize: 11,
                padding: '4px 10px',
                borderRadius: 6,
                background: 'rgba(56, 189, 248, 0.15)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                color: '#38bdf8',
                cursor: isTestingGateway ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <RefreshCw style={{ width: 12, height: 12, animation: isTestingGateway ? 'spin 1s linear infinite' : 'none' }} />
              {isTestingGateway ? 'Testing...' : 'Test Status'}
            </button>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
              Gateway Endpoint URL (default: http://localhost:3001 or deployed host)
            </label>
            <input
              type="text"
              placeholder="http://localhost:3001 or https://my-gateway.render.com"
              value={settings.gatewayUrl}
              onChange={e => updateSettings({ gatewayUrl: e.target.value })}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#ffffff',
                fontSize: 12,
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
              Unified API Key (Optional if gateway has no auth requirement)
            </label>
            <input
              type="password"
              placeholder="Enter your unified gateway key if required"
              value={settings.apiKey}
              onChange={e => updateSettings({ apiKey: e.target.value })}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#ffffff',
                fontSize: 12,
                outline: 'none',
              }}
            />
          </div>

          {gatewayError && (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#fca5a5',
                fontSize: 11,
              }}
            >
              ⚠️ {gatewayError}
            </div>
          )}
        </div>
      )}

      {/* ── Model Selector Bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 18px',
          background: 'rgba(255, 255, 255, 0.03)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          fontSize: 12,
        }}
      >
        <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 5 }}>
          <Bot style={{ width: 14, height: 14, color: '#a855f7' }} />
          Model:
        </span>

        <select
          value={settings.selectedModel}
          onChange={e => updateSettings({ selectedModel: e.target.value })}
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#e2e8f0',
            fontSize: 12,
            borderRadius: 8,
            padding: '4px 8px',
            outline: 'none',
            cursor: 'pointer',
            maxWidth: '70%',
          }}
        >
          {POPULAR_FREE_MODELS.map(m => (
            <option key={m.id} value={m.id} style={{ background: '#1e1b2e', color: '#fff' }}>
              {m.name}
            </option>
          ))}
          {availableModels
            .filter(id => !POPULAR_FREE_MODELS.some(p => p.id === id))
            .map(id => (
              <option key={id} value={id} style={{ background: '#1e1b2e', color: '#fff' }}>
                {id}
              </option>
            ))}
        </select>
      </div>

      {/* ── Messages Feed ── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 18px',
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
                    <span style={{ fontWeight: 600 }}>FreeLLM</span>
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
                {msg.content}
              </div>

              {!isUser && (
                <div style={{ display: 'flex', gap: 6, paddingLeft: 4 }}>
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
                </div>
              )}
            </div>
          );
        })}

        {/* Loading / Typing Indicator */}
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', color: '#cbd5e1' }}>
            <Moon style={{ width: 14, height: 14, color: '#a855f7', animation: 'spin 3s linear infinite' }} />
            <span style={{ fontSize: 12, fontStyle: 'italic', color: '#94a3b8' }}>
              FreeLLMAPI is routing through free models...
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Prompt Suggestions (when chat is short) ── */}
      {messages.length <= 2 && !isLoading && (
        <div
          style={{
            padding: '8px 18px',
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            whiteSpace: 'nowrap',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          }}
        >
          {STARTER_PROMPTS.map((prompt, i) => (
            <button
              key={i}
              onClick={() => handleSendMessage(prompt)}
              style={{
                fontSize: 11,
                padding: '5px 10px',
                borderRadius: 12,
                background: 'rgba(168, 85, 247, 0.1)',
                border: '1px solid rgba(168, 85, 247, 0.25)',
                color: '#e2e8f0',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* ── Input Bar ── */}
      <footer
        style={{
          padding: '12px 18px',
          background: 'rgba(20, 16, 36, 0.85)',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 10,
        }}
      >
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
          placeholder="Ask FreeLLMAPI anything (Enter to send)..."
          rows={1}
          style={{
            flex: 1,
            maxHeight: 120,
            minHeight: 38,
            padding: '9px 12px',
            borderRadius: 12,
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            color: '#ffffff',
            fontSize: 13,
            outline: 'none',
            resize: 'none',
            lineHeight: 1.4,
            fontFamily: 'inherit',
          }}
        />

        <button
          onClick={() => handleSendMessage()}
          disabled={!input.trim() || isLoading}
          aria-label="Send message"
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            background:
              input.trim() && !isLoading
                ? 'linear-gradient(135deg, #a855f7, #6366f1)'
                : 'rgba(255, 255, 255, 0.08)',
            border: 'none',
            color: input.trim() && !isLoading ? '#ffffff' : '#64748b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: input.trim() && !isLoading ? 'pointer' : 'default',
            transition: 'all 0.15s ease',
            boxShadow: input.trim() && !isLoading ? '0 0 12px rgba(168, 85, 247, 0.5)' : 'none',
          }}
        >
          <Send style={{ width: 16, height: 16 }} />
        </button>
      </footer>
    </div>
  );
}
