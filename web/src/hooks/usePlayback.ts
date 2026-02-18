import { useReducer, useRef, useEffect, useCallback } from 'react';
import { FileDetail } from '../types';
import { audioUrl, slideUrl } from '../api';

export type Phase =
  | 'idle'
  | 'question'
  | 'q-speaking'
  | 'q-pause'
  | 'answer'
  | 'a-speaking'
  | 'a-pause'
  | 'done';

export type Rating = 'again' | 'hard' | 'good' | 'easy';

interface PlaybackState {
  currentFile: string | null;
  fileData: FileDetail | null;
  cardOrder: number[];
  currentCardIdx: number;
  phase: Phase;
  isPlaying: boolean;
  isShuffled: boolean;
  isQueueMode: boolean;
  pendingRating: Rating | null;
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
  | { type: 'TOGGLE_QUEUE_MODE' }
  | { type: 'MARK_CARD'; rating: Rating }
  | { type: 'SKIP_CARD' }
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

function getReinsertDistance(rating: 'again' | 'hard' | 'good', remaining: number): number {
  const jitter = Math.round(Math.random());
  switch (rating) {
    case 'again':
      return Math.max(3, Math.floor(remaining * 0.10)) + jitter;
    case 'hard':
      return Math.max(5, Math.floor(remaining * 0.25)) + jitter;
    case 'good':
      return Math.max(7, Math.floor(remaining * 0.60)) + jitter;
  }
}

function advanceQueue(state: PlaybackState): PlaybackState {
  const rating = state.pendingRating;
  const cardValue = state.cardOrder[state.currentCardIdx];
  const newOrder = [...state.cardOrder];
  newOrder.splice(state.currentCardIdx, 1);

  if (rating === 'again' || rating === 'hard' || rating === 'good') {
    const remaining = newOrder.length - state.currentCardIdx;
    const distance = getReinsertDistance(rating, remaining);
    const insertAt = Math.min(state.currentCardIdx + distance, newOrder.length);
    newOrder.splice(insertAt, 0, cardValue);
  }
  // easy or null: don't reinsert

  if (newOrder.length === 0 || state.currentCardIdx >= newOrder.length) {
    return { ...state, cardOrder: newOrder, pendingRating: null, phase: 'done', isPlaying: false };
  }
  return { ...state, cardOrder: newOrder, pendingRating: null, phase: 'question' };
}

const initialState: PlaybackState = {
  currentFile: null,
  fileData: null,
  cardOrder: [],
  currentCardIdx: 0,
  phase: 'idle',
  isPlaying: false,
  isShuffled: false,
  isQueueMode: false,
  pendingRating: null,
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
        pendingRating: null,
      };
    }
    case 'PLAY':
      if (state.phase === 'done') {
        const order = state.isQueueMode
          ? makeOrder(state.fileData?.questions.length || 0, state.isShuffled)
          : state.cardOrder;
        return { ...state, isPlaying: true, currentCardIdx: 0, cardOrder: order, phase: 'question', pendingRating: null };
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
      if (state.isQueueMode) {
        return advanceQueue(state);
      }
      const next = state.currentCardIdx + 1;
      if (next >= state.cardOrder.length) {
        return { ...state, phase: 'done', isPlaying: false };
      }
      return { ...state, currentCardIdx: next, phase: 'question' };
    }
    case 'PREV_CARD': {
      const prev = Math.max(0, state.currentCardIdx - 1);
      return { ...state, currentCardIdx: prev, phase: 'question', pendingRating: null };
    }
    case 'GO_TO_CARD':
      return { ...state, currentCardIdx: action.index, phase: 'question', isPlaying: true, pendingRating: null };
    case 'MARK_CARD':
      return { ...state, pendingRating: action.rating };
    case 'SKIP_CARD':
      // Easy immediate skip: clear pending (don't reinsert), advance
      return advanceQueue({ ...state, pendingRating: null });
    case 'TOGGLE_SHUFFLE': {
      const newShuffled = !state.isShuffled;
      const order = makeOrder(state.fileData?.questions.length || 0, newShuffled);
      return { ...state, isShuffled: newShuffled, cardOrder: order, currentCardIdx: 0, phase: 'idle', isPlaying: false, pendingRating: null };
    }
    case 'TOGGLE_QUEUE_MODE': {
      const newQueueMode = !state.isQueueMode;
      const order = makeOrder(state.fileData?.questions.length || 0, state.isShuffled);
      return { ...state, isQueueMode: newQueueMode, cardOrder: order, currentCardIdx: 0, phase: 'idle', isPlaying: false, pendingRating: null };
    }
    case 'RESTART': {
      const order = makeOrder(state.fileData?.questions.length || 0, state.isShuffled);
      return { ...state, cardOrder: order, currentCardIdx: 0, phase: 'idle', isPlaying: false, pendingRating: null };
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

  // Pre-fetch next card's audio and slides
  useEffect(() => {
    if (!state.currentFile || !state.fileData) return;

    const file = state.currentFile;
    const cardRealIdx = state.cardOrder[state.currentCardIdx];

    if (state.phase === 'q-speaking' || state.phase === 'a-speaking') {
      const nextIdx = state.currentCardIdx + 1;
      if (nextIdx < state.cardOrder.length) {
        const nextCard = state.cardOrder[nextIdx];
        fetch(audioUrl(file, nextCard, 'question')).catch(() => {});
        fetch(slideUrl(file, nextCard, 'question')).catch(() => {});
      }
    }

    if (state.phase === 'q-speaking') {
      fetch(audioUrl(file, cardRealIdx, 'answer')).catch(() => {});
      fetch(slideUrl(file, cardRealIdx, 'answer')).catch(() => {});
    }
  }, [state.phase]);

  function playAudio(url: string) {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const audio = audioRef.current;

    audio.onended = () => {
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
  const toggleQueueMode = useCallback(() => {
    stopAudioAndTimer(audioRef, timerRef);
    dispatch({ type: 'TOGGLE_QUEUE_MODE' });
  }, []);
  const restart = useCallback(() => {
    stopAudioAndTimer(audioRef, timerRef);
    dispatch({ type: 'RESTART' });
  }, []);
  const goToCard = useCallback((index: number) => {
    stopAudioAndTimer(audioRef, timerRef);
    dispatch({ type: 'GO_TO_CARD', index });
  }, []);
  const rateCard = useCallback((rating: Rating) => {
    if (rating === 'easy') {
      stopAudioAndTimer(audioRef, timerRef);
      dispatch({ type: 'SKIP_CARD' });
    } else {
      dispatch({ type: 'MARK_CARD', rating });
    }
  }, []);

  // Derived state
  const currentRealIndex = state.cardOrder[state.currentCardIdx] ?? 0;
  const currentCard = state.fileData?.questions[currentRealIndex] ?? null;
  const displayType: 'question' | 'answer' =
    state.phase === 'answer' || state.phase === 'a-speaking' || state.phase === 'a-pause'
      ? 'answer'
      : 'question';
  const isSpeaking = state.phase === 'q-speaking' || state.phase === 'a-speaking';
  const queueRemaining = state.isQueueMode ? state.cardOrder.length - state.currentCardIdx : 0;
  const isCardActive = state.isPlaying && state.phase !== 'idle' && state.phase !== 'done';

  return {
    state,
    currentCard,
    currentRealIndex,
    displayType,
    isSpeaking,
    queueRemaining,
    isCardActive,
    play,
    pause,
    next,
    prev,
    loadFile,
    toggleShuffle,
    toggleQueueMode,
    restart,
    goToCard,
    rateCard,
  };
}
