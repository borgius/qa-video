import { useRef, useState, useLayoutEffect } from 'react';
import { YamlConfig } from '../types';

interface SlideCardProps {
  text: string;
  type: 'question' | 'answer';
  cardIndex: number;
  totalCards: number;
  config: YamlConfig;
  isSpeaking?: boolean;
}

export function SlideCard({ text, type, cardIndex, totalCards, config, isSpeaking }: SlideCardProps) {
  const bgColor = type === 'question'
    ? (config.questionColor || '#16213e')
    : (config.answerColor || '#0f3460');
  const badgeColor = type === 'question' ? '#e94560' : '#0cca4a';
  const label = type === 'question' ? 'QUESTION' : 'ANSWER';
  const badge = type === 'question' ? 'Q' : 'A';
  const baseFontSize = Math.min(config.fontSize || 52, 42);
  const textColor = config.textColor || '#ffffff';
  const minFontSize = 16;

  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [fontSize, setFontSize] = useState(baseFontSize);

  // Measure and shrink font until text fits
  useLayoutEffect(() => {
    setFontSize(baseFontSize);
  }, [text, baseFontSize]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;

    if (textEl.scrollHeight > container.clientHeight && fontSize > minFontSize) {
      setFontSize(prev => Math.max(prev - 2, minFontSize));
    }
  }, [fontSize, text]);

  return (
    <div style={{
      width: '100%',
      aspectRatio: '16 / 9',
      maxWidth: '960px',
      position: 'relative',
      backgroundColor: bgColor,
      borderRadius: '12px',
      overflow: 'hidden',
      boxShadow: `0 8px 32px rgba(0, 0, 0, 0.4)${isSpeaking ? `, 0 0 20px ${badgeColor}40` : ''}`,
      transition: 'box-shadow 0.3s ease, background-color 0.4s ease',
    }}>
      {/* Header bar */}
      <div style={{
        height: '80px',
        background: 'rgba(0, 0, 0, 0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 40px',
      }}>
        <span style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontWeight: 'bold',
          fontSize: '28px',
          color: textColor,
          letterSpacing: '1px',
        }}>
          {label} {cardIndex + 1} of {totalCards}
        </span>

        {/* Badge */}
        <span style={{
          width: '60px',
          height: '60px',
          borderRadius: '12px',
          backgroundColor: badgeColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontWeight: 'bold',
          fontSize: '36px',
          color: '#ffffff',
          transition: 'transform 0.3s ease',
          transform: isSpeaking ? 'scale(1.1)' : 'scale(1)',
        }}>
          {badge}
        </span>
      </div>

      {/* Body text */}
      <div
        ref={containerRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 'calc(100% - 80px - 4px)',
          padding: '20px 60px',
          textAlign: 'center',
          overflow: 'hidden',
        }}
      >
        <p
          ref={textRef}
          style={{
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: `${fontSize}px`,
            lineHeight: 1.4,
            color: textColor,
            whiteSpace: 'pre-wrap',
            margin: 0,
            maxWidth: '100%',
            wordBreak: 'break-word',
          }}
        >
          {text}
        </p>
      </div>

      {/* Footer line */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        width: '100%',
        height: '4px',
        background: 'rgba(255, 255, 255, 0.15)',
      }} />
    </div>
  );
}
