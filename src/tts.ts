let ttsInstance: any = null;

export async function initTTS(voice?: string): Promise<void> {
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
  voice: string
): Promise<void> {
  if (!ttsInstance) {
    throw new Error('TTS not initialized. Call initTTS() first.');
  }

  const audio = await ttsInstance.generate(text, { voice });
  audio.save(outputPath);
}

export async function getAudioDuration(filePath: string): Promise<number> {
  const ffmpeg = await import('fluent-ffmpeg');
  const FfmpegCommand = ffmpeg.default;

  return new Promise((resolve, reject) => {
    FfmpegCommand.ffprobe(filePath, (err: Error | null, metadata: any) => {
      if (err) {
        reject(new Error(`Failed to probe audio file: ${err.message}`));
        return;
      }
      const duration = metadata?.format?.duration;
      if (typeof duration !== 'number' || isNaN(duration)) {
        reject(new Error(`Could not determine duration for: ${filePath}`));
        return;
      }
      resolve(duration);
    });
  });
}
