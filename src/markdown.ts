/**
 * Markdown parser for Q&A answers.
 * Handles fenced code blocks (block-level) and inline formatting
 * (**bold**, *italic*, ***bold italic***, `inline code`).
 */

export interface TextSegment { kind: 'text'; content: string; }
export interface CodeSegment { kind: 'code'; lang: string; content: string; }
export type MdSegment = TextSegment | CodeSegment;

// ── Inline markdown types ────────────────────────────────────────────────────

export interface InlineStyle {
  bold: boolean;
  italic: boolean;
  code: boolean;
}

export interface InlineRun {
  text: string;
  style: InlineStyle;
}

export const PLAIN_STYLE: InlineStyle = { bold: false, italic: false, code: false };

/**
 * Split `text` into alternating text and code-block segments using a
 * line-by-line state machine.  Unclosed fences are treated as plain text.
 */
export function parseMarkdown(text: string): MdSegment[] {
  const segments: MdSegment[] = [];
  const lines = text.split('\n');

  let inCode = false;
  let lang = '';
  let codeLines: string[] = [];
  let textLines: string[] = [];

  for (const line of lines) {
    if (!inCode) {
      const fenceMatch = line.match(/^```(\w*)$/);
      if (fenceMatch) {
        const prose = textLines.join('\n').trim();
        if (prose) segments.push({ kind: 'text', content: prose });
        textLines = [];
        inCode = true;
        lang = fenceMatch[1] ?? '';
        codeLines = [];
      } else {
        textLines.push(line);
      }
    } else {
      if (line === '```') {
        segments.push({ kind: 'code', lang, content: codeLines.join('\n') });
        inCode = false;
        lang = '';
        codeLines = [];
      } else {
        codeLines.push(line);
      }
    }
  }

  // Flush remaining text.  If we were in an unclosed fence, fold it back in.
  if (inCode) textLines.push('```' + lang, ...codeLines);
  const remaining = textLines.join('\n').trim();
  if (remaining) segments.push({ kind: 'text', content: remaining });

  // Guarantee at least one segment
  if (segments.length === 0) segments.push({ kind: 'text', content: text });

  return segments;
}

/** True if `text` contains at least one fenced code block. */
export function hasCodeBlocks(text: string): boolean {
  return /^```/m.test(text);
}

/**
 * Build a TTS-friendly spoken representation of a code segment.
 * Prefixes with "Code:" so the listener knows a code example is starting.
 */
export function codeToTTS(seg: CodeSegment): string {
  return `Code: ${seg.content}`;
}

// ── Inline markdown parsing ──────────────────────────────────────────────────

/**
 * Parse inline markdown into styled text runs.
 * Handles `code`, ***bold italic***, **bold**, *italic* (and _ variants).
 * Backticks have highest priority and disable other parsing inside them.
 */
export function parseInlineMarkdown(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let i = 0;
  let buf = '';
  let bold = false;
  let italic = false;

  function flush(): void {
    if (buf) {
      runs.push({ text: buf, style: { bold, italic, code: false } });
      buf = '';
    }
  }

  while (i < text.length) {
    const ch = text[i];

    // Backtick: inline code (highest priority, no nesting)
    if (ch === '`') {
      flush();
      i++;
      const start = i;
      while (i < text.length && text[i] !== '`') i++;
      const code = text.slice(start, i);
      if (code) runs.push({ text: code, style: { bold: false, italic: false, code: true } });
      if (i < text.length) i++; // skip closing backtick
      continue;
    }

    // Asterisks or underscores: bold/italic toggles
    if (ch === '*' || ch === '_') {
      let count = 0;
      let j = i;
      while (j < text.length && text[j] === ch) { count++; j++; }

      if (count >= 3) {
        flush();
        bold = !bold;
        italic = !italic;
        i += 3;
      } else if (count >= 2) {
        flush();
        bold = !bold;
        i += 2;
      } else {
        flush();
        italic = !italic;
        i += 1;
      }
      continue;
    }

    buf += ch;
    i++;
  }

  flush();

  // Collapse adjacent runs with identical styles
  const collapsed: InlineRun[] = [];
  for (const run of runs) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && prev.style.bold === run.style.bold
      && prev.style.italic === run.style.italic
      && prev.style.code === run.style.code) {
      prev.text += run.text;
    } else {
      collapsed.push({ text: run.text, style: { ...run.style } });
    }
  }

  return collapsed.length > 0
    ? collapsed
    : [{ text, style: { ...PLAIN_STYLE } }];
}

/**
 * Strip inline markdown markers, keeping only the text content.
 * Used for TTS preprocessing.
 */
export function stripInlineMarkdown(text: string): string {
  let result = text;
  // Strip backtick-wrapped code (keep content)
  result = result.replace(/`([^`]*)`/g, '$1');
  // Strip ***, **, * and ___, __, _ wrappers (keep content)
  result = result.replace(/\*{1,3}(.*?)\*{1,3}/g, '$1');
  result = result.replace(/_{1,3}(.*?)_{1,3}/g, '$1');
  return result;
}
