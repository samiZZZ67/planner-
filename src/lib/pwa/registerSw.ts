'use client';

type UpdateCallback = (reload: () => void) => void;

let updateCallback: UpdateCallback | null = null;
let waitingWorker: ServiceWorker | null = null;

export function onServiceWorkerUpdate(cb: UpdateCallback) {
  updateCallback = cb;
}

export function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // Handle controllerchange reload
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(reg => {
        // If an updated worker is already waiting
        if (reg.waiting) {
          waitingWorker = reg.waiting;
          if (updateCallback) {
            updateCallback(promptReload);
          }
          return;
        }

        // If a new worker is found
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              waitingWorker = newWorker;
              if (updateCallback) {
                updateCallback(promptReload);
              }
            }
          });
        });
      })
      .catch(err => {
        console.warn('ServiceWorker registration skipped:', err.message);
      });
  });
}

function promptReload() {
  if (waitingWorker) {
    waitingWorker.postMessage({ action: 'skipWaiting' });
  } else {
    window.location.reload();
  }
}
