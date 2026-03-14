import { slideUrl } from '../api';
import { SlideImage } from './SlideImage';

interface SlideCardProps {
  fileName: string;
  type: 'question' | 'answer';
  cardIndex: number;
  isSpeaking?: boolean;
  zoomed?: boolean;
  format?: 'full' | 'shorts';
}

export function SlideCard({ fileName, type, cardIndex, isSpeaking, zoomed, format }: SlideCardProps) {
  const badgeColor = type === 'question' ? '#e94560' : '#0cca4a';
  const src = slideUrl(fileName, cardIndex, type, format);
  const isShorts = format === 'shorts';

  const sizeStyle: React.CSSProperties = isShorts
    ? zoomed
      ? { height: 'min(91vh, 840px)', aspectRatio: '9 / 16' }
      : { height: 'min(70vh, 600px)', aspectRatio: '9 / 16' }
    : zoomed
      ? { width: 'min(93vw, calc(93vh * 16 / 9))', aspectRatio: '16 / 9' }
      : { width: '100%', maxWidth: '960px', aspectRatio: '16 / 9' };

  return (
    <div style={{
      ...sizeStyle,
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
