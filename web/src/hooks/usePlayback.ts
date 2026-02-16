import { useReducer, useRef, useEffect, useCallback } from 'react';
import { FileDetail } from '../types';
import { audioUrl } from '../api';

export type Phase =
  | 'idle'
  | 'question'
  | 'q-speaking'
  | 'q-pause'
  | 'answer'
  | 'a-speaking'
  | 'a-pause'
  | 'done';

interface PlaybackState {
  currentFile: string | null;
  fileData: FileDetail | null;
  cardOrder: number[];
  currentCardIdx: number;
  phase: Phase;
  isPlaying: boolean;
  isShuffled: boolean;
}

type Action =
  | { type: 'LOAD_FILE'; payload: { name: string; data: FileDetail } }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SET_PHASE'; phase: Phase }
  | { type: 'NEXT_CARD' }
  | { type: 'PREV_CARD' }
  | { type: 'GO_TO_CARD'; index: number }
  | { type: 'TOGGLE_SHUFFLE' }
  | { type: 'RESTART' };

function shuffle(arr: number[]): number[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function makeOrder(length: number, shouldShuffle: boolean): number[] {
  const order = Array.from({ length }, (_, i) => i);
  return shouldShuffle ? shuffle(order) : order;
}

const initialState: PlaybackState = {
  currentFile: null,
  fileData: null,
  cardOrder: [],
  currentCardIdx: 0,
  phase: 'idle',
  isPlaying: false,
  isShuffled: false,
};

function reducer(state: PlaybackState, action: Action): PlaybackState {
  switch (action.type) {
    case 'LOAD_FILE': {
      const order = makeOrder(action.payload.data.questions.length, state.isShuffled);
      return {
        ...state,
        currentFile: action.payload.name,
        fileData: action.payload.data,
        cardOrder: order,
        currentCardIdx: 0,
        phase: 'idle',
        isPlaying: false,
      };
    }
    case 'PLAY':
      if (state.phase === 'done') {
        return { ...state, isPlaying: true, currentCardIdx: 0, phase: 'question' };
      }
      if (state.phase === 'idle') {
        return { ...state, isPlaying: true, phase: 'question' };
      }
      return { ...state, isPlaying: true };
    case 'PAUSE':
      return { ...state, isPlaying: false };
    case 'SET_PHASE':
      return { ...state, phase: action.phase };
    case 'NEXT_CARD': {
      const next = state.currentCardIdx + 1;
      if (next >= state.cardOrder.length) {
        return { ...state, phase: 'done', isPlaying: false };
      }
      return { ...state, currentCardIdx: next, phase: 'question' };
    }
    case 'PREV_CARD': {
      const prev = Math.max(0, state.currentCardIdx - 1);
      return { ...state, currentCardIdx: prev, phase: 'question' };
    }
    case 'GO_TO_CARD':
      return { ...state, currentCardIdx: action.index, phase: 'question', isPlaying: true };
    case 'TOGGLE_SHUFFLE': {
      const newShuffled = !state.isShuffled;
      const order = makeOrder(state.fileData?.questions.length || 0, newShuffled);
      return { ...state, isShuffled: newShuffled, cardOrder: order, currentCardIdx: 0, phase: 'idle', isPlaying: false };
    }
    case 'RESTART': {
      const order = makeOrder(state.fileData?.questions.length || 0, state.isShuffled);
      return { ...state, cardOrder: order, currentCardIdx: 0, phase: 'idle', isPlaying: false };
    }
    default:
      return state;
  }
}

function stopAudioAndTimer(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  timerRef: React.RefObject<number | null>,
) {
  if (audioRef.current) {
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
  }
  if (timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

export function usePlayback() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  // Use a ref to track phase so audio callbacks always see the current value
  const phaseRef = useRef<Phase>(state.phase);
  phaseRef.current = state.phase;

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  // Phase progression
  useEffect(() => {
    if (!state.isPlaying || !state.fileData || !state.currentFile) return;

    const cardRealIdx = state.cardOrder[state.currentCardIdx];
    if (cardRealIdx === undefined) return;

    const config = state.fileData.config;
    const file = state.currentFile;

    switch (state.phase) {
      case 'question': {
        dispatch({ type: 'SET_PHASE', phase: 'q-speaking' });
        playAudio(audioUrl(file, cardRealIdx, 'question'));
        break;
      }
      case 'q-pause': {
        const delay = (config.questionDelay ?? 2) * 1000;
        timerRef.current = window.setTimeout(() => {
          dispatch({ type: 'SET_PHASE', phase: 'answer' });
        }, delay);
        break;
      }
      case 'answer': {
        dispatch({ type: 'SET_PHASE', phase: 'a-speaking' });
        playAudio(audioUrl(file, cardRealIdx, 'answer'));
        break;
      }
      case 'a-pause': {
        const delay = (config.answerDelay ?? 3) * 1000;
        timerRef.current = window.setTimeout(() => {
          dispatch({ type: 'NEXT_CARD' });
        }, delay);
        break;
      }
    }
  }, [state.phase, state.isPlaying, state.currentCardIdx]);

  // Pre-fetch next card's audio
  useEffect(() => {
    if (!state.currentFile || !state.fileData) return;

    if (state.phase === 'q-speaking' || state.phase === 'a-speaking') {
      const nextIdx = state.currentCardIdx + 1;
      if (nextIdx < state.cardOrder.length) {
        const nextCard = state.cardOrder[nextIdx];
        fetch(audioUrl(state.currentFile, nextCard, 'question')).catch(() => {});
      }
    }

    if (state.phase === 'q-speaking') {
      const cardRealIdx = state.cardOrder[state.currentCardIdx];
      fetch(audioUrl(state.currentFile, cardRealIdx, 'answer')).catch(() => {});
    }
  }, [state.phase]);

  function playAudio(url: string) {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const audio = audioRef.current;

    audio.onended = () => {
      // Read phase from ref to avoid stale closure
      const p = phaseRef.current;
      if (p === 'q-speaking') {
        dispatch({ type: 'SET_PHASE', phase: 'q-pause' });
      } else if (p === 'a-speaking') {
        dispatch({ type: 'SET_PHASE', phase: 'a-pause' });
      }
    };

    audio.onerror = () => {
      const p = phaseRef.current;
      if (p === 'q-speaking') {
        dispatch({ type: 'SET_PHASE', phase: 'q-pause' });
      } else if (p === 'a-speaking') {
        dispatch({ type: 'SET_PHASE', phase: 'a-pause' });
      }
    };

    audio.src = url;
    audio.play().catch(() => {
      dispatch({ type: 'PAUSE' });
    });
  }

  const play = useCallback(() => dispatch({ type: 'PLAY' }), []);
  const pause = useCallback(() => {
    dispatch({ type: 'PAUSE' });
    stopAudioAndTimer(audioRef, timerRef);
  }, []);
  const next = useCallback(() => {
    stopAudioAndTimer(audioRef, timerRef);
    dispatch({ type: 'NEXT_CARD' });
  }, []);
  const prev = useCallback(() => {
    stopAudioAndTimer(audioRef, timerRef);
    dispatch({ type: 'PREV_CARD' });
  }, []);
  const loadFile = useCallback((name: string, data: FileDetail) => {
    stopAudioAndTimer(audioRef, timerRef);
    dispatch({ type: 'LOAD_FILE', payload: { name, data } });
  }, []);
  const toggleShuffle = useCallback(() => {
    stopAudioAndTimer(audioRef, timerRef);
    dispatch({ type: 'TOGGLE_SHUFFLE' });
  }, []);
  const restart = useCallback(() => {
    stopAudioAndTimer(audioRef, timerRef);
    dispatch({ type: 'RESTART' });
  }, []);
  const goToCard = useCallback((index: number) => {
    stopAudioAndTimer(audioRef, timerRef);
    dispatch({ type: 'GO_TO_CARD', index });
  }, []);

  // Derived state
  const currentRealIndex = state.cardOrder[state.currentCardIdx] ?? 0;
  const currentCard = state.fileData?.questions[currentRealIndex] ?? null;
  const displayType: 'question' | 'answer' =
    state.phase === 'answer' || state.phase === 'a-speaking' || state.phase === 'a-pause'
      ? 'answer'
      : 'question';
  const isSpeaking = state.phase === 'q-speaking' || state.phase === 'a-speaking';

  return {
    state,
    currentCard,
    currentRealIndex,
    displayType,
    isSpeaking,
    play,
    pause,
    next,
    prev,
    loadFile,
    toggleShuffle,
    restart,
    goToCard,
  };
}
