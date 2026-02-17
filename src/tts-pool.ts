import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface Task {
  id: number;
  text: string;
  outputPath: string;
  resolve: (duration: number) => void;
  reject: (err: Error) => void;
}

interface ProcState {
  proc: ChildProcess;
  busy: boolean;
}

export class TTSPool {
  private states: ProcState[] = [];
  private queue: Task[] = [];
  private pending = new Map<number, Task>();
  private nextId = 0;
  readonly size: number;

  constructor(workerCount?: number) {
    this.size = workerCount ?? Math.max(1, Math.floor(cpus().length * 0.8));
  }

  async init(voice: string): Promise<void> {
    // Detect tsx dev mode vs compiled JS
    const isTsx = import.meta.url.endsWith('.ts');
    const workerFile = isTsx ? './tts-worker.ts' : './tts-worker.js';
    const workerPath = fileURLToPath(new URL(workerFile, import.meta.url));

    // Resolve tsx/esm absolute path so it works reliably from any cwd
    const req = createRequire(import.meta.url);
    const tsxEsmUrl = pathToFileURL(req.resolve('tsx/esm')).href;
    const execArgv = isTsx ? ['--import', tsxEsmUrl] : [];

    // Each worker pipes its stderr here; raise the listener limit to avoid spurious warnings
    process.stderr.setMaxListeners(this.size * 4 + process.stderr.getMaxListeners());

    await Promise.all(
      Array.from({ length: this.size }, () =>
        new Promise<void>((resolve, reject) => {
          const proc = fork(workerPath, [], {
            execArgv,
            env: { ...process.env, TTS_VOICE: voice },
            silent: true, // capture stderr so TTS model logs don't clutter output
          });

          const state: ProcState = { proc, busy: false };

          proc.once('message', (msg: { type: string; error?: string }) => {
            if (msg.type !== 'ready') {
              reject(new Error(`Worker init failed: ${msg.error ?? 'unknown'}`));
              return;
            }
            this.states.push(state);

            proc.on('message', (msg: { type: string; id: number; duration?: number; error?: string }) => {
              const task = this.pending.get(msg.id);
              if (!task) return;
              this.pending.delete(msg.id);
              state.busy = false;
              if (msg.type === 'error') {
                task.reject(new Error(msg.error ?? 'synthesis failed'));
              } else {
                task.resolve(msg.duration ?? 0);
              }
              this.dispatch();
            });

            resolve();
          });

          // Surface worker stderr in the parent's stderr
          proc.stderr?.pipe(process.stderr);
          proc.on('error', reject);
        })
      )
    );
  }

  synthesize(text: string, outputPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, text, outputPath, resolve, reject });
      this.dispatch();
    });
  }

  private dispatch(): void {
    while (this.queue.length > 0) {
      const idle = this.states.find(s => !s.busy);
      if (!idle) break;
      const task = this.queue.shift();
      if (!task) break;
      idle.busy = true;
      this.pending.set(task.id, task);
      idle.proc.send({ id: task.id, text: task.text, outputPath: task.outputPath });
    }
  }

  async terminate(): Promise<void> {
    await Promise.all(
      this.states.map(
        s => new Promise<void>(resolve => {
          s.proc.once('exit', () => resolve());
          s.proc.kill('SIGTERM');
        })
      )
    );
  }
}
