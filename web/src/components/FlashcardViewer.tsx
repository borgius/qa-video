import { SlideCard } from './SlideCard';
import { YamlConfig, YamlCard } from '../types';
import { Phase } from '../hooks/usePlayback';

interface FlashcardViewerProps {
  card: YamlCard | null;
  cardIndex: number;
  totalCards: number;
  config: YamlConfig;
  displayType: 'question' | 'answer';
  isSpeaking: boolean;
  phase: Phase;
  title: string;
}

export function FlashcardViewer({
  card,
  cardIndex,
  totalCards,
  config,
  displayType,
  isSpeaking,
  phase,
  title,
}: FlashcardViewerProps) {
  if (!card) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        color: 'var(--text-secondary)',
      }}>
        <div style={{
          width: '80px',
          height: '80px',
          borderRadius: '20px',
          background: 'rgba(255,255,255,0.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '36px',
        }}>
          Q
        </div>
        <p style={{ fontSize: '18px', fontWeight: 500 }}>Select a topic to begin</p>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Choose a topic from the sidebar, then press Play
        </p>
      </div>
    );
  }

  const text = displayType === 'question' ? card.question : card.answer;

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px',
      gap: '24px',
      overflow: 'auto',
    }}>
      {/* Title */}
      <h2 style={{
        fontSize: '14px',
        fontWeight: 500,
        color: 'var(--text-secondary)',
        letterSpacing: '0.5px',
      }}>
        {title}
      </h2>

      {/* Slide card */}
      <SlideCard
        text={text}
        type={displayType}
        cardIndex={cardIndex}
        totalCards={totalCards}
        config={config}
        isSpeaking={isSpeaking}
      />

      {/* Phase indicator */}
      {phase !== 'idle' && phase !== 'done' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          color: 'var(--text-secondary)',
        }}>
          {isSpeaking && (
            <span style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: displayType === 'question' ? 'var(--accent)' : 'var(--accent-green)',
              animation: 'pulse 1s ease-in-out infinite',
            }} />
          )}
          <span>
            {phase === 'q-speaking' && 'Speaking question...'}
            {phase === 'q-pause' && 'Think about the answer...'}
            {phase === 'a-speaking' && 'Speaking answer...'}
            {phase === 'a-pause' && 'Next card coming up...'}
            {phase === 'question' && 'Loading...'}
            {phase === 'answer' && 'Loading...'}
          </span>
        </div>
      )}

      {phase === 'done' && (
        <div style={{
          fontSize: '16px',
          fontWeight: 600,
          color: 'var(--accent-green)',
        }}>
          All cards complete! Press R to restart.
        </div>
      )}

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
