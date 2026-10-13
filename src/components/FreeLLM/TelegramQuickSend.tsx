'use client';

import { useState } from 'react';
import { Send, X } from 'lucide-react';
import { apiFetch } from '@/lib/api/apiClient';

export function TelegramQuickSend({ isPhone = false, theme = 'dark' }: { isPhone?: boolean; theme?: 'dark' | 'light' }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const isDark = theme !== 'light';

  async function sendMessage() {
    if (!text.trim() || sending) return;
    setSending(true);
    setNotice('');
    setError('');
    try {
      const response = await apiFetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Telegram could not send this message.');
      setText('');
      setNotice(`Sent to ${data.channel} through your bot.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Telegram could not send this message.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {open && <section
        role="dialog"
        aria-label="Send a message to the Telegram channel"
        style={{
          position: 'fixed',
          right: isPhone ? 12 : 20,
          bottom: isPhone ? 154 : 88,
          zIndex: 91,
          width: isPhone ? 'min(360px, calc(100vw - 24px))' : 'min(380px, calc(100vw - 40px))',
          padding: 14,
          display: 'grid',
          gap: 10,
          borderRadius: 18,
          color: 'var(--text-primary)',
          background: isDark ? 'rgba(13, 11, 24, 0.97)' : 'rgba(255, 255, 255, 0.98)',
          border: `1px solid ${isDark ? 'rgba(192, 132, 252, 0.38)' : 'rgba(124, 58, 237, 0.3)'}`,
          boxShadow: '0 18px 48px rgba(0,0,0,.35)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div><strong style={{ fontSize: 14 }}>Send to Telegram</strong><div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 3 }}>Your bot posts your text to its configured channel.</div></div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close Telegram message" style={{ border: 0, background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', padding: 5 }}><X size={17} /></button>
        </header>
        <textarea
          autoFocus
          value={text}
          maxLength={3500}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void sendMessage(); } }}
          placeholder="Type the exact message to post…"
          aria-label="Telegram message text"
          style={{ width: '100%', minHeight: 118, maxHeight: 280, resize: 'vertical', borderRadius: 12, border: '1px solid var(--v-glass-border)', padding: 11, background: 'var(--v-glass-bg-subtle)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{text.length}/3500 · Ctrl+Enter to send</span>
          <button type="button" onClick={() => void sendMessage()} disabled={!text.trim() || sending} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', border: 0, borderRadius: 10, background: 'var(--accent-color)', color: '#fff', fontWeight: 700, cursor: sending || !text.trim() ? 'not-allowed' : 'pointer', opacity: sending || !text.trim() ? .6 : 1 }}><Send size={14} />{sending ? 'Sending…' : 'Send'}</button>
        </div>
        {notice && <p role="status" style={{ margin: 0, color: '#22c55e', fontSize: 12 }}>{notice}</p>}
        {error && <p role="alert" style={{ margin: 0, color: '#f87171', fontSize: 12 }}>{error}</p>}
      </section>}
      <button
        type="button"
        onClick={() => { setOpen(value => !value); setError(''); }}
        aria-label={open ? 'Close Telegram message button' : 'Open Telegram message button'}
        aria-expanded={open}
        title="Send a message to Telegram"
        style={{
          position: 'fixed',
          right: isPhone ? 12 : 20,
          bottom: isPhone ? 92 : 24,
          zIndex: 90,
          width: 46,
          height: 46,
          borderRadius: '50%',
          border: `1px solid ${isDark ? 'rgba(192, 132, 252, 0.6)' : 'rgba(124, 58, 237, 0.45)'}`,
          background: isDark ? 'linear-gradient(145deg,#211432,#100d1d)' : 'linear-gradient(145deg,#fff,#f3e8ff)',
          color: isDark ? '#e9d5ff' : '#6d28d9',
          boxShadow: '0 7px 22px rgba(0,0,0,.28)',
          fontSize: 22,
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >T</button>
    </>
  );
}
