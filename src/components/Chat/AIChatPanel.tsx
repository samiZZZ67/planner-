'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db, getActiveTimer, getAIConversations, createAIConversation, updateAIConversationTitle, deleteAIConversation, getAIMessages, saveAIMessage } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import {
  Sparkles, X, Send, Bot, User, Trash2, ShieldCheck,
  CheckCircle2, AlertTriangle, ArrowRight, RefreshCw, Clock,
  Maximize2, Minimize2, Check, CheckSquare, PlusCircle,
  Menu, Plus, Search, Edit2, Square, Mic, MicOff,
  Volume2, VolumeX, Paperclip, FileText, Image as ImageIcon
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

const DEFAULT_GREETING = `Hello! I'm **Sam’s AI**, your NightPlanner assistant with full authorized access to your schedule.

You can ask me live questions like:
- *"What tasks do I still have today?"*
- *"How much time do I have left?"*
- *"Summarize my progress this week"*
- *"Explain how offline synchronization works"*

Or command me to manage your planner:
- *"Add a task called Study Python under Learning for two hours"*
- *"Update my task from 2 PM to 4 PM"*
- *"Start the timer for 45 minutes"*
- *"Create a new category called Content Creation"*
- *"Delete the task named Video Editing"* or *"Delete all my tasks for today"*.`;

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
  const [activeProviderName, setActiveProviderName] = useState<string>('Google Gemini');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  // ── Voice & Audio ──
  const [isDictating, setIsDictating] = useState(false);
  const [isSpeakingMessageId, setIsSpeakingMessageId] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

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
      const list = await getAIConversations('owner');
      setConversations(list);
      if (list.length > 0 && !activeConversationId) {
        // Open most recent conversation
        await selectConversation(list[0].id);
      }
    } catch (e) {
      console.warn('Failed to load conversations from Dexie:', e);
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
    await updateAIConversationTitle(convId, editingTitle.trim());
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, title: editingTitle.trim() } : c));
    setEditingConvId(null);
  };

  const handleDeleteConversation = async (convId: string) => {
    await deleteAIConversation(convId);
    setConversations(prev => prev.filter(c => c.id !== convId));
    setConfirmDeleteConvId(null);
    if (activeConversationId === convId) {
      handleStartNewChat();
    }
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

  // Clean up speech and abort on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, []);

  // ── Gather Live Context for Website Copilot ──
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
          window.dispatchEvent(new CustomEvent('nightplanner:timer-action', {
            detail: {
              action: action.type === 'start_timer' ? 'start' : action.type === 'pause_timer' ? 'pause' : 'stop',
              taskId: action.params?.taskId,
              taskTitle: action.params?.taskTitle,
              minutes: action.params?.minutes || 25,
            },
          }));
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
  const handleSendMessage = async (textToSend?: string) => {
    const content = (textToSend || input).trim();
    if ((!content && attachedFiles.length === 0) || loading) return;

    let convId = activeConversationId;
    if (!convId) {
      const generatedTitle = (content || attachedFiles[0]?.name || 'Chat').slice(0, 32);
      const newConv = await createAIConversation(generatedTitle, 'owner');
      convId = newConv.id;
      setActiveConversationId(convId);
      setConversations(prev => [newConv, ...prev]);
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

    // Save user message to Dexie
    await saveAIMessage({
      id: userMsg.id,
      conversationId: convId,
      role: userMsg.role,
      content: userMsg.content,
      timestamp: userMsg.timestamp,
    });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const fullContext = await gatherFullContext();

      const res = await apiFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          context: fullContext,
        }),
        signal: controller.signal,
      });

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

      // Save assistant message to Dexie
      await saveAIMessage({
        id: assistantMsg.id,
        conversationId: convId,
        role: assistantMsg.role,
        content: assistantMsg.content,
        timestamp: assistantMsg.timestamp,
        provider: assistantMsg.provider,
        actions: assistantMsg.actions,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        const stopMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '⏹️ Generation stopped by user.',
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, stopMsg]);
        await saveAIMessage({
          id: stopMsg.id,
          conversationId: convId,
          role: stopMsg.role,
          content: stopMsg.content,
          timestamp: stopMsg.timestamp,
        });
      } else {
        const errorMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `⚠️ ${err.message || 'Could not connect to Sam’s AI. Please verify network or API keys.'}`,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, errorMsg]);
      }
    } finally {
      setLoading(false);
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

  // ── Text-to-Speech (Spoken AI response) ──
  const handleSpeakMessage = (msg: Message) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    if (isSpeakingMessageId === msg.id) {
      window.speechSynthesis.cancel();
      setIsSpeakingMessageId(null);
      return;
    }

    window.speechSynthesis.cancel();
    const cleanText = msg.content.replace(/[*#`_~]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => setIsSpeakingMessageId(null);
    utterance.onerror = () => setIsSpeakingMessageId(null);

    setIsSpeakingMessageId(msg.id);
    window.speechSynthesis.speak(utterance);
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
                  background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.4), rgba(56, 189, 248, 0.4))',
                  border: '2px solid rgba(192, 132, 252, 0.7)',
                  boxShadow: '0 0 16px rgba(168, 85, 247, 0.4)',
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
                  <span style={{ fontSize: 9.5, padding: '1px 6px', borderRadius: 4, background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.3)', color: '#38bdf8', fontWeight: 600 }}>
                    Copilot
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Full Planner Access · {activeProviderName}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
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
                onClick={onClose}
                className="v-circle-btn"
                style={{ width: 32, height: 32 }}
                title="Close Sam’s AI (Esc)"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>

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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
                    <button
                      type="button"
                      onClick={() => handleSpeakMessage(msg)}
                      title={isSpeakingMessageId === msg.id ? "Stop voice reading" : "Read aloud with voice"}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: isSpeakingMessageId === msg.id ? '#c084fc' : '#94a3b8',
                        fontSize: 11,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 4px',
                      }}
                    >
                      {isSpeakingMessageId === msg.id ? (
                        <>
                          <VolumeX size={12} />
                          <span>Stop</span>
                        </>
                      ) : (
                        <>
                          <Volume2 size={12} />
                          <span>Listen</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', color: 'var(--text-muted)', fontSize: 12 }}>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    border: '2px solid var(--accent-color)',
                    borderTopColor: 'transparent',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
                <span className="font-system">Sam’s AI is analyzing your planner data…</span>
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
