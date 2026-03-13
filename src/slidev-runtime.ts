/**
 * Capture PNG frames from a Slidev deck by running `slidev export --with-clicks`.
 *
 * Exported filenames follow the pattern "NNN-CC.png":
 *   NNN = Slidev slide number (1-based, includes the global-FM pseudo-slide)
 *   CC  = click-state index (01 = initial, 02 = after click 1, …)
 *
 * Slidev slide number 1 = global-FM pseudo-slide (exported but visually empty).
 * Content slide [i] (0-based) = Slidev slide number i+2.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────────────────

/** Captured frames for one content slide (0-based index). */
export interface SlideFrames {
  /** 0-based content-slide index. */
  slideIndex: number;
  /**
   * Absolute paths to frame PNGs in click order.
   * frames[0] = initial state, frames[1] = after click 1, …
   */
  frames: string[];
}

interface FramesManifest {
  deckHash: string;
  slides: SlideFrames[];
}

// ── Dependency check ──────────────────────────────────────────────────────────

let _slidevChecked = false;

function ensureSlidev(): void {
  if (_slidevChecked) return;
  // `slidev` is expected in PATH (e.g. installed via `npm i -g @slidev/cli`).
  // We don't throw here — the actual execFileAsync call will fail with a clear
  // "command not found" message if slidev is missing.
  _slidevChecked = true;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Export a Slidev deck to PNG frames (one per slide per click state) and return
 * a per-slide frame manifest.
 *
 * @param deckPath         Path to the .md Slidev file.
 * @param contentSlideCount Number of real content slides (excludes global-FM).
 * @param deckHash         SHA of the deck file content, used as cache key.
 * @param tempDir          Working directory for cached frames and manifest.
 * @param force            When true, ignore existing cache and re-export.
 */
export async function captureSlidevFrames(
  deckPath: string,
  contentSlideCount: number,
  deckHash: string,
  tempDir: string,
  force: boolean,
): Promise<SlideFrames[]> {
  ensureSlidev();

  const framesDir = join(tempDir, 'frames');
  const manifestPath = join(tempDir, 'frames-manifest.json');

  // ── Cache hit ──
  if (!force && existsSync(manifestPath)) {
    try {
      const m = JSON.parse(await readFile(manifestPath, 'utf-8')) as FramesManifest;
      if (
        m.deckHash === deckHash &&
        m.slides.length === contentSlideCount &&
        m.slides.every(s => s.frames.length > 0 && s.frames.every(f => existsSync(f)))
      ) {
        return m.slides;
      }
    } catch {
      // Corrupt / outdated manifest — fall through to re-export.
    }
  }

  await mkdir(framesDir, { recursive: true });

  // ── Run slidev export ──
  console.log(`  Exporting Slidev frames…`);
  const exportStart = Date.now();
  try {
    await execFileAsync(
      'slidev',
      ['export', deckPath, '--format', 'png', '--with-clicks', '--output', framesDir],
      { cwd: dirname(deckPath) },
    );
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(
        'slidev not found in PATH.\n' +
        '  Install with: npm i -g @slidev/cli',
      );
    }
    throw err;
  }
  console.log(`  Export done (${((Date.now() - exportStart) / 1000).toFixed(1)}s)`);

  // ── Parse exported filenames ──
  // Pattern: "NNN-CC.png" — NNN = Slidev slide num (1-based), CC = click state (01 = initial).
  const files = (await readdir(framesDir))
    .filter(f => /^\d+-\d+\.png$/.test(f))
    .sort();

  const bySlide = new Map<number, string[]>();
  for (const file of files) {
    const m = file.match(/^(\d+)-(\d+)\.png$/);
    if (!m) continue;
    const num = parseInt(m[1], 10);
    const arr = bySlide.get(num) ?? [];
    arr.push(join(framesDir, file));
    bySlide.set(num, arr);
  }

  const sortedNums = [...bySlide.keys()].sort((a, b) => a - b);

  // Determine whether the global-FM pseudo-slide was exported as slide 1.
  // If total export count > content slides, global FM was exported → offset = 1.
  const hasGlobalFMExported = sortedNums.length > contentSlideCount;
  const offset = hasGlobalFMExported ? 1 : 0;

  // ── Build per-content-slide frame list ──
  const result: SlideFrames[] = [];
  for (let i = 0; i < contentSlideCount; i++) {
    const slidevNum = sortedNums[i + offset];
    const frames = slidevNum !== undefined ? (bySlide.get(slidevNum) ?? []) : [];
    result.push({ slideIndex: i, frames });
  }

  // ── Persist manifest ──
  const manifest: FramesManifest = { deckHash, slides: result };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return result;
}
