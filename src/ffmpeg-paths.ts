import { execFileSync, execSync } from 'child_process';
import { accessSync, chmodSync, constants, existsSync } from 'fs';

function which(bin: string): string | null {
  try {
    return execFileSync('which', [bin], { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

async function resolveFfmpegPath(): Promise<string | null> {
  try {
    const p: string | null = (await import('ffmpeg-static')).default;
    if (p && existsSync(p)) return p;
  } catch {}
  return process.env.FFMPEG_PATH || which('ffmpeg');
}

async function resolveFfprobePath(): Promise<string | null> {
  try {
    const p: string | undefined = (await import('@ffprobe-installer/ffprobe')).path;
    if (p && existsSync(p)) return p;
  } catch {}
  return process.env.FFPROBE_PATH || which('ffprobe');
}

let _ffmpegPath: string | null = null;
let _ffprobePath: string | null = null;

export async function ensureDeps(): Promise<void> {
  _ffmpegPath = await resolveFfmpegPath();
  _ffprobePath = await resolveFfprobePath();

  if (!_ffmpegPath) {
    console.error(
      'Error: ffmpeg not found.\n' +
      '  Install: brew install ffmpeg (macOS) / sudo apt install ffmpeg (Linux)\n' +
      '  Or set FFMPEG_PATH environment variable.'
    );
    process.exit(1);
  }

  if (!_ffprobePath) {
    console.error(
      'Error: ffprobe not found.\n' +
      '  Install ffmpeg (includes ffprobe):\n' +
      '    brew install ffmpeg (macOS) / sudo apt install ffmpeg (Linux)\n' +
      '  Or set FFPROBE_PATH environment variable.'
    );
    process.exit(1);
  }

  ensureExecutable(_ffmpegPath);
  ensureExecutable(_ffprobePath);

  process.env.FFMPEG_PATH = _ffmpegPath;
  process.env.FFPROBE_PATH = _ffprobePath;
}

function ensureExecutable(filePath: string): void {
  try {
    accessSync(filePath, constants.X_OK);
  } catch {
    chmodSync(filePath, 0o755);
  }
}

export function getFfmpegPath(): string {
  if (!_ffmpegPath) throw new Error('Call ensureDeps() first');
  return _ffmpegPath;
}

export function getFfprobePath(): string {
  if (!_ffprobePath) throw new Error('Call ensureDeps() first');
  return _ffprobePath;
}
