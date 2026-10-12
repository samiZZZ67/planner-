'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Lock, Eye, EyeOff, ArrowRight, ShieldCheck, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/api/apiClient';

interface MasterLockScreenProps {
  onUnlock: () => void;
  theme?: 'dark' | 'light';
}

export function MasterLockScreen({ onUnlock, theme = 'dark' }: MasterLockScreenProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleUnlock = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!password.trim() || loading) return;

    setLoading(true);
    setError('');

    try {
      const res = await apiFetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim() }),
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.token) {
        if (typeof window !== 'undefined') {
          localStorage.setItem('np_session_token', data.token);
        }
        onUnlock();
      } else {
        setError(data?.error || 'Invalid master password.');
      }
    } catch (err: any) {
      setError(err.message || 'Incorrect password. Access denied.');
    } finally {
      setLoading(false);
    }
  };

  const isDark = theme !== 'light';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        backgroundColor: 'var(--v-app-bg)',
      }}
    >
      {/* Spatial Room Backdrop */}
      <div className="vision-room-bg" />

      {/* Central Floating Lock Box */}
      <div
        className="v-card"
        style={{
          width: '100%',
          maxWidth: '420px',
          padding: '36px 28px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          position: 'relative',
          zIndex: 10,
          background: 'var(--v-glass-bg-card)',
          backdropFilter: 'blur(36px) saturate(180%)',
          WebkitBackdropFilter: 'blur(36px) saturate(180%)',
          border: '1.5px solid var(--v-glass-border)',
          borderRadius: 24,
          boxShadow: 'var(--v-shadow-spatial)',
          animation: 'fadeInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <style>{`
          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(16px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>

        {/* Top Logo & Lock Badge */}
        <div style={{ position: 'relative', marginBottom: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              overflow: 'hidden',
              background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.4), rgba(56, 189, 248, 0.4))',
              border: '2px solid rgba(192, 132, 252, 0.6)',
              boxShadow: '0 0 30px rgba(168, 85, 247, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 4,
            }}
          >
            <img
              src="/icons/icon-192.png"
              alt="Night Planner"
              style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
            />
          </div>
          <div
            style={{
              position: 'absolute',
              bottom: -4,
              right: -4,
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: '#8b5cf6',
              border: '2px solid var(--v-app-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
          >
            <Lock size={13} color="#ffffff" />
          </div>
        </div>

        {/* Title */}
        <h1
          className="font-bloody"
          style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: '0.04em',
            margin: '0 0 6px',
            color: 'var(--text-primary)',
            textAlign: 'center',
          }}
        >
          Night Planner
        </h1>

        <div
          style={{
            fontSize: 12.5,
            color: 'var(--text-muted)',
            textAlign: 'center',
            marginBottom: 26,
            maxWidth: 320,
            lineHeight: 1.5,
          }}
        >
          Protected Workspace · Enter master password to access
        </div>

        {/* Error Alert */}
        {error && (
          <div
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 12,
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1.5px solid rgba(239, 68, 68, 0.4)',
              color: '#ef4444',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 18,
            }}
          >
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Password Form */}
        <form onSubmit={handleUnlock} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <input
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => {
                setPassword(e.target.value);
                if (error) setError('');
              }}
              placeholder="Enter master password..."
              className="v-input font-system"
              style={{
                fontSize: 14,
                padding: '12px 42px 12px 16px',
                minHeight: 46,
              }}
              disabled={loading}
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(prev => !prev)}
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title={showPassword ? "Hide password" : "Show password"}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <button
            type="submit"
            disabled={!password.trim() || loading}
            className="v-pill-btn v-pill-btn-primary"
            style={{
              width: '100%',
              padding: '12px',
              fontSize: 14,
              fontWeight: 700,
              gap: 8,
              opacity: !password.trim() || loading ? 0.6 : 1,
              cursor: !password.trim() || loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? (
              <span>Verifying password…</span>
            ) : (
              <>
                <ShieldCheck size={16} />
                <span>Unlock Workspace</span>
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
