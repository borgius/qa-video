import { join } from 'path';
import { writeFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Segment } from './types.js';
import { getFfmpegPath } from './ffmpeg-paths.js';

const execFileAsync = promisify(execFile);

async function getFfmpeg() {
  const ffmpeg = await import('fluent-ffmpeg');
  return ffmpeg.default;
}

export async function createSegmentClip(
  segment: Segment,
  outputPath: string
): Promise<void> {
  const FfmpegCommand = await getFfmpeg();

  return new Promise((resolve, reject) => {
    FfmpegCommand()
      .input(segment.imagePath)
      .inputOptions(['-loop', '1'])
      .input(segment.audioPath)
      .outputOptions([
        '-c:v', 'libx264',
        '-tune', 'stillimage',
        '-c:a', 'aac',
        '-b:a', '384k',
        '-ar', '48000',
        '-ac', '2',
        '-pix_fmt', 'yuv420p',
        '-shortest',
        '-t', String(segment.totalDuration),
        '-r', '30',
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
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

export async function concatenateClips(
  clipPaths: string[],
  outputPath: string,
  tempDir: string
): Promise<void> {
  const FfmpegCommand = await getFfmpeg();

  // Write concat list file
  const concatListPath = join(tempDir, 'concat_list.txt');
  const concatContent = clipPaths.map(p => `file '${p}'`).join('\n');
  await writeFile(concatListPath, concatContent, 'utf-8');

  return new Promise((resolve, reject) => {
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
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
}
