import { useRef, useEffect } from 'react';
import { YamlCard } from '../types';

interface QuestionListProps {
  questions: YamlCard[];
  cardOrder: number[];
  currentCardIdx: number;
  onGoToCard: (index: number) => void;
}

export function QuestionList({
  questions,
  cardOrder,
  currentCardIdx,
  onGoToCard,
}: QuestionListProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentCardIdx]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
    }}>
      {cardOrder.map((realIdx, orderIdx) => {
        const q = questions[realIdx];
        if (!q) return null;
        const isActive = orderIdx === currentCardIdx;

        return (
          <button
            key={`${orderIdx}-${realIdx}`}
            ref={isActive ? activeRef : null}
            onClick={() => onGoToCard(orderIdx)}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: '6px',
              background: isActive ? 'rgba(233, 69, 96, 0.15)' : 'transparent',
              border: isActive ? '1px solid rgba(233, 69, 96, 0.3)' : '1px solid transparent',
              color: 'var(--text-primary)',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              transition: 'background 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => {
              if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
            }}
            onMouseLeave={e => {
              if (!isActive) e.currentTarget.style.background = 'transparent';
            }}
          >
            <span style={{
              minWidth: '22px',
              height: '22px',
              borderRadius: '4px',
              background: isActive ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
              color: isActive ? '#fff' : 'var(--text-secondary)',
              fontSize: '11px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              {realIdx + 1}
            </span>
            <span style={{
              fontSize: '12px',
              lineHeight: '1.4',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}>
              {q.question}
            </span>
          </button>
        );
      })}
    </div>
  );
}
