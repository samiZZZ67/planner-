'use client';

import React, { useState, useEffect, useRef } from 'react';
import { db } from '@/lib/db';
import {
  Sparkles, X, Send, Bot, User, Trash2, ShieldCheck,
  CheckCircle2, AlertTriangle, ArrowRight, RefreshCw, Clock
} from 'lucide-react';
import type { Task, Section, WeeklyPlan, MonthlyPlan } from '@/types';

interface AIChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentDate: string;
  isPhone: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  provider?: string;
}

export function AIChatPanel({ isOpen, onClose, currentDate, isPhone }: AIChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Hello! I'm your AI Assistant. You can ask me general questions, ask for explanations, brainstorm ideas, or click **"Review Today's Plan"** to get a scientifically grounded review of your focus budget, cognitive workload, and scheduling.`,
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

  const gatherPlanContext = async () => {
    const monthId = currentDate.slice(0, 7);
    const [tasks, dayRecord, monthlyPlan, allWeeks] = await Promise.all([
      db.tasks.filter(t => t.date === currentDate && !t.deleted).toArray(),
      db.days.get(currentDate),
      db.monthlyPlans.get(monthId),
      db.weeklyPlans.filter(w => !w.deleted).toArray(),
    ]);

    const weeklyPlan = allWeeks.find(w => currentDate >= w.startDate && currentDate <= w.endDate) || null;

    return {
      date: currentDate,
      focusBudgetHours: dayRecord?.freeHours || 8,
      tasks,
      weeklyGoals: weeklyPlan?.goals || '',
      monthlyGoals: monthlyPlan?.title || '',
    };
  };

  const handleSendMessage = async (textToSend?: string, isPlanReview = false) => {
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
      let planContext = null;
      if (isPlanReview || content.toLowerCase().includes('plan') || content.toLowerCase().includes('schedule')) {
        planContext = await gatherPlanContext();
      }

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
          action: isPlanReview ? 'review_plan' : 'chat',
          currentPlanContext: planContext,
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

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data?.message?.content || 'No response received from assistant.',
        timestamp: Date.now(),
        provider: data?.provider,
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

  const handleReviewCurrentPlan = () => {
    handleSendMessage('Please review my daily plan for today. Provide a scientifically grounded evaluation of my focus time budget, cognitive workload, break buffers, and scheduling priorities.', true);
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
          width: isPhone ? '100%' : '440px',
          maxWidth: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: isPhone ? '16px 16px 0 0' : '16px 0 0 16px',
          padding: 0,
          background: 'var(--v-glass-bg)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.6)',
          borderRight: 'none',
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
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'var(--v-glass-bg-subtle)',
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
                AI Assistant & Plan Review
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Powered by {activeProviderName}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
            onClick={handleReviewCurrentPlan}
            className="v-pill-btn"
            style={{
              padding: '4px 12px',
              fontSize: 11,
              whiteSpace: 'nowrap',
              borderColor: 'var(--accent-color)',
              background: 'var(--accent-glow)',
              gap: 4,
            }}
          >
            <Sparkles size={11} color="var(--accent-color)" /> Review Today's Plan
          </button>
          <button
            type="button"
            onClick={() => handleSendMessage('What are effective cognitive rest techniques between intense deep work sessions?')}
            className="v-pill-btn"
            style={{ padding: '4px 12px', fontSize: 11, whiteSpace: 'nowrap', gap: 4 }}
          >
            <Clock size={11} /> Cognitive Rest
          </button>
          <button
            type="button"
            onClick={() => handleSendMessage('How can I optimize my study plan for AASTU coursework while balancing video editing?')}
            className="v-pill-btn"
            style={{ padding: '4px 12px', fontSize: 11, whiteSpace: 'nowrap', gap: 4 }}
          >
            🎯 AASTU & Creative Balance
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
                gap: 4,
              }}
            >
              <div
                style={{
                  maxWidth: '88%',
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
                className={msg.role === 'assistant' ? 'font-handle' : ''}
              >
                {msg.content}
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
              <span className="font-handle">Thinking & analyzing plan…</span>
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
            placeholder="Ask a question or request plan review..."
            disabled={loading}
            className="v-input font-handle"
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
