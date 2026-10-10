'use client';

import React, { useState, useEffect, useRef } from 'react';
import { db, getActiveTimer } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import {
  Sparkles, X, Send, Bot, User, Trash2, ShieldCheck,
  CheckCircle2, AlertTriangle, ArrowRight, RefreshCw, Clock,
  Maximize2, Minimize2, Check, CheckSquare, PlusCircle
} from 'lucide-react';
import type { Task, Section, WeeklyPlan, MonthlyPlan } from '@/types';
import { apiFetch } from '@/lib/api/apiClient';

interface AIChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentDate: string;
  isPhone: boolean;
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

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  provider?: string;
  actions?: ActionReceipt[];
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
  // 1. Direct ID match
  const byId = tasks.find(t => t.id === query);
  if (byId) return byId;
  // 2. Exact title match
  const byExactTitle = tasks.find(t => t.title.toLowerCase() === q);
  if (byExactTitle) return byExactTitle;
  // 3. Includes title match
  const byIncludes = tasks.filter(t => t.title.toLowerCase().includes(q) || q.includes(t.title.toLowerCase()));
  if (byIncludes.length > 0) return byIncludes[0];
  return null;
}

export function AIChatPanel({ isOpen, onClose, currentDate, isPhone }: AIChatPanelProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Hello! I'm your NightPlanner AI Copilot with full access to manage your schedule.\n\nYou can ask me live questions like:\n- *"What is my current task?"*\n- *"How many tasks are left?"*\n- *"What did I complete today?"*\n- *"How is my progress?"*\n\nOr instruct me to manage tasks:\n- *"Add a new task called Study Python under Learning tomorrow for 2 hours"*\n- *"Mark my current task as completed"*\n- *"Move my Python task to tomorrow"*\n- *"Delete the task about video editing"*`,
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeProviderName, setActiveProviderName] = useState<string>('Google Gemini');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [isOpen, messages]);

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

  /**
   * Execute action against Dexie IndexedDB and notify syncEngine
   */
  const executeLocalAction = async (action: any): Promise<ActionReceipt> => {
    try {
      const [allTasks, sections] = await Promise.all([
        db.tasks.toArray(),
        db.sections.filter(s => !s.deleted).toArray(),
      ]);

      if (action.type === 'create_task') {
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

        return {
          id: action.id,
          type: 'create_task',
          status: 'success',
          message: `Created task "${newTask.title}" in ${sec?.name || 'Tasks'} (${targetDate}, ${duration}m)`,
          action,
        };
      }

      if (action.type === 'update_task') {
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

        const changes = Object.keys(updates).join(', ');
        return {
          id: action.id,
          type: 'update_task',
          status: 'success',
          message: `Updated task "${targetTask.title}" (${changes || 'applied updates'})`,
          action,
        };
      }

      if (action.type === 'delete_task') {
        // If confirmation required, return pending state
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

        return {
          id: action.id,
          type: 'delete_task',
          status: 'success',
          message: `Deleted task "${targetTask.title}"`,
          action,
        };
      }

      if (action.type === 'create_section') {
        const params = action.params || {};
        const newSec: Section = {
          id: `sec-${crypto.randomUUID().slice(0, 8)}`,
          name: params.name || 'New Category',
          color: params.color || '#3b82f6',
          icon: params.icon || '📌',
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

  const handleConfirmDelete = async (actionReceipt: ActionReceipt) => {
    try {
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

      updateActionReceipt(actionReceipt.id, 'success', `Deleted task "${targetTask.title}".`);
    } catch (err: any) {
      updateActionReceipt(actionReceipt.id, 'error', `Failed to delete: ${err.message}`);
    }
  };

  const handleCancelDelete = (actionReceipt: ActionReceipt) => {
    const title = actionReceipt.action.params?.taskTitle || actionReceipt.action.params?.taskIdentifier || 'task';
    updateActionReceipt(actionReceipt.id, 'cancelled', `Cancelled deletion of "${title}".`);
  };

  const updateActionReceipt = (actionId: string, status: ActionReceipt['status'], message: string) => {
    setMessages(prev => prev.map(msg => {
      if (!msg.actions) return msg;
      const updatedActions = msg.actions.map(a => a.id === actionId ? { ...a, status, message } : a);
      return { ...msg, actions: updatedActions };
    }));
  };

  const handleSendMessage = async (textToSend?: string) => {
    const content = (textToSend || input).trim();
    if (!content || loading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    if (!textToSend) setInput('');
    setLoading(true);

    try {
      const fullContext = await gatherFullContext();

      const res = await apiFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
          context: fullContext,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        let errDesc = data?.error;
        if (!errDesc) {
          if (res.status === 401) {
            errDesc = 'Please log in with your app password to use the AI assistant.';
          } else if (res.status === 429) {
            errDesc = 'AI providers are currently rate-limited. Please wait a moment and try again.';
          } else if (res.status === 502) {
            errDesc = 'AI provider service is temporarily unreachable. Please verify API keys in .env.local.';
          } else {
            errDesc = `Chat service error (${res.status}).`;
          }
        }
        throw new Error(errDesc);
      }

      if (data?.provider) setActiveProviderName(data.provider);

      // Execute any returned actions locally on Dexie
      const rawActions = data?.actions || [];
      const actionReceipts: ActionReceipt[] = [];

      for (const act of rawActions) {
        const receipt = await executeLocalAction(act);
        actionReceipts.push(receipt);
      }

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data?.message?.content || 'No response received from assistant.',
        timestamp: Date.now(),
        provider: data?.provider,
        actions: actionReceipts.length > 0 ? actionReceipts : undefined,
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `⚠️ ${err.message || 'Could not connect to AI service. Please verify your API key in .env.local.'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'stretch',
        background: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
    >
      <div
        className="v-card"
        onClick={e => e.stopPropagation()}
        style={{
          width: isMaximized ? '100vw' : isPhone ? '100%' : '520px',
          maxWidth: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: isMaximized ? 0 : isPhone ? '16px 16px 0 0' : '16px 0 0 16px',
          padding: 0,
          background: 'var(--v-glass-bg)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.6)',
          borderRight: 'none',
          borderTop: isMaximized ? 'none' : undefined,
          borderBottom: isMaximized ? 'none' : undefined,
          transition: 'width 0.25s cubic-bezier(0.16, 1, 0.3, 1), border-radius 0.25s ease',
          animation: 'slideInRight 0.25s ease-out',
        }}
      >
        <style>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
        `}</style>

        {/* ── 1. Header ── */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1.5px solid var(--v-glass-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'var(--accent-glow)',
                border: '1.5px solid var(--accent-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
              }}
            >
              🌙
            </div>
            <div>
              <div className="font-bloody" style={{ fontSize: 16, fontWeight: 700 }}>
                NightPlanner AI Copilot
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Authorized Website Access · {activeProviderName}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Expand / Minimize Toggle */}
            <button
              type="button"
              onClick={() => setIsMaximized(prev => !prev)}
              className="v-circle-btn"
              style={{ width: 30, height: 30 }}
              title={isMaximized ? "Minimize to normal size" : "Expand to cover entire window"}
              aria-label={isMaximized ? "Minimize to normal size" : "Expand to cover entire window"}
            >
              {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
            <button
              type="button"
              onClick={() => setMessages([messages[0]])}
              className="v-circle-btn"
              style={{ width: 30, height: 30 }}
              title="Clear chat"
            >
              <Trash2 size={13} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="v-circle-btn"
              style={{ width: 30, height: 30 }}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── 2. Quick Action Chips ── */}
        <div
          style={{
            padding: '10px 16px',
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
            onClick={() => handleSendMessage('What is my current task?')}
            className="v-pill-btn"
            style={{ padding: '4px 11px', fontSize: 11, whiteSpace: 'nowrap', gap: 4 }}
          >
            🎯 Current Task
          </button>
          <button
            type="button"
            onClick={() => handleSendMessage('How many tasks are left today?')}
            className="v-pill-btn"
            style={{ padding: '4px 11px', fontSize: 11, whiteSpace: 'nowrap', gap: 4 }}
          >
            📋 Tasks Left
          </button>
          <button
            type="button"
            onClick={() => handleSendMessage('What did I complete today?')}
            className="v-pill-btn"
            style={{ padding: '4px 11px', fontSize: 11, whiteSpace: 'nowrap', gap: 4 }}
          >
            ✅ Completed Today
          </button>
          <button
            type="button"
            onClick={() => handleSendMessage('How is my progress today?')}
            className="v-pill-btn"
            style={{
              padding: '4px 11px',
              fontSize: 11,
              whiteSpace: 'nowrap',
              borderColor: 'var(--accent-color)',
              background: 'var(--accent-glow)',
              gap: 4,
            }}
          >
            <Sparkles size={11} color="var(--accent-color)" /> My Progress
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
              <div
                style={{
                  maxWidth: '92%',
                  padding: '10px 14px',
                  borderRadius: msg.role === 'user' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                  background: msg.role === 'user'
                    ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.25), rgba(99, 102, 241, 0.25))'
                    : 'var(--v-glass-bg-card)',
                  border: `1.5px solid ${msg.role === 'user' ? 'rgba(56, 189, 248, 0.5)' : 'var(--v-glass-border)'}`,
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: 'var(--text-primary)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
                className="font-system"
              >
                {msg.content}

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
                              Confirm Deletion Required
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
                                Confirm Delete
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

              {msg.provider && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)', paddingLeft: 4 }}>
                  via {msg.provider}
                </span>
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
              <span className="font-system">Thinking & executing planner actions…</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── 4. Input Bar ── */}
        <form
          onSubmit={e => {
            e.preventDefault();
            handleSendMessage();
          }}
          style={{
            padding: '14px 18px',
            borderTop: '1.5px solid var(--v-glass-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask questions or say 'Add gym for 1 hour under Health'..."
            disabled={loading}
            className="v-input font-system"
            style={{ fontSize: 13, flex: 1, padding: '10px 14px' }}
          />

          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="v-circle-btn"
            style={{
              width: 38,
              height: 38,
              background: input.trim() ? 'var(--accent-glow)' : 'transparent',
              borderColor: input.trim() ? 'var(--accent-color)' : 'var(--v-glass-border)',
              color: input.trim() ? 'var(--accent-color)' : 'var(--text-muted)',
              flexShrink: 0,
            }}
          >
            <Send size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}
