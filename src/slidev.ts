/**
 * Parse a Slidev .md deck into slides with presenter notes and narration segments.
 * Uses @slidev/parser for robust frontmatter/note extraction.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parse as parseSlideParsed } from '@slidev/parser';
import { slug } from './cache.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** One narration chunk aligned to a specific visual click-state frame. */
export interface ClickSegment {
  text: string;       // TTS text for this narration (trimmed)
  frameIndex: number; // 0 = initial state, 1 = after first click, …
}

/** One slide from a Slidev deck, enriched for video generation and browser use. */
export interface SlidevSlide {
  /** 0-based index among content slides (the global-FM pseudo-slide is excluded). */
  index: number;
  /**
   * Stable browser-facing name derived from the first heading when available,
   * using the pattern "slide-01-some-title", otherwise "slide-01".
   */
  name: string;
  /** First markdown heading from the slide content, or undefined. */
  title: string | undefined;
  /** Presenter notes extracted from the trailing HTML comment. Empty when absent. */
  notes: string;
  /** True when presenter notes were present (vs. falling back to visible text). */
  hasNotes: boolean;
  /**
   * Per-frame narration segments.
   * – If notes contained [click] / [click:n] markers: one entry per visual frame.
   * – Otherwise: a single entry covering the entire narration track.
   */
  narrationSegments: ClickSegment[];
  /** Plain-text rendering of visible slide content used as TTS fallback. */
  fallbackText: string;
}

export interface SlidevDeck {
  title: string;
  description: string;
  filePath: string;
  slides: SlidevSlide[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Split a notes string on [click] / [click:n] markers into per-frame segments. */
function parseClickSegments(notes: string): ClickSegment[] {
  const parts = notes.split(/\[click(?::\d+)?\]/g);
  return parts
    .map((text, i) => ({ text: text.trim(), frameIndex: i }))
    .filter(s => s.text.length > 0);
}

/** Reduce slide markdown to plain text for TTS fallback narration. */
function markdownToPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')             // fenced code blocks
    .replace(/`[^`]+`/g, '')                    // inline code
    .replace(/^#{1,6}\s+/gm, '')               // headings (#)
    .replace(/<[^>]+>/g, ' ')                   // HTML tags
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')    // [text](url) → text
    .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1') // bold / italic
    .replace(/^\s*[-*+]\s+/gm, '')             // unordered list bullets
    .replace(/^\s*\d+\.\s+/gm, '')             // ordered list markers
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build a stable browser-facing name: "slide-01-some-title" or "slide-01". */
function deriveSlideName(index: number, title: string | undefined): string {
  const pad = String(index + 1).padStart(2, '0');
  if (title) {
    const ts = slug(title).slice(0, 40).replace(/-+$/, '');
    if (ts) return `slide-${pad}-${ts}`;
  }
  return `slide-${pad}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function parseSlidevDeck(filePath: string): Promise<SlidevDeck> {
  const raw = await readFile(filePath, 'utf-8');
  const parsed = await parseSlideParsed(raw, filePath);

  // parsed.slides[0] is the global-frontmatter pseudo-slide (content is always empty).
  const globalFM = parsed.slides[0]?.frontmatter ?? {};
  const deckTitle = (globalFM.title as string | undefined) ?? basename(filePath, '.md');
  const deckDesc = (globalFM.description as string | undefined) ?? '';

  // Real slides begin at index 1.  Filter out purely-empty sections left by
  // consecutive `---` separators.
  const contentSlides = parsed.slides.slice(1).filter(s => s.content.trim() !== '');

  const slides: SlidevSlide[] = contentSlides.map((s, i) => {
    const notes = s.note?.trim() ?? '';
    const hasNotes = notes.length > 0;
    const narrationSource = hasNotes ? notes : markdownToPlainText(s.content);
    const segments = parseClickSegments(narrationSource);

    return {
      index: i,
      name: deriveSlideName(i, s.title ?? undefined),
      title: s.title ?? undefined,
      notes,
      hasNotes,
      narrationSegments:
        segments.length > 0 ? segments : [{ text: narrationSource, frameIndex: 0 }],
      fallbackText: markdownToPlainText(s.content),
    };
  });

  return { title: deckTitle, description: deckDesc, filePath, slides };
}
