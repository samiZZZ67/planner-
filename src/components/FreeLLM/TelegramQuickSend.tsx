'use client';

import { useState } from 'react';
import { Image as ImageIcon, Mic, Send, X } from 'lucide-react';
import { apiFetch } from '@/lib/api/apiClient';

export function TelegramQuickSend({ isPhone = false, theme = 'dark' }: { isPhone?: boolean; theme?: 'dark' | 'light' }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [media, setMedia] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const isDark = theme !== 'light';

  async function sendMessage() {
    if ((!text.trim() && !media) || sending) return;
    if (media && text.length > 1024) {
      setError('Telegram image and voice captions are limited to 1,024 characters.');
      return;
    }
    setSending(true);
    setNotice('');
    setError('');
    try {
      const body = media ? new FormData() : JSON.stringify({ text });
      if (body instanceof FormData) {
        body.set('text', text);
        body.set('media', media!, media!.name);
      }
      const response = await apiFetch('/api/telegram/send', {
        method: 'POST',
        ...(body instanceof FormData ? {} : { headers: { 'Content-Type': 'application/json' } }),
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Telegram could not send this message.');
      setText('');
      setMedia(null);
      setNotice(`Sent ${data.kind === 'photo' ? 'image' : data.kind === 'voice' ? 'voice message' : 'message'} to ${data.channel} through your bot.`);
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
          <div><strong style={{ fontSize: 14 }}>Send to Telegram</strong><div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 3 }}>Your bot posts text, images, and voice files to its configured channel.</div></div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close Telegram message" style={{ border: 0, background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', padding: 5 }}><X size={17} /></button>
        </header>
        <textarea
          autoFocus
          value={text}
          maxLength={media ? 1024 : 3500}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void sendMessage(); } }}
          placeholder={media ? 'Optional caption for the attachment…' : 'Type the exact message to post…'}
          aria-label={media ? 'Optional Telegram caption' : 'Telegram message text'}
          style={{ width: '100%', minHeight: 118, maxHeight: 280, resize: 'vertical', borderRadius: 12, border: '1px solid var(--v-glass-border)', padding: 11, background: 'var(--v-glass-bg-subtle)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--v-glass-border)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>
            <ImageIcon size={14} /> Add image
            <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" hidden onChange={event => { setMedia(event.target.files?.[0] || null); setError(''); event.currentTarget.value = ''; }} />
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--v-glass-border)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>
            <Mic size={14} /> Add voice
            <input type="file" accept="audio/ogg,audio/mpeg,audio/mp4,audio/x-m4a,.ogg,.mp3,.m4a" hidden onChange={event => { setMedia(event.target.files?.[0] || null); setError(''); event.currentTarget.value = ''; }} />
          </label>
          {media && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', color: 'var(--text-primary)', fontSize: 11, overflowWrap: 'anywhere' }}><b>{media.type.startsWith('image/') ? 'Image:' : 'Voice:'}</b> {media.name}<button type="button" aria-label="Remove attachment" onClick={() => { setMedia(null); setError(''); }} style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', padding: 2, cursor: 'pointer' }}><X size={13} /></button></span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{text.length}/{media ? 1024 : 3500} characters · Ctrl+Enter to send</span>
          <button type="button" onClick={() => void sendMessage()} disabled={(!text.trim() && !media) || sending} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', border: 0, borderRadius: 10, background: 'var(--accent-color)', color: '#fff', fontWeight: 700, cursor: sending || (!text.trim() && !media) ? 'not-allowed' : 'pointer', opacity: sending || (!text.trim() && !media) ? .6 : 1 }}><Send size={14} />{sending ? 'Sending…' : media?.type.startsWith('image/') ? 'Send image' : media ? 'Send voice' : 'Send'}</button>
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
