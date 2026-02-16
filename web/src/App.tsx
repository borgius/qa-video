import { useCallback, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { FlashcardViewer } from './components/FlashcardViewer';
import { useFiles } from './hooks/useFiles';
import { usePlayback } from './hooks/usePlayback';
import { useKeyboard } from './hooks/useKeyboard';
import { fetchFileDetail } from './api';

export default function App() {
  const { files, loading: loadingFiles } = useFiles();
  const playback = usePlayback();
  const { state, currentCard, currentRealIndex, displayType, isSpeaking } = playback;

  const handleSelectFile = useCallback((name: string) => {
    if (name === state.currentFile) return;
    fetchFileDetail(name).then(data => {
      playback.loadFile(name, data);
    });
  }, [state.currentFile, playback.loadFile]);

  const keyboardActions = useMemo(() => ({
    onTogglePlay: () => {
      if (state.isPlaying) playback.pause();
      else playback.play();
    },
    onNext: playback.next,
    onPrev: playback.prev,
    onShuffle: playback.toggleShuffle,
    onRestart: playback.restart,
  }), [state.isPlaying, playback]);

  useKeyboard(keyboardActions);

  const config = state.fileData?.config ?? {};
  const title = state.fileData?.title ?? '';
  const totalCards = state.fileData?.questions.length ?? 0;

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100vw',
      overflow: 'hidden',
      background: 'var(--bg-primary)',
    }}>
      <Sidebar
        files={files}
        selectedFile={state.currentFile}
        onSelectFile={handleSelectFile}
        isPlaying={state.isPlaying}
        phase={state.phase}
        isShuffled={state.isShuffled}
        currentCardIdx={state.currentCardIdx}
        totalCards={totalCards}
        onPlay={playback.play}
        onPause={playback.pause}
        onNext={playback.next}
        onPrev={playback.prev}
        onShuffle={playback.toggleShuffle}
        onRestart={playback.restart}
        loadingFiles={loadingFiles}
      />

      <FlashcardViewer
        card={currentCard}
        cardIndex={currentRealIndex}
        totalCards={totalCards}
        config={config}
        displayType={displayType}
        isSpeaking={isSpeaking}
        phase={state.phase}
        title={title}
      />
    </div>
  );
}
