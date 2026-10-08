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
      className="sticky top-0 z-50 bg-gradient-to-r from-purple-700 to-indigo-800 text-white px-4 py-2.5 shadow-md flex items-center justify-between gap-4"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
        <span>New version available! Reload to update Night Planner.</span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => {
            if (reloadFn) reloadFn();
            else window.location.reload();
          }}
          className="px-3 py-1 bg-white text-purple-900 rounded-lg text-xs font-semibold hover:bg-slate-100 transition-colors"
        >
          Reload
        </button>
        <button
          onClick={() => setShowUpdate(false)}
          className="p-1 text-white/80 hover:text-white"
          aria-label="Dismiss update banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
