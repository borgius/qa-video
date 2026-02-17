import { execFile } from 'node:child_process';
import { unlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// biome-ignore lint/suspicious/noExplicitAny: dynamically loaded kokoro-js module
let ttsInstance: any = null;

/** Maximum characters per TTS chunk — Kokoro truncates silently beyond ~250 chars. */
export const MAX_CHUNK_CHARS = 200;

/**
 * Split preprocessed TTS text into chunks that fit within Kokoro's token limit.
 * Splits at paragraph separators (`,, `), sentence endings, or word boundaries.
 */
function splitIntoChunks(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > MAX_CHUNK_CHARS) {
    const slice = remaining.slice(0, MAX_CHUNK_CHARS + 1);

    // Prefer splitting at paragraph/sentence/clause boundaries (in priority order)
    const delimiters = [',, ', '. ', '! ', '? ', '; ', ', '];
    let splitAt = -1;
    for (const delim of delimiters) {
      const idx = slice.lastIndexOf(delim);
      if (idx > 0) {
        splitAt = idx + delim.length;
        break;
      }
    }

    if (splitAt <= 0) {
      // Fallback: split at last word boundary
      const lastSpace = slice.lastIndexOf(' ');
      splitAt = lastSpace > 0 ? lastSpace + 1 : MAX_CHUNK_CHARS;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

async function concatWavFiles(inputs: string[], output: string): Promise<void> {
  // Use the env var set by ensureDeps() in the parent process; it is inherited by
  // forked TTS workers.  Fall back to bare 'ffmpeg' if running outside the pipeline.
  const ffmpegBin = process.env.FFMPEG_PATH ?? 'ffmpeg';
  const listPath = `${output}.list.txt`;
  await writeFile(listPath, inputs.map(p => `file '${p}'`).join('\n'), 'utf-8');
  try {
    await execFileAsync(ffmpegBin, [
      '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', output,
    ]);
  } finally {
    await unlink(listPath).catch(() => {});
  }
}

export async function initTTS(_voice?: string): Promise<void> {
  const { KokoroTTS } = await import('kokoro-js');
  console.log('Loading Kokoro TTS model (first run downloads ~80MB model)...');
  ttsInstance = await KokoroTTS.from_pretrained(
    'onnx-community/Kokoro-82M-v1.0-ONNX',
    { dtype: 'q8' }
  );
  console.log('TTS model loaded successfully.');
}

export async function synthesize(
  text: string,
  outputPath: string,
  voice: string,
): Promise<void> {
  if (!ttsInstance) {
    throw new Error('TTS not initialized. Call initTTS() first.');
  }

  const chunks = splitIntoChunks(text);

  if (chunks.length === 1) {
    const audio = await ttsInstance.generate(text, { voice });
    await audio.save(outputPath);
    return;
  }

  // Synthesize each chunk to a temp file, then concatenate into the final output.
  const chunkPaths = chunks.map((_, i) => `${outputPath}.chunk${i}.wav`);
  try {
    for (let i = 0; i < chunks.length; i++) {
      const audio = await ttsInstance.generate(chunks[i], { voice });
      await audio.save(chunkPaths[i]);
    }
    await concatWavFiles(chunkPaths, outputPath);
  } finally {
    await Promise.all(chunkPaths.map(p => unlink(p).catch(() => {})));
  }
}

export async function getAudioDuration(filePath: string): Promise<number> {
  const ffmpeg = await import('fluent-ffmpeg');
  const FfmpegCommand = ffmpeg.default;

  return new Promise((resolve, reject) => {
    // biome-ignore lint/suspicious/noExplicitAny: fluent-ffmpeg metadata has no exported type
    FfmpegCommand.ffprobe(filePath, (err: Error | null, metadata: any) => {
      if (err) {
        reject(new Error(`Failed to probe audio file: ${err.message}`));
        return;
      }
      const duration: unknown = metadata?.format?.duration;
      if (typeof duration !== 'number' || Number.isNaN(duration)) {
        reject(new Error(`Could not determine duration for: ${filePath}`));
        return;
      }
      resolve(duration);
    });
  });
}
