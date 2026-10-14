'use client';

import React, { useState } from 'react';
import { Lock, Shield, Eye, EyeOff } from 'lucide-react';
import { syncEngine } from '@/lib/sync/syncEngine';
import { apiFetch } from '@/lib/api/apiClient';

interface LoginModalProps {
  isOpen?: boolean;
  onClose: () => void;
}

export function LoginModal({ isOpen = true, onClose }: LoginModalProps) {
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await apiFetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.token) {
          localStorage.setItem('np_session_token', data.token);
        }
        syncEngine.triggerSync();
        onClose();
      } else {
        setError(data.error || `Failed (${res.status})`);
      }
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="v-modal-backdrop" style={{ zIndex: 80 }}>
      <div className="v-modal-dialog" style={{ width: '100%', maxWidth: 360, padding: 32 }}>
        {/* Icon */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--accent-glow)', border: '1.5px solid var(--accent-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={20} style={{ color: 'var(--accent-color)' }} />
          </div>
          <div>
            <div className="font-bloody" style={{ fontSize: 20, color: 'var(--text-primary)', lineHeight: 1 }}>Cloud Sync</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Login to enable sync across devices</div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 20 }}>
            <label className="g-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPwd ? 'text' : 'password'}
                className="g-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
                placeholder="Enter your password"
                style={{ paddingRight: 40 }}
              />
              <button type="button" onClick={() => setShowPwd(!showPwd)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>
                {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {error && (
            <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, marginBottom: 16, fontSize: 12, color: 'rgba(239,68,68,0.85)' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={onClose} className="g-btn" style={{ flex: 1, padding: '11px', fontSize: 13 }}>Cancel</button>
            <button type="submit" disabled={loading || !password} className="g-btn g-btn-primary"
              style={{ flex: 2, padding: '11px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: !password ? 0.5 : 1 }}>
              <Lock size={14} />{loading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </form>

        <p style={{ marginTop: 18, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
          The app works offline without logging in. Login is only needed for cloud sync between devices.
        </p>
      </div>
    </div>
  );
}
