import type { Rating } from '../hooks/usePlayback';

interface RatingButtonsProps {
  onRate: (rating: Rating) => void;
  remaining: number;
  selected: Rating | null;
}

const ratings: { rating: Rating; label: string; key: string; color: string }[] = [
  { rating: 'again', label: 'Again', key: '1', color: '#e94560' },
  { rating: 'hard', label: 'Hard', key: '2', color: '#e57e25' },
  { rating: 'good', label: 'Good', key: '3', color: '#0cca4a' },
  { rating: 'easy', label: 'Easy', key: '4', color: '#3b82f6' },
];

export function RatingButtons({ onRate, remaining, selected }: RatingButtonsProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '8px',
      background: 'rgba(13, 13, 26, 0.92)',
      backdropFilter: 'blur(8px)',
      padding: '10px 16px',
      borderRadius: '12px',
      border: '1px solid var(--sidebar-border)',
    }}>
      <div style={{
        fontSize: '12px',
        color: 'var(--text-muted)',
      }}>
        {remaining} remaining
      </div>
      <div style={{
        display: 'flex',
        gap: '8px',
      }}>
        {ratings.map(({ rating, label, key, color }) => {
          const isSelected = selected === rating;
          return (
            <button
              type="button"
              key={rating}
              onClick={() => onRate(rating)}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                background: isSelected ? `${color}88` : `${color}33`,
                border: `1.5px solid ${isSelected ? color : `${color}66`}`,
                color,
                fontSize: '13px',
                fontWeight: 600,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                transition: 'background 0.15s, border-color 0.15s, transform 0.1s',
                minWidth: '64px',
                transform: isSelected ? 'scale(1.05)' : 'scale(1)',
              }}
              onMouseEnter={e => {
                if (!isSelected) {
                  e.currentTarget.style.background = `${color}55`;
                }
              }}
              onMouseLeave={e => {
                if (!isSelected) {
                  e.currentTarget.style.background = `${color}33`;
                }
              }}
            >
              <span>{label}</span>
              <span style={{
                fontSize: '10px',
                opacity: 0.6,
                fontWeight: 400,
              }}>
                {key}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
