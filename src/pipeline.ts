import { mkdirSync, existsSync } from 'fs';
import { cpus } from 'os';
import { parseYamlFile } from './parser.js';
import { getAudioDuration } from './tts.js';
import { TTSPool } from './tts-pool.js';
import { renderSlide } from './renderer.js';
import { createSegmentClip, createSilentClip, concatenateClips } from './assembler.js';
import { Segment, PipelineConfig, DEFAULT_CONFIG } from './types.js';
import { sha, cachedPath, isCached, removeStale } from './cache.js';
import { preprocessForTTS } from './tts-preprocess.js';

/** Run tasks in parallel, at most `limit` concurrent at a time. */
async function runConcurrent<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function elapsed(start: number): string {
  return ((Date.now() - start) / 1000).toFixed(1);
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export async function runPipeline(config: PipelineConfig): Promise<void> {
  const pipelineStart = Date.now();
  const { force, skipTTS } = config;

  if (!existsSync(config.tempDir)) {
    mkdirSync(config.tempDir, { recursive: true });
  }

  // ── Stage 1: Parse YAML ──
  const stage1Start = Date.now();
  console.log('\n── Stage 1/4: Parsing YAML ──');
  const yamlData = await parseYamlFile(config.inputPath);
  const cards = yamlData.questions;

  const yamlConfig = yamlData.config;
  if (yamlConfig.questionDelay !== undefined && config.questionDelay === DEFAULT_CONFIG.questionDelay) {
    config.questionDelay = yamlConfig.questionDelay;
  }
  if (yamlConfig.answerDelay !== undefined && config.answerDelay === DEFAULT_CONFIG.answerDelay) {
    config.answerDelay = yamlConfig.answerDelay;
  }
  if (yamlConfig.voice && config.voice === DEFAULT_CONFIG.voice) {
    config.voice = yamlConfig.voice;
  }

  console.log(`  Cards: ${cards.length}`);
  console.log(`  Voice: ${config.voice}`);
  console.log(`  Delays: question=${config.questionDelay}s, answer=${config.answerDelay}s, gap=${config.cardGap}s`);
  if (force) console.log(`  Force: regenerating all artifacts`);
  console.log(`  Stage 1 done (${elapsed(stage1Start)}s)`);

  // ── Stage 2: Synthesize speech (parallel) ──
  const stage2Start = Date.now();
  console.log('\n── Stage 2/4: Synthesizing speech ──');

  type AudioItem = {
    i: number;
    isQuestion: boolean;
    text: string;
    ttsText: string;
    audioPath: string;
    delay: number;
  };

  const audioItems: AudioItem[] = cards.flatMap((card, i) => {
    const qTTSText = preprocessForTTS(card.question);
    const aTTSText = preprocessForTTS(card.answer);
    return [
      {
        i, isQuestion: true, text: card.question, ttsText: qTTSText,
        audioPath: cachedPath(config.tempDir, `q_${i}`, `audio:${qTTSText}:${config.voice}`, 'wav'),
        delay: config.questionDelay,
      },
      {
        i, isQuestion: false, text: card.answer, ttsText: aTTSText,
        audioPath: cachedPath(config.tempDir, `a_${i}`, `audio:${aTTSText}:${config.voice}`, 'wav'),
        delay: config.answerDelay,
      },
    ];
  });

  const uncachedItems = audioItems.filter(t => !isCached(t.audioPath, force));

  if (skipTTS) {
    const missing = uncachedItems.map(t => t.audioPath);
    if (missing.length > 0) {
      throw new Error(
        `update requires pre-existing audio for all cards. Missing ${missing.length} file(s).\n` +
        `  Run "qa-video generate" first to synthesize audio.`,
      );
    }
    console.log(`  Skipping TTS synthesis (${audioItems.length} cached)`);
  }

  let pool: TTSPool | null = null;

  if (!skipTTS && uncachedItems.length > 0) {
    pool = new TTSPool();
    const cpuCount = cpus().length;
    console.log(`  Workers: ${pool.size} / ${cpuCount} CPUs (${Math.round(pool.size / cpuCount * 100)}%)`);
    process.stdout.write(`  Loading TTS models in ${pool.size} workers...`);
    const loadStart = Date.now();
    await pool.init(config.voice);
    console.log(` done (${elapsed(loadStart)}s)`);
  }

  let synthesizedCount = 0;
  const durations = await Promise.all(
    audioItems.map(async (item) => {
      if (isCached(item.audioPath, force)) {
        return { duration: await getAudioDuration(item.audioPath), cached: true };
      }
      if (!pool) throw new Error('TTS pool not initialized');
      const duration = await pool.synthesize(item.ttsText, item.audioPath);
      synthesizedCount++;
      process.stdout.write(`\r  Synthesizing: ${synthesizedCount}/${uncachedItems.length}`);
      return { duration, cached: false };
    })
  );

  if (pool) {
    await pool.terminate();
    console.log(); // newline after \r progress
  }

  const segments: Segment[] = [];
  let totalAudioDuration = 0;
  let cachedAudioCount = 0;

  for (let idx = 0; idx < audioItems.length; idx++) {
    const item = audioItems[idx];
    const { duration, cached } = durations[idx];
    totalAudioDuration += duration;
    if (cached) cachedAudioCount++;
    segments.push({
      type: item.isQuestion ? 'question' : 'answer',
      text: item.text,
      cardIndex: item.i,
      totalCards: cards.length,
      audioPath: item.audioPath,
      imagePath: '',
      audioDuration: duration,
      totalDuration: duration + item.delay,
    });
  }

  // Remove stale audio files for any card whose TTS text changed (old hash-named .wav left behind)
  await Promise.all(
    audioItems.map(async (item, idx) => {
      if (!durations[idx].cached) {
        const prefix = item.isQuestion ? `q_${item.i}` : `a_${item.i}`;
        await removeStale(config.tempDir, prefix, 'wav', item.audioPath);
      }
    })
  );

  console.log(`  Total audio: ${formatDuration(totalAudioDuration)} (${cachedAudioCount}/${segments.length} cached)`);
  console.log(`  Stage 2 done (${elapsed(stage2Start)}s)`);

  // ── Stage 3: Render slides (parallel) ──
  const stage3Start = Date.now();
  console.log('\n── Stage 3/4: Rendering slides ──');

  // Assign image paths upfront so Stage 4 can reference them
  const gapSlideHash = `slide:gap:${config.backgroundColor}:${config.fontSize}:${cards.length}`;
  const gapSlidePath = cachedPath(config.tempDir, 'slide_gap', gapSlideHash, 'png');

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const slideHash = `slide:${seg.text}:${seg.type}:${seg.cardIndex}:${seg.totalCards}:${config.fontSize}:${config.questionColor}:${config.answerColor}:${config.textColor}`;
    seg.imagePath = cachedPath(config.tempDir, `slide_${i}`, slideHash, 'png');
  }

  let cachedSlideCount = 0;
  await Promise.all([
    ...segments.map(async (seg) => {
      if (isCached(seg.imagePath, force)) {
        cachedSlideCount++;
      } else {
        await renderSlide(seg.imagePath, {
          text: seg.text, type: seg.type, cardIndex: seg.cardIndex,
          totalCards: seg.totalCards, config,
        });
      }
    }),
    (async () => {
      if (isCached(gapSlidePath, force)) {
        cachedSlideCount++;
      } else {
        await renderSlide(gapSlidePath, {
          text: '', type: 'question', cardIndex: 0, totalCards: cards.length,
          config: { ...config, questionColor: config.backgroundColor },
        });
      }
    })(),
  ]);

  console.log(`  Rendered ${segments.length + 1} slides (${cachedSlideCount} cached)`);
  console.log(`  Stage 3 done (${elapsed(stage3Start)}s)`);

  // ── Stage 4: Assemble video (parallel clip encoding) ──
  const stage4Start = Date.now();
  console.log('\n── Stage 4/4: Assembling video ──');

  // Build ordered clip descriptors (order must be preserved for concatenation)
  type ClipDesc =
    | { kind: 'segment'; path: string; seg: Segment }
    | { kind: 'gap'; path: string };

  const clipDescs: ClipDesc[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segTTSText = preprocessForTTS(seg.text);
    const clipHash = `clip:${sha(`audio:${segTTSText}:${config.voice}`)}:${sha(`slide:${seg.text}:${seg.type}:${seg.cardIndex}:${seg.totalCards}:${config.fontSize}:${config.questionColor}:${config.answerColor}:${config.textColor}`)}:${seg.totalDuration}`;
    clipDescs.push({ kind: 'segment', seg, path: cachedPath(config.tempDir, `clip_${i}`, clipHash, 'mp4') });

    if (seg.type === 'answer' && seg.cardIndex < seg.totalCards - 1 && config.cardGap > 0) {
      const gapHash = `gap:${sha(gapSlideHash)}:${config.cardGap}`;
      clipDescs.push({ kind: 'gap', path: cachedPath(config.tempDir, `gap_${i}`, gapHash, 'mp4') });
    }
  }

  const uncachedClips = clipDescs.filter(d => !isCached(d.path, force));
  const cachedClipCount = clipDescs.length - uncachedClips.length;
  let encodedCount = 0;

  // ffmpeg already uses multiple threads internally; cap concurrent processes at ~50% of CPUs
  const clipConcurrency = Math.max(2, Math.floor(cpus().length * 0.5));
  console.log(`  Clips: ${clipDescs.length} total, ${uncachedClips.length} to encode (${clipConcurrency} concurrent)`);

  await runConcurrent(
    clipDescs.map(desc => async () => {
      if (isCached(desc.path, force)) return;
      if (desc.kind === 'segment') {
        await createSegmentClip(desc.seg, desc.path);
      } else {
        await createSilentClip(gapSlidePath, config.cardGap, desc.path);
      }
      encodedCount++;
      process.stdout.write(`\r  Encoding: ${encodedCount}/${uncachedClips.length}`);
    }),
    clipConcurrency,
  );
  if (uncachedClips.length > 0) console.log(); // newline after \r progress

  const clipPaths = clipDescs.map(d => d.path);
  const clipDurations = clipDescs.map(d => d.kind === 'segment' ? d.seg.totalDuration : config.cardGap);

  process.stdout.write(`  Concatenating: 0/${clipPaths.length}`);
  const concatStart = Date.now();
  await concatenateClips(clipPaths, config.outputPath, config.tempDir, clipDurations, (current, total) => {
    process.stdout.write(`\r  Concatenating: ${current}/${total}`);
  });
  console.log(`\r  Concatenating: ${clipPaths.length}/${clipPaths.length} done (${elapsed(concatStart)}s)`);
  console.log(`  Clips: ${cachedClipCount}/${clipDescs.length} cached`);
  console.log(`  Stage 4 done (${elapsed(stage4Start)}s)`);

  // ── Summary ──
  const estimatedVideoDuration = segments.reduce((sum, s) => sum + s.totalDuration, 0) + (cards.length - 1) * config.cardGap;
  console.log(`\n══ Complete ══`);
  console.log(`  Output:   ${config.outputPath}`);
  console.log(`  Duration: ~${formatDuration(estimatedVideoDuration)}`);
  console.log(`  Cards:    ${cards.length}`);
  console.log(`  Time:     ${elapsed(pipelineStart)}s`);
}
