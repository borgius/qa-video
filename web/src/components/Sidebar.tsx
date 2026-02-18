import { useState } from 'react';
import type { Phase } from '../hooks/usePlayback';
import type { FileInfo, YamlCard } from '../types';
import { PlaybackControls } from './PlaybackControls';
import { QuestionList } from './QuestionList';

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
  questions: YamlCard[];
  cardOrder: number[];
  onGoToCard: (index: number) => void;
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
  questions,
  cardOrder,
  onGoToCard,
}: SidebarProps) {
  const hasQuestions = questions.length > 0;
  const [topicsExpanded, setTopicsExpanded] = useState(true);
  const selectedFileInfo = files.find(f => f.name === selectedFile);

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

      {/* Scrollable content: topics + questions */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px',
      }}>
        {/* Topics section header with expand/collapse toggle */}
        <button
          type="button"
          onClick={() => setTopicsExpanded(v => !v)}
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            color: 'var(--text-muted)',
            background: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span style={{
            fontSize: '10px',
            transition: 'transform 0.2s',
            transform: topicsExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            display: 'inline-block',
          }}>&#9654;</span>
          Topics ({files.length})
        </button>

        {loadingFiles ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Loading...
          </div>
        ) : topicsExpanded ? (
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
        ) : selectedFileInfo ? (
          /* Collapsed: show only the selected topic */
          <div style={{
            padding: '6px 12px',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'var(--accent)',
              flexShrink: 0,
            }} />
            <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
              {selectedFileInfo.title}
            </span>
          </div>
        ) : null}

        {/* Questions section - shown when a file is selected */}
        {hasQuestions && (
          <>
            <div style={{
              margin: '12px 0 4px',
              borderTop: '1px solid var(--sidebar-border)',
              paddingTop: '12px',
            }}>
              <div style={{
                padding: '4px 12px 8px',
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span>Questions ({questions.length})</span>
                {isShuffled && (
                  <span style={{
                    fontSize: '10px',
                    fontWeight: 500,
                    color: 'var(--accent)',
                    textTransform: 'none',
                    letterSpacing: 'normal',
                  }}>
                    Shuffled
                  </span>
                )}
              </div>
            </div>
            <QuestionList
              questions={questions}
              cardOrder={cardOrder}
              currentCardIdx={currentCardIdx}
              onGoToCard={onGoToCard}
            />
          </>
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
