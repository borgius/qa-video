import { FileInfo } from '../types';
import { PlaybackControls } from './PlaybackControls';
import { Phase } from '../hooks/usePlayback';

interface SidebarProps {
  files: FileInfo[];
  selectedFile: string | null;
  onSelectFile: (name: string) => void;
  isPlaying: boolean;
  phase: Phase;
  isShuffled: boolean;
  currentCardIdx: number;
  totalCards: number;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onShuffle: () => void;
  onRestart: () => void;
  loadingFiles: boolean;
  onToggleSidebar: () => void;
}

export function Sidebar({
  files,
  selectedFile,
  onSelectFile,
  isPlaying,
  phase,
  isShuffled,
  currentCardIdx,
  totalCards,
  onPlay,
  onPause,
  onNext,
  onPrev,
  onShuffle,
  onRestart,
  loadingFiles,
  onToggleSidebar,
}: SidebarProps) {
  return (
    <aside style={{
      width: '320px',
      minWidth: '320px',
      height: '100%',
      background: 'var(--sidebar-bg)',
      borderRight: '1px solid var(--sidebar-border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Logo + collapse */}
      <div style={{
        padding: '24px 20px 16px',
        borderBottom: '1px solid var(--sidebar-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <h1 style={{
          fontSize: '20px',
          fontWeight: 700,
          letterSpacing: '-0.5px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          margin: 0,
        }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: 'var(--accent)',
            fontSize: '16px',
            fontWeight: 700,
          }}>Q</span>
          QA Flashcards
        </h1>
        <button
          type="button"
          onClick={onToggleSidebar}
          title="Hide sidebar (B)"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '4px',
            fontSize: '18px',
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          &#x2039;
        </button>
      </div>

      {/* File list */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px',
      }}>
        <div style={{
          padding: '8px 12px',
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '1px',
          color: 'var(--text-muted)',
        }}>
          Topics ({files.length})
        </div>

        {loadingFiles ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Loading...
          </div>
        ) : (
          files.map(file => (
            <button
              key={file.name}
              onClick={() => onSelectFile(file.name)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                background: selectedFile === file.name ? 'rgba(233, 69, 96, 0.15)' : 'transparent',
                border: selectedFile === file.name ? '1px solid rgba(233, 69, 96, 0.3)' : '1px solid transparent',
                color: 'var(--text-primary)',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                transition: 'background 0.15s, border-color 0.15s',
                marginBottom: '2px',
              }}
              onMouseEnter={e => {
                if (selectedFile !== file.name) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                }
              }}
              onMouseLeave={e => {
                if (selectedFile !== file.name) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: 500 }}>
                {file.title}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                {file.questionCount} questions
              </span>
            </button>
          ))
        )}
      </div>

      {/* Playback controls */}
      <PlaybackControls
        isPlaying={isPlaying}
        phase={phase}
        isShuffled={isShuffled}
        currentCardIdx={currentCardIdx}
        totalCards={totalCards}
        onPlay={onPlay}
        onPause={onPause}
        onNext={onNext}
        onPrev={onPrev}
        onShuffle={onShuffle}
        onRestart={onRestart}
        hasFile={selectedFile !== null}
      />
    </aside>
  );
}
