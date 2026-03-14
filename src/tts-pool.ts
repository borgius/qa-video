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
  timer?: NodeJS.Timeout;
}

interface ProcState {
  proc: ChildProcess;
  busy: boolean;
  /** ID of the task currently in-flight on this worker, or null if idle. */
  currentTaskId: number | null;
}

export class TTSPool {
  private states: ProcState[] = [];
  private queue: Task[] = [];
  private pending = new Map<number, Task>();
  private nextId = 0;
  /** Set to false during terminate() so the exit handler skips respawn. */
  private running = false;
  private voice = '';
  private workerPath = '';
  private execArgv: string[] = [];
  readonly size: number;

  constructor(workerCount?: number) {
    this.size = workerCount ?? Math.max(1, Math.floor(cpus().length * 0.8));
  }

  async init(voice: string): Promise<void> {
    // Detect tsx dev mode vs compiled JS
    const isTsx = import.meta.url.endsWith('.ts');
    const workerFile = isTsx ? './tts-worker.ts' : './tts-worker.js';
    this.workerPath = fileURLToPath(new URL(workerFile, import.meta.url));

    // Resolve tsx/esm absolute path so it works reliably from any cwd
    const req = createRequire(import.meta.url);
    const tsxEsmUrl = pathToFileURL(req.resolve('tsx/esm')).href;
    this.execArgv = isTsx ? ['--import', tsxEsmUrl] : [];
    this.voice = voice;
    this.running = true;

    // Each worker pipes its stderr here; raise the listener limit to avoid spurious warnings
    process.stderr.setMaxListeners(this.size * 4 + process.stderr.getMaxListeners());

    await Promise.all(Array.from({ length: this.size }, () => this.spawnWorker()));
  }

  private spawnWorker(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const proc = fork(this.workerPath, [], {
        execArgv: this.execArgv,
        env: { ...process.env, TTS_VOICE: this.voice },
        silent: true, // capture stderr so TTS model logs don't clutter output
      });

      const state: ProcState = { proc, busy: false, currentTaskId: null };

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
          state.currentTaskId = null;
          if (task.timer) clearTimeout(task.timer);
          if (msg.type === 'error') {
            task.reject(new Error(msg.error ?? 'synthesis failed'));
          } else {
            task.resolve(msg.duration ?? 0);
          }
          this.dispatch();
        });

        proc.on('exit', (code, signal) => {
          if (!this.running) return; // intentional shutdown via terminate()
          // Remove crashed worker from active pool
          const idx = this.states.indexOf(state);
          if (idx !== -1) this.states.splice(idx, 1);
          // Reject the in-flight task (if it wasn't already rejected by a timeout)
          if (state.currentTaskId !== null) {
            const task = this.pending.get(state.currentTaskId);
            if (task) {
              this.pending.delete(state.currentTaskId);
              if (task.timer) clearTimeout(task.timer);
              task.reject(new Error(`TTS worker crashed (exit ${code ?? signal})`));
            }
            state.currentTaskId = null;
          }
          // Respawn a replacement worker to maintain pool size
          this.spawnWorker().then(() => this.dispatch()).catch(() => {});
        });

        // Surface worker stderr in the parent's stderr
        proc.stderr?.pipe(process.stderr);
        resolve();
      });

      proc.on('error', reject);
    });
  }

  synthesize(text: string, outputPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, text, outputPath, resolve, reject });
      this.dispatch();
    });
  }

  private dispatch(): void {
    const timeoutMs = Number(process.env.TTS_WORKER_TIMEOUT_MS ?? '90000');
    while (this.queue.length > 0) {
      const idle = this.states.find(s => !s.busy);
      if (!idle) break;
      const task = this.queue.shift();
      if (!task) break;
      idle.busy = true;
      idle.currentTaskId = task.id;
      this.pending.set(task.id, task);
      idle.proc.send({ id: task.id, text: task.text, outputPath: task.outputPath });
      // Timeout: if the worker doesn't respond in time, kill it (exit handler will
      // reject the task and respawn the worker automatically).
      task.timer = setTimeout(() => {
        if (!this.pending.has(task.id)) return; // already resolved/rejected
        this.pending.delete(task.id);
        idle.proc.kill('SIGKILL'); // triggers exit handler → crash recovery + respawn
        task.reject(new Error(`TTS synthesis timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }
  }

  async terminate(): Promise<void> {
    this.running = false;
    // Drain the queue so nothing waits forever after shutdown
    for (const task of this.queue) {
      if (task.timer) clearTimeout(task.timer);
      task.reject(new Error('TTSPool terminated'));
    }
    this.queue.length = 0;
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
