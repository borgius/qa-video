import { useCallback, useMemo, useState } from 'react';
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [zoomed, setZoomed] = useState(false);

  const handleSelectFile = useCallback((name: string) => {
    if (name === state.currentFile) return;
    fetchFileDetail(name).then(data => {
      playback.loadFile(name, data);
    });
  }, [state.currentFile, playback.loadFile]);

  const toggleSidebar = useCallback(() => setSidebarOpen(v => !v), []);
  const toggleZoom = useCallback(() => setZoomed(v => !v), []);

  const keyboardActions = useMemo(() => ({
    onTogglePlay: () => {
      if (state.isPlaying) playback.pause();
      else playback.play();
    },
    onNext: playback.next,
    onPrev: playback.prev,
    onShuffle: playback.toggleShuffle,
    onRestart: playback.restart,
    onToggleSidebar: toggleSidebar,
    onToggleZoom: toggleZoom,
  }), [state.isPlaying, playback, toggleSidebar, toggleZoom]);

  useKeyboard(keyboardActions);

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
      {sidebarOpen && (
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
          onToggleSidebar={toggleSidebar}
          questions={state.fileData?.questions ?? []}
          cardOrder={state.cardOrder}
          onGoToCard={playback.goToCard}
        />
      )}

      <FlashcardViewer
        card={currentCard}
        fileName={state.currentFile ?? ''}
        cardIndex={currentRealIndex}
        displayType={displayType}
        isSpeaking={isSpeaking}
        phase={state.phase}
        title={title}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        zoomed={zoomed}
        onToggleZoom={toggleZoom}
      />
    </div>
  );
}
