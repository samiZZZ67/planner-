'use client';

import { useCallback, useEffect, useState } from 'react';
import Script from 'next/script';
import { AlertTriangle, LoaderCircle, Moon, RotateCcw } from 'lucide-react';
import { FreeLLMAssistant } from '@/components/FreeLLM/FreeLLMAssistant';

interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  viewportHeight?: number;
  viewportStableHeight?: number;
  ready: () => void;
  expand: () => void;
  disableVerticalSwipes?: () => void;
  onEvent?: (eventType: string, handler: () => void) => void;
  offEvent?: (eventType: string, handler: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

type AuthState =
  | { status: 'loading' }
  | { status: 'ready'; theme: 'light' | 'dark' }
  | { status: 'error'; message: string };

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="telegram-mini-app-gate">
      <div className="telegram-mini-app-card">
        <span className="telegram-mini-app-mark"><Moon size={20} /></span>
        <LoaderCircle className="telegram-mini-app-spinner" size={19} />
        <div className="telegram-mini-app-title">AI Models</div>
        <div className="telegram-mini-app-copy">{label}</div>
      </div>
    </div>
  );
}

export function TelegramMiniAppClient() {
  const [sdkReady, setSdkReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });

  const authenticate = useCallback(async () => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) {
      setAuthState({
        status: 'error',
        message: 'Open AI Models from the Planner bot in Telegram to start a secure session.',
      });
      return;
    }

    try {
      webApp.ready();
      webApp.expand();
      webApp.disableVerticalSwipes?.();
    } catch {
      // Older Telegram clients may not implement every viewport control.
    }

    if (!webApp.initData) {
      setAuthState({
        status: 'error',
        message: 'Telegram did not provide launch data. Close this page and reopen it from the Planner bot.',
      });
      return;
    }

    setAuthState({ status: 'loading' });
    try {
      const response = await fetch('/api/telegram/mini-app/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ initData: webApp.initData }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok || typeof result.token !== 'string') {
        throw new Error(result?.error || 'Telegram authentication failed. Please reopen the Mini App.');
      }

      try {
        localStorage.setItem('np_session_token', result.token);
      } catch {
        // The secure same-origin cookie remains available when WebView storage is restricted.
      }
      setAuthState({ status: 'ready', theme: webApp.colorScheme === 'light' ? 'light' : 'dark' });
    } catch (error) {
      setAuthState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not authenticate this Telegram session.',
      });
    }
  }, []);

  useEffect(() => {
    if (sdkReady) void authenticate();
  }, [sdkReady, attempt, authenticate]);

  useEffect(() => {
    if (!sdkReady) return;
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;
    const previousTheme = document.documentElement.getAttribute('data-theme');
    const previousViewportHeight = document.documentElement.style.getPropertyValue('--tg-viewport-height');

    const applyTelegramEnvironment = () => {
      const nextTheme = webApp.colorScheme === 'light' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nextTheme);
      const height = webApp.viewportHeight || webApp.viewportStableHeight;
      if (height) document.documentElement.style.setProperty('--tg-viewport-height', `${height}px`);
      setAuthState(current => current.status === 'ready' ? { status: 'ready', theme: nextTheme } : current);
    };

    applyTelegramEnvironment();
    webApp.onEvent?.('themeChanged', applyTelegramEnvironment);
    webApp.onEvent?.('viewportChanged', applyTelegramEnvironment);
    return () => {
      webApp.offEvent?.('themeChanged', applyTelegramEnvironment);
      webApp.offEvent?.('viewportChanged', applyTelegramEnvironment);
      if (previousTheme) document.documentElement.setAttribute('data-theme', previousTheme);
      else document.documentElement.removeAttribute('data-theme');
      if (previousViewportHeight) document.documentElement.style.setProperty('--tg-viewport-height', previousViewportHeight);
      else document.documentElement.style.removeProperty('--tg-viewport-height');
    };
  }, [sdkReady]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onReady={() => setSdkReady(true)}
      />
      <main className="telegram-mini-app-root">
        {authState.status === 'loading' && <LoadingScreen label="Connecting to Telegram…" />}
        {authState.status === 'error' && (
          <div className="telegram-mini-app-gate">
            <div className="telegram-mini-app-card">
              <span className="telegram-mini-app-mark"><AlertTriangle size={20} /></span>
              <div className="telegram-mini-app-title">Could not open AI Models</div>
              <div className="telegram-mini-app-copy">{authState.message}</div>
              <button className="telegram-mini-app-retry" onClick={() => setAttempt(value => value + 1)}>
                <RotateCcw size={15} /> Try again
              </button>
            </div>
          </div>
        )}
        {authState.status === 'ready' && (
          <FreeLLMAssistant isPhone miniAppMode theme={authState.theme} />
        )}
      </main>
      <style jsx global>{`
        .telegram-mini-app-root {
          position: fixed;
          inset: 0;
          min-height: var(--tg-viewport-height, 100dvh);
          background: var(--v-app-bg, #0b0b0d);
          color: var(--text-primary, #f4f4f5);
        }
        .telegram-mini-app-gate {
          width: 100%;
          height: var(--tg-viewport-height, 100dvh);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          box-sizing: border-box;
          background: var(--v-app-bg, #0b0b0d);
          color: var(--text-primary, #f4f4f5);
          font-family: var(--font-system, system-ui, sans-serif);
        }
        .telegram-mini-app-card {
          width: min(100%, 340px);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
          padding: 28px 24px;
          border: 1px solid var(--v-glass-border, rgba(255,255,255,.14));
          border-radius: 22px;
          background: var(--v-glass-bg-card, rgba(255,255,255,.06));
          text-align: center;
          box-shadow: var(--v-shadow-spatial, 0 18px 48px rgba(0,0,0,.3));
        }
        .telegram-mini-app-mark {
          width: 44px;
          height: 44px;
          display: grid;
          place-items: center;
          color: var(--accent-color, #fff);
          background: var(--accent-glow, rgba(255,255,255,.12));
          border-radius: 14px;
        }
        .telegram-mini-app-spinner { animation: telegram-mini-app-spin .9s linear infinite; }
        .telegram-mini-app-title { font-weight: 700; font-size: 17px; }
        .telegram-mini-app-copy { color: var(--text-secondary, #a1a1aa); font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
        .telegram-mini-app-retry {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          margin-top: 4px;
          padding: 10px 14px;
          color: var(--text-primary, #f4f4f5);
          background: var(--v-glass-bg-subtle, rgba(255,255,255,.08));
          border: 1px solid var(--v-glass-border-subtle, rgba(255,255,255,.14));
          border-radius: 10px;
          font: inherit;
          font-size: 13px;
          cursor: pointer;
        }
        @keyframes telegram-mini-app-spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
