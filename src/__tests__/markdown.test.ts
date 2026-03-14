import { describe, it, expect } from 'vitest';
import {
  parseMarkdown,
  hasCodeBlocks,
  codeToTTS,
  parseInlineMarkdown,
  stripInlineMarkdown,
  PLAIN_STYLE,
} from '../markdown.js';

describe('parseMarkdown', () => {
  it('returns single text segment for plain text', () => {
    const result = parseMarkdown('Hello world');
    expect(result).toEqual([{ kind: 'text', content: 'Hello world' }]);
  });

  it('returns text as-is for empty string', () => {
    const result = parseMarkdown('');
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('text');
  });

  it('parses a single fenced code block', () => {
    const text = 'Before\n```js\nconsole.log("hi");\n```\nAfter';
    const result = parseMarkdown(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ kind: 'text', content: 'Before' });
    expect(result[1]).toEqual({ kind: 'code', lang: 'js', content: 'console.log("hi");' });
    expect(result[2]).toEqual({ kind: 'text', content: 'After' });
  });

  it('parses code block with no language tag', () => {
    const text = '```\nsome code\n```';
    const result = parseMarkdown(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: 'code', lang: '', content: 'some code' });
  });

  it('treats unclosed fence as plain text', () => {
    const text = 'Text\n```js\ncode without closing';
    const result = parseMarkdown(text);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('text');
    expect(result[0].content).toContain('```js');
    expect(result[0].content).toContain('code without closing');
  });

  it('parses multiple code blocks interspersed with text', () => {
    const text = 'Intro\n```\ncode1\n```\nMiddle\n```\ncode2\n```\nEnd';
    const result = parseMarkdown(text);
    expect(result).toHaveLength(5);
    expect(result.filter(s => s.kind === 'code')).toHaveLength(2);
    expect(result.filter(s => s.kind === 'text')).toHaveLength(3);
  });

  it('skips empty text segments between consecutive code blocks', () => {
    const text = '```\nfirst\n```\n```\nsecond\n```';
    const result = parseMarkdown(text);
    // Only code segments, no empty text segments
    expect(result.filter(s => s.kind === 'code')).toHaveLength(2);
    expect(result.filter(s => s.kind === 'text')).toHaveLength(0);
  });

  it('preserves multiline code content', () => {
    const text = '```python\nline1\nline2\nline3\n```';
    const result = parseMarkdown(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: 'code', lang: 'python', content: 'line1\nline2\nline3' });
  });
});

describe('hasCodeBlocks', () => {
  it('returns true when text has a fenced code block', () => {
    expect(hasCodeBlocks('hello\n```js\ncode\n```')).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(hasCodeBlocks('just plain text')).toBe(false);
  });

  it('returns true even if fence is unclosed', () => {
    expect(hasCodeBlocks('text\n```js\nno closing')).toBe(true);
  });
});

describe('codeToTTS', () => {
  it('prefixes code content with "Code:"', () => {
    const seg = { kind: 'code' as const, lang: 'js', content: 'console.log("hi")' };
    expect(codeToTTS(seg)).toBe('Code: console.log("hi")');
  });

  it('works with empty code content', () => {
    const seg = { kind: 'code' as const, lang: '', content: '' };
    expect(codeToTTS(seg)).toBe('Code: ');
  });
});

describe('parseInlineMarkdown', () => {
  it('returns plain text as-is', () => {
    const result = parseInlineMarkdown('hello world');
    expect(result).toEqual([{ text: 'hello world', style: PLAIN_STYLE }]);
  });

  it('parses bold text', () => {
    const result = parseInlineMarkdown('**bold**');
    expect(result).toEqual([{ text: 'bold', style: { bold: true, italic: false, code: false } }]);
  });

  it('parses italic text with asterisks', () => {
    const result = parseInlineMarkdown('*italic*');
    expect(result).toEqual([{ text: 'italic', style: { bold: false, italic: true, code: false } }]);
  });

  it('parses italic text with underscores', () => {
    const result = parseInlineMarkdown('_italic_');
    expect(result).toEqual([{ text: 'italic', style: { bold: false, italic: true, code: false } }]);
  });

  it('parses bold-italic text', () => {
    const result = parseInlineMarkdown('***bold italic***');
    expect(result).toEqual([{ text: 'bold italic', style: { bold: true, italic: true, code: false } }]);
  });

  it('parses inline code', () => {
    const result = parseInlineMarkdown('`code`');
    expect(result).toEqual([{ text: 'code', style: { bold: false, italic: false, code: true } }]);
  });

  it('parses mixed inline styles', () => {
    const result = parseInlineMarkdown('plain **bold** plain');
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ text: 'plain ', style: PLAIN_STYLE });
    expect(result[1]).toEqual({ text: 'bold', style: { bold: true, italic: false, code: false } });
    expect(result[2]).toEqual({ text: ' plain', style: PLAIN_STYLE });
  });

  it('parses inline code mixed with text', () => {
    const result = parseInlineMarkdown('Run `kubectl apply` to deploy');
    const codeRun = result.find(r => r.style.code);
    expect(codeRun?.text).toBe('kubectl apply');
  });

  it('collapses adjacent runs with identical styles', () => {
    // Double-toggling bold should collapse back to plain
    const result = parseInlineMarkdown('**a****b**');
    // both 'a' and 'b' have bold style — they should collapse into one run
    const boldRuns = result.filter(r => r.style.bold);
    expect(boldRuns).toHaveLength(1);
    expect(boldRuns[0].text).toBe('ab');
  });

  it('returns the original text as plain run when input has no markers', () => {
    const result = parseInlineMarkdown('no markers here');
    expect(result).toEqual([{ text: 'no markers here', style: PLAIN_STYLE }]);
  });

  it('handles empty string', () => {
    const result = parseInlineMarkdown('');
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('');
  });
});

describe('stripInlineMarkdown', () => {
  it('strips bold markers', () => {
    expect(stripInlineMarkdown('**bold**')).toBe('bold');
  });

  it('strips italic asterisk markers', () => {
    expect(stripInlineMarkdown('*italic*')).toBe('italic');
  });

  it('strips bold-italic markers', () => {
    expect(stripInlineMarkdown('***bold italic***')).toBe('bold italic');
  });

  it('strips underscore italic markers', () => {
    expect(stripInlineMarkdown('_italic_')).toBe('italic');
  });

  it('strips inline code backticks but keeps content', () => {
    expect(stripInlineMarkdown('`code`')).toBe('code');
  });

  it('strips multiple markers in one string', () => {
    const result = stripInlineMarkdown('**bold** and `code` and *italic*');
    expect(result).toBe('bold and code and italic');
  });

  it('leaves plain text unchanged', () => {
    expect(stripInlineMarkdown('plain text')).toBe('plain text');
  });
});
