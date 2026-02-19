import { writeFile } from 'node:fs/promises';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import {
  parseMarkdown,
  parseInlineMarkdown,
  PLAIN_STYLE,
  type MdSegment,
  type InlineRun,
  type InlineStyle,
} from './markdown.js';
import type { PipelineConfig } from './types.js';

interface SlideOptions {
  text: string;
  type: 'question' | 'answer';
  cardIndex: number;
  totalCards: number;
  config: PipelineConfig;
  questionText?: string;  // shown in the answer header
}

// ── Font helpers ─────────────────────────────────────────────────────────────

/** Build a CSS font string for a given inline style. */
function fontForStyle(style: InlineStyle, fontSize: number): string {
  if (style.code) {
    const codeFontSize = Math.max(14, Math.round(fontSize * 0.88));
    return `${codeFontSize}px "Courier New", "Consolas", monospace`;
  }
  const weight = style.bold ? 'bold' : 'normal';
  const slant = style.italic ? 'italic' : 'normal';
  return `${slant} ${weight} ${fontSize}px "Arial", "Helvetica", sans-serif`;
}

// ── Inline-run measurement & wrapping ────────────────────────────────────────

/**
 * Split runs into "words" — arrays of InlineRun fragments separated by whitespace.
 * A single visual word may span multiple styled runs (e.g. "half**bold**").
 */
function splitRunsIntoWords(runs: InlineRun[]): InlineRun[][] {
  const words: InlineRun[][] = [];
  let currentWord: InlineRun[] = [];

  for (const run of runs) {
    // Split run text by whitespace, preserving groups
    const parts = run.text.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        // Whitespace = word boundary
        if (currentWord.length > 0) {
          words.push(currentWord);
          currentWord = [];
        }
      } else {
        currentWord.push({ text: part, style: run.style });
      }
    }
  }
  if (currentWord.length > 0) words.push(currentWord);
  return words;
}

/** Measure the pixel width of a word (array of styled fragments). */
function measureWord(ctx: SKRSContext2D, fragments: InlineRun[], fontSize: number): number {
  let w = 0;
  for (const frag of fragments) {
    ctx.font = fontForStyle(frag.style, fontSize);
    w += ctx.measureText(frag.text).width;
    if (frag.style.code) w += 2 * Math.round(fontSize * 0.12);
  }
  return w;
}

/** Measure total pixel width of a line of runs. */
function measureLineWidth(ctx: SKRSContext2D, runs: InlineRun[], fontSize: number): number {
  let w = 0;
  for (const run of runs) {
    ctx.font = fontForStyle(run.style, fontSize);
    w += ctx.measureText(run.text).width;
    if (run.style.code) w += 2 * Math.round(fontSize * 0.12);
  }
  return w;
}

/**
 * Word-wrap inline runs into display lines.
 * Each returned line is an InlineRun[] that fits within maxWidth.
 */
function wrapRuns(
  ctx: SKRSContext2D,
  runs: InlineRun[],
  maxWidth: number,
  fontSize: number,
): InlineRun[][] {
  const words = splitRunsIntoWords(runs);
  if (words.length === 0) return [];

  ctx.font = fontForStyle(PLAIN_STYLE, fontSize);
  const spaceW = ctx.measureText(' ').width;

  const lines: InlineRun[][] = [];
  let curLine: InlineRun[] = [];
  let curWidth = 0;

  for (const wordFrags of words) {
    const wordW = measureWord(ctx, wordFrags, fontSize);
    const needed = curLine.length > 0 ? spaceW + wordW : wordW;

    if (curWidth + needed > maxWidth && curLine.length > 0) {
      lines.push(curLine);
      curLine = [...wordFrags];
      curWidth = wordW;
    } else {
      if (curLine.length > 0) {
        // Append space to last run if same style, otherwise add a plain space run
        const last = curLine[curLine.length - 1];
        if (last.style.bold === PLAIN_STYLE.bold
          && last.style.italic === PLAIN_STYLE.italic
          && last.style.code === PLAIN_STYLE.code) {
          last.text += ' ';
        } else {
          curLine.push({ text: ' ', style: { ...PLAIN_STYLE } });
        }
        curWidth += spaceW;
      }
      curLine.push(...wordFrags);
      curWidth += wordW;
    }
  }
  if (curLine.length > 0) lines.push(curLine);
  return lines;
}

// ── Drawing runs ─────────────────────────────────────────────────────────────

/**
 * Draw a sequence of styled runs at (startX, y).
 * Inline code gets a subtle background pill.
 */
function drawRuns(
  ctx: SKRSContext2D,
  runs: InlineRun[],
  startX: number,
  y: number,
  fontSize: number,
  textColor: string,
): void {
  let x = startX;
  ctx.textAlign = 'left';

  for (const run of runs) {
    if (!run.text) continue;

    ctx.font = fontForStyle(run.style, fontSize);
    const w = ctx.measureText(run.text).width;

    if (run.style.code) {
      const padH = Math.round(fontSize * 0.12);
      const padV = Math.round(fontSize * 0.06);
      const bgW = w + 2 * padH;
      const bgH = fontSize + 2 * padV;
      const bgY = y - fontSize * 0.82;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      ctx.roundRect(x, bgY, bgW, bgH, 4);
      ctx.fill();

      ctx.fillStyle = '#e8e8e8';
      ctx.fillText(run.text, x + padH, y);
      x += bgW;
    } else {
      ctx.fillStyle = textColor;
      ctx.fillText(run.text, x, y);
      x += w;
    }
  }
}

// ── Code line wrapping ───────────────────────────────────────────────────────

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

/** A single line in a text block, with rendering metadata. */
type TextLine =
  | { kind: 'prose'; runs: InlineRun[] }
  | { kind: 'bullet'; runs: InlineRun[] }
  | { kind: 'numbered'; runs: InlineRun[] }
  | { kind: 'continuation'; runs: InlineRun[] };

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
 * Parses inline markdown and returns run-based TextLines.
 */
function buildTextLines(
  ctx: SKRSContext2D,
  text: string,
  maxWidth: number,
  fontSize: number,
): { lines: TextLine[]; hasList: boolean } {
  const result: TextLine[] = [];
  let hasList = false;
  const BULLET = '• ';

  for (const paragraph of text.split('\n')) {
    const trimmed = paragraph.trim();
    if (!trimmed) { result.push({ kind: 'prose', runs: [] }); continue; }

    const listMatch = trimmed.match(/^[-*•]\s+(.*)/s);
    // Detect numbered lists: "1. text", "**1. text**", "1) text", etc.
    // Strip leading bold/italic markers for matching, but keep full text for rendering.
    const stripped = trimmed.replace(/^(\*{1,3}|_{1,3})/, '');
    const numberedMatch = !listMatch && stripped.match(/^(\d+)[.)]\s+/);
    if (listMatch) {
      hasList = true;
      ctx.font = fontForStyle(PLAIN_STYLE, fontSize);
      const bulletW = ctx.measureText(BULLET).width;
      const contentW = maxWidth - bulletW;

      const inlineRuns = parseInlineMarkdown(listMatch[1].trim());
      const wrappedLines = wrapRuns(ctx, inlineRuns, contentW, fontSize);

      if (wrappedLines.length === 0) {
        result.push({ kind: 'bullet', runs: [{ text: BULLET, style: { ...PLAIN_STYLE } }] });
      } else {
        wrappedLines.forEach((lineRuns, idx) => {
          if (idx === 0) {
            result.push({
              kind: 'bullet',
              runs: [{ text: BULLET, style: { ...PLAIN_STYLE } }, ...lineRuns],
            });
          } else {
            result.push({ kind: 'continuation', runs: lineRuns });
          }
        });
      }
    } else if (numberedMatch) {
      hasList = true;
      const inlineRuns = parseInlineMarkdown(trimmed);
      const wrappedLines = wrapRuns(ctx, inlineRuns, maxWidth, fontSize);
      for (const lineRuns of wrappedLines) {
        result.push({ kind: 'numbered', runs: lineRuns });
      }
    } else {
      const inlineRuns = parseInlineMarkdown(trimmed);
      const wrappedLines = wrapRuns(ctx, inlineRuns, maxWidth, fontSize);
      for (const lineRuns of wrappedLines) {
        result.push({ kind: 'prose', runs: lineRuns });
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
      const { lines: textLines, hasList } = buildTextLines(ctx, seg.content, contentWidth, mainFontSize);
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
  const { text, type, cardIndex, totalCards, config, questionText } = options;
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

  const headerLabel = `${type === 'question' ? 'QUESTION' : 'ANSWER'} ${cardIndex + 1} of ${totalCards}`;
  const headerText = type === 'answer' && questionText
    ? `${headerLabel}: ${questionText}`
    : headerLabel;

  ctx.fillStyle = textColor;
  ctx.font = `bold 28px "Arial", "Helvetica", sans-serif`;
  ctx.textAlign = 'left';

  // Truncate header if it exceeds available width (leave room for badge)
  const maxHeaderWidth = width - 160;
  let displayHeader = headerText;
  if (ctx.measureText(displayHeader).width > maxHeaderWidth) {
    while (displayHeader.length > 0 && ctx.measureText(displayHeader + '…').width > maxHeaderWidth) {
      displayHeader = displayHeader.slice(0, -1);
    }
    displayHeader += '…';
  }

  ctx.fillText(displayHeader, 40, 50);

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
      ctx.font = fontForStyle(PLAIN_STYLE, currentFontSize);
      const bulletW = block.hasList ? ctx.measureText('• ').width : 0;

      let lineY = y + currentFontSize;
      for (const tl of block.textLines) {
        const isEmpty = tl.runs.length === 0
          || (tl.runs.length === 1 && !tl.runs[0].text);
        if (isEmpty) { lineY += block.lineHeight; continue; }

        if (tl.kind === 'prose') {
          if (block.hasList) {
            // Left-align prose within list blocks so descriptions stay aligned
            drawRuns(ctx, tl.runs, contentMargin, lineY, currentFontSize, textColor);
          } else {
            const lineW = measureLineWidth(ctx, tl.runs, currentFontSize);
            const startX = (width - lineW) / 2;
            drawRuns(ctx, tl.runs, startX, lineY, currentFontSize, textColor);
          }
        } else if (tl.kind === 'numbered') {
          drawRuns(ctx, tl.runs, contentMargin, lineY, currentFontSize, textColor);
        } else if (tl.kind === 'bullet') {
          drawRuns(ctx, tl.runs, contentMargin, lineY, currentFontSize, textColor);
        } else {
          // continuation: indent to align with text after '• '
          drawRuns(ctx, tl.runs, contentMargin + bulletW, lineY, currentFontSize, textColor);
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
