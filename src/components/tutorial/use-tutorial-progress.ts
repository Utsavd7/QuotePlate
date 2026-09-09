'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { TutorialStateDto } from '@/lib/tutorial/tutorial-state';
import { createTutorialProgress } from './tutorial-progress';

export function useTutorialProgress(initial?: TutorialStateDto) {
  const [store] = useState(() => createTutorialProgress(initial));
  const progress = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return { ...progress, dispatch: store.dispatch, retry: store.retry, useSavedProgress: store.useSavedProgress };
}
