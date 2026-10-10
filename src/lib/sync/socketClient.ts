import { io, Socket } from 'socket.io-client';

let socketInstance: Socket | null = null;

export function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  if (socketInstance) return socketInstance;

  const serverUrl =
    (process.env.NEXT_PUBLIC_API_URL || '').trim().replace(/\/+$/, '') ||
    window.location.origin;

  try {
    socketInstance = io(serverUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      withCredentials: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socketInstance.on('connect', () => {
      console.log('[Socket.IO] Connected to sync server:', socketInstance?.id);
    });

    socketInstance.on('disconnect', (reason) => {
      console.log('[Socket.IO] Disconnected:', reason);
    });
  } catch (err) {
    console.warn('[Socket.IO] Initialization failed:', err);
  }

  return socketInstance;
}

export function notifySyncUpdate() {
  try {
    const s = getSocket();
    if (s && s.connected) {
      s.emit('sync:push', { timestamp: Date.now() });
    }
  } catch (err) {
    console.warn('[Socket.IO] Failed to emit sync push:', err);
  }
}
