import express from 'express';
import cors from 'cors';
import { readdirSync, mkdirSync } from 'fs';
import { createServer } from 'node:net';
import { join, resolve } from 'path';
import { concatenateAudioFiles } from './assembler.js';
import { cachedPath, isCached, slug } from './cache.js';
import { generateTitle, topicFromFilename } from './metadata.js';
import { parseYamlFile } from './parser.js';
import { renderSlide } from './renderer.js';
import { buildAudioPlan } from './tts-preprocess.js';
import { initTTS, synthesize } from './tts.js';
import { DEFAULT_CONFIG, type PipelineConfig } from './types.js';

const app = express();
const PORT = process.env.PORT || 3001;

let qaDir = resolve(process.cwd(), 'qa');
let filterFile: string | undefined;
const outputDir = resolve(process.cwd(), 'output');

app.use(cors());
app.use(express.json());

// ── Health ──

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── Files ──

app.get('/api/files', async (_req, res, next) => {
  try {
    let yamlFiles = readdirSync(qaDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();
    if (filterFile) yamlFiles = yamlFiles.filter(f => f === filterFile);

    const files = await Promise.all(
      yamlFiles.map(async (filename) => {
        const filePath = join(qaDir, filename);
        const name = filename.replace(/\.(yaml|yml)$/, '');
        try {
          const data = await parseYamlFile(filePath);
          return {
            name,
            filename,
            title: generateTitle(filePath, data),
            description: data.config.description || '',
            questionCount: data.questions.length,
          };
        } catch {
          return { name, filename, title: topicFromFilename(filePath), description: '', questionCount: 0 };
        }
      })
    );

    res.json({ files: files.filter(f => f.questionCount > 0) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/files/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    const filePath = join(qaDir, `${name}.yaml`);
    const data = await parseYamlFile(filePath);

    res.json({
      name,
      title: generateTitle(filePath, data),
      config: data.config,
      questions: data.questions,
    });
  } catch (err) {
    next(err);
  }
});

// ── TTS Queue ──

let ttsInitialized = false;
let ttsInitializing: Promise<void> | null = null;
const ttsQueue: Array<{
  text: string;
  path: string;
  voice: string;
  resolve: () => void;
  reject: (err: Error) => void;
}> = [];
let processing = false;

async function ensureTTS(voice: string): Promise<void> {
  if (ttsInitialized) return;
  if (!ttsInitializing) {
    ttsInitializing = initTTS(voice).then(() => {
      ttsInitialized = true;
    });
  }
  await ttsInitializing;
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  while (ttsQueue.length > 0) {
    const job = ttsQueue.shift()!;
    try {
      await ensureTTS(job.voice);
      if (!isCached(job.path, false)) {
        await synthesize(job.text, job.path, job.voice);
      }
      job.resolve();
    } catch (err) {
      job.reject(err as Error);
    }
  }

  processing = false;
}

function enqueue(text: string, path: string, voice: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ttsQueue.push({ text, path, voice, resolve, reject });
    processQueue();
  });
}

// ── Audio ──

app.get('/api/audio/:name/:cardIndex/:type', async (req, res, next) => {
  try {
    const { name, cardIndex: cardIndexStr, type } = req.params;
    const cardIndex = parseInt(cardIndexStr, 10);

    if (type !== 'question' && type !== 'answer') {
      res.status(400).json({ error: 'type must be "question" or "answer"' });
      return;
    }

    const filePath = join(qaDir, `${name}.yaml`);
    const data = await parseYamlFile(filePath);

    if (cardIndex < 0 || cardIndex >= data.questions.length) {
      res.status(404).json({ error: 'Card index out of range' });
      return;
    }

    const card = data.questions[cardIndex];
    const text = type === 'question' ? card.question : card.answer;
    const voice = data.config.voice || DEFAULT_CONFIG.voice;
    const codeVoice = data.config.codeVoice || DEFAULT_CONFIG.codeVoice;

    const qSlug = slug(card.question);
    const prefix = type === 'question' ? `q_${cardIndex}_${qSlug}` : `a_${cardIndex}_${qSlug}`;
    const tempDir = join(outputDir, '.tmp', name);
    mkdirSync(tempDir, { recursive: true });

    const plan = buildAudioPlan(text, tempDir, prefix, voice, codeVoice);
    const label = `[${name}] ${type} ${cardIndex + 1}/${data.questions.length}`;

    if (isCached(plan.finalAudioPath, false)) {
      console.log(`${label} — cached`);
      res.sendFile(plan.finalAudioPath, { dotfiles: 'allow' });
      return;
    }

    const parts = plan.isMultiPart ? ` (${plan.parts.length} parts)` : '';
    console.log(`${label} — generating${parts}...`);
    const start = Date.now();

    // Synthesize each part
    for (const part of plan.parts) {
      await enqueue(part.ttsText, part.audioPath, part.voice);
    }

    // Concatenate multi-part WAVs
    if (plan.isMultiPart && !isCached(plan.finalAudioPath, false)) {
      await concatenateAudioFiles(
        plan.parts.map(p => p.audioPath),
        plan.finalAudioPath,
      );
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`${label} — done (${elapsed}s)`);
    res.sendFile(plan.finalAudioPath, { dotfiles: 'allow' });
  } catch (err) {
    next(err);
  }
});

app.get('/api/audio/:name/:cardIndex/:type/status', async (req, res, next) => {
  try {
    const { name, cardIndex: cardIndexStr, type } = req.params;
    const cardIndex = parseInt(cardIndexStr, 10);

    if (type !== 'question' && type !== 'answer') {
      res.status(400).json({ error: 'type must be "question" or "answer"' });
      return;
    }

    const filePath = join(qaDir, `${name}.yaml`);
    const data = await parseYamlFile(filePath);

    if (cardIndex < 0 || cardIndex >= data.questions.length) {
      res.status(404).json({ error: 'Card index out of range' });
      return;
    }

    const card = data.questions[cardIndex];
    const text = type === 'question' ? card.question : card.answer;
    const voice = data.config.voice || DEFAULT_CONFIG.voice;
    const codeVoice = data.config.codeVoice || DEFAULT_CONFIG.codeVoice;

    const qSlug = slug(card.question);
    const prefix = type === 'question' ? `q_${cardIndex}_${qSlug}` : `a_${cardIndex}_${qSlug}`;
    const tempDir = join(outputDir, '.tmp', name);

    const plan = buildAudioPlan(text, tempDir, prefix, voice, codeVoice);

    res.json({
      cached: isCached(plan.finalAudioPath, false),
      generating: ttsQueue.some(j => plan.parts.some(p => p.audioPath === j.path)),
    });
  } catch (err) {
    next(err);
  }
});

// ── Slides ──

app.get('/api/slides/:name/:cardIndex/:type', async (req, res, next) => {
  try {
    const { name, cardIndex: cardIndexStr, type } = req.params;
    const cardIndex = parseInt(cardIndexStr, 10);

    if (type !== 'question' && type !== 'answer') {
      res.status(400).json({ error: 'type must be "question" or "answer"' });
      return;
    }

    const filePath = join(qaDir, `${name}.yaml`);
    const data = await parseYamlFile(filePath);

    if (cardIndex < 0 || cardIndex >= data.questions.length) {
      res.status(404).json({ error: 'Card index out of range' });
      return;
    }

    const card = data.questions[cardIndex];
    const text = type === 'question' ? card.question : card.answer;
    const totalCards = data.questions.length;

    const config: PipelineConfig = {
      inputPath: filePath,
      outputPath: '',
      tempDir: '',
      voice: data.config.voice || DEFAULT_CONFIG.voice,
      codeVoice: data.config.codeVoice || DEFAULT_CONFIG.codeVoice,
      questionDelay: data.config.questionDelay ?? DEFAULT_CONFIG.questionDelay,
      answerDelay: data.config.answerDelay ?? DEFAULT_CONFIG.answerDelay,
      cardGap: data.config.cardGap ?? DEFAULT_CONFIG.cardGap,
      fontSize: data.config.fontSize ?? DEFAULT_CONFIG.fontSize,
      backgroundColor: data.config.backgroundColor || DEFAULT_CONFIG.backgroundColor,
      questionColor: data.config.questionColor || DEFAULT_CONFIG.questionColor,
      answerColor: data.config.answerColor || DEFAULT_CONFIG.answerColor,
      textColor: data.config.textColor || DEFAULT_CONFIG.textColor,
      width: DEFAULT_CONFIG.width,
      height: DEFAULT_CONFIG.height,
      force: false,
    };

    const segType = type as 'question' | 'answer';
    const qSlug = slug(card.question);
    const slideHash = `slide:v4:${text}:${segType}:${cardIndex}:${totalCards}:${config.fontSize}:${config.questionColor}:${config.answerColor}:${config.textColor}`;
    const tempDir = join(outputDir, '.tmp', name);
    mkdirSync(tempDir, { recursive: true });

    const segIndex = type === 'question' ? cardIndex * 2 : cardIndex * 2 + 1;
    const slideTypeTag = type === 'question' ? 'q' : 'a';
    const imagePath = cachedPath(tempDir, `slide_${segIndex}_${slideTypeTag}_${qSlug}`, slideHash, 'png');

    if (isCached(imagePath, false)) {
      res.sendFile(imagePath, { dotfiles: 'allow' });
      return;
    }

    await renderSlide(imagePath, {
      text,
      type: segType,
      cardIndex,
      totalCards,
      config,
    });

    res.sendFile(imagePath, { dotfiles: 'allow' });
  } catch (err) {
    next(err);
  }
});

// ── Error handler ──

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('API Error:', err.message);
  const status = err.code === 'ENOENT' ? 404 : 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port);
  });
}

async function findAvailablePort(startPort: number, maxAttempts = 20): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) return port;
    console.log(`Port ${port} is in use, trying another one...`);
  }
  throw new Error(`No available port found after trying ${startPort}–${startPort + maxAttempts - 1}`);
}

export async function startServer(port?: number, opts?: { qaDir?: string; filterFile?: string }): Promise<number> {
  if (opts?.qaDir) qaDir = opts.qaDir;
  if (opts?.filterFile) filterFile = opts.filterFile;
  const requestedPort = port ?? Number(PORT);
  const listenPort = await findAvailablePort(requestedPort);
  return new Promise((resolve) => {
    app.listen(listenPort, () => {
      console.log(`QA Video API running on http://localhost:${listenPort}`);
      resolve(listenPort);
    });
  });
}

// Run directly (tsx src/server.ts)
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  startServer();
}
