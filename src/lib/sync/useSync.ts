'use client';

import { useState, useEffect } from 'react';
import { syncEngine, type SyncEngineState } from './syncEngine';

export function useSync(): SyncEngineState & {
  triggerSync: () => Promise<void>;
  notifyLocalMutation: () => void;
} {
  const [state, setState] = useState<SyncEngineState>(syncEngine.getState());

  useEffect(() => {
    syncEngine.init();
    const unsubscribe = syncEngine.subscribe(setState);
    return () => unsubscribe();
  }, []);

  return {
    ...state,
    triggerSync: () => syncEngine.triggerSync(),
    notifyLocalMutation: () => syncEngine.notifyLocalMutation(),
  };
}
