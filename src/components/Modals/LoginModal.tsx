'use client';

import React, { useState } from 'react';
import { useSync } from '@/lib/sync/useSync';
import { Lock, X, AlertCircle, ShieldCheck } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { triggerSync } = useSync();

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      // Success: trigger immediate sync & close
      await triggerSync();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Login error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-title"
    >
      <div className="w-full max-w-md bg-bg-card border border-border-color rounded-2xl shadow-2xl p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-text-muted hover:text-text-primary rounded-lg transition-colors"
          aria-label="Close login dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-purple-950/80 border border-purple-700 flex items-center justify-center text-purple-300">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 id="login-title" className="font-bloody text-xl font-bold text-text-primary">
              Cloud Sync Login
            </h2>
            <p className="text-xs text-text-muted">
              Connect to your Neon Postgres database
            </p>
          </div>
        </div>

        <p className="text-sm text-text-secondary mb-4 leading-relaxed">
          Night Planner always saves on your device first. Login is only required to synchronize your data to the cloud.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-950/70 border border-red-800 text-red-300 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="app-password" className="block text-xs font-medium text-text-secondary mb-1.5">
              App Password
            </label>
            <input
              id="app-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your APP_PASSWORD"
              className="w-full px-3.5 py-2.5 rounded-xl bg-bg-secondary border border-border-color text-text-primary placeholder:text-text-muted/60 text-base focus:border-accent-primary focus:outline-none"
              autoFocus
              required
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-text-muted">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Protected by signed 90-day cookie session and rate-limit guard.</span>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
            >
              Work Offline
            </button>
            <button
              type="submit"
              disabled={loading || !password}
              className="px-5 py-2 text-sm rounded-xl bg-accent-primary hover:bg-accent-hover text-white font-medium disabled:opacity-50 transition-colors shadow-lg shadow-purple-900/30"
            >
              {loading ? 'Verifying...' : 'Log In & Sync'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
