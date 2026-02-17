import { writeFile } from 'node:fs/promises';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { parseMarkdown, type MdSegment } from './markdown.js';
import type { PipelineConfig } from './types.js';

interface SlideOptions {
  text: string;
  type: 'question' | 'answer';
  cardIndex: number;
  totalCards: number;
  config: PipelineConfig;
}

// ── Text helpers ─────────────────────────────────────────────────────────────

/** Word-wrap prose text into display lines. */
function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') { lines.push(''); continue; }
    const words = paragraph.split(/\s+/);
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Wrap a single code line at character boundaries if it exceeds maxWidth.
 */
function wrapCodeLine(ctx: SKRSContext2D, line: string, maxWidth: number): string[] {
  if (!line) return [''];
  if (ctx.measureText(line).width <= maxWidth) return [line];
  const result: string[] = [];
  let current = '';
  for (const ch of line) {
    const test = current + ch;
    if (ctx.measureText(test).width > maxWidth && current) {
      result.push(current);
      current = ch;
    } else {
      current = test;
    }
  }
  if (current) result.push(current);
  return result;
}

// ── Layout ───────────────────────────────────────────────────────────────────

/** A single line in a text block, with rendering position metadata. */
type TextLine =
  | { kind: 'prose'; text: string }         // centered prose
  | { kind: 'bullet'; text: string }        // first line of a bullet item ("• text")
  | { kind: 'continuation'; text: string }; // wrapped continuation of a bullet item

interface BlockLayout {
  kind: 'text' | 'code';
  textLines: TextLine[]; // used for 'text' blocks
  lines: string[];       // used for 'code' blocks
  lineHeight: number;
  totalHeight: number;
  codePadding: number;
  hasList: boolean;
}

/**
 * Wrap a text segment that may contain bullet list items (`- ` / `* ` prefixes).
 * Returns per-line metadata so the renderer can center prose and left-align
 * bullets with a hanging indent on wrapped continuation lines.
 */
function buildTextLines(
  ctx: SKRSContext2D,
  text: string,
  maxWidth: number,
): { lines: TextLine[]; hasList: boolean } {
  const result: TextLine[] = [];
  let hasList = false;
  const BULLET = '• ';

  for (const paragraph of text.split('\n')) {
    const trimmed = paragraph.trim();
    if (!trimmed) { result.push({ kind: 'prose', text: '' }); continue; }

    const listMatch = trimmed.match(/^[-*•]\s+(.*)/s);
    if (listMatch) {
      hasList = true;
      const bulletW = ctx.measureText(BULLET).width;
      const contentW = maxWidth - bulletW;
      const words = listMatch[1].trim().split(/\s+/);
      let current = '';
      let isFirst = true;

      for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (ctx.measureText(test).width > contentW && current) {
          result.push(isFirst
            ? { kind: 'bullet', text: `${BULLET}${current}` }
            : { kind: 'continuation', text: current });
          current = word;
          isFirst = false;
        } else {
          current = test;
        }
      }
      if (current) {
        result.push(isFirst
          ? { kind: 'bullet', text: `${BULLET}${current}` }
          : { kind: 'continuation', text: current });
      }
    } else {
      for (const line of wrapText(ctx, trimmed, maxWidth)) {
        result.push({ kind: 'prose', text: line });
      }
    }
  }

  return { lines: result, hasList };
}

/**
 * Compute per-block layouts for all segments at the given font size.
 * `contentWidth` is the available text width (slide width minus margins).
 */
function computeLayout(
  ctx: SKRSContext2D,
  segments: MdSegment[],
  mainFontSize: number,
  contentWidth: number,
): BlockLayout[] {
  const codeFontSize = Math.max(14, Math.round(mainFontSize * 0.78));
  const codeLineHeight = codeFontSize * 1.35;
  const codePadding = Math.max(10, Math.round(mainFontSize * 0.32));

  return segments.map(seg => {
    if (seg.kind === 'text') {
      ctx.font = `${mainFontSize}px "Arial", "Helvetica", sans-serif`;
      const { lines: textLines, hasList } = buildTextLines(ctx, seg.content, contentWidth);
      const lineHeight = mainFontSize * 1.4;
      return {
        kind: 'text' as const,
        textLines,
        lines: [],
        lineHeight,
        totalHeight: textLines.length * lineHeight,
        codePadding: 0,
        hasList,
      };
    } else {
      const codeContentWidth = contentWidth - 2 * codePadding;
      ctx.font = `${codeFontSize}px "Courier New", "Consolas", monospace`;
      const wrappedLines = seg.content.split('\n').flatMap(l =>
        wrapCodeLine(ctx, l, codeContentWidth),
      );
      return {
        kind: 'code' as const,
        textLines: [],
        lines: wrappedLines,
        lineHeight: codeLineHeight,
        totalHeight: wrappedLines.length * codeLineHeight + 2 * codePadding,
        codePadding,
        hasList: false,
      };
    }
  });
}

function totalLayoutHeight(blocks: BlockLayout[], segGap: number): number {
  return blocks.reduce((s, b) => s + b.totalHeight, 0) + Math.max(0, blocks.length - 1) * segGap;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function renderSlide(
  outputPath: string,
  options: SlideOptions,
): Promise<void> {
  const { text, type, cardIndex, totalCards, config } = options;
  const { width, height, fontSize, textColor } = config;

  const bgColor = type === 'question' ? config.questionColor : config.answerColor;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // ── Background ──
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  // ── Header bar ──
  const headerHeight = 80;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(0, 0, width, headerHeight);

  ctx.fillStyle = textColor;
  ctx.font = `bold 28px "Arial", "Helvetica", sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(
    `${type === 'question' ? 'QUESTION' : 'ANSWER'} ${cardIndex + 1} of ${totalCards}`,
    40,
    50,
  );

  // ── Type badge ──
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

  // ── Content area ──
  const contentMargin = 100;
  const contentWidth = width - 2 * contentMargin;
  const contentAreaTop = headerHeight;
  const contentAreaHeight = height - contentAreaTop - 20;
  const minFontSize = 16;

  const segments = parseMarkdown(text);

  // Auto-shrink font until all content fits vertically
  let currentFontSize = fontSize;
  while (currentFontSize > minFontSize) {
    const segGap = Math.round(currentFontSize * 0.6);
    const blocks = computeLayout(ctx, segments, currentFontSize, contentWidth);
    if (totalLayoutHeight(blocks, segGap) <= contentAreaHeight) break;
    currentFontSize -= 2;
  }

  const segGap = Math.round(currentFontSize * 0.6);
  const blocks = computeLayout(ctx, segments, currentFontSize, contentWidth);
  const totalH = totalLayoutHeight(blocks, segGap);
  const codeFontSize = Math.max(14, Math.round(currentFontSize * 0.78));

  // Code boxes span almost the full slide width for readability
  const codeBoxMargin = 60;
  const codeBoxWidth = width - 2 * codeBoxMargin;

  // Center the whole content block vertically in the content area
  let y = contentAreaTop + (contentAreaHeight - totalH) / 2;
  if (y < contentAreaTop + 10) y = contentAreaTop + 10;

  // ── Draw each block ──
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];

    if (block.kind === 'text') {
      ctx.fillStyle = textColor;
      ctx.font = `${currentFontSize}px "Arial", "Helvetica", sans-serif`;
      const bulletW = block.hasList ? ctx.measureText('• ').width : 0;

      let lineY = y + currentFontSize;
      for (const tl of block.textLines) {
        if (!tl.text) { lineY += block.lineHeight; continue; }
        if (tl.kind === 'prose') {
          ctx.textAlign = 'center';
          ctx.fillText(tl.text, width / 2, lineY);
        } else if (tl.kind === 'bullet') {
          ctx.textAlign = 'left';
          ctx.fillText(tl.text, contentMargin, lineY);
        } else {
          // continuation: indent to align with text after '• '
          ctx.textAlign = 'left';
          ctx.fillText(tl.text, contentMargin + bulletW, lineY);
        }
        lineY += block.lineHeight;
      }
    } else {
      const boxH = block.totalHeight;
      const cp = block.codePadding;

      // Dark background
      ctx.fillStyle = '#161b22';
      ctx.beginPath();
      ctx.roundRect(codeBoxMargin, y, codeBoxWidth, boxH, 8);
      ctx.fill();

      // Subtle border
      ctx.strokeStyle = '#30363d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(codeBoxMargin, y, codeBoxWidth, boxH, 8);
      ctx.stroke();

      // Code text — GitHub-dark green, left-aligned, monospace
      ctx.textAlign = 'left';
      ctx.fillStyle = '#7ee787';
      ctx.font = `${codeFontSize}px "Courier New", "Consolas", monospace`;

      let codeY = y + cp + codeFontSize;
      for (const line of block.lines) {
        ctx.fillText(line, codeBoxMargin + cp, codeY);
        codeY += block.lineHeight;
      }
    }

    y += block.totalHeight;
    if (bi < blocks.length - 1) y += segGap;
  }

  // ── Footer stripe ──
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.fillRect(0, height - 4, width, 4);

  const buffer = canvas.toBuffer('image/png');
  await writeFile(outputPath, buffer);
}
