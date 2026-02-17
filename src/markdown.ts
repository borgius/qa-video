/**
 * Minimal Markdown parser for fenced code blocks in Q&A answers.
 * Only triple-backtick fenced code blocks are handled; all other text is
 * treated as plain prose.
 */

export interface TextSegment { kind: 'text'; content: string; }
export interface CodeSegment { kind: 'code'; lang: string; content: string; }
export type MdSegment = TextSegment | CodeSegment;

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
