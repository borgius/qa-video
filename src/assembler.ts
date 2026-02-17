import { execFile } from 'node:child_process';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getFfmpegPath } from './ffmpeg-paths.js';
import type { Segment } from './types.js';

const execFileAsync = promisify(execFile);

async function getFfmpeg() {
  const ffmpeg = await import('fluent-ffmpeg');
  return ffmpeg.default;
}

export async function createSegmentClip(
  segment: Segment,
  outputPath: string,
): Promise<void> {
  // apad extends the audio stream with silence to exactly totalDuration seconds,
  // matching the looped video track length so the audio track is never shorter
  // than the video track — required for correct audio sync during concat.
  await execFileAsync(getFfmpegPath(), [
    '-y',
    '-loop', '1', '-i', segment.imagePath,
    '-i', segment.audioPath,
    '-filter_complex', `[1:a]apad=whole_dur=${segment.totalDuration}[a]`,
    '-map', '0:v',
    '-map', '[a]',
    '-c:v', 'libx264', '-tune', 'stillimage',
    '-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-ac', '2',
    '-pix_fmt', 'yuv420p',
    '-t', String(segment.totalDuration),
    '-r', '30',
    outputPath,
  ]);
}

export async function createSilentClip(
  imagePath: string,
  durationSec: number,
  outputPath: string
): Promise<void> {
  await execFileAsync(getFfmpegPath(), [
    '-y',
    '-loop', '1', '-i', imagePath,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-c:v', 'libx264', '-tune', 'stillimage',
    '-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-ac', '2',
    '-pix_fmt', 'yuv420p',
    '-t', String(durationSec),
    '-r', '30',
    outputPath,
  ]);
}

/**
 * Concatenate multiple WAV/audio files into one using the ffmpeg concat
 * demuxer.  A single-input shortcut avoids spawning ffmpeg unnecessarily.
 */
export async function concatenateAudioFiles(
  inputPaths: string[],
  outputPath: string,
): Promise<void> {
  if (inputPaths.length === 1) {
    await execFileAsync(getFfmpegPath(), ['-y', '-i', inputPaths[0], '-c', 'copy', outputPath]);
    return;
  }

  const listPath = `${outputPath}.parts.txt`;
  await writeFile(listPath, inputPaths.map(p => `file '${p}'`).join('\n'), 'utf-8');

  await execFileAsync(getFfmpegPath(), [
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath,
  ]);

  await unlink(listPath).catch(() => {});
}

function timemarkToSeconds(timemark: string): number {
  const parts = timemark.split(':');
  return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
}

export async function concatenateClips(
  clipPaths: string[],
  outputPath: string,
  tempDir: string,
  clipDurations?: number[],
  onProgress?: (current: number, total: number) => void,
): Promise<void> {
  const FfmpegCommand = await getFfmpeg();

  // Write concat list file
  const concatListPath = join(tempDir, 'concat_list.txt');
  const concatContent = clipPaths.map(p => `file '${p}'`).join('\n');
  await writeFile(concatListPath, concatContent, 'utf-8');

  // Build cumulative time boundaries so we can map timemark → clip index
  const cumulative: number[] = [];
  if (clipDurations) {
    let sum = 0;
    for (const d of clipDurations) {
      sum += d;
      cumulative.push(sum);
    }
  }

  return new Promise((resolve, reject) => {
    let lastClip = 0;
    FfmpegCommand()
      .input(concatListPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions([
        '-c:v', 'libx264',
        '-crf', '18',
        '-preset', 'medium',
        '-profile:v', 'high',
        '-level', '4.0',
        '-tune', 'stillimage',
        '-c:a', 'aac',
        '-b:a', '384k',
        '-ar', '48000',
        '-ac', '2',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-r', '30',
      ])
      .output(outputPath)
      .on('progress', (progress: { timemark: string }) => {
        if (cumulative.length > 0 && onProgress) {
          const sec = timemarkToSeconds(progress.timemark);
          let idx = cumulative.findIndex(c => c > sec);
          if (idx === -1) idx = cumulative.length - 1;
          if (idx !== lastClip) {
            lastClip = idx;
            onProgress(idx, clipPaths.length);
          }
        }
      })
      .on('end', () => {
        if (onProgress) onProgress(clipPaths.length, clipPaths.length);
        resolve();
      })
      .on('error', (err: Error) => reject(err))
      .run();
  });
}
