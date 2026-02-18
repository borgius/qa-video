import { existsSync, mkdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { concatenateAudioFiles, concatenateClips, createSegmentClip, createSilentClip } from './assembler.js';
import { cachedPath, isCached, removeStale, sha, slug } from './cache.js';
import { codeToTTS, parseMarkdown } from './markdown.js';
import { parseYamlFile } from './parser.js';
import { renderSlide } from './renderer.js';
import { TTSPool } from './tts-pool.js';
import { preprocessForTTS } from './tts-preprocess.js';
import { getAudioDuration, MAX_CHUNK_CHARS } from './tts.js';
import { DEFAULT_CONFIG, type PipelineConfig, type Segment } from './types.js';

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

// ── Audio plan types ──────────────────────────────────────────────────────────

/** A single TTS synthesis unit (one voice, one WAV output). */
interface SynthPart {
  audioPath: string;
  ttsText: string;
  voice: string;
}

/**
 * Audio plan for one question or answer slot.
 * Single-part plans map directly to an existing WAV; multi-part plans require
 * the segment WAVs to be concatenated into `finalAudioPath`.
 */
interface AudioPlan {
  cardIndex: number;
  isQuestion: boolean;
  rawText: string;
  delay: number;
  finalAudioPath: string;  // the WAV consumed by the video assembler
  parts: SynthPart[];
  isMultiPart: boolean;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

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
  if (yamlConfig.codeVoice && config.codeVoice === DEFAULT_CONFIG.codeVoice) {
    config.codeVoice = yamlConfig.codeVoice;
  }

  // If YAML doesn't set codeVoice and it still matches the default, keep it;
  // but if voice was overridden and codeVoice wasn't explicitly set, leave codeVoice as-is.

  console.log(`  Cards: ${cards.length}`);
  console.log(`  Voice: ${config.voice}  Code voice: ${config.codeVoice}`);
  console.log(`  Delays: question=${config.questionDelay}s, answer=${config.answerDelay}s, gap=${config.cardGap}s`);
  if (force) console.log(`  Force: regenerating all artifacts`);
  console.log(`  Stage 1 done (${elapsed(stage1Start)}s)`);

  // ── Stage 2: Synthesize speech ──
  const stage2Start = Date.now();
  console.log('\n── Stage 2/4: Synthesizing speech ──');

  /**
   * Build an audio cache key.  Short texts (≤ MAX_CHUNK_CHARS) use the original
   * `audio:` prefix so existing valid WAVs are reused.  Long texts that require
   * chunking use `audio-chunked:` so old truncated WAVs are discarded and
   * re-synthesised at full length.
   */
  const audioCacheKey = (ttsText: string, voice: string) =>
    ttsText.length > MAX_CHUNK_CHARS
      ? `audio-chunked:${ttsText}:${voice}`
      : `audio:${ttsText}:${voice}`;

  // Build one AudioPlan per question/answer slot.
  const audioPlans: AudioPlan[] = cards.flatMap((card, i) => {
    const qSlug = slug(card.question);

    // ── Question (always single-part, main voice) ──
    const qTTSText = preprocessForTTS(card.question);
    const qAudioPath = cachedPath(config.tempDir, `q_${i}_${qSlug}`, audioCacheKey(qTTSText, config.voice), 'wav');
    const qPlan: AudioPlan = {
      cardIndex: i, isQuestion: true, rawText: card.question,
      delay: config.questionDelay,
      finalAudioPath: qAudioPath,
      parts: [{ audioPath: qAudioPath, ttsText: qTTSText, voice: config.voice }],
      isMultiPart: false,
    };

    // ── Answer ──
    const mdSegs = parseMarkdown(card.answer);
    const hasCode = mdSegs.some(s => s.kind === 'code');

    let aPlan: AudioPlan;

    if (!hasCode) {
      const aTTSText = preprocessForTTS(card.answer);
      const aAudioPath = cachedPath(config.tempDir, `a_${i}_${qSlug}`, audioCacheKey(aTTSText, config.voice), 'wav');
      aPlan = {
        cardIndex: i, isQuestion: false, rawText: card.answer,
        delay: config.answerDelay,
        finalAudioPath: aAudioPath,
        parts: [{ audioPath: aAudioPath, ttsText: aTTSText, voice: config.voice }],
        isMultiPart: false,
      };
    } else {
      // Multi-part: each markdown segment gets its own WAV, then they're concatenated.
      const parts: SynthPart[] = mdSegs.map((seg, j) => {
        const rawTTS = seg.kind === 'code'
          ? codeToTTS(seg)
          : seg.content;
        const ttsText = preprocessForTTS(rawTTS);
        const voice = seg.kind === 'code' ? config.codeVoice : config.voice;
        const prefix = `a_${i}_${qSlug}_${seg.kind === 'code' ? 'c' : 't'}${j}`;
        return { audioPath: cachedPath(config.tempDir, prefix, audioCacheKey(ttsText, voice), 'wav'), ttsText, voice };
      });

      // Final concatenated WAV keyed by all part hashes + both voices.
      const partKey = parts.map(p => sha(`${p.ttsText}:${p.voice}`)).join('|');
      const finalAudioPath = cachedPath(config.tempDir, `a_${i}_${qSlug}`, `md-audio:${partKey}`, 'wav');

      aPlan = {
        cardIndex: i, isQuestion: false, rawText: card.answer,
        delay: config.answerDelay,
        finalAudioPath,
        parts,
        isMultiPart: true,
      };
    }

    return [qPlan, aPlan];
  });

  // Partition parts by voice for pool scheduling.
  const mainParts = audioPlans.flatMap(p => p.parts.filter(pt => pt.voice === config.voice));
  const codeParts = audioPlans.flatMap(p => p.parts.filter(pt => pt.voice !== config.voice));

  const uncachedMain = mainParts.filter(pt => !isCached(pt.audioPath, force));
  const uncachedCode = codeParts.filter(pt => !isCached(pt.audioPath, force));

  if (skipTTS) {
    const missing = [...uncachedMain, ...uncachedCode].map(pt => pt.audioPath);
    if (missing.length > 0) {
      throw new Error(
        `update requires pre-existing audio for all segments. Missing ${missing.length} file(s).\n` +
        `  Run "qa-video generate" first to synthesize audio.`,
      );
    }
    console.log(`  Skipping TTS synthesis (all segments cached)`);
  }

  // ── Phase 2A: Main voice pool ──
  if (!skipTTS && uncachedMain.length > 0) {
    const pool = new TTSPool();
    const cpuCount = cpus().length;
    console.log(`  Workers: ${pool.size} / ${cpuCount} CPUs — voice: ${config.voice}`);
    process.stdout.write(`  Loading TTS model...`);
    const loadStart = Date.now();
    await pool.init(config.voice);
    console.log(` done (${elapsed(loadStart)}s)`);

    let done = 0;
    await Promise.all(uncachedMain.map(async pt => {
      await pool.synthesize(pt.ttsText, pt.audioPath);
      process.stdout.write(`\r  Synthesizing (main): ${++done}/${uncachedMain.length}`);
    }));
    if (uncachedMain.length > 0) console.log();
    await pool.terminate();
  }

  // ── Phase 2B: Code voice pool (only if a different voice is configured) ──
  if (!skipTTS && uncachedCode.length > 0) {
    const pool = new TTSPool(1); // single worker — code blocks are short
    console.log(`  Code voice: ${config.codeVoice} (${uncachedCode.length} segment(s))`);
    process.stdout.write(`  Loading code TTS model...`);
    const loadStart = Date.now();
    await pool.init(config.codeVoice);
    console.log(` done (${elapsed(loadStart)}s)`);

    let done = 0;
    await Promise.all(uncachedCode.map(async pt => {
      await pool.synthesize(pt.ttsText, pt.audioPath);
      process.stdout.write(`\r  Synthesizing (code): ${++done}/${uncachedCode.length}`);
    }));
    if (uncachedCode.length > 0) console.log();
    await pool.terminate();
  }

  // ── Phase 2C: Concatenate multi-part answer WAVs ──
  for (const plan of audioPlans) {
    if (plan.isMultiPart && !isCached(plan.finalAudioPath, force)) {
      await concatenateAudioFiles(plan.parts.map(p => p.audioPath), plan.finalAudioPath);
    }
  }

  // ── Phase 2D: Build Segment list with durations ──
  const segments: Segment[] = [];
  let totalAudioDuration = 0;
  let cachedAudioCount = 0;

  for (const plan of audioPlans) {
    // Count as "cached" if no part required synthesis
    const wasCached = plan.parts.every(pt => isCached(pt.audioPath, false));
    if (wasCached) cachedAudioCount++;
    const duration = await getAudioDuration(plan.finalAudioPath);
    totalAudioDuration += duration;
    segments.push({
      type: plan.isQuestion ? 'question' : 'answer',
      text: plan.rawText,
      cardIndex: plan.cardIndex,
      totalCards: cards.length,
      questionSlug: slug(cards[plan.cardIndex].question),
      audioPath: plan.finalAudioPath,
      imagePath: '',
      audioDuration: duration,
      totalDuration: duration + plan.delay,
    });
  }

  // Clean up stale single-part audio files for changed cards.
  await Promise.all(
    audioPlans.map(async plan => {
      if (!plan.isMultiPart) {
        const prefix = plan.isQuestion ? `q_${plan.cardIndex}` : `a_${plan.cardIndex}`;
        await removeStale(config.tempDir, prefix, 'wav', plan.finalAudioPath);
      }
    }),
  );

  console.log(`  Total audio: ${formatDuration(totalAudioDuration)} (${cachedAudioCount}/${audioPlans.length} cached)`);
  console.log(`  Stage 2 done (${elapsed(stage2Start)}s)`);

  // ── Stage 3: Render slides (parallel) ──
  const stage3Start = Date.now();
  console.log('\n── Stage 3/4: Rendering slides ──');

  const gapSlideHash = `slide:gap:${config.backgroundColor}:${config.fontSize}:${cards.length}`;
  const gapSlidePath = cachedPath(config.tempDir, 'slide_gap', gapSlideHash, 'png');

  // Slide cache keys include :v2 to invalidate pre-markdown cached slides.
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const slideHash = `slide:v3:${seg.text}:${seg.type}:${seg.cardIndex}:${seg.totalCards}:${config.fontSize}:${config.questionColor}:${config.answerColor}:${config.textColor}`;
    const slideTypeTag = seg.type === 'question' ? 'q' : 'a';
    seg.imagePath = cachedPath(config.tempDir, `slide_${i}_${slideTypeTag}_${seg.questionSlug}`, slideHash, 'png');
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

  type ClipDesc =
    | { kind: 'segment'; path: string; seg: Segment }
    | { kind: 'gap'; path: string };

  const clipDescs: ClipDesc[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    // Use the actual audio path in the clip hash so changes in TTS or code voice
    // correctly invalidate the clip cache.
    const clipTypeTag = seg.type === 'question' ? 'q' : 'a';
    const clipHash = `clip:v2:${sha(seg.audioPath)}:${sha(seg.imagePath)}:${seg.totalDuration}`;
    clipDescs.push({ kind: 'segment', seg, path: cachedPath(config.tempDir, `clip_${i}_${clipTypeTag}_${seg.questionSlug}`, clipHash, 'mp4') });

    if (seg.type === 'answer' && seg.cardIndex < seg.totalCards - 1 && config.cardGap > 0) {
      const gapHash = `gap:${sha(gapSlideHash)}:${config.cardGap}`;
      clipDescs.push({ kind: 'gap', path: cachedPath(config.tempDir, `gap_${i}_${seg.questionSlug}`, gapHash, 'mp4') });
    }
  }

  const uncachedClips = clipDescs.filter(d => !isCached(d.path, force));
  const cachedClipCount = clipDescs.length - uncachedClips.length;
  let encodedCount = 0;

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
  if (uncachedClips.length > 0) console.log();

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
