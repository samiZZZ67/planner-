'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db, getActiveTimer, getAIConversations, createAIConversation, updateAIConversationTitle, deleteAIConversation, getAIMessages, saveAIMessage } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import {
  Sparkles, X, Send, Bot, User, Trash2, ShieldCheck,
  CheckCircle2, AlertTriangle, ArrowRight, RefreshCw, Clock,
  Maximize2, Minimize2, Check, CheckSquare, PlusCircle,
  Menu, Plus, Search, Edit2, Square, Mic, MicOff,
  Volume2, VolumeX, Paperclip, FileText, Image as ImageIcon,
  Play, Pause, LoaderCircle, Sliders, Headphones, Radio
} from 'lucide-react';
import type { Task, Section, WeeklyPlan, MonthlyPlan, AIConversation, AIMessageItem } from '@/types';
import { apiFetch } from '@/lib/api/apiClient';
import { FormattedMessage } from './FormattedMessage';

interface AIChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentDate: string;
  isPhone: boolean;
  theme?: 'dark' | 'light';
}

export interface ActionReceipt {
  id: string;
  type: string;
  status: 'success' | 'pending' | 'cancelled' | 'error';
  message: string;
  action: {
    id: string;
    type: string;
    params: any;
    requiresConfirmation?: boolean;
  };
}

export interface AttachedFile {
  name: string;
  type: string;
  size: number;
  textContent?: string;
  dataUrl?: string;
}
function cleanMarkdownForSpeech(text: string): string {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, ' [Code snippet omitted] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[-*+]\s+/g, '')
    .replace(/\n+/g, ' ')
    .trim();
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  provider?: string;
  actions?: ActionReceipt[];
  attachments?: AttachedFile[];
}

function resolveDateString(dateInput: string | undefined, baseDate: string): string {
  if (!dateInput) return baseDate;
  const lower = dateInput.trim().toLowerCase();
  if (lower === 'today') return baseDate;
  if (lower === 'tomorrow') {
    const [y, m, d] = baseDate.split('-').map(Number);
    const dObj = new Date(Date.UTC(y, m - 1, d + 1));
    return dObj.toISOString().split('T')[0];
  }
  if (lower === 'yesterday') {
    const [y, m, d] = baseDate.split('-').map(Number);
    const dObj = new Date(Date.UTC(y, m - 1, d - 1));
    return dObj.toISOString().split('T')[0];
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
    return lower;
  }
  return baseDate;
}

function findTaskByQuery(query: string, tasks: Task[]): Task | null {
  if (!query) return null;
  const q = query.trim().toLowerCase();
  const byId = tasks.find(t => t.id === query);
  if (byId) return byId;
  const byExactTitle = tasks.find(t => t.title.toLowerCase() === q);
  if (byExactTitle) return byExactTitle;
  const byIncludes = tasks.filter(t => t.title.toLowerCase().includes(q) || q.includes(t.title.toLowerCase()));
  if (byIncludes.length > 0) return byIncludes[0];
  return null;
}

const DEFAULT_GREETING = 'Hi! What is on your mind?';

export function AIChatPanel({ isOpen, onClose, currentDate, isPhone, theme }: AIChatPanelProps) {
  // ── Theme State ──
  const [activeTheme, setActiveTheme] = useState<'dark' | 'light'>(theme || 'dark');

  useEffect(() => {
    if (theme) {
      setActiveTheme(theme);
    } else if (typeof document !== 'undefined') {
      const current = document.documentElement.getAttribute('data-theme') as 'dark' | 'light';
      if (current) setActiveTheme(current);
    }
  }, [theme]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const observer = new MutationObserver(() => {
      const current = document.documentElement.getAttribute('data-theme') as 'dark' | 'light';
      if (current) setActiveTheme(current);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const isDark = activeTheme !== 'light';

  // ── Layout & Sidebar States ──
  const [isMaximized, setIsMaximized] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(!isPhone);

  // ── Conversation & History States ──
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [confirmDeleteConvId, setConfirmDeleteConvId] = useState<string | null>(null);

  // ── Chat Messages & Composer ──
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: DEFAULT_GREETING,
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lifecycleState, setLifecycleState] = useState<
    'idle' | 'submitting' | 'connecting' | 'thinking' | 'using_tool' | 'streaming' | 'completed' | 'failed' | 'cancelled'
  >('idle');
  const [activityLabel, setActivityLabel] = useState<string>('');
  const [activeProviderName, setActiveProviderName] = useState<string>('Google Gemini');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  // ── Voice & Audio (Unified Modular Neural Voice) ──
  const [isDictating, setIsDictating] = useState(false);
  const [isSpeakingMessageId, setIsSpeakingMessageId] = useState<string | null>(null);
  const [isPausedMessageId, setIsPausedMessageId] = useState<string | null>(null);
  const [speechLoadingId, setSpeechLoadingId] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<{ messageId: string; error: string; canFallbackToBrowser: boolean } | null>(null);
  const [speechFallbackNotice, setSpeechFallbackNotice] = useState<{ messageId: string; providerName: string } | null>(null);
  const [selectedVoiceProvider, setSelectedVoiceProvider] = useState<string>('elevenlabs');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('pNInz6obpgDQGcFmaJgB');
  const [voiceSpeed, setVoiceSpeed] = useState<number>(1.0);
  const [voiceConfigData, setVoiceConfigData] = useState<any>(null);
  const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState(false);
  const [autoSpeakResponses, setAutoSpeakResponses] = useState(false);
  const autoSpeakResponsesRef = useRef(false);
  const [isTestingVoice, setIsTestingVoice] = useState(false);

  // ── Hands-Free Continuous Duplex Live Voice Call ──
  const [isLiveCallActive, setIsLiveCallActive] = useState(false);
  const isLiveCallActiveRef = useRef(false);
  const [callStatus, setCallStatus] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const callStatusRef = useRef<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [callSubtitle, setCallSubtitle] = useState('Listening... Speak naturally.');
  const [isCallMuted, setIsCallMuted] = useState(false);
  const isCallMutedRef = useRef(false);
  const callRecognitionRef = useRef<any>(null);
  const callSilenceTimerRef = useRef<any>(null);
  const callTranscriptRef = useRef<string>('');

  useEffect(() => {
    isLiveCallActiveRef.current = isLiveCallActive;
  }, [isLiveCallActive]);

  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  useEffect(() => {
    isCallMutedRef.current = isCallMuted;
  }, [isCallMuted]);

  const recognitionRef = useRef<any>(null);
  const chatAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatAudioUrlRef = useRef<string | null>(null);
  const chatAudioAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    autoSpeakResponsesRef.current = autoSpeakResponses;
  }, [autoSpeakResponses]);

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

  // Load voice settings on mount
  useEffect(() => {
    try {
      const savedProvider = localStorage.getItem('np_voice_provider');
      if (savedProvider) setSelectedVoiceProvider(savedProvider);
      const savedVoice = localStorage.getItem('np_voice_id');
      if (savedVoice) setSelectedVoiceId(savedVoice);
      const savedSpeed = localStorage.getItem('np_voice_speed');
      if (savedSpeed) setVoiceSpeed(Number(savedSpeed) || 1.0);
      try { localStorage.removeItem('np_voice_auto_speak'); } catch {}
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

  // ── Avatar Profile ──
  const [profileAvatar, setProfileAvatar] = useState<string>('/icons/icon-192.png');

  // ── Refs ──
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // ── Load Avatar & Conversations on Mount ──
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedAvatar = localStorage.getItem('np_sams_ai_avatar');
      if (savedAvatar) setProfileAvatar(savedAvatar);
    }
    loadConversations();
  }, []);

  const loadConversations = async () => {
    try {
      // 1. Instant load from local Dexie
      const list = await getAIConversations('owner');
      setConversations(list);
      if (list.length > 0 && !activeConversationId) {
        await selectConversation(list[0].id);
      }

      // 2. Fetch server history to ensure phone and PC sync and keep long-term history
      const res = await apiFetch('/api/ai/history?assistant=sams_ai');
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.ok && Array.isArray(data.conversations)) {
          const serverConvs: AIConversation[] = data.conversations;
          const serverMsgs: Record<string, AIMessageItem[]> = data.messages || {};

          for (const c of serverConvs) {
            await db.aiConversations.put(c);
          }
          for (const cId of Object.keys(serverMsgs)) {
            const ms = serverMsgs[cId];
            if (Array.isArray(ms)) {
              for (const m of ms) {
                await db.aiMessages.put(m);
              }
            }
          }

          // If local Dexie had items not on server, sync them up to server
          const localOnly = list.filter(l => !serverConvs.some(s => s.id === l.id));
          if (localOnly.length > 0) {
            const allLocalMsgs: AIMessageItem[] = [];
            for (const loc of localOnly) {
              const ms = await getAIMessages(loc.id);
              allLocalMsgs.push(...ms);
            }
            apiFetch('/api/ai/history', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                assistant: 'sams_ai',
                action: 'sync',
                conversations: localOnly,
                messages: allLocalMsgs,
              }),
            }).catch(() => null);
          }

          const merged = await getAIConversations('owner');
          setConversations(merged);
          if (merged.length > 0) {
            const curId = activeConversationId || merged[0].id;
            const target = merged.find(c => c.id === curId) || merged[0];
            await selectConversation(target.id);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load conversations from Dexie/Server:', e);
    }
  };

  const selectConversation = async (convId: string) => {
    setActiveConversationId(convId);
    if (isPhone) setIsSidebarOpen(false);
    try {
      const dbMsgs = await getAIMessages(convId);
      if (dbMsgs.length > 0) {
        setMessages(dbMsgs.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          provider: m.provider,
          actions: m.actions,
        })));
      } else {
        setMessages([
          {
            id: 'welcome',
            role: 'assistant',
            content: DEFAULT_GREETING,
            timestamp: Date.now(),
          },
        ]);
      }
    } catch {
      // Fallback
    }
  };

  const handleStartNewChat = async () => {
    setActiveConversationId(null);
    setAttachedFiles([]);
    setInput('');
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: DEFAULT_GREETING,
        timestamp: Date.now(),
      },
    ]);
    if (isPhone) setIsSidebarOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleSaveRename = async (convId: string) => {
    if (!editingTitle.trim()) {
      setEditingConvId(null);
      return;
    }
    const updated = await updateAIConversationTitle(convId, editingTitle.trim());
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, title: editingTitle.trim() } : c));
    setEditingConvId(null);
    if (updated) {
      apiFetch('/api/ai/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assistant: 'sams_ai',
          action: 'save_conversation',
          conversation: updated,
        }),
      }).catch(() => null);
    }
  };

  const handleDeleteConversation = async (convId: string) => {
    await deleteAIConversation(convId);
    setConversations(prev => prev.filter(c => c.id !== convId));
    setConfirmDeleteConvId(null);
    if (activeConversationId === convId) {
      handleStartNewChat();
    }
    apiFetch('/api/ai/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistant: 'sams_ai',
        action: 'delete_conversation',
        conversationId: convId,
      }),
    }).catch(() => null);
  };

  // ── Keyboard Shortcuts (Esc & Ctrl+K) ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        if (confirmDeleteConvId) {
          setConfirmDeleteConvId(null);
          return;
        }
        if (isSidebarOpen && isPhone) {
          setIsSidebarOpen(false);
          return;
        }
        onClose();
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handleStartNewChat();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSidebarOpen, isPhone, confirmDeleteConvId, onClose]);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [isOpen, messages]);

  // Clean up speech, live call, and abort on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (callSilenceTimerRef.current) {
        clearTimeout(callSilenceTimerRef.current);
        callSilenceTimerRef.current = null;
      }
      if (callRecognitionRef.current) {
        try { callRecognitionRef.current.abort(); } catch {}
        callRecognitionRef.current = null;
      }
      if (chatAudioRef.current) {
        chatAudioRef.current.pause();
        chatAudioRef.current.src = '';
        chatAudioRef.current = null;
      }
      if (chatAudioUrlRef.current) {
        URL.revokeObjectURL(chatAudioUrlRef.current);
        chatAudioUrlRef.current = null;
      }
      chatAudioAbortRef.current?.abort();
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, []);

  // ── Gather Live Context for Sam's AI ──
  const gatherFullContext = async () => {
    const monthId = currentDate.slice(0, 7);
    const [todayTasks, allTasks, sections, dayRecord, activeTimer, timeLogsToday, allWeeks, monthlyPlan] = await Promise.all([
      db.tasks.filter(t => t.date === currentDate && !t.deleted).toArray(),
      db.tasks.filter(t => !t.deleted).toArray(),
      db.sections.filter(s => !s.deleted).toArray(),
      db.days.get(currentDate),
      getActiveTimer(),
      db.timeLogs.filter(tl => tl.date === currentDate && !tl.deleted).toArray(),
      db.weeklyPlans.filter(w => !w.deleted).toArray(),
      db.monthlyPlans.get(monthId),
    ]);

    const weeklyPlan = allWeeks.find(w => currentDate >= w.startDate && currentDate <= w.endDate) || null;

    return {
      currentDate,
      focusBudgetHours: dayRecord?.freeHours || 8,
      todayTasks: todayTasks.map(t => {
        const sec = sections.find(s => s.id === t.sectionId);
        return {
          id: t.id,
          title: t.title,
          sectionId: t.sectionId,
          sectionName: sec?.name || 'General',
          isCompleted: t.isCompleted,
          status: t.status,
          startTime: t.startTime,
          endTime: t.endTime,
          scheduledMinutes: t.scheduledMinutes || t.estimatedMinutes || 60,
          estimatedMinutes: t.estimatedMinutes,
          priority: t.priority,
          mustDo: t.mustDo,
          deadline: t.deadline,
          description: t.description,
        };
      }),
      recentTasks: allTasks.slice(-50).map(t => {
        const sec = sections.find(s => s.id === t.sectionId);
        return {
          id: t.id,
          title: t.title,
          date: t.date,
          isCompleted: t.isCompleted,
          sectionName: sec?.name || 'General',
          priority: t.priority,
          deadline: t.deadline,
        };
      }),
      sections: sections.map(s => ({
        id: s.id,
        name: s.name,
        color: s.color,
        dailyTargetMinutes: s.dailyTargetMinutes,
        targetType: s.targetType,
      })),
      dayRecord,
      activeTimer,
      timeLogsToday,
      weeklyPlan: weeklyPlan ? {
        startDate: weeklyPlan.startDate,
        endDate: weeklyPlan.endDate,
        goals: weeklyPlan.goals,
        aastuCommitments: weeklyPlan.aastuCommitments,
        deepWorkTargets: weeklyPlan.deepWorkTargets,
      } : null,
      monthlyPlan: monthlyPlan ? {
        month: monthlyPlan.month,
        title: monthlyPlan.title,
        academicPriorities: monthlyPlan.academicPriorities,
        editingTargets: monthlyPlan.editingTargets,
      } : null,
    };
  };

  // ── Execute Actions Locally against Dexie & Notify Planner ──
  const executeLocalAction = async (action: any): Promise<ActionReceipt> => {
    try {
      const [allTasks, sections] = await Promise.all([
        db.tasks.toArray(),
        db.sections.filter(s => !s.deleted).toArray(),
      ]);

      if (action.type === 'create_task') {
        if (action.status === 'failed') {
          return {
            id: action.id,
            type: 'create_task',
            status: 'error',
            message: action.error || 'Server failed to save task to database.',
            action,
          };
        }

        if (action.savedTask) {
          const saved: Task = action.savedTask;
          await db.tasks.put({ ...saved, synced: 1 });
          syncEngine.notifyLocalMutation();
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('samsspace:task-created', { detail: saved }));
            window.dispatchEvent(new CustomEvent('nightplanner:task-created', { detail: saved }));
          }
          const matchedSec = sections.find(s => s.id === saved.sectionId);
          return {
            id: action.id,
            type: 'create_task',
            status: 'success',
            message: `Created task "${saved.title}" in ${matchedSec?.name || 'Tasks'} (${saved.date}, ${saved.scheduledMinutes || saved.estimatedMinutes || 60}m)`,
            action,
          };
        }

        const params = action.params || {};
        const targetDate = resolveDateString(params.date, currentDate);
        const sec = sections.find(s =>
          s.id === params.section ||
          s.name.toLowerCase() === (params.section || '').toLowerCase()
        ) || sections[0];

        const duration = Number(params.scheduledMinutes) || 60;
        const now = Date.now();
        const newTask: Task = {
          id: crypto.randomUUID(),
          date: targetDate,
          sectionId: sec?.id || 'default-sec-1',
          title: params.title || 'New Task',
          description: params.description || '',
          strategy: '',
          doneMeans: '',
          estimatedMinutes: duration,
          scheduledMinutes: duration,
          priority: params.priority || 'Medium',
          mustDo: params.mustDo || false,
          startTime: params.startTime,
          endTime: params.endTime,
          deadline: params.deadline || targetDate,
          tags: [],
          icon: '🎯',
          isCompleted: false,
          completedAt: null,
          order: 99,
          createdAt: now,
          updatedAt: now,
          deleted: false,
          isSample: false,
          synced: 0,
          status: 'not_started',
        };

        await db.tasks.put(newTask);
        syncEngine.notifyLocalMutation();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('samsspace:task-created', { detail: newTask }));
          window.dispatchEvent(new CustomEvent('nightplanner:task-created', { detail: newTask }));
        }

        return {
          id: action.id,
          type: 'create_task',
          status: 'success',
          message: `Created task "${newTask.title}" in ${sec?.name || 'Tasks'} (${targetDate}, ${duration}m)`,
          action,
        };
      }

      if (action.type === 'update_task') {
        if (action.status === 'failed') {
          return {
            id: action.id,
            type: 'update_task',
            status: 'error',
            message: action.error || 'Server failed to update task in database.',
            action,
          };
        }

        if (action.savedTask) {
          const saved: Task = action.savedTask;
          await db.tasks.put({ ...saved, synced: 1 });
          syncEngine.notifyLocalMutation();
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('samsspace:task-updated', { detail: saved }));
            window.dispatchEvent(new CustomEvent('nightplanner:task-updated', { detail: saved }));
          }
          return {
            id: action.id,
            type: 'update_task',
            status: 'success',
            message: `Updated task "${saved.title}"`,
            action,
          };
        }

        const params = action.params || {};
        const query = params.taskIdentifier || '';
        const targetTask = findTaskByQuery(query, allTasks.filter(t => !t.deleted));

        if (!targetTask) {
          return {
            id: action.id,
            type: 'update_task',
            status: 'error',
            message: `Could not find task matching "${query}".`,
            action,
          };
        }

        const updates = params.updates || {};
        if (updates.isCompleted !== undefined) {
          targetTask.isCompleted = Boolean(updates.isCompleted);
          targetTask.completedAt = updates.isCompleted ? Date.now() : null;
          targetTask.status = updates.isCompleted ? 'completed' : 'not_started';
        }
        if (updates.title) targetTask.title = updates.title;
        if (updates.date) targetTask.date = resolveDateString(updates.date, currentDate);
        if (updates.deadline) targetTask.deadline = resolveDateString(updates.deadline, currentDate);
        if (updates.priority) targetTask.priority = updates.priority;
        if (updates.startTime) targetTask.startTime = updates.startTime;
        if (updates.endTime) targetTask.endTime = updates.endTime;
        if (updates.scheduledMinutes) {
          targetTask.scheduledMinutes = Number(updates.scheduledMinutes);
          targetTask.estimatedMinutes = Number(updates.scheduledMinutes);
        }
        if (updates.section) {
          const s = sections.find(sec =>
            sec.id === updates.section ||
            sec.name.toLowerCase() === updates.section.toLowerCase()
          );
          if (s) targetTask.sectionId = s.id;
        }

        targetTask.updatedAt = Date.now();
        targetTask.synced = 0;
        await db.tasks.put(targetTask);
        syncEngine.notifyLocalMutation();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('samsspace:task-updated', { detail: targetTask }));
          window.dispatchEvent(new CustomEvent('nightplanner:task-updated', { detail: targetTask }));
        }

        return {
          id: action.id,
          type: 'update_task',
          status: 'success',
          message: `Updated task "${targetTask.title}"`,
          action,
        };
      }

      if (action.type === 'delete_task') {
        if (action.requiresConfirmation) {
          return {
            id: action.id,
            type: 'delete_task',
            status: 'pending',
            message: `Are you sure you want to permanently delete task "${action.params?.taskTitle || action.params?.taskIdentifier}"?`,
            action,
          };
        }

        const query = action.params?.taskIdentifier || action.params?.taskTitle || '';
        const targetTask = findTaskByQuery(query, allTasks.filter(t => !t.deleted));
        if (!targetTask) {
          return {
            id: action.id,
            type: 'delete_task',
            status: 'error',
            message: `Task "${query}" not found to delete.`,
            action,
          };
        }

        targetTask.deleted = true;
        targetTask.updatedAt = Date.now();
        targetTask.synced = 0;
        await db.tasks.put(targetTask);
        syncEngine.notifyLocalMutation();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('samsspace:task-deleted', { detail: targetTask.id }));
          window.dispatchEvent(new CustomEvent('nightplanner:task-deleted', { detail: targetTask.id }));
        }

        return {
          id: action.id,
          type: 'delete_task',
          status: 'success',
          message: `Deleted task "${targetTask.title}"`,
          action,
        };
      }

      if (action.type === 'delete_all_tasks') {
        return {
          id: action.id,
          type: 'delete_all_tasks',
          status: 'pending',
          message: `Are you sure you want to delete ALL tasks scheduled for ${action.params?.date || currentDate}? This cannot be undone.`,
          action,
        };
      }

      if (action.type === 'create_section') {
        const params = action.params || {};
        const newSec: Section = {
          id: `sec-${crypto.randomUUID().slice(0, 8)}`,
          name: params.name || 'New Category',
          color: params.color || '#8b5cf6',
          icon: params.icon || '🎨',
          order: sections.length,
          dailyTargetMinutes: params.dailyTargetMinutes || null,
          targetType: 'at least',
          updatedAt: Date.now(),
          deleted: false,
          isSample: false,
          synced: 0,
        };
        await db.sections.put(newSec);
        syncEngine.notifyLocalMutation();
        return {
          id: action.id,
          type: 'create_section',
          status: 'success',
          message: `Created new category "${newSec.name}"`,
          action,
        };
      }

      if (action.type === 'start_timer' || action.type === 'pause_timer' || action.type === 'stop_timer') {
        if (typeof window !== 'undefined') {
          const timerDetail = {
            action: action.type === 'start_timer' ? 'start' : action.type === 'pause_timer' ? 'pause' : 'stop',
            taskId: action.params?.taskId,
            taskTitle: action.params?.taskTitle,
            minutes: action.params?.minutes || 25,
          };
          window.dispatchEvent(new CustomEvent('samsspace:timer-action', { detail: timerDetail }));
          window.dispatchEvent(new CustomEvent('nightplanner:timer-action', { detail: timerDetail }));
        }
        return {
          id: action.id,
          type: action.type,
          status: 'success',
          message: action.type === 'start_timer'
            ? `Started timer for ${action.params?.minutes || 25} minutes.`
            : action.type === 'pause_timer'
            ? 'Paused active timer.'
            : 'Stopped and saved timer session.',
          action,
        };
      }

      if (action.type === 'navigate') {
        const tab = action.params?.tab || 'todo';
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('samsspace:navigate', { detail: { tab } }));
          window.dispatchEvent(new CustomEvent('nightplanner:navigate', { detail: { tab } }));
        }
        return {
          id: action.id,
          type: 'navigate',
          status: 'success',
          message: `Navigated to ${tab}.`,
          action,
        };
      }

      if (action.type === 'manage_plan') {
        const params = action.params || {};
        if (params.planType === 'day') {
          const date = resolveDateString(params.date, currentDate);
          const day = (await db.days.get(date)) || {
            id: date,
            date,
            freeHours: 8,
            review: { worked: '', blocked: '', change: '' },
            updatedAt: Date.now(),
            deleted: false,
            isSample: false,
            synced: 0,
          };
          if (params.updates?.freeHours) {
            day.freeHours = Number(params.updates.freeHours);
          }
          day.updatedAt = Date.now();
          day.synced = 0;
          await db.days.put(day);
          syncEngine.notifyLocalMutation();
          return {
            id: action.id,
            type: 'manage_plan',
            status: 'success',
            message: `Updated focus budget to ${day.freeHours} hours for ${date}`,
            action,
          };
        }
      }

      return {
        id: action.id,
        type: action.type,
        status: 'error',
        message: `Unsupported action type: ${action.type}`,
        action,
      };
    } catch (err: any) {
      return {
        id: action.id,
        type: action.type,
        status: 'error',
        message: `Action execution failed: ${err.message}`,
        action,
      };
    }
  };

  // ── Confirm / Cancel Destructive Deletion ──
  const handleConfirmDelete = async (actionReceipt: ActionReceipt) => {
    try {
      if (actionReceipt.action.type === 'delete_all_tasks') {
        const targetDate = actionReceipt.action.params?.date || currentDate;
        const tasksToDelete = await db.tasks.filter(t => t.date === targetDate && !t.deleted).toArray();
        const now = Date.now();
        for (const t of tasksToDelete) {
          t.deleted = true;
          t.updatedAt = now;
          t.synced = 0;
          await db.tasks.put(t);
        }
        syncEngine.notifyLocalMutation();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('samsspace:tasks-bulk-deleted', { detail: { date: targetDate } }));
          window.dispatchEvent(new CustomEvent('nightplanner:tasks-bulk-deleted', { detail: { date: targetDate } }));
        }
        updateActionReceipt(actionReceipt.id, 'success', `Deleted all ${tasksToDelete.length} tasks scheduled for ${targetDate}.`);
        return;
      }

      const allTasks = await db.tasks.toArray();
      const query = actionReceipt.action.params?.taskIdentifier || actionReceipt.action.params?.taskTitle || '';
      const targetTask = findTaskByQuery(query, allTasks.filter(t => !t.deleted));

      if (!targetTask) {
        updateActionReceipt(actionReceipt.id, 'error', `Could not find task "${query}" to delete.`);
        return;
      }

      targetTask.deleted = true;
      targetTask.updatedAt = Date.now();
      targetTask.synced = 0;
      await db.tasks.put(targetTask);
      syncEngine.notifyLocalMutation();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('samsspace:task-deleted', { detail: targetTask.id }));
        window.dispatchEvent(new CustomEvent('nightplanner:task-deleted', { detail: targetTask.id }));
      }

      updateActionReceipt(actionReceipt.id, 'success', `Deleted task "${targetTask.title}".`);
    } catch (err: any) {
      updateActionReceipt(actionReceipt.id, 'error', `Failed to delete: ${err.message}`);
    }
  };

  const handleCancelDelete = (actionReceipt: ActionReceipt) => {
    const title = actionReceipt.action.params?.taskTitle || actionReceipt.action.params?.taskIdentifier || 'action';
    updateActionReceipt(actionReceipt.id, 'cancelled', `Cancelled deletion of "${title}".`);
  };

  const updateActionReceipt = (actionId: string, status: ActionReceipt['status'], message: string) => {
    setMessages(prev => prev.map(msg => {
      if (!msg.actions) return msg;
      const updatedActions = msg.actions.map(a => a.id === actionId ? { ...a, status, message } : a);
      return { ...msg, actions: updatedActions };
    }));
  };

  // ── Send Message with Stop Controller & Persistence ──
  const handleSendMessage = async (textToSend?: string, isFromVoiceCall = false) => {
    const content = (textToSend || input).trim();
    if ((!content && attachedFiles.length === 0) || loading) return;

    if (chatAudioRef.current) {
      chatAudioRef.current.pause();
      chatAudioRef.current.src = '';
      chatAudioRef.current = null;
    }
    if (chatAudioUrlRef.current) {
      URL.revokeObjectURL(chatAudioUrlRef.current);
      chatAudioUrlRef.current = null;
    }
    chatAudioAbortRef.current?.abort();
    setIsSpeakingMessageId(null);

    let convId = activeConversationId;
    if (!convId) {
      const generatedTitle = (content || attachedFiles[0]?.name || 'Chat').slice(0, 32);
      const newConv = await createAIConversation(generatedTitle, 'owner');
      convId = newConv.id;
      setActiveConversationId(convId);
      setConversations(prev => [newConv, ...prev]);

      apiFetch('/api/ai/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assistant: 'sams_ai',
          action: 'save_conversation',
          conversation: newConv,
        }),
      }).catch(() => null);
    }

    // Build context with attached files if any
    let fullPromptText = content;
    if (attachedFiles.length > 0) {
      const fileHeaders = attachedFiles
        .map(f => `\n--- ATTACHED FILE: ${f.name} (${f.type}, ${Math.round(f.size / 1024)}KB) ---\n${f.textContent || '[Binary Attachment]'}\n--- END OF FILE ---\n`)
        .join('\n');
      fullPromptText = `${fullPromptText}\n\n${fileHeaders}`.trim();
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content || `[Sent ${attachedFiles.length} attachment(s)]`,
      timestamp: Date.now(),
      attachments: attachedFiles.length > 0 ? [...attachedFiles] : undefined,
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    if (!textToSend) setInput('');
    setAttachedFiles([]);
    setLoading(true);
    setLifecycleState('submitting');
    setActivityLabel('Analyzing workspace data...');

    // Save user message to Dexie and sync to server
    const userMsgItem: AIMessageItem = {
      id: userMsg.id,
      conversationId: convId,
      role: userMsg.role,
      content: userMsg.content,
      timestamp: userMsg.timestamp,
    };
    await saveAIMessage(userMsgItem);
    apiFetch('/api/ai/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistant: 'sams_ai',
        action: 'save_message',
        message: userMsgItem,
      }),
    }).catch(() => null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const fullContext = await gatherFullContext();
      setLifecycleState('connecting');
      setActivityLabel('Consulting Sam’s AI...');

      const res = await apiFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream, application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          context: fullContext,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (res.headers.get('content-type')?.includes('text/event-stream')) {
        if (!res.ok || !res.body) {
          throw new Error(`AI stream error (${res.status}).`);
        }
        setLifecycleState('thinking');
        setActivityLabel('Thinking...');
        const streamedMsgId = crypto.randomUUID();
        let streamedContent = '';
        let streamedProvider = activeProviderName;
        let finalActions: any[] = [];
        let verifiedFeedback: string | null = null;
        let errorFeedback: string | null = null;

        setMessages(prev => [...prev, {
          id: streamedMsgId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          provider: streamedProvider,
        }]);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let ended = false;

        const processLine = (line: string) => {
          if (!line.startsWith('data:')) return;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') {
            ended = true;
            return;
          }
          try {
            const event = JSON.parse(payload);
            if (event.provider) {
              streamedProvider = event.provider;
              setActiveProviderName(event.provider);
            }
            if (event.type === 'done') {
              if (Array.isArray(event.actions)) finalActions = event.actions;
              if (event.verifiedFeedback) verifiedFeedback = event.verifiedFeedback;
              if (event.errorFeedback) errorFeedback = event.errorFeedback;
            }
            const delta = event.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta) {
              setLifecycleState('streaming');
              streamedContent += delta;
              setMessages(prev => prev.map(m => m.id === streamedMsgId
                ? { ...m, content: streamedContent, provider: streamedProvider }
                : m
              ));
            }
          } catch {}
        };

        while (!ended) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) processLine(line);
        }
        buffer += decoder.decode();
        if (buffer.trim()) processLine(buffer);

        if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');

        // Execute any returned actions on local Dexie
        const actionReceipts: ActionReceipt[] = [];
        if (finalActions.length > 0) {
          setLifecycleState('using_tool');
          setActivityLabel('Executing actions in workspace...');
          for (const act of finalActions) {
            const receipt = await executeLocalAction(act);
            actionReceipts.push(receipt);
          }
        }

        const finalAssistantText = errorFeedback || verifiedFeedback || streamedContent || 'Task completed.';
        const assistantMsg: Message = {
          id: streamedMsgId,
          role: 'assistant',
          content: finalAssistantText,
          timestamp: Date.now(),
          provider: streamedProvider,
          actions: actionReceipts.length > 0 ? actionReceipts : undefined,
        };

        setMessages(prev => prev.map(m => m.id === streamedMsgId ? assistantMsg : m));
        setLifecycleState('completed');

        // Save assistant message to Dexie and sync to server
        const assistantMsgItem: AIMessageItem = {
          id: assistantMsg.id,
          conversationId: convId,
          role: assistantMsg.role,
          content: assistantMsg.content,
          timestamp: assistantMsg.timestamp,
          provider: assistantMsg.provider,
          actions: assistantMsg.actions,
        };
        await saveAIMessage(assistantMsgItem);
        apiFetch('/api/ai/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assistant: 'sams_ai',
            action: 'save_message',
            message: assistantMsgItem,
          }),
        }).catch(() => null);

        // Only auto-speak when explicitly requested through hands-free Live Voice Call.
        // Standard typed chat responses never auto-speak to protect ElevenLabs quota.
        if (isFromVoiceCall && isLiveCallActiveRef.current && assistantMsg.content.trim()) {
          void handleSpeakMessage(assistantMsg);
        }
      } else {
        const data = await res.json().catch(() => null);

        if (!res.ok) {
          let errDesc = data?.error;
          if (!errDesc) {
            if (res.status === 401) {
              errDesc = 'Please log in with your app password to use Sam’s AI.';
            } else if (res.status === 429) {
              errDesc = 'AI providers are currently rate-limited. Please wait a moment and try again.';
            } else if (res.status === 502) {
              errDesc = 'AI provider service is temporarily unreachable.';
            } else {
              errDesc = `Chat service error (${res.status}).`;
            }
          }
          throw new Error(errDesc);
        }

        if (data?.provider) setActiveProviderName(data.provider);

        // Execute returned actions locally on Dexie
        const rawActions = data?.actions || [];
        const actionReceipts: ActionReceipt[] = [];

        for (const act of rawActions) {
          const receipt = await executeLocalAction(act);
          actionReceipts.push(receipt);
        }

        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data?.message?.content || 'No response received from Sam’s AI.',
          timestamp: Date.now(),
          provider: data?.provider || 'Sam’s AI',
          actions: actionReceipts.length > 0 ? actionReceipts : undefined,
        };

        setMessages(prev => [...prev, assistantMsg]);
        setLifecycleState('completed');

        // Save assistant message to Dexie and sync to server
        const assistantMsgItem: AIMessageItem = {
          id: assistantMsg.id,
          conversationId: convId,
          role: assistantMsg.role,
          content: assistantMsg.content,
          timestamp: assistantMsg.timestamp,
          provider: assistantMsg.provider,
          actions: assistantMsg.actions,
        };
        await saveAIMessage(assistantMsgItem);
        apiFetch('/api/ai/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assistant: 'sams_ai',
            action: 'save_message',
            message: assistantMsgItem,
          }),
        }).catch(() => null);

        // Only auto-speak when explicitly requested through hands-free Live Voice Call.
        // Standard typed chat responses never auto-speak to protect ElevenLabs quota.
        if (isFromVoiceCall && isLiveCallActiveRef.current && assistantMsg.content.trim()) {
          void handleSpeakMessage(assistantMsg);
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setLifecycleState('cancelled');
        const stopMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '⏹️ Generation stopped by user.',
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, stopMsg]);
        const stopMsgItem: AIMessageItem = {
          id: stopMsg.id,
          conversationId: convId,
          role: stopMsg.role,
          content: stopMsg.content,
          timestamp: stopMsg.timestamp,
        };
        await saveAIMessage(stopMsgItem);
        apiFetch('/api/ai/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assistant: 'sams_ai',
            action: 'save_message',
            message: stopMsgItem,
          }),
        }).catch(() => null);
      } else {
        setLifecycleState('failed');
        const errorMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `⚠️ ${err.message || 'Could not connect to Sam’s AI. Please verify network or API keys.'}`,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, errorMsg]);
        if (isLiveCallActiveRef.current) {
          setCallStatus('listening');
          callStatusRef.current = 'listening';
          setCallSubtitle('Could not get response. Listening for your voice...');
          startCallRecognition();
        }
      }
    } finally {
      setLoading(false);
      setActivityLabel('');
      abortControllerRef.current = null;
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
  };

  // ── Voice Dictation (Speech-to-Text) ──
  const handleToggleDictation = () => {
    if (isDictating) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      setIsDictating(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Speech Recognition is not supported by your current browser. Try Google Chrome or Safari.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsDictating(true);
      };

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setInput(prev => (prev ? `${prev} ${transcript}` : transcript));
      };

      recognition.onerror = (e: any) => {
        console.warn('Speech recognition notice:', e.error);
        setIsDictating(false);
        if (e.error === 'not-allowed') {
          alert('Microphone access was denied. Please allow microphone permissions in browser settings.');
        }
      };

      recognition.onend = () => {
        setIsDictating(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.warn('Could not initialize speech recognition:', err);
      setIsDictating(false);
    }
  };

  // ── Hands-Free Continuous Duplex Live Voice Call Functions ──
  const stopLiveVoiceCall = useCallback(() => {
    isLiveCallActiveRef.current = false;
    setIsLiveCallActive(false);
    setCallStatus('idle');
    callStatusRef.current = 'idle';
    setCallSubtitle('Listening... Speak naturally.');
    callTranscriptRef.current = '';
    if (callSilenceTimerRef.current) {
      clearTimeout(callSilenceTimerRef.current);
      callSilenceTimerRef.current = null;
    }
    if (callRecognitionRef.current) {
      try { callRecognitionRef.current.abort(); } catch {}
      callRecognitionRef.current = null;
    }
    if (chatAudioRef.current) {
      chatAudioRef.current.pause();
      chatAudioRef.current.src = '';
      chatAudioRef.current = null;
    }
    if (chatAudioUrlRef.current) {
      URL.revokeObjectURL(chatAudioUrlRef.current);
      chatAudioUrlRef.current = null;
    }
    chatAudioAbortRef.current?.abort();
    setIsSpeakingMessageId(null);
    setIsPausedMessageId(null);
  }, []);

  const startCallRecognition = useCallback(() => {
    if (!isLiveCallActiveRef.current || isCallMutedRef.current) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setCallSubtitle('Speech recognition is not supported in this browser. Try Chrome or Safari.');
      return;
    }

    try {
      if (callRecognitionRef.current) {
        try { callRecognitionRef.current.abort(); } catch {}
        callRecognitionRef.current = null;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        if (!isLiveCallActiveRef.current) {
          try { recognition.abort(); } catch {}
          return;
        }
        setCallStatus('listening');
        callStatusRef.current = 'listening';
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          if (item.isFinal) {
            final += item[0].transcript;
          } else {
            interim += item[0].transcript;
          }
        }
        const currentText = (final || interim).trim();
        if (currentText) {
          callTranscriptRef.current = currentText;
          setCallSubtitle(currentText);

          // 1500ms silence auto-submits speech
          if (callSilenceTimerRef.current) clearTimeout(callSilenceTimerRef.current);
          callSilenceTimerRef.current = setTimeout(() => {
            if (!isLiveCallActiveRef.current) return;
            const phrase = callTranscriptRef.current.trim();
            if (phrase) {
              try { recognition.stop(); } catch {}
              setCallStatus('thinking');
              callStatusRef.current = 'thinking';
              setCallSubtitle('Thinking...');
              callTranscriptRef.current = '';
              void handleSendMessage(phrase, true);
            }
          }, 1500);
        }
      };

      recognition.onerror = (e: any) => {
        console.warn('[Live Call] Speech recognition notice:', e.error);
        if (e.error === 'not-allowed') {
          alert('Microphone access was denied. Please allow microphone permissions in browser settings.');
          stopLiveVoiceCall();
        }
      };

      recognition.onend = () => {
        if (isLiveCallActiveRef.current && callStatusRef.current === 'listening' && !isCallMutedRef.current) {
          try { recognition.start(); } catch {}
        }
      };

      callRecognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.warn('[Live Call] Could not start speech recognition:', err);
    }
  }, [stopLiveVoiceCall, handleSendMessage]);

  const toggleLiveVoiceCall = useCallback(() => {
    if (isLiveCallActive) {
      stopLiveVoiceCall();
    } else {
      isLiveCallActiveRef.current = true;
      setIsLiveCallActive(true);
      setIsCallMuted(false);
      isCallMutedRef.current = false;
      setCallStatus('listening');
      callStatusRef.current = 'listening';
      setCallSubtitle('Listening... Speak naturally.');
      callTranscriptRef.current = '';
      setTimeout(() => {
        startCallRecognition();
      }, 150);
    }
  }, [isLiveCallActive, stopLiveVoiceCall, startCallRecognition]);

  const interruptCall = useCallback(() => {
    if (chatAudioRef.current) {
      chatAudioRef.current.pause();
      chatAudioRef.current.src = '';
      chatAudioRef.current = null;
    }
    if (chatAudioUrlRef.current) {
      URL.revokeObjectURL(chatAudioUrlRef.current);
      chatAudioUrlRef.current = null;
    }
    chatAudioAbortRef.current?.abort();
    abortControllerRef.current?.abort();
    setIsSpeakingMessageId(null);
    setIsPausedMessageId(null);
    setCallStatus('listening');
    callStatusRef.current = 'listening';
    setCallSubtitle('Interrupted. Listening again...');
    callTranscriptRef.current = '';
    startCallRecognition();
  }, [startCallRecognition]);

  // ── Text-to-Speech (Spoken AI response via Modular Neural TTS) ──
  const handleSpeakMessage = async (msg: Message | { id: string; content: string }, forceBrowser = false) => {
    // If clicking the same message currently playing: toggle pause / resume
    if (isSpeakingMessageId === msg.id) {
      if (isPausedMessageId === msg.id && chatAudioRef.current) {
        chatAudioRef.current.play().catch(() => null);
        setIsPausedMessageId(null);
        return;
      } else if (chatAudioRef.current && !chatAudioRef.current.paused) {
        chatAudioRef.current.pause();
        setIsPausedMessageId(msg.id);
        return;
      }
    }

    // Stop any active audio
    if (chatAudioRef.current) {
      chatAudioRef.current.pause();
      chatAudioRef.current.src = '';
      chatAudioRef.current = null;
    }
    if (chatAudioUrlRef.current) {
      URL.revokeObjectURL(chatAudioUrlRef.current);
      chatAudioUrlRef.current = null;
    }
    chatAudioAbortRef.current?.abort();
    chatAudioAbortRef.current = null;
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    setIsSpeakingMessageId(null);
    setIsPausedMessageId(null);
    setSpeechError(null);
    setSpeechFallbackNotice(null);

    // If user explicitly chose browser speech synthesis
    if (forceBrowser) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const clean = cleanMarkdownForSpeech(msg.content);
        const utterance = new SpeechSynthesisUtterance(clean);
        utterance.rate = voiceSpeed;
        utterance.onend = () => {
          setIsSpeakingMessageId(null);
          setIsPausedMessageId(null);
          if (isLiveCallActiveRef.current) {
            setCallStatus('listening');
            callStatusRef.current = 'listening';
            setCallSubtitle('Listening... Speak naturally.');
            callTranscriptRef.current = '';
            startCallRecognition();
          }
        };
        utterance.onerror = () => {
          setIsSpeakingMessageId(null);
          setIsPausedMessageId(null);
          if (isLiveCallActiveRef.current) {
            setCallStatus('listening');
            callStatusRef.current = 'listening';
            setCallSubtitle('Listening... Speak naturally.');
            callTranscriptRef.current = '';
            startCallRecognition();
          }
        };
        setIsSpeakingMessageId(msg.id);
        window.speechSynthesis.speak(utterance);
      }
      return;
    }

    const cleanText = cleanMarkdownForSpeech(msg.content);
    if (!cleanText) return;

    if (isLiveCallActiveRef.current) {
      setCallStatus('speaking');
      callStatusRef.current = 'speaking';
      setCallSubtitle('Preparing spoken response...');
    }

    setSpeechLoadingId(msg.id);
    const controller = new AbortController();
    chatAudioAbortRef.current = controller;

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

      const blob = await response.blob();
      if (controller.signal.aborted) return;

      const fallbackTriggered = response.headers.get('X-Voice-Fallback') === 'true';
      const providerName = response.headers.get('X-Voice-Provider') || 'Neural Voice';
      if (fallbackTriggered) {
        setSpeechFallbackNotice({ messageId: msg.id, providerName });
      }

      const url = URL.createObjectURL(blob);
      chatAudioUrlRef.current = url;
      const audio = new Audio(url);
      chatAudioRef.current = audio;
      audio.playbackRate = voiceSpeed;

      audio.onplay = () => {
        setSpeechLoadingId(null);
        setIsSpeakingMessageId(msg.id);
        setIsPausedMessageId(null);
        if (isLiveCallActiveRef.current) {
          setCallStatus('speaking');
          callStatusRef.current = 'speaking';
          setCallSubtitle('Sam’s AI is speaking...');
        }
      };

      audio.onpause = () => {
        if (chatAudioRef.current?.paused && !chatAudioRef.current.ended) {
          setIsPausedMessageId(msg.id);
        }
      };

      audio.onended = () => {
        setIsSpeakingMessageId(null);
        setIsPausedMessageId(null);
        if (chatAudioUrlRef.current) {
          URL.revokeObjectURL(chatAudioUrlRef.current);
          chatAudioUrlRef.current = null;
        }
        chatAudioRef.current = null;
        if (isLiveCallActiveRef.current) {
          setCallStatus('listening');
          callStatusRef.current = 'listening';
          setCallSubtitle('Listening... Speak naturally.');
          callTranscriptRef.current = '';
          startCallRecognition();
        }
      };

      audio.onerror = () => {
        setIsSpeakingMessageId(null);
        setIsPausedMessageId(null);
        setSpeechLoadingId(null);
        setSpeechError({
          messageId: msg.id,
          error: 'Audio playback failed in browser element.',
          canFallbackToBrowser: typeof window !== 'undefined' && 'speechSynthesis' in window,
        });
        if (isLiveCallActiveRef.current) {
          setCallStatus('listening');
          callStatusRef.current = 'listening';
          setCallSubtitle('Voice playback error. Listening again...');
          callTranscriptRef.current = '';
          startCallRecognition();
        }
      };

      await audio.play();
    } catch (err: any) {
      if (controller.signal.aborted) return;
      console.warn('[AIChatPanel] Neural voice synthesis error:', err);
      setSpeechLoadingId(null);
      setIsSpeakingMessageId(null);
      setIsPausedMessageId(null);
      setSpeechError({
        messageId: msg.id,
        error: err?.message || 'Neural voice unavailable.',
        canFallbackToBrowser: typeof window !== 'undefined' && 'speechSynthesis' in window,
      });
      if (isLiveCallActiveRef.current) {
        setCallStatus('listening');
        callStatusRef.current = 'listening';
        setCallSubtitle('Voice error. Listening for your voice...');
        callTranscriptRef.current = '';
        startCallRecognition();
      }
    }
  };

  const testVoiceAudio = () => {
    setIsTestingVoice(true);
    void handleSpeakMessage({
      id: 'sams-ai-voice-test',
      content: 'Hello! This is a preview of your NightPlanner neural voice assistant powered by ElevenLabs.',
    }).finally(() => setIsTestingVoice(false));
  };

  // ── File Attachments ──
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    files.forEach(file => {
      const reader = new FileReader();
      if (file.type.startsWith('image/')) {
        reader.onload = () => {
          setAttachedFiles(prev => [
            ...prev,
            {
              name: file.name,
              type: file.type,
              size: file.size,
              dataUrl: reader.result as string,
            },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = () => {
          setAttachedFiles(prev => [
            ...prev,
            {
              name: file.name,
              type: file.type,
              size: file.size,
              textContent: reader.result as string,
            },
          ]);
        };
        reader.readAsText(file);
      }
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  if (!isOpen) return null;

  const filteredConversations = conversations.filter(c =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'stretch',
        background: isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(15, 23, 42, 0.25)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
      role="dialog"
      aria-label="Sam’s AI Assistant"
    >
      <div
        className="v-card"
        onClick={e => e.stopPropagation()}
        style={{
          width: isMaximized ? '100vw' : isPhone ? '100%' : '640px',
          maxWidth: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'row',
          borderRadius: isMaximized ? 0 : isPhone ? '16px 16px 0 0' : '16px 0 0 16px',
          padding: 0,
          background: 'var(--v-glass-bg)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: isDark ? '-8px 0 32px rgba(0, 0, 0, 0.6)' : 'var(--v-shadow-spatial)',
          borderRight: 'none',
          borderTop: isMaximized ? 'none' : undefined,
          borderBottom: isMaximized ? 'none' : undefined,
          transition: 'width 0.25s cubic-bezier(0.16, 1, 0.3, 1), border-radius 0.25s ease',
          animation: 'slideInRight 0.25s ease-out',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <style>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
        `}</style>

        {/* ── Mobile Backdrop for Sidebar Drawer ── */}
        {isSidebarOpen && isPhone && (
          <div
            onClick={() => setIsSidebarOpen(false)}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 25,
              background: isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(15, 23, 42, 0.3)',
              backdropFilter: 'blur(2px)',
              WebkitBackdropFilter: 'blur(2px)',
            }}
          />
        )}

        {/* ── ChatGPT-Style Collapsible Sidebar ── */}
        {isSidebarOpen && (
          <aside
            style={{
              width: isPhone ? '280px' : '260px',
              height: '100%',
              background: isDark ? 'rgba(12, 10, 24, 0.98)' : 'rgba(248, 250, 252, 0.98)',
              borderRight: isDark ? '1px solid rgba(168, 85, 247, 0.25)' : '1px solid rgba(15, 23, 42, 0.12)',
              display: 'flex',
              flexDirection: 'column',
              position: isPhone ? 'absolute' : 'relative',
              left: 0,
              top: 0,
              bottom: 0,
              zIndex: 30,
              boxShadow: isPhone ? (isDark ? '4px 0 24px rgba(0, 0, 0, 0.7)' : '4px 0 24px rgba(15, 23, 42, 0.15)') : 'none',
              animation: 'slideInRight 0.2s ease-out',
            }}
          >
            {/* Sidebar Top: New Chat (Single button, duplicate hamburger/collapse removed) */}
            <div style={{ padding: '14px 12px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={handleStartNewChat}
                className="v-pill-btn"
                style={{
                  flex: 1,
                  padding: '7px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: isDark ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(56, 189, 248, 0.3))' : 'rgba(15, 23, 42, 0.06)',
                  borderColor: isDark ? 'rgba(192, 132, 252, 0.4)' : 'rgba(15, 23, 42, 0.16)',
                  color: 'var(--text-primary)',
                }}
              >
                <Plus size={14} />
                <span>New Chat</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.6, fontFamily: 'monospace' }}>⌘K</span>
              </button>
            </div>

            {/* Search Input in Sidebar */}
            <div style={{ padding: '0 12px 10px' }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Search size={12} style={{ position: 'absolute', left: 10, color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search chats..."
                  style={{
                    width: '100%',
                    padding: '6px 10px 6px 28px',
                    fontSize: 11.5,
                    background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 23, 42, 0.05)',
                    border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(15, 23, 42, 0.12)',
                    borderRadius: 8,
                    color: 'var(--text-primary)',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Conversation List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '4px 8px' }}>
                Previous Chats ({filteredConversations.length})
              </span>

              {filteredConversations.length === 0 ? (
                <div style={{ padding: '16px 8px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                  No conversations yet. Start a new chat!
                </div>
              ) : (
                filteredConversations.map(conv => {
                  const isActive = conv.id === activeConversationId;
                  const isEditing = conv.id === editingConvId;

                  return (
                    <div
                      key={conv.id}
                      onClick={() => !isEditing && selectConversation(conv.id)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        fontSize: 12,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                        background: isActive ? (isDark ? 'rgba(168, 85, 247, 0.25)' : 'rgba(168, 85, 247, 0.15)') : 'transparent',
                        border: isActive ? (isDark ? '1px solid rgba(192, 132, 252, 0.4)' : '1px solid rgba(168, 85, 247, 0.35)') : '1px solid transparent',
                        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {isEditing ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}>
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={e => setEditingTitle(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleSaveRename(conv.id);
                              if (e.key === 'Escape') setEditingConvId(null);
                            }}
                            autoFocus
                            style={{
                              flex: 1,
                              fontSize: 11,
                              background: isDark ? '#09090b' : '#ffffff',
                              border: '1px solid var(--accent-color)',
                              borderRadius: 4,
                              padding: '2px 6px',
                              color: 'var(--text-primary)',
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveRename(conv.id)}
                            style={{ background: 'none', border: 'none', color: '#22c55e', cursor: 'pointer', padding: 2 }}
                          >
                            <Check size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingConvId(null)}
                            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2 }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {conv.title}
                          </span>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: isActive ? 1 : 0.6 }}>
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                setEditingConvId(conv.id);
                                setEditingTitle(conv.title);
                              }}
                              title="Rename chat"
                              style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: 2 }}
                            >
                              <Edit2 size={11} />
                            </button>

                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                setConfirmDeleteConvId(conv.id);
                              }}
                              title="Delete chat"
                              style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 2 }}
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Confirm Delete Conversation Modal in Sidebar */}
            {confirmDeleteConvId && (
              <div
                style={{
                  padding: '12px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  borderTop: '1px solid rgba(239, 68, 68, 0.4)',
                  fontSize: 11,
                }}
              >
                <div style={{ color: '#fca5a5', fontWeight: 600, marginBottom: 8 }}>
                  Delete this conversation permanently?
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => handleDeleteConversation(confirmDeleteConvId)}
                    style={{
                      flex: 1,
                      padding: '4px',
                      background: '#ef4444',
                      border: 'none',
                      borderRadius: 6,
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteConvId(null)}
                    style={{
                      flex: 1,
                      padding: '4px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      border: 'none',
                      borderRadius: 6,
                      color: '#fff',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </aside>
        )}

        {/* ── Main Chat Stream Area ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
          {/* ── 1. Sam's AI Header ── */}
          <div
            style={{
              padding: '14px 18px',
              borderBottom: '1.5px solid var(--v-glass-border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              {/* Single Functional Sidebar Hamburger Button */}
              <button
                type="button"
                onClick={() => setIsSidebarOpen(prev => !prev)}
                className="v-circle-btn"
                style={{
                  width: 34,
                  height: 34,
                  background: isSidebarOpen ? (isDark ? 'rgba(168, 85, 247, 0.25)' : 'rgba(168, 85, 247, 0.15)') : 'transparent',
                  borderColor: isSidebarOpen ? (isDark ? 'rgba(192, 132, 252, 0.5)' : 'rgba(168, 85, 247, 0.4)') : 'var(--v-glass-border)',
                }}
                title={isSidebarOpen ? "Collapse sidebar" : "Open previous conversations"}
                aria-label="Toggle conversation history sidebar"
              >
                <Menu size={16} />
              </button>

              {/* Sam's AI Profile Launcher Avatar */}
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  background: 'var(--v-glass-bg-subtle)',
                  border: '1.5px solid var(--v-glass-border)',
                  boxShadow: '0 0 14px var(--accent-glow)',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <img
                  src={profileAvatar}
                  alt="Sam’s AI Profile"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={() => setProfileAvatar('/icons/icon-192.png')}
                />
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="font-bloody" style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.02em' }}>
                    Sam’s AI
                  </span>
                  <span style={{ fontSize: 9.5, padding: '1px 6px', borderRadius: 4, background: 'var(--accent-glow)', border: '1px solid var(--accent-color)', color: 'var(--accent-color)', fontWeight: 600 }}>
                    AI
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Sam'Space · {activeProviderName}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {/* Hands-Free Live Voice Call Toggle */}
              <button
                type="button"
                onClick={toggleLiveVoiceCall}
                className="v-circle-btn"
                style={{
                  width: 32,
                  height: 32,
                  color: isLiveCallActive ? '#38bdf8' : undefined,
                  borderColor: isLiveCallActive ? 'rgba(56, 189, 248, 0.6)' : undefined,
                  background: isLiveCallActive ? 'rgba(56, 189, 248, 0.2)' : undefined,
                  boxShadow: isLiveCallActive ? '0 0 12px rgba(56, 189, 248, 0.4)' : undefined,
                }}
                title={isLiveCallActive ? "End Live Voice Call" : "Start Live Voice Call (Hands-Free Duplex)"}
                aria-label="Live Voice Call"
              >
                <Headphones size={13} />
              </button>

              {/* Voice & Speech Settings Toggle */}
              <button
                type="button"
                onClick={() => setIsVoiceSettingsOpen(prev => !prev)}
                className="v-circle-btn"
                style={{
                  width: 32,
                  height: 32,
                  color: isVoiceSettingsOpen ? '#c084fc' : undefined,
                  borderColor: isVoiceSettingsOpen ? 'rgba(168, 85, 247, 0.4)' : undefined,
                  background: isVoiceSettingsOpen ? 'rgba(168, 85, 247, 0.15)' : undefined,
                }}
                title="Voice & Speech Settings"
                aria-label="Voice & Speech Settings"
              >
                <Volume2 size={13} />
              </button>

              {/* Expand / Minimize Toggle */}
              <button
                type="button"
                onClick={() => setIsMaximized(prev => !prev)}
                className="v-circle-btn"
                style={{ width: 32, height: 32 }}
                title={isMaximized ? "Restore window" : "Maximize window"}
                aria-label="Maximize / Minimize"
              >
                {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>

              {/* Close Button */}
              <button
                type="button"
                onClick={() => {
                  stopLiveVoiceCall();
                  onClose();
                }}
                className="v-circle-btn"
                style={{ width: 32, height: 32 }}
                title="Close Sam’s AI (Esc)"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Voice Settings Drawer */}
          {isVoiceSettingsOpen && (
            <div
              style={{
                padding: '12px 16px',
                background: isDark ? 'rgba(20, 20, 35, 0.95)' : 'rgba(245, 247, 250, 0.97)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                borderBottom: '1px solid var(--v-glass-border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#c084fc' }}>
                  <Sliders size={13} />
                  <span>Neural Voice Assistant Settings</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsVoiceSettingsOpen(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 2,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  title="Close voice settings"
                >
                  <X size={14} />
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                {/* Voice Provider */}
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
                    <option value="elevenlabs">ElevenLabs Neural (Key Rotation & 20+ Models)</option>
                    <option value="piper">Piper Self-Hosted (Offline, Zero Quota)</option>
                    <option value="free_tts">Free Neural Audio (Zero Setup Required)</option>
                    <option value="openai">OpenAI Audio Speech (TTS-1)</option>
                  </select>
                </div>

                {/* Voice Persona / Model */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
                    Voice Persona / Model:
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
                              Custom Voice ({selectedVoiceId.slice(0, 10)}...)
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
                    <div style={{ marginTop: 4, display: 'flex', gap: 6 }}>
                      <input
                        type="text"
                        placeholder="Custom Voice ID (e.g. C1npRmjB19a6yNkEucvx)"
                        id="sams-custom-voice-id-input"
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
                          const inputEl = document.getElementById('sams-custom-voice-id-input') as HTMLInputElement;
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

              {/* Speed, Auto-read, and Test Button */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', paddingTop: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
                      Speed:
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
                      <option value={0.8}>0.8x</option>
                      <option value={1.0}>1.0x</option>
                      <option value={1.2}>1.2x</option>
                      <option value={1.5}>1.5x</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }} title="Typed chat never speaks automatically to conserve ElevenLabs quota. Use the Listen button or Live Voice Call to speak.">
                    <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                    <span>Typed chat: Silent (Quota protected)</span>
                  </div>
                </div>

                {/* Test Audio Button */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isSpeakingMessageId === 'sams-ai-voice-test' || isPausedMessageId === 'sams-ai-voice-test' ? (
                    <button
                      type="button"
                      aria-label="Control audio playback"
                      onClick={() => {
                        if (chatAudioRef.current) {
                          if (chatAudioRef.current.paused) {
                            void chatAudioRef.current.play();
                            setIsPausedMessageId(null);
                          } else {
                            chatAudioRef.current.pause();
                            setIsPausedMessageId('sams-ai-voice-test');
                          }
                        }
                      }}
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
                      {isPausedMessageId === 'sams-ai-voice-test' ? <Play size={12} /> : <Pause size={12} />}
                      <span>{isPausedMessageId === 'sams-ai-voice-test' ? 'Resume' : 'Pause'}</span>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={testVoiceAudio}
                    aria-label="Test audio playback"
                    disabled={speechLoadingId === 'sams-ai-voice-test' || isTestingVoice}
                    style={{
                      background: isTestingVoice ? 'rgba(168, 85, 247, 0.3)' : 'linear-gradient(135deg, #a855f7, #6366f1)',
                      border: 'none',
                      borderRadius: 6,
                      padding: '4px 10px',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: isTestingVoice ? 'default' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    {speechLoadingId === 'sams-ai-voice-test' || isTestingVoice ? (
                      <>
                        <LoaderCircle size={12} className="animate-spin" />
                        <span>Generating Audio...</span>
                      </>
                    ) : (
                      <>
                        <Play size={12} />
                        <span>Test Voice Audio</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Provider Setup & Key Pool Status Badge */}
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
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── Live Hands-Free Duplex Voice Call Overlay ── */}
          {isLiveCallActive && (
            <div
              style={{
                padding: '16px 20px',
                background: isDark
                  ? 'linear-gradient(180deg, rgba(20, 15, 38, 0.96), rgba(12, 10, 25, 0.98))'
                  : 'linear-gradient(180deg, rgba(240, 245, 255, 0.96), rgba(230, 238, 252, 0.98))',
                borderBottom: '1px solid ' + (isDark ? 'rgba(56, 189, 248, 0.3)' : 'rgba(56, 189, 248, 0.4)'),
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
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  background:
                    callStatus === 'speaking'
                      ? 'radial-gradient(circle, #38bdf8 0%, #6366f1 70%, #a855f7 100%)'
                      : isCallMuted
                      ? 'radial-gradient(circle, #64748b 0%, #334155 100%)'
                      : callStatus === 'thinking'
                      ? 'radial-gradient(circle, #f59e0b 0%, #a855f7 70%, #6366f1 100%)'
                      : 'radial-gradient(circle, #38bdf8 0%, #a855f7 60%, #4f46e5 100%)',
                  boxShadow: isCallMuted
                    ? '0 0 10px rgba(100, 116, 139, 0.3)'
                    : callStatus === 'speaking'
                    ? '0 0 35px rgba(56, 189, 248, 0.8), 0 0 50px rgba(168, 85, 247, 0.5)'
                    : '0 0 30px rgba(168, 85, 247, 0.8), 0 0 45px rgba(56, 189, 248, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  animation: isCallMuted ? 'none' : 'pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                  transition: 'all 0.3s ease',
                }}
              >
                <Radio style={{ width: 28, height: 28, color: '#ffffff' }} />
              </div>

              <div style={{ textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: isDark ? '#f1f5f9' : '#0f172a' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: isCallMuted ? '#64748b' : '#22c55e', display: 'inline-block' }} />
                  <span>
                    {isCallMuted
                      ? 'Microphone Muted'
                      : callStatus === 'speaking'
                      ? 'Sam’s AI is speaking...'
                      : callStatus === 'thinking'
                      ? 'Thinking...'
                      : 'Listening... (Speak naturally, silence auto-submits)'}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: isDark ? '#cbd5e1' : '#475569', marginTop: 4, maxWidth: 420, fontStyle: 'italic', wordBreak: 'break-word' }}>
                  {callSubtitle || 'Listening...'}
                </div>
              </div>

              {/* Voice Mode Action Controls */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    const nextMuted = !isCallMuted;
                    setIsCallMuted(nextMuted);
                    isCallMutedRef.current = nextMuted;
                    if (nextMuted) {
                      try { callRecognitionRef.current?.stop(); } catch {}
                      setCallSubtitle('Microphone muted. Tap Unmute to resume.');
                    } else {
                      setCallSubtitle('Listening... Speak naturally.');
                      startCallRecognition();
                    }
                  }}
                  className="v-pill-btn"
                  style={{
                    background: isCallMuted ? 'rgba(239, 68, 68, 0.25)' : 'var(--v-glass-bg-subtle)',
                    borderColor: isCallMuted ? '#ef4444' : 'var(--v-glass-border-subtle)',
                    color: isCallMuted ? '#f87171' : 'var(--text-primary)',
                    fontSize: 11.5,
                    padding: '5px 12px',
                    gap: 5,
                  }}
                >
                  {isCallMuted ? <MicOff size={13} /> : <Mic size={13} />}
                  <span>{isCallMuted ? 'Unmute' : 'Mute'}</span>
                </button>

                {/* Interrupt Button */}
                <button
                  type="button"
                  onClick={interruptCall}
                  className="v-pill-btn"
                  style={{
                    background: 'var(--v-glass-bg-subtle)',
                    borderColor: 'var(--v-glass-border-subtle)',
                    color: 'var(--text-primary)',
                    fontSize: 11.5,
                    padding: '5px 12px',
                    gap: 5,
                  }}
                  title="Interrupt current speech playback and listen immediately"
                >
                  <Square size={12} />
                  <span>Interrupt</span>
                </button>

                {/* End Call Button */}
                <button
                  type="button"
                  onClick={stopLiveVoiceCall}
                  className="v-pill-btn"
                  style={{
                    background: 'rgba(239, 68, 68, 0.2)',
                    borderColor: 'rgba(239, 68, 68, 0.5)',
                    color: '#f87171',
                    fontSize: 11.5,
                    padding: '5px 12px',
                    gap: 5,
                  }}
                  title="Exit hands-free live call"
                >
                  <X size={13} />
                  <span>End Call</span>
                </button>
              </div>
            </div>
          )}

          {/* ── 2. Quick Action Chips ── */}
          <div
            style={{
              padding: '8px 16px',
              borderBottom: '1px solid var(--v-glass-border-subtle)',
              display: 'flex',
              gap: 8,
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              background: 'var(--v-glass-bg-subtle)',
            }}
          >
            <button
              type="button"
              onClick={() => handleSendMessage('What tasks do I still have today?')}
              className="v-pill-btn"
              style={{ padding: '4px 11px', fontSize: 11, whiteSpace: 'nowrap', gap: 4 }}
            >
              🎯 Current Tasks
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage('How much time do I have left today?')}
              className="v-pill-btn"
              style={{ padding: '4px 11px', fontSize: 11, whiteSpace: 'nowrap', gap: 4 }}
            >
              ⏱️ Time Left
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage('Summarize my progress this week.')}
              className="v-pill-btn"
              style={{ padding: '4px 11px', fontSize: 11, whiteSpace: 'nowrap', gap: 4 }}
            >
              📊 Weekly Progress
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage('Start the timer for 45 minutes.')}
              className="v-pill-btn"
              style={{ padding: '4px 11px', fontSize: 11, whiteSpace: 'nowrap', gap: 4, borderColor: '#38bdf8', color: '#38bdf8' }}
            >
              ⚡ 45m Timer
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage('Explain how offline synchronization works.')}
              className="v-pill-btn"
              style={{ padding: '4px 11px', fontSize: 11, whiteSpace: 'nowrap', gap: 4 }}
            >
              🔄 Offline Sync
            </button>
          </div>

          {/* ── 3. Chat Messages Stream ── */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            {messages.map(msg => (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  gap: 6,
                }}
              >
                {/* Header Badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: msg.role === 'user' ? '#cbd5e1' : '#c084fc', padding: '0 4px' }}>
                  {msg.role === 'user' ? (
                    <span>You</span>
                  ) : (
                    <>
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          overflow: 'hidden',
                          border: '1px solid #c084fc',
                        }}
                      >
                        <img src={profileAvatar} alt="Sam's AI" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                      <span style={{ fontWeight: 600 }}>Sam’s AI</span>
                      {msg.provider && (
                        <span style={{ fontSize: 9.5, color: '#94a3b8' }}>
                          · {msg.provider}
                        </span>
                      )}
                    </>
                  )}
                </div>

                {/* Message Bubble */}
                <div
                  style={{
                    maxWidth: '92%',
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                    background: msg.role === 'user'
                      ? (isDark ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.25), rgba(99, 102, 241, 0.25))' : 'rgba(2, 132, 199, 0.12)')
                      : 'var(--v-glass-bg-card)',
                    border: `1.5px solid ${msg.role === 'user' ? (isDark ? 'rgba(56, 189, 248, 0.5)' : 'rgba(2, 132, 199, 0.35)') : 'var(--v-glass-border)'}`,
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: 'var(--text-primary)',
                    whiteSpace: msg.role === 'user' ? 'pre-wrap' : 'normal',
                    wordBreak: 'break-word',
                  }}
                  className="font-system"
                >
                  {/* Attachments preview if user message */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {msg.attachments.map((att, i) => (
                        <div
                          key={i}
                          style={{
                            padding: '4px 8px',
                            background: isDark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(15, 23, 42, 0.06)',
                            borderRadius: 6,
                            fontSize: 11,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            color: isDark ? '#7dd3fc' : '#0284c7',
                          }}
                        >
                          {att.dataUrl ? (
                            <img src={att.dataUrl} alt={att.name} style={{ width: 20, height: 20, borderRadius: 3, objectFit: 'cover' }} />
                          ) : (
                            <FileText size={12} />
                          )}
                          <span>{att.name}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {msg.role === 'assistant' || msg.role === 'system' ? (
                    <FormattedMessage content={msg.content} />
                  ) : (
                    <div>{msg.content}</div>
                  )}

                  {/* ── Action Receipts & Destructive Confirmations ── */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {msg.actions.map(receipt => (
                        <div key={receipt.id}>
                          {/* Pending Destructive Confirmation Card */}
                          {receipt.status === 'pending' ? (
                            <div
                              style={{
                                padding: '10px 14px',
                                borderRadius: 10,
                                background: 'rgba(239, 68, 68, 0.12)',
                                border: '1.5px solid rgba(239, 68, 68, 0.5)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#ef4444' }}>
                                <AlertTriangle size={14} />
                                Confirm Action Required
                              </div>
                              <div style={{ fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                                {receipt.message}
                              </div>
                              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                <button
                                  type="button"
                                  onClick={() => handleConfirmDelete(receipt)}
                                  className="v-pill-btn"
                                  style={{
                                    padding: '5px 14px',
                                    fontSize: 11.5,
                                    fontWeight: 600,
                                    background: '#ef4444',
                                    borderColor: '#ef4444',
                                    color: '#ffffff',
                                  }}
                                >
                                  Confirm & Execute
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCancelDelete(receipt)}
                                  className="v-pill-btn"
                                  style={{
                                    padding: '5px 12px',
                                    fontSize: 11.5,
                                    background: 'var(--v-glass-bg-subtle)',
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : receipt.status === 'success' ? (
                            <div
                              style={{
                                padding: '8px 12px',
                                borderRadius: 8,
                                background: 'rgba(34, 197, 94, 0.1)',
                                border: '1px solid rgba(34, 197, 94, 0.4)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                fontSize: 12,
                                color: '#22c55e',
                              }}
                            >
                              <CheckCircle2 size={14} style={{ flexShrink: 0 }} />
                              <span style={{ fontWeight: 600 }}>{receipt.message}</span>
                            </div>
                          ) : receipt.status === 'cancelled' ? (
                            <div
                              style={{
                                padding: '8px 12px',
                                borderRadius: 8,
                                background: 'var(--v-glass-bg-subtle)',
                                border: '1px solid var(--v-glass-border-subtle)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                fontSize: 12,
                                color: 'var(--text-muted)',
                              }}
                            >
                              <X size={14} style={{ flexShrink: 0 }} />
                              <span>{receipt.message}</span>
                            </div>
                          ) : (
                            <div
                              style={{
                                padding: '8px 12px',
                                borderRadius: 8,
                                background: 'rgba(239, 68, 68, 0.1)',
                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                fontSize: 12,
                                color: '#ef4444',
                              }}
                            >
                              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                              <span>{receipt.message}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Assistant Message Actions Toolbar */}
                {msg.role === 'assistant' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {/* Speech / Audio Controls */}
                      {speechLoadingId === msg.id ? (
                        <span
                          style={{
                            color: '#a855f7',
                            fontSize: 11,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 4px',
                          }}
                        >
                          <LoaderCircle size={12} className="animate-spin" />
                          <span>Synthesizing audio...</span>
                        </span>
                      ) : isSpeakingMessageId === msg.id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => handleSpeakMessage(msg)}
                            aria-label="Retry neural voice playback"
                            title="Stop voice playback"
                            style={{
                              background: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              borderRadius: 4,
                              color: '#f87171',
                              fontSize: 11,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '2px 6px',
                            }}
                          >
                            <VolumeX size={12} />
                            <span>Stop</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (chatAudioRef.current) {
                                chatAudioRef.current.pause();
                                setIsPausedMessageId(msg.id);
                              }
                            }}
                            title="Pause voice playback"
                            style={{
                              background: 'rgba(168, 85, 247, 0.15)',
                              border: '1px solid rgba(168, 85, 247, 0.3)',
                              borderRadius: 4,
                              color: '#c084fc',
                              fontSize: 11,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '2px 6px',
                            }}
                          >
                            <Pause size={12} />
                            <span>Pause</span>
                          </button>
                        </div>
                      ) : isPausedMessageId === msg.id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (chatAudioRef.current) {
                                void chatAudioRef.current.play();
                                setIsPausedMessageId(null);
                              }
                            }}
                            title="Resume voice playback"
                            style={{
                              background: 'rgba(168, 85, 247, 0.15)',
                              border: '1px solid rgba(168, 85, 247, 0.3)',
                              borderRadius: 4,
                              color: '#c084fc',
                              fontSize: 11,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '2px 6px',
                            }}
                          >
                            <Play size={12} />
                            <span>Resume</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSpeakMessage(msg)}
                            title="Stop voice playback"
                            style={{
                              background: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              borderRadius: 4,
                              color: '#f87171',
                              fontSize: 11,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '2px 6px',
                            }}
                          >
                            <VolumeX size={12} />
                            <span>Stop</span>
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSpeakMessage(msg)}
                          title="Read aloud with neural voice"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#94a3b8',
                            fontSize: 11,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 4px',
                          }}
                        >
                          <Volume2 size={12} />
                          <span>Listen</span>
                        </button>
                      )}

                      {/* Copy Message Button */}
                      <button
                        type="button"
                        onClick={() => {
                          if (typeof navigator !== 'undefined' && navigator.clipboard) {
                            navigator.clipboard.writeText(msg.content);
                          }
                        }}
                        title="Copy message text"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#94a3b8',
                          fontSize: 11,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 4px',
                        }}
                      >
                        <span>Copy</span>
                      </button>

                      {msg.content.startsWith('⚠️') && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              const lastUser = [...messages].reverse().find(m => m.role === 'user');
                              if (lastUser) {
                                setMessages(prev => prev.filter(m => m.id !== msg.id && m.id !== lastUser.id));
                                void handleSendMessage(lastUser.content);
                              }
                            }}
                            title="Retry this request"
                            style={{
                              background: 'rgba(239, 68, 68, 0.15)',
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
                            <RefreshCw size={11} />
                            <span>Retry</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const lastUser = [...messages].reverse().find(m => m.role === 'user');
                              if (lastUser) {
                                setInput(lastUser.content);
                                setMessages(prev => prev.filter(m => m.id !== msg.id && m.id !== lastUser.id));
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
                            <Edit2 size={11} />
                            <span>Edit prompt</span>
                          </button>
                        </>
                      )}
                    </div>

                    {/* Speech Fallback Notice */}
                    {speechFallbackNotice?.messageId === msg.id && (
                      <div
                        style={{
                          fontSize: 11,
                          color: '#eab308',
                          background: 'rgba(234, 179, 8, 0.1)',
                          border: '1px solid rgba(234, 179, 8, 0.3)',
                          borderRadius: 6,
                          padding: '4px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <AlertTriangle size={12} />
                        <span>Primary provider unavailable; synthesized using failover {speechFallbackNotice.providerName}.</span>
                      </div>
                    )}

                    {/* Speech Error Banner with Retry & Browser Fallback */}
                    {speechError?.messageId === msg.id && (
                      <div
                        style={{
                          fontSize: 11,
                          color: '#f87171',
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: 6,
                          padding: '6px 8px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <AlertTriangle size={12} />
                          <span>{speechError.error}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                          <button
                            type="button"
                            onClick={() => handleSpeakMessage(msg)}
                            style={{
                              background: 'rgba(239, 68, 68, 0.2)',
                              border: '1px solid rgba(239, 68, 68, 0.4)',
                              borderRadius: 4,
                              color: '#fca5a5',
                              padding: '2px 6px',
                              fontSize: 10.5,
                              cursor: 'pointer',
                            }}
                          >
                            Retry Neural Voice
                          </button>
                          {speechError.canFallbackToBrowser && (
                            <button
                              type="button"
                              onClick={() => handleSpeakMessage(msg, true)}
                              aria-label="Use browser voice playback"
                              style={{
                                background: 'rgba(255, 255, 255, 0.1)',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                borderRadius: 4,
                                color: 'var(--text-secondary)',
                                padding: '2px 6px',
                                fontSize: 10.5,
                                cursor: 'pointer',
                              }}
                            >
                              Use Browser Voice
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {loading && lifecycleState !== 'streaming' && (
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
                  border: '1.5px solid var(--v-glass-border)',
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
                  <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-color, #a855f7)' }} />
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

          {/* ── 4. Attached Files Chips Preview ── */}
          {attachedFiles.length > 0 && (
            <div style={{ padding: '6px 18px', background: 'rgba(0, 0, 0, 0.25)', borderTop: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {attachedFiles.map((file, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 8px',
                    borderRadius: 6,
                    background: 'rgba(168, 85, 247, 0.2)',
                    border: '1px solid rgba(192, 132, 252, 0.35)',
                    fontSize: 11,
                    color: '#e2e8f0',
                  }}
                >
                  {file.dataUrl ? (
                    <img src={file.dataUrl} alt={file.name} style={{ width: 18, height: 18, borderRadius: 3, objectFit: 'cover' }} />
                  ) : (
                    <FileText size={12} />
                  )}
                  <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 1 }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── 5. Composer Input Bar with Stop & Mic Controls ── */}
          <form
            onSubmit={e => {
              e.preventDefault();
              handleSendMessage();
            }}
            style={{
              padding: '12px 18px',
              borderTop: '1.5px solid var(--v-glass-border-subtle)',
              display: 'flex',
              alignItems: 'flex-end',
              gap: 8,
              background: 'var(--v-glass-bg-subtle)',
            }}
          >
            {/* Hidden File Input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.json,.csv"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />

            {/* Paperclip Attachment Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="v-circle-btn"
              style={{ width: 36, height: 36, flexShrink: 0 }}
              title="Attach document or image"
              aria-label="Attach file"
            >
              <Paperclip size={15} />
            </button>

            {/* Mic Voice Dictation Button */}
            <button
              type="button"
              onClick={handleToggleDictation}
              className="v-circle-btn"
              style={{
                width: 36,
                height: 36,
                flexShrink: 0,
                background: isDictating ? 'rgba(239, 68, 68, 0.25)' : 'transparent',
                borderColor: isDictating ? '#ef4444' : 'var(--v-glass-border)',
                color: isDictating ? '#ef4444' : 'var(--text-muted)',
              }}
              title={isDictating ? "Stop voice dictation" : "Speak message with voice"}
              aria-label="Voice dictation"
            >
              {isDictating ? <MicOff size={15} /> : <Mic size={15} />}
            </button>

            {/* Textarea Composer (auto expands with Shift+Enter) */}
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={isDictating ? "Listening to your voice..." : "Ask Sam’s AI or say 'Add 2h study task tomorrow'..."}
              disabled={loading}
              className="v-input font-system"
              style={{
                fontSize: 13,
                flex: 1,
                padding: '9px 12px',
                minHeight: 38,
                maxHeight: 120,
                resize: 'none',
                lineHeight: 1.4,
              }}
            />

            {/* Stop or Send Button */}
            {loading ? (
              <button
                type="button"
                onClick={handleStopGeneration}
                className="v-pill-btn"
                style={{
                  height: 38,
                  padding: '0 12px',
                  background: 'rgba(239, 68, 68, 0.2)',
                  borderColor: '#ef4444',
                  color: '#ef4444',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
                title="Stop generation"
              >
                <Square size={12} fill="currentColor" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() && attachedFiles.length === 0}
                className="v-circle-btn"
                style={{
                  width: 38,
                  height: 38,
                  background: (input.trim() || attachedFiles.length > 0) ? 'var(--accent-glow)' : 'transparent',
                  borderColor: (input.trim() || attachedFiles.length > 0) ? 'var(--accent-color)' : 'var(--v-glass-border)',
                  color: (input.trim() || attachedFiles.length > 0) ? 'var(--accent-color)' : 'var(--text-muted)',
                  flexShrink: 0,
                }}
                aria-label="Send message (Enter)"
              >
                <Send size={15} />
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
