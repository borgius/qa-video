import { slideUrl } from '../api';
import { SlideImage } from './SlideImage';

interface SlideCardProps {
  fileName: string;
  type: 'question' | 'answer';
  cardIndex: number;
  isSpeaking?: boolean;
  zoomed?: boolean;
}

export function SlideCard({ fileName, type, cardIndex, isSpeaking, zoomed }: SlideCardProps) {
  const badgeColor = type === 'question' ? '#e94560' : '#0cca4a';
  const src = slideUrl(fileName, cardIndex, type);

  return (
    <div style={{
      // Use min() so the 16:9 box fits within both viewport constraints
      width: zoomed ? 'min(93vw, calc(93vh * 16 / 9))' : '100%',
      maxWidth: zoomed ? undefined : '960px',
      aspectRatio: '16 / 9',
      position: 'relative',
      borderRadius: zoomed ? '4px' : '12px',
      overflow: 'hidden',
      boxShadow: `0 8px 32px rgba(0, 0, 0, 0.4)${isSpeaking ? `, 0 0 20px ${badgeColor}40` : ''}`,
      transition: 'box-shadow 0.3s ease',
    }}>
      <SlideImage key={src} src={src} alt={`${type} ${cardIndex + 1}`} />
    </div>
  );
}
