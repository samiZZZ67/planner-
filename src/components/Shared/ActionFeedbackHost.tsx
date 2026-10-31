'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';
import type { ActionFeedbackEventDetail } from '@/lib/utils/actionFeedback';

export function ActionFeedbackHost() {
  const [notice, setNotice] = useState<ActionFeedbackEventDetail | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const onFeedback = (event: Event) => {
      const detail = (event as CustomEvent<ActionFeedbackEventDetail>).detail;
      if (!detail) return;
      if (timer) window.clearTimeout(timer);
      setNotice(detail);
      if (detail.status !== 'pending') {
        timer = window.setTimeout(() => setNotice(current => current?.id === detail.id ? null : current), detail.status === 'error' ? 5000 : 2200);
      }
    };
    window.addEventListener('samsspace:action-feedback', onFeedback);
    return () => {
      window.removeEventListener('samsspace:action-feedback', onFeedback);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  if (!notice) return null;
  const pending = notice.status === 'pending';
  const error = notice.status === 'error';
  return (
    <>
      <style>{'@keyframes sams-action-spin{to{transform:rotate(360deg)}}'}</style>
      <div
        role={error ? 'alert' : 'status'}
        aria-live={error ? 'assertive' : 'polite'}
        style={{
          position: 'fixed', top: 16, right: 16, zIndex: 2000, display: 'flex', alignItems: 'center', gap: 10,
          maxWidth: 'min(420px, calc(100vw - 32px))', padding: '11px 14px', borderRadius: 14,
          color: 'var(--text-primary)', background: 'var(--v-glass-bg-card, rgba(18,16,30,.96))',
          border: '1px solid var(--v-glass-border)',
          boxShadow: '0 12px 36px rgba(0,0,0,.28)', backdropFilter: 'blur(16px)', fontSize: 13,
        }}
      >
        {pending ? <LoaderCircle size={17} style={{ flexShrink: 0, animation: 'sams-action-spin .8s linear infinite' }} />
          : error ? <AlertCircle size={17} color="var(--text-primary)" style={{ flexShrink: 0 }} />
            : <CheckCircle2 size={17} color="var(--text-primary)" style={{ flexShrink: 0 }} />}
        <span style={{ overflowWrap: 'anywhere' }}>{notice.message}</span>
      </div>
    </>
  );
}
