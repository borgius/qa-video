import { slideUrl } from '../api';
import { SlideImage } from './SlideImage';

interface SlideCardProps {
  fileName: string;
  type: 'question' | 'answer';
  cardIndex: number;
  isSpeaking?: boolean;
  zoomed?: boolean;
  format?: 'full' | 'shorts';
  captionsText?: string;
  captionsEnabled?: boolean;
}

export function SlideCard({ fileName, type, cardIndex, isSpeaking, zoomed, format, captionsText, captionsEnabled }: SlideCardProps) {
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
      {captionsEnabled && captionsText && (
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '12px 20px 14px',
          background: 'rgba(0, 0, 0, 0.68)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          color: '#fff',
          fontSize: 'clamp(12px, 1.8cqw, 18px)',
          lineHeight: 1.55,
          textAlign: 'center',
          zIndex: 20,
          maxHeight: '38%',
          overflowY: 'auto',
          boxSizing: 'border-box',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}>
          {captionsText}
        </div>
      )}
    </div>
  );
}
