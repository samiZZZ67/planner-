'use client';

import React, { useState, useEffect } from 'react';
import { onServiceWorkerUpdate } from '@/lib/pwa/registerSw';
import { RefreshCw, X } from 'lucide-react';

export function UpdateBanner() {
  const [showUpdate, setShowUpdate] = useState(false);
  const [reloadFn, setReloadFn] = useState<(() => void) | null>(null);

  useEffect(() => {
    onServiceWorkerUpdate((reload) => {
      setReloadFn(() => reload);
      setShowUpdate(true);
    });
  }, []);

  if (!showUpdate) return null;

  return (
    <div
      role="alert"
      style={{
        background: 'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(99,102,241,0.2))',
        borderBottom: '1px solid rgba(139,92,246,0.3)',
        backdropFilter: 'blur(12px)',
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>
        <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
        <span>New version of Sam'Space is ready — reload to update.</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={() => { if (reloadFn) reloadFn(); else window.location.reload(); }}
          className="g-btn g-btn-primary"
          style={{ padding: '5px 14px', fontSize: 12 }}
        >
          Reload
        </button>
        <button onClick={() => setShowUpdate(false)} className="g-icon-btn" style={{ width: 28, height: 28 }} aria-label="Dismiss">
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
