import { Phase } from '../hooks/usePlayback';

interface PlaybackControlsProps {
  isPlaying: boolean;
  phase: Phase;
  isShuffled: boolean;
  isQueueMode: boolean;
  currentCardIdx: number;
  totalCards: number;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onShuffle: () => void;
  onRestart: () => void;
  onToggleQueueMode: () => void;
  hasFile: boolean;
}

export function PlaybackControls({
  isPlaying,
  phase,
  isShuffled,
  isQueueMode,
  currentCardIdx,
  totalCards,
  onPlay,
  onPause,
  onNext,
  onPrev,
  onShuffle,
  onRestart,
  onToggleQueueMode,
  hasFile,
}: PlaybackControlsProps) {
  const isIdle = phase === 'idle' || phase === 'done';
  const progress = totalCards > 0 ? ((currentCardIdx + (isIdle ? 0 : 1)) / totalCards) * 100 : 0;

  const phaseLabel = (() => {
    switch (phase) {
      case 'idle': return 'Ready';
      case 'question': return 'Question';
      case 'q-speaking': return 'Speaking question...';
      case 'q-pause': return 'Think about it...';
      case 'answer': return 'Answer';
      case 'a-speaking': return 'Speaking answer...';
      case 'a-pause': return 'Moving on...';
      case 'done': return 'Complete!';
      default: return '';
    }
  })();

  return (
    <div style={{
      padding: '20px',
      borderTop: '1px solid var(--sidebar-border)',
    }}>
      {/* Progress bar */}
      <div style={{
        width: '100%',
        height: '4px',
        background: 'rgba(255,255,255,0.1)',
        borderRadius: '2px',
        marginBottom: '12px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${progress}%`,
          height: '100%',
          background: 'linear-gradient(90deg, var(--accent), var(--accent-green))',
          borderRadius: '2px',
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Status line */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        fontSize: '12px',
        color: 'var(--text-secondary)',
      }}>
        <span>{hasFile ? `Card ${currentCardIdx + 1} of ${totalCards}` : 'No file selected'}</span>
        <span>{phaseLabel}</span>
      </div>

      {/* Main controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        marginBottom: '12px',
      }}>
        {/* Queue mode */}
        <button
          onClick={onToggleQueueMode}
          disabled={!hasFile}
          title="Queue mode (Q)"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            background: isQueueMode ? '#3b82f6' : 'rgba(255,255,255,0.1)',
            color: 'var(--text-primary)',
            fontSize: '14px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: hasFile ? 1 : 0.3,
            transition: 'background 0.2s',
          }}
        >
          SRS
        </button>

        {/* Shuffle */}
        <button
          onClick={onShuffle}
          disabled={!hasFile}
          title="Shuffle (S)"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            background: isShuffled ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
            color: 'var(--text-primary)',
            fontSize: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: hasFile ? 1 : 0.3,
            transition: 'background 0.2s',
          }}
        >
          &#8645;
        </button>

        {/* Prev */}
        <button
          onClick={onPrev}
          disabled={!hasFile || currentCardIdx === 0}
          title="Previous (Left/P)"
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: 'rgba(255,255,255,0.1)',
            color: 'var(--text-primary)',
            fontSize: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: hasFile && currentCardIdx > 0 ? 1 : 0.3,
            transition: 'background 0.2s',
          }}
        >
          &#9664;
        </button>

        {/* Play/Pause */}
        <button
          onClick={isPlaying ? onPause : onPlay}
          disabled={!hasFile}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            background: hasFile ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
            color: '#ffffff',
            fontSize: '22px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: hasFile ? 1 : 0.3,
            transition: 'transform 0.2s, background 0.2s',
            transform: isPlaying ? 'scale(1.05)' : 'scale(1)',
          }}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        {/* Next */}
        <button
          onClick={onNext}
          disabled={!hasFile || currentCardIdx >= totalCards - 1}
          title="Next (Right/N)"
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: 'rgba(255,255,255,0.1)',
            color: 'var(--text-primary)',
            fontSize: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: hasFile && currentCardIdx < totalCards - 1 ? 1 : 0.3,
            transition: 'background 0.2s',
          }}
        >
          &#9654;
        </button>

        {/* Restart */}
        <button
          onClick={onRestart}
          disabled={!hasFile}
          title="Restart (R)"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            background: 'rgba(255,255,255,0.1)',
            color: 'var(--text-primary)',
            fontSize: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: hasFile ? 1 : 0.3,
            transition: 'background 0.2s',
          }}
        >
          &#8634;
        </button>
      </div>

      {/* Keyboard shortcuts hint */}
      <div style={{
        fontSize: '10px',
        color: 'var(--text-muted)',
        textAlign: 'center',
      }}>
        Space: play/pause &middot; &larr;&rarr;: prev/next &middot; S: shuffle &middot; Q: queue &middot; R: restart
      </div>
    </div>
  );
}
