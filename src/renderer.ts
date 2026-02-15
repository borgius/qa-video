import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { writeFile } from 'fs/promises';
import { PipelineConfig } from './types.js';

interface SlideOptions {
  text: string;
  type: 'question' | 'answer';
  cardIndex: number;
  totalCards: number;
  config: PipelineConfig;
}

function wrapText(
  ctx: any,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }

    const words = paragraph.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
}

export async function renderSlide(
  outputPath: string,
  options: SlideOptions
): Promise<void> {
  const { text, type, cardIndex, totalCards, config } = options;
  const { width, height, fontSize, textColor } = config;

  const bgColor = type === 'question' ? config.questionColor : config.answerColor;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  // Header bar
  const headerHeight = 80;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(0, 0, width, headerHeight);

  // Header text
  ctx.fillStyle = textColor;
  ctx.font = `bold 28px "Arial", "Helvetica", sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(
    `${type === 'question' ? 'QUESTION' : 'ANSWER'} ${cardIndex + 1} of ${totalCards}`,
    40,
    50
  );

  // Type badge
  const badgeText = type === 'question' ? 'Q' : 'A';
  const badgeColor = type === 'question' ? '#e94560' : '#0cca4a';
  const badgeSize = 60;
  const badgeX = width - 100;
  const badgeY = 10;

  ctx.fillStyle = badgeColor;
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeSize, badgeSize, 12);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 36px "Arial", "Helvetica", sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(badgeText, badgeX + badgeSize / 2, badgeY + 43);

  // Main text
  ctx.font = `${fontSize}px "Arial", "Helvetica", sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = textColor;

  const maxTextWidth = width - 200;
  const lines = wrapText(ctx, text, maxTextWidth);
  const lineHeight = fontSize * 1.4;
  const totalTextHeight = lines.length * lineHeight;

  // Center vertically (below header)
  const contentAreaTop = headerHeight;
  const contentAreaHeight = height - contentAreaTop;
  let startY = contentAreaTop + (contentAreaHeight - totalTextHeight) / 2 + fontSize;

  // Clamp so text doesn't go above header
  if (startY < contentAreaTop + fontSize + 20) {
    startY = contentAreaTop + fontSize + 20;
  }

  for (const line of lines) {
    ctx.fillText(line, width / 2, startY);
    startY += lineHeight;
  }

  // Footer
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.fillRect(0, height - 4, width, 4);

  // Save PNG
  const buffer = canvas.toBuffer('image/png');
  await writeFile(outputPath, buffer);
}
