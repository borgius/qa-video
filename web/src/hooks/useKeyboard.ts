import { useEffect } from 'react';
import type { Rating } from './usePlayback';

interface KeyboardActions {
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onShuffle: () => void;
  onRestart: () => void;
  onToggleSidebar: () => void;
  onToggleZoom: () => void;
  onToggleQueueMode: () => void;
  onRate: (rating: Rating) => void;
}

const ratingKeys: Record<string, Rating> = {
  '1': 'again',
  '2': 'hard',
  '3': 'good',
  '4': 'easy',
};

export function useKeyboard(actions: KeyboardActions) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger when typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Rating keys (1-4)
      const rating = ratingKeys[e.key];
      if (rating) {
        e.preventDefault();
        actions.onRate(rating);
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          actions.onTogglePlay();
          break;
        case 'ArrowRight':
        case 'n':
          e.preventDefault();
          actions.onNext();
          break;
        case 'ArrowLeft':
        case 'p':
          e.preventDefault();
          actions.onPrev();
          break;
        case 's':
          e.preventDefault();
          actions.onShuffle();
          break;
        case 'r':
          e.preventDefault();
          actions.onRestart();
          break;
        case 'b':
          e.preventDefault();
          actions.onToggleSidebar();
          break;
        case 'f':
          e.preventDefault();
          actions.onToggleZoom();
          break;
        case 'q':
          e.preventDefault();
          actions.onToggleQueueMode();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actions]);
}
