import { execFileSync } from 'child_process';

function which(bin: string): string | null {
  try {
    return execFileSync('which', [bin], { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

async function resolveFfmpegPath(): Promise<string | null> {
  try {
    const mod = await import('ffmpeg-static');
    if (mod.default) return mod.default;
  } catch {}
  return process.env.FFMPEG_PATH || which('ffmpeg');
}

async function resolveFfprobePath(): Promise<string | null> {
  try {
    const mod = await import('@ffprobe-installer/ffprobe');
    if (mod.path) return mod.path;
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

  process.env.FFMPEG_PATH = _ffmpegPath;
  process.env.FFPROBE_PATH = _ffprobePath;
}

export function getFfmpegPath(): string {
  if (!_ffmpegPath) throw new Error('Call ensureDeps() first');
  return _ffmpegPath;
}

export function getFfprobePath(): string {
  if (!_ffprobePath) throw new Error('Call ensureDeps() first');
  return _ffprobePath;
}
