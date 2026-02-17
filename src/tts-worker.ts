// Runs as a child process (via fork). Communicates via process IPC.
import { getAudioDuration, initTTS, synthesize } from './tts.js';

type Task = { id: number; text: string; outputPath: string };
type Reply =
  | { type: 'ready' }
  | { type: 'done'; id: number; duration: number }
  | { type: 'error'; id: number; error: string };

function send(msg: Reply): void {
  if (process.send) process.send(msg);
}

const rawVoice = process.env.TTS_VOICE;
if (!rawVoice) throw new Error('TTS_VOICE env var required');
const voice: string = rawVoice;

async function main() {
  await initTTS(voice);
  send({ type: 'ready' });

  process.on('message', async (task: Task) => {
    try {
      await synthesize(task.text, task.outputPath, voice);
      const duration = await getAudioDuration(task.outputPath);
      send({ type: 'done', id: task.id, duration });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      send({ type: 'error', id: task.id, error: msg });
    }
  });
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  send({ type: 'error', id: -1, error: msg });
  process.exit(1);
});
