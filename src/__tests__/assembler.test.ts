import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Mock node:child_process so no real FFmpeg is invoked ─────────────────────
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

// ── Mock ffmpeg-paths so getFfmpegPath() returns a dummy string ───────────────
vi.mock('../ffmpeg-paths.js', () => ({ getFfmpegPath: () => '/mock/ffmpeg' }));

import { execFile } from 'node:child_process';
import {
  createSegmentClip,
  createSilentClip,
  createMultiFrameClip,
  concatenateAudioFiles,
} from '../assembler.js';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

// ── Capture all FFmpeg argument lists via mock ───────────────────────────────
let capturedArgs: string[][] = [];

beforeEach(() => {
  capturedArgs = [];
  mockExecFile.mockImplementation((_cmd: string, args: string[], cb: Function) => {
    capturedArgs.push(args);
    cb(null, '', '');
  });
});

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'qa-assembler-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── createSegmentClip ────────────────────────────────────────────────────────
describe('createSegmentClip', () => {
  it('calls FFmpeg with expected codec and format flags', async () => {
    const segment = {
      type: 'question' as const,
      text: 'Q?',
      cardIndex: 0,
      totalCards: 1,
      questionSlug: 'q',
      audioPath: '/tmp/audio.wav',
      imagePath: '/tmp/slide.png',
      audioDuration: 3,
      totalDuration: 4,
    };
    await createSegmentClip(segment, '/tmp/out.mp4');

    expect(capturedArgs).toHaveLength(1);
    const args = capturedArgs[0];
    expect(args).toContain('-loop');
    expect(args).toContain('1');
    expect(args).toContain('/tmp/slide.png');
    expect(args).toContain('/tmp/audio.wav');
    expect(args).toContain('libx264');
    expect(args).toContain('aac');
    expect(args).toContain('yuv420p');
    expect(args).toContain('30');
    expect(args).toContain('/tmp/out.mp4');
  });

  it('encodes totalDuration into the FFmpeg -t argument', async () => {
    const segment = {
      type: 'answer' as const,
      text: 'A.',
      cardIndex: 0,
      totalCards: 1,
      questionSlug: 'q',
      audioPath: '/tmp/audio.wav',
      imagePath: '/tmp/slide.png',
      audioDuration: 5,
      totalDuration: 7,
    };
    await createSegmentClip(segment, '/tmp/out.mp4');

    const args = capturedArgs[0];
    const tIdx = args.indexOf('-t');
    expect(tIdx).toBeGreaterThan(-1);
    expect(args[tIdx + 1]).toBe('7');
  });

  it('uses apad filter with the correct whole_dur', async () => {
    const segment = {
      type: 'question' as const,
      text: 'Q?',
      cardIndex: 0,
      totalCards: 1,
      questionSlug: 'q',
      audioPath: '/tmp/audio.wav',
      imagePath: '/tmp/slide.png',
      audioDuration: 2,
      totalDuration: 3.5,
    };
    await createSegmentClip(segment, '/tmp/out.mp4');

    const args = capturedArgs[0];
    const filterArg = args[args.indexOf('-filter_complex') + 1];
    expect(filterArg).toContain('apad=whole_dur=3.5');
  });
});

// ── createSilentClip ─────────────────────────────────────────────────────────
describe('createSilentClip', () => {
  it('calls FFmpeg with anullsrc for silent audio', async () => {
    await createSilentClip('/tmp/slide.png', 2, '/tmp/silent.mp4');

    expect(capturedArgs).toHaveLength(1);
    const args = capturedArgs[0];
    expect(args).toContain('anullsrc=r=48000:cl=stereo');
    expect(args).toContain('/tmp/slide.png');
    expect(args).toContain('/tmp/silent.mp4');
  });

  it('sets -t to the given duration', async () => {
    await createSilentClip('/tmp/slide.png', 5, '/tmp/out.mp4');

    const args = capturedArgs[0];
    const tIdx = args.indexOf('-t');
    expect(args[tIdx + 1]).toBe('5');
  });
});

// ── createMultiFrameClip ────────────────────────────────────────────────────
describe('createMultiFrameClip', () => {
  it('throws when frames array is empty', async () => {
    await expect(
      createMultiFrameClip([], '/tmp/audio.wav', 5, '/tmp/out.mp4'),
    ).rejects.toThrow('no frames');
  });

  it('uses the single-frame fast path for one frame', async () => {
    const frames = [{ imagePath: '/tmp/img.png', durationSec: 4 }];
    await createMultiFrameClip(frames, '/tmp/audio.wav', 4, '/tmp/out.mp4');

    expect(capturedArgs).toHaveLength(1);
    const args = capturedArgs[0];
    // Single-frame path still uses apad
    const filterArg = args[args.indexOf('-filter_complex') + 1];
    expect(filterArg).toContain('apad=whole_dur=4');
    expect(args).toContain('/tmp/img.png');
  });

  it('builds concat filter for multiple frames', async () => {
    const frames = [
      { imagePath: '/tmp/img1.png', durationSec: 2 },
      { imagePath: '/tmp/img2.png', durationSec: 3 },
    ];
    await createMultiFrameClip(frames, '/tmp/audio.wav', 5, '/tmp/out.mp4');

    expect(capturedArgs).toHaveLength(1);
    const args = capturedArgs[0];
    const filterArg = args[args.indexOf('-filter_complex') + 1];
    expect(filterArg).toContain('concat=n=2');
    expect(filterArg).toContain('trim=duration=2');
    expect(filterArg).toContain('trim=duration=3');
    expect(filterArg).toContain('apad=whole_dur=5');
  });

  it('includes all image paths as inputs for multi-frame', async () => {
    const frames = [
      { imagePath: '/tmp/img1.png', durationSec: 1 },
      { imagePath: '/tmp/img2.png', durationSec: 2 },
      { imagePath: '/tmp/img3.png', durationSec: 3 },
    ];
    await createMultiFrameClip(frames, '/tmp/audio.wav', 6, '/tmp/out.mp4');

    const args = capturedArgs[0];
    expect(args).toContain('/tmp/img1.png');
    expect(args).toContain('/tmp/img2.png');
    expect(args).toContain('/tmp/img3.png');
  });
});

// ── concatenateAudioFiles ────────────────────────────────────────────────────
describe('concatenateAudioFiles', () => {
  it('uses direct copy for a single input', async () => {
    await concatenateAudioFiles(['/tmp/a.wav'], '/tmp/out.wav');

    expect(capturedArgs).toHaveLength(1);
    const args = capturedArgs[0];
    expect(args).toContain('/tmp/a.wav');
    expect(args).toContain('-c');
    expect(args).toContain('copy');
    expect(args).toContain('/tmp/out.wav');
    // Should NOT use concat demuxer for single file
    expect(args).not.toContain('concat');
  });

  it('writes a concat list file and passes it to FFmpeg for multiple inputs', async () => {
    const outPath = join(tmpDir, 'out.wav');
    const inputs = ['/tmp/a.wav', '/tmp/b.wav', '/tmp/c.wav'];
    await concatenateAudioFiles(inputs, outPath);

    expect(capturedArgs).toHaveLength(1);
    const args = capturedArgs[0];
    // Should use concat demuxer
    expect(args).toContain('concat');
    expect(args).toContain(outPath);
  });

  it('cleans up the concat list file after completion', async () => {
    const outPath = join(tmpDir, 'out.wav');
    const listPath = `${outPath}.parts.txt`;
    await concatenateAudioFiles(['/tmp/a.wav', '/tmp/b.wav'], outPath);

    // The list file should be deleted
    const { existsSync } = await import('node:fs');
    expect(existsSync(listPath)).toBe(false);
  });
});
