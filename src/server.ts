import express from 'express';
import cors from 'cors';
import { readdirSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { createServer } from 'node:net';
import { join, resolve } from 'path';
import { concatenateAudioFiles } from './assembler.js';
import { cachedPath, isCached, resolveOutputDir, slug } from './cache.js';
import { generateTitle, topicFromFilename } from './metadata.js';
import { parseYamlFile } from './parser.js';
import { parseSlidevDeck } from './slidev.js';
import { renderSlide } from './renderer.js';
import { buildAudioPlan } from './tts-preprocess.js';
import { initTTS, synthesize } from './tts.js';
import { DEFAULT_CONFIG, type PipelineConfig } from './types.js';

const app = express();
const PORT = process.env.PORT || 3001;

let qaDir = resolve(process.cwd(), 'qa');
let filterFile: string | undefined;
let outputDir = resolveOutputDir(qaDir);

app.use(cors());
app.use(express.json());

// ── Health ──

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── Files ──

/** Scan qaDir for YAML and Slidev .md files at root level and one level of subdirectories. */
function scanYamlFiles(dir: string, filterFilename?: string) {
  const results: { relPath: string; subfolder: string | undefined; filename: string; type: 'yaml' | 'slidev' }[] = [];
  const isSource = (f: string) => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.md');
  const fileType = (f: string): 'yaml' | 'slidev' => f.endsWith('.md') ? 'slidev' : 'yaml';
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      try {
        readdirSync(join(dir, entry.name))
          .filter(isSource)
          .sort()
          .forEach(f => {
            if (!filterFilename || filterFilename === f) {
              results.push({ relPath: `${entry.name}/${f}`, subfolder: entry.name, filename: f, type: fileType(f) });
            }
          });
      } catch { /* skip unreadable subdirs */ }
    } else if (entry.isFile() && isSource(entry.name)) {
      if (!filterFilename || filterFilename === entry.name) {
        results.push({ relPath: entry.name, subfolder: undefined, filename: entry.name, type: fileType(entry.name) });
      }
    }
  }
  return results.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** Resolve the absolute source file path for a deck name, trying .yaml, .yml, .md in order. */
function resolveSourceFile(name: string): string {
  for (const ext of ['.yaml', '.yml', '.md']) {
    const p = join(qaDir, `${name}${ext}`);
    if (existsSync(p)) return p;
  }
  throw Object.assign(new Error(`Source file not found: ${name}`), { code: 'ENOENT' });
}

/** Return the path to the first PNG frame for a Slidev slide if the export cache exists. */
function findSlidevFrame(name: string, cardIndex: number): string | null {
  const tempDir = join(outputDir, '.tmp', name);
  const manifestPath = join(tempDir, 'frames-manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const slide = manifest.slides?.[cardIndex];
    if (slide?.frames?.length > 0 && existsSync(slide.frames[0])) {
      return slide.frames[0] as string;
    }
  } catch { /* corrupt manifest */ }
  return null;
}

app.get('/api/files', async (_req, res, next) => {
  try {
    const allFiles = scanYamlFiles(qaDir, filterFile);

    const files = await Promise.all(
      allFiles.map(async ({ relPath, subfolder, filename, type }) => {
        const filePath = join(qaDir, relPath);
        const name = relPath.replace(/\.(yaml|yml|md)$/, '');
        try {
          if (type === 'slidev') {
            const deck = await parseSlidevDeck(filePath);
            return { name, filename, subfolder, title: deck.title, description: deck.description || '', questionCount: deck.slides.length, type: 'slidev' as const };
          }
          const data = await parseYamlFile(filePath);
          return { name, filename, subfolder, title: generateTitle(filePath, data), description: data.config.description || '', questionCount: data.questions.length, type: 'yaml' as const };
        } catch {
          return { name, filename, subfolder, title: topicFromFilename(filePath), description: '', questionCount: 0, type };
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
    const filePath = resolveSourceFile(name);

    if (filePath.endsWith('.md')) {
      const deck = await parseSlidevDeck(filePath);
      res.json({
        name,
        title: deck.title,
        config: {},
        questions: deck.slides.map(s => ({
          question: s.title || `Slide ${s.index + 1}`,
          answer: s.narrationSegments.map(seg => seg.text).join(' '),
        })),
        type: 'slidev',
      });
      return;
    }

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

    const filePath = resolveSourceFile(name);

    // ── Slidev branch ──────────────────────────────────────────────────────────
    if (filePath.endsWith('.md')) {
      const deck = await parseSlidevDeck(filePath);
      if (cardIndex < 0 || cardIndex >= deck.slides.length) {
        res.status(404).json({ error: 'Card index out of range' });
        return;
      }
      const slide = deck.slides[cardIndex];
      const text = type === 'question'
        ? (slide.title || `Slide ${slide.index + 1}`)
        : slide.narrationSegments.map(s => s.text).join(' ');
      const voice = DEFAULT_CONFIG.voice;
      const prefix = type === 'question' ? `sq_${cardIndex}` : `sa_${cardIndex}_${slide.name}`;
      const tempDir = join(outputDir, '.tmp', name);
      mkdirSync(tempDir, { recursive: true });
      const audioPath = cachedPath(tempDir, prefix, `slidev:${type}:${text}:${voice}`, 'wav');
      const label = `[${name}] slide-${cardIndex + 1} ${type}`;
      if (isCached(audioPath, false)) {
        console.log(`${label} — cached`);
        res.sendFile(audioPath, { dotfiles: 'allow' });
        return;
      }
      console.log(`${label} — generating...`);
      await enqueue(text, audioPath, voice);
      res.sendFile(audioPath, { dotfiles: 'allow' });
      return;
    }

    // ── YAML branch ────────────────────────────────────────────────────────────
    const data = await parseYamlFile(filePath);

    if (cardIndex < 0 || cardIndex >= data.questions.length) {
      res.status(404).json({ error: 'Card index out of range' });
      return;
    }

    const card = data.questions[cardIndex];
    const text = type === 'question' ? card.question : card.answer;
    const voice = type === 'question'
      ? (data.config.questionVoice || DEFAULT_CONFIG.questionVoice)
      : (data.config.voice || DEFAULT_CONFIG.voice);
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

    const filePath = resolveSourceFile(name);

    // ── Slidev branch ──────────────────────────────────────────────────────────
    if (filePath.endsWith('.md')) {
      const deck = await parseSlidevDeck(filePath);
      if (cardIndex < 0 || cardIndex >= deck.slides.length) {
        res.status(404).json({ error: 'Card index out of range' });
        return;
      }
      const slide = deck.slides[cardIndex];
      const text = type === 'question'
        ? (slide.title || `Slide ${slide.index + 1}`)
        : slide.narrationSegments.map(s => s.text).join(' ');
      const voice = DEFAULT_CONFIG.voice;
      const prefix = type === 'question' ? `sq_${cardIndex}` : `sa_${cardIndex}_${slide.name}`;
      const tempDir = join(outputDir, '.tmp', name);
      const audioPath = cachedPath(tempDir, prefix, `slidev:${type}:${text}:${voice}`, 'wav');
      res.json({
        cached: isCached(audioPath, false),
        generating: ttsQueue.some(j => j.path === audioPath),
      });
      return;
    }

    // ── YAML branch ────────────────────────────────────────────────────────────
    const data = await parseYamlFile(filePath);

    if (cardIndex < 0 || cardIndex >= data.questions.length) {
      res.status(404).json({ error: 'Card index out of range' });
      return;
    }

    const card = data.questions[cardIndex];
    const text = type === 'question' ? card.question : card.answer;
    const voice = type === 'question'
      ? (data.config.questionVoice || DEFAULT_CONFIG.questionVoice)
      : (data.config.voice || DEFAULT_CONFIG.voice);
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

    const filePath = resolveSourceFile(name);

    // ── Slidev branch: serve exported PNG frame ────────────────────────────────
    if (filePath.endsWith('.md')) {
      const framePath = findSlidevFrame(name, cardIndex);
      if (framePath) {
        res.sendFile(framePath, { dotfiles: 'allow' });
        return;
      }
      // Frame not yet exported — fall back to a text card render
      const deck = await parseSlidevDeck(filePath);
      if (cardIndex < 0 || cardIndex >= deck.slides.length) {
        res.status(404).json({ error: 'Card index out of range' });
        return;
      }
      const slide = deck.slides[cardIndex];
      const text = type === 'question'
        ? (slide.title || `Slide ${slide.index + 1}`)
        : slide.narrationSegments.map(s => s.text).join(' ');
      const totalCards = deck.slides.length;
      const width = DEFAULT_CONFIG.width;
      const height = DEFAULT_CONFIG.height;
      const config: PipelineConfig = {
        inputPath: filePath,
        outputPath: '',
        tempDir: '',
        voice: DEFAULT_CONFIG.voice,
        questionVoice: DEFAULT_CONFIG.questionVoice,
        codeVoice: DEFAULT_CONFIG.codeVoice,
        questionDelay: DEFAULT_CONFIG.questionDelay,
        answerDelay: DEFAULT_CONFIG.answerDelay,
        cardGap: DEFAULT_CONFIG.cardGap,
        fontSize: DEFAULT_CONFIG.fontSize,
        backgroundColor: DEFAULT_CONFIG.backgroundColor,
        questionColor: DEFAULT_CONFIG.questionColor,
        answerColor: DEFAULT_CONFIG.answerColor,
        textColor: DEFAULT_CONFIG.textColor,
        width,
        height,
        force: false,
        format: 'full',
        questionsPerShort: DEFAULT_CONFIG.questionsPerShort,
      };
      const segType = type as 'question' | 'answer';
      const slideHash = `slidev-card:v1:${text}:${segType}:${cardIndex}:${totalCards}:${width}x${height}`;
      const tempDir = join(outputDir, '.tmp', name);
      mkdirSync(tempDir, { recursive: true });
      const imagePath = cachedPath(tempDir, `scard_${cardIndex}_${segType}`, slideHash, 'png');
      if (!isCached(imagePath, false)) {
        await renderSlide(imagePath, { text, type: segType, cardIndex, totalCards, config });
      }
      res.sendFile(imagePath, { dotfiles: 'allow' });
      return;
    }

    // ── YAML branch ────────────────────────────────────────────────────────────
    const data = await parseYamlFile(filePath);

    if (cardIndex < 0 || cardIndex >= data.questions.length) {
      res.status(404).json({ error: 'Card index out of range' });
      return;
    }

    const card = data.questions[cardIndex];
    const text = type === 'question' ? card.question : card.answer;
    const totalCards = data.questions.length;

    const format = req.query.format === 'shorts' ? 'shorts' : 'full';
    const width = format === 'shorts' ? 1080 : DEFAULT_CONFIG.width;
    const height = format === 'shorts' ? 1920 : DEFAULT_CONFIG.height;

    const config: PipelineConfig = {
      inputPath: filePath,
      outputPath: '',
      tempDir: '',
      voice: data.config.voice || DEFAULT_CONFIG.voice,
      questionVoice: data.config.questionVoice || DEFAULT_CONFIG.questionVoice,
      codeVoice: data.config.codeVoice || DEFAULT_CONFIG.codeVoice,
      questionDelay: data.config.questionDelay ?? DEFAULT_CONFIG.questionDelay,
      answerDelay: data.config.answerDelay ?? DEFAULT_CONFIG.answerDelay,
      cardGap: data.config.cardGap ?? DEFAULT_CONFIG.cardGap,
      fontSize: data.config.fontSize ?? DEFAULT_CONFIG.fontSize,
      backgroundColor: data.config.backgroundColor || DEFAULT_CONFIG.backgroundColor,
      questionColor: data.config.questionColor || DEFAULT_CONFIG.questionColor,
      answerColor: data.config.answerColor || DEFAULT_CONFIG.answerColor,
      textColor: data.config.textColor || DEFAULT_CONFIG.textColor,
      width,
      height,
      force: false,
      format,
      questionsPerShort: DEFAULT_CONFIG.questionsPerShort,
    };

    const segType = type as 'question' | 'answer';
    const qSlug = slug(card.question);
    const qTextForHash = segType === 'answer' ? card.question : '';
    const slideHash = `slide:v5:${text}:${segType}:${cardIndex}:${totalCards}:${config.fontSize}:${config.questionColor}:${config.answerColor}:${config.textColor}:${qTextForHash}:${width}x${height}`;
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
      questionText: segType === 'answer' ? card.question : undefined,
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

export async function startServer(port?: number, opts?: { qaDir?: string; filterFile?: string; outputDir?: string }): Promise<number> {
  if (opts?.qaDir) {
    qaDir = opts.qaDir;
    outputDir = opts.outputDir ? opts.outputDir : resolveOutputDir(qaDir);
  } else if (opts?.outputDir) {
    outputDir = opts.outputDir;
  }
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
