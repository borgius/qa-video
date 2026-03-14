import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { cpus } from 'node:os';
import { concatenateAudioFiles, concatenateClips, createMultiFrameClip, createSegmentClip, createSilentClip } from './assembler.js';
import { cachedPath, CLIP_CACHE_VERSION, isCached, removeStale, sha, SLIDE_CACHE_VERSION, slug } from './cache.js';
import { parseYamlFile } from './parser.js';
import { renderSlide } from './renderer.js';
import { parseSlidevDeck } from './slidev.js';
import { captureSlidevFrames } from './slidev-runtime.js';
import { TTSPool } from './tts-pool.js';
import { type AudioPlan, buildAudioPlan } from './tts-preprocess.js';
import { getAudioDuration } from './tts.js';
import { DEFAULT_CONFIG, type FrameSpan, type PipelineConfig, type Segment } from './types.js';

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

/** Pipeline-specific wrapper around the shared AudioPlan. */
interface PipelineAudioPlan extends AudioPlan {
  cardIndex: number;
  isQuestion: boolean;
  rawText: string;
  delay: number;
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
  const allCards = yamlData.questions;
  const rangeStart = config.cardRange?.[0] ?? 0;
  const rangeEnd = config.cardRange?.[1] ?? allCards.length;
  const cards = allCards.slice(rangeStart, rangeEnd);

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
  if (yamlConfig.questionVoice && config.questionVoice === DEFAULT_CONFIG.questionVoice) {
    config.questionVoice = yamlConfig.questionVoice;
  }
  if (yamlConfig.codeVoice && config.codeVoice === DEFAULT_CONFIG.codeVoice) {
    config.codeVoice = yamlConfig.codeVoice;
  }

  console.log(`  Cards: ${cards.length}`);
  console.log(`  Voices: answer=${config.voice}  question=${config.questionVoice}  code=${config.codeVoice}`);
  console.log(`  Delays: question=${config.questionDelay}s, answer=${config.answerDelay}s, gap=${config.cardGap}s`);
  if (force) console.log(`  Force: regenerating all artifacts`);
  console.log(`  Stage 1 done (${elapsed(stage1Start)}s)`);

  // ── Stage 2: Synthesize speech ──
  const stage2Start = Date.now();
  console.log('\n── Stage 2/4: Synthesizing speech ──');

  // Build one PipelineAudioPlan per question/answer slot using the shared builder.
  const audioPlans: PipelineAudioPlan[] = cards.flatMap((card, i) => {
    const qSlug = slug(card.question);
    const customAcronyms = yamlData.config.acronyms;

    const qPlan: PipelineAudioPlan = {
      ...buildAudioPlan(card.question, config.tempDir, `q_${i}_${qSlug}`, config.questionVoice, config.codeVoice, customAcronyms),
      cardIndex: i, isQuestion: true, rawText: card.question,
      delay: config.questionDelay,
    };

    const aPlan: PipelineAudioPlan = {
      ...buildAudioPlan(card.answer, config.tempDir, `a_${i}_${qSlug}`, config.voice, config.codeVoice, customAcronyms),
      cardIndex: i, isQuestion: false, rawText: card.answer,
      delay: config.answerDelay,
    };

    return [qPlan, aPlan];
  });

  // Partition parts by voice for pool scheduling.
  const allParts = audioPlans.flatMap(p => p.parts);
  const voiceGroups = new Map<string, typeof allParts>();
  for (const pt of allParts) {
    const group = voiceGroups.get(pt.voice);
    if (group) group.push(pt);
    else voiceGroups.set(pt.voice, [pt]);
  }

  const allUncached = allParts.filter(pt => !isCached(pt.audioPath, force));

  if (skipTTS) {
    if (allUncached.length > 0) {
      throw new Error(
        `update requires pre-existing audio for all segments. Missing ${allUncached.length} file(s).\n` +
        `  Run "qa-video generate" first to synthesize audio.`,
      );
    }
    console.log(`  Skipping TTS synthesis (all segments cached)`);
  }

  // Synthesize each voice group with its own worker pool.
  if (!skipTTS) {
    for (const [voice, parts] of voiceGroups) {
      const uncached = parts.filter(pt => !isCached(pt.audioPath, force));
      if (uncached.length === 0) continue;

      const pool = new TTSPool();
      console.log(`  Voice: ${voice} — workers: ${pool.size} (${uncached.length} segment(s))`);
      process.stdout.write(`  Loading TTS model...`);
      const loadStart = Date.now();
      await pool.init(voice);
      console.log(` done (${elapsed(loadStart)}s)`);

      let done = 0;
      const synthStart = Date.now();
      const taskDurations: number[] = [];
      await Promise.all(uncached.map(async pt => {
        const t0 = Date.now();
        await pool.synthesize(pt.ttsText, pt.audioPath);
        taskDurations.push(Date.now() - t0);
        done++;
        const avgMs = taskDurations.reduce((a, b) => a + b, 0) / taskDurations.length;
        const remaining = uncached.length - done;
        const etaStr = remaining > 0 ? ` | ~${formatDuration(Math.round(avgMs * remaining / 1000))} left` : '';
        process.stdout.write(`\r  Synthesizing (${voice}): ${done}/${uncached.length}${etaStr}`);
      }));
      void synthStart; // used implicitly via elapsed reporting above
      console.log();
      await pool.terminate();
    }
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

  const gapSlideHash = `slide:gap:${config.backgroundColor}:${config.fontSize}:${cards.length}:${config.width}x${config.height}`;
  const gapSlidePath = cachedPath(config.tempDir, 'slide_gap', gapSlideHash, 'png');

  // Slide cache keys include :v2 to invalidate pre-markdown cached slides.
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const qTextForHash = seg.type === 'answer' ? cards[seg.cardIndex].question : '';
    const slideHash = `slide:${SLIDE_CACHE_VERSION}:${seg.text}:${seg.type}:${seg.cardIndex}:${seg.totalCards}:${config.fontSize}:${config.questionColor}:${config.answerColor}:${config.textColor}:${qTextForHash}:${config.width}x${config.height}`;
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
          questionText: seg.type === 'answer' ? cards[seg.cardIndex].question : undefined,
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
    const clipHash = `clip:${CLIP_CACHE_VERSION}:${sha(seg.audioPath)}:${sha(seg.imagePath)}:${seg.totalDuration}`;
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

// ── Shorts pipeline ───────────────────────────────────────────────────────────

/**
 * Split a YAML file into multiple short-form videos, grouping `questionsPerShort`
 * cards per output file.  Returns the paths of all generated short clips.
 *
 * Optimised: stages 1-3 (TTS + slides) run once for ALL cards in a shared
 * temp dir; only stage 4 (assembly/concat) runs per-short, reusing the cached
 * clips built in the shared pass.
 */
function toSlug(text: string, maxLen = 48): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/, '');
}

export async function runShortsPipeline(config: PipelineConfig): Promise<string[]> {
  const pipelineStart = Date.now();
  const { force } = config;

  mkdirSync(config.tempDir, { recursive: true });

  // ── Stage 1: Parse YAML (all cards) ──────────────────────────────────────
  const stage1Start = Date.now();
  console.log('\n── Stage 1/4: Parsing YAML ──');

  const yamlData = await parseYamlFile(config.inputPath);
  const allCards = yamlData.questions;
  const totalCards = allCards.length;
  const qps = config.questionsPerShort;
  const groups = Math.ceil(totalCards / qps);
  const numWidth = String(groups).length;

  // Apply YAML config overrides (same logic as runPipeline)
  const yamlConfig = yamlData.config;
  if (yamlConfig.questionDelay !== undefined && config.questionDelay === DEFAULT_CONFIG.questionDelay)
    config.questionDelay = yamlConfig.questionDelay;
  if (yamlConfig.answerDelay !== undefined && config.answerDelay === DEFAULT_CONFIG.answerDelay)
    config.answerDelay = yamlConfig.answerDelay;
  if (yamlConfig.voice && config.voice === DEFAULT_CONFIG.voice) config.voice = yamlConfig.voice;
  if (yamlConfig.questionVoice && config.questionVoice === DEFAULT_CONFIG.questionVoice)
    config.questionVoice = yamlConfig.questionVoice;
  if (yamlConfig.codeVoice && config.codeVoice === DEFAULT_CONFIG.codeVoice)
    config.codeVoice = yamlConfig.codeVoice;

  const inputName = basename(config.inputPath, '.yaml').replace(/\.yml$/, '');
  const shortsDir = join(dirname(config.outputPath), inputName);
  mkdirSync(shortsDir, { recursive: true });

  console.log(`  Cards:      ${totalCards}`);
  console.log(`  Voices: answer=${config.voice}  question=${config.questionVoice}  code=${config.codeVoice}`);
  console.log(`  Delays: question=${config.questionDelay}s, answer=${config.answerDelay}s, gap=${config.cardGap}s`);
  console.log(`  Shorts:     ${groups} (${qps} card(s) each)`);
  console.log(`  Dimensions: ${config.width}×${config.height}`);
  console.log(`  Output dir: ${shortsDir}`);
  console.log(`  Stage 1 done (${elapsed(stage1Start)}s)`);

  // ── Stage 2: Synthesise speech for ALL cards at once ─────────────────────
  const stage2Start = Date.now();
  console.log('\n── Stage 2/4: Synthesizing speech (all cards) ──');

  const audioPlans: PipelineAudioPlan[] = allCards.flatMap((card, i) => {
    const qSlug = slug(card.question);
    const customAcronyms = yamlData.config.acronyms;
    return [
      {
        ...buildAudioPlan(card.question, config.tempDir, `q_${i}_${qSlug}`, config.questionVoice, config.codeVoice, customAcronyms),
        cardIndex: i, isQuestion: true, rawText: card.question, delay: config.questionDelay,
      },
      {
        ...buildAudioPlan(card.answer, config.tempDir, `a_${i}_${qSlug}`, config.voice, config.codeVoice, customAcronyms),
        cardIndex: i, isQuestion: false, rawText: card.answer, delay: config.answerDelay,
      },
    ];
  });

  const allParts = audioPlans.flatMap(p => p.parts);
  const voiceGroups = new Map<string, typeof allParts>();
  for (const pt of allParts) {
    const g = voiceGroups.get(pt.voice);
    if (g) g.push(pt); else voiceGroups.set(pt.voice, [pt]);
  }

  for (const [voice, parts] of voiceGroups) {
    const uncached = parts.filter(pt => !isCached(pt.audioPath, force));
    if (uncached.length === 0) continue;
    const pool = new TTSPool();
    console.log(`  Voice: ${voice} — workers: ${pool.size} (${uncached.length} segment(s))`);
    process.stdout.write(`  Loading TTS model...`);
    const loadStart = Date.now();
    await pool.init(voice);
    console.log(` done (${elapsed(loadStart)}s)`);
    let done = 0;
    await Promise.all(uncached.map(async pt => {
      await pool.synthesize(pt.ttsText, pt.audioPath);
      process.stdout.write(`\r  Synthesizing (${voice}): ${++done}/${uncached.length}`);
    }));
    console.log();
    await pool.terminate();
  }

  for (const plan of audioPlans) {
    if (plan.isMultiPart && !isCached(plan.finalAudioPath, force))
      await concatenateAudioFiles(plan.parts.map(p => p.audioPath), plan.finalAudioPath);
  }

  // Build segment list with durations
  const allSegments: Segment[] = [];
  let totalAudioDuration = 0;
  let cachedAudioCount = 0;
  for (const plan of audioPlans) {
    const wasCached = plan.parts.every(pt => isCached(pt.audioPath, false));
    if (wasCached) cachedAudioCount++;
    const duration = await getAudioDuration(plan.finalAudioPath);
    totalAudioDuration += duration;
    allSegments.push({
      type: plan.isQuestion ? 'question' : 'answer',
      text: plan.rawText,
      cardIndex: plan.cardIndex,
      totalCards,
      questionSlug: slug(allCards[plan.cardIndex].question),
      audioPath: plan.finalAudioPath,
      imagePath: '',
      audioDuration: duration,
      totalDuration: duration + plan.delay,
    });
  }

  await Promise.all(audioPlans.map(async plan => {
    if (!plan.isMultiPart) {
      const prefix = plan.isQuestion ? `q_${plan.cardIndex}` : `a_${plan.cardIndex}`;
      await removeStale(config.tempDir, prefix, 'wav', plan.finalAudioPath);
    }
  }));

  console.log(`  Total audio: ${formatDuration(totalAudioDuration)} (${cachedAudioCount}/${audioPlans.length} cached)`);
  console.log(`  Stage 2 done (${elapsed(stage2Start)}s)`);

  // ── Stage 3: Render slides for ALL cards at once (parallel) ──────────────
  const stage3Start = Date.now();
  console.log('\n── Stage 3/4: Rendering slides (all cards) ──');

  const gapSlideHash = `slide:gap:${config.backgroundColor}:${config.fontSize}:${totalCards}:${config.width}x${config.height}`;
  const gapSlidePath = cachedPath(config.tempDir, 'slide_gap', gapSlideHash, 'png');

  for (let i = 0; i < allSegments.length; i++) {
    const seg = allSegments[i];
    const qTextForHash = seg.type === 'answer' ? allCards[seg.cardIndex].question : '';
    const slideHash = `slide:${SLIDE_CACHE_VERSION}:${seg.text}:${seg.type}:${seg.cardIndex}:${seg.totalCards}:${config.fontSize}:${config.questionColor}:${config.answerColor}:${config.textColor}:${qTextForHash}:${config.width}x${config.height}`;
    const slideTypeTag = seg.type === 'question' ? 'q' : 'a';
    seg.imagePath = cachedPath(config.tempDir, `slide_${i}_${slideTypeTag}_${seg.questionSlug}`, slideHash, 'png');
  }

  let cachedSlideCount = 0;
  await Promise.all([
    ...allSegments.map(async seg => {
      if (isCached(seg.imagePath, force)) { cachedSlideCount++; }
      else {
        await renderSlide(seg.imagePath, {
          text: seg.text, type: seg.type, cardIndex: seg.cardIndex,
          totalCards, config,
          questionText: seg.type === 'answer' ? allCards[seg.cardIndex].question : undefined,
        });
      }
    }),
    (async () => {
      if (isCached(gapSlidePath, force)) { cachedSlideCount++; }
      else {
        await renderSlide(gapSlidePath, {
          text: '', type: 'question', cardIndex: 0, totalCards,
          config: { ...config, questionColor: config.backgroundColor },
        });
      }
    })(),
  ]);

  console.log(`  Rendered ${allSegments.length + 1} slides (${cachedSlideCount} cached)`);
  console.log(`  Stage 3 done (${elapsed(stage3Start)}s)`);

  // ── Stage 4: Assemble each short (reusing shared clip cache) ─────────────
  const outputPaths: string[] = [];
  const clipConcurrency = Math.max(2, Math.floor(cpus().length * 0.5));

  for (let gi = 0; gi < groups; gi++) {
    const cardStart = gi * qps;
    const cardEnd = Math.min(cardStart + qps, totalCards);
    const shortNum = String(gi + 1).padStart(Math.max(numWidth, 2), '0');
    const questionSlug = toSlug(allCards[cardStart].question);
    const shortOutputPath = join(shortsDir, `${shortNum}-${questionSlug}.mp4`);

    // Per-short temp dir is only used for the concat list file
    const shortTempDir = join(config.tempDir, `short-${shortNum}`);
    mkdirSync(shortTempDir, { recursive: true });

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  SHORT ${gi + 1}/${groups}: cards ${cardStart + 1}–${cardEnd}`);
    console.log(`${'═'.repeat(60)}`);

    const stage4Start = Date.now();

    // Segments that belong to this short
    const segments = allSegments.filter(s => s.cardIndex >= cardStart && s.cardIndex < cardEnd);

    type ClipDesc = { kind: 'segment'; path: string; seg: Segment } | { kind: 'gap'; path: string };
    const clipDescs: ClipDesc[] = [];

    for (const seg of segments) {
      // Use global segment index (2*cardIndex for Q, 2*cardIndex+1 for A) so clips
      // are shared across all shorts and across full-video runs.
      const globalSegIdx = seg.cardIndex * 2 + (seg.type === 'answer' ? 1 : 0);
      const clipTypeTag = seg.type === 'question' ? 'q' : 'a';
      const clipHash = `clip:${CLIP_CACHE_VERSION}:${sha(seg.audioPath)}:${sha(seg.imagePath)}:${seg.totalDuration}`;
      clipDescs.push({
        kind: 'segment', seg,
        path: cachedPath(config.tempDir, `clip_${globalSegIdx}_${clipTypeTag}_${seg.questionSlug}`, clipHash, 'mp4'),
      });
      // Gap after every answer except the last card in THIS short
      if (seg.type === 'answer' && seg.cardIndex < cardEnd - 1 && config.cardGap > 0) {
        const gapHash = `gap:${sha(gapSlideHash)}:${config.cardGap}`;
        clipDescs.push({ kind: 'gap', path: cachedPath(config.tempDir, `gap_${seg.cardIndex}_${seg.questionSlug}`, gapHash, 'mp4') });
      }
    }

    const uncachedClips = clipDescs.filter(d => !isCached(d.path, force));
    const cachedClipCount = clipDescs.length - uncachedClips.length;
    let encodedCount = 0;

    console.log(`  Clips: ${clipDescs.length} total, ${uncachedClips.length} to encode (${clipConcurrency} concurrent)`);
    await runConcurrent(
      clipDescs.map(desc => async () => {
        if (isCached(desc.path, force)) return;
        if (desc.kind === 'segment') await createSegmentClip(desc.seg, desc.path);
        else await createSilentClip(gapSlidePath, config.cardGap, desc.path);
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
    await concatenateClips(clipPaths, shortOutputPath, shortTempDir, clipDurations, (current, total) => {
      process.stdout.write(`\r  Concatenating: ${current}/${total}`);
    });
    console.log(`\r  Concatenating: ${clipPaths.length}/${clipPaths.length} done (${elapsed(concatStart)}s)`);
    console.log(`  Clips: ${cachedClipCount}/${clipDescs.length} cached`);
    console.log(`  Stage 4 done (${elapsed(stage4Start)}s)`);

    outputPaths.push(shortOutputPath);
  }

  const totalTime = ((Date.now() - pipelineStart) / 1000).toFixed(1);
  console.log(`\n══ Shorts Complete: ${groups} video(s) in ${totalTime}s ══`);
  console.log(`  Output dir: ${shortsDir}`);

  return outputPaths;
}

// ── Slidev pipeline ───────────────────────────────────────────────────────────

/**
 * Generate a narrated MP4 from a Slidev .md deck.
 * Stages:
 *   1. Parse deck  → SlidevSlide array with notes + narration segments
 *   2. Export PNG frames via `slidev export --with-clicks`
 *   3. TTS synthesis for every narration segment
 *   4. Assemble per-slide multi-frame clips → concat final video
 */
export async function runSlidevPipeline(config: PipelineConfig): Promise<void> {
  const pipelineStart = Date.now();
  const { force } = config;

  if (!existsSync(config.tempDir)) mkdirSync(config.tempDir, { recursive: true });

  // ── Stage 1: Parse Slidev deck ──
  const stage1Start = Date.now();
  console.log('\n── Stage 1/4: Parsing Slidev deck ──');
  const deck = await parseSlidevDeck(config.inputPath);
  const deckContent = await readFile(config.inputPath, 'utf-8');
  const deckHash = sha(deckContent);
  console.log(`  Title:  ${deck.title}`);
  console.log(`  Slides: ${deck.slides.length}`);
  console.log(`  Stage 1 done (${elapsed(stage1Start)}s)`);

  // ── Stage 2: Capture visual frames ──
  const stage2Start = Date.now();
  console.log('\n── Stage 2/4: Capturing Slidev frames ──');
  const slideFramesList = await captureSlidevFrames(
    config.inputPath, deck.slides.length, deckHash, config.tempDir, force,
  );
  const totalFrameCount = slideFramesList.reduce((sum, sf) => sum + sf.frames.length, 0);
  console.log(`  Captured ${totalFrameCount} frame(s) across ${deck.slides.length} slide(s)`);
  console.log(`  Stage 2 done (${elapsed(stage2Start)}s)`);

  // ── Stage 3: TTS synthesis ──
  const stage3Start = Date.now();
  console.log('\n── Stage 3/4: Synthesizing speech ──');

  // One TTS part per narration segment per slide.
  interface SlidevTTSPart {
    slideIdx: number;
    frameIndex: number;
    audioPath: string;
    ttsText: string;
  }
  const ttsParts: SlidevTTSPart[] = deck.slides.flatMap(slide =>
    slide.narrationSegments.map(seg => {
      const prefix = `sl_${slide.index}_seg_${seg.frameIndex}`;
      const audioPath = cachedPath(config.tempDir, prefix, sha(`${seg.text}:${config.voice}`), 'wav');
      return { slideIdx: slide.index, frameIndex: seg.frameIndex, audioPath, ttsText: seg.text };
    }),
  );

  const uncachedParts = ttsParts.filter(p => !isCached(p.audioPath, force));
  if (uncachedParts.length > 0) {
    const pool = new TTSPool();
    console.log(`  Voice: ${config.voice} — workers: ${pool.size} (${uncachedParts.length} part(s))`);
    process.stdout.write(`  Loading TTS model...`);
    const loadStart = Date.now();
    await pool.init(config.voice);
    console.log(` done (${elapsed(loadStart)}s)`);
    let done = 0;
    await Promise.all(uncachedParts.map(async p => {
      await pool.synthesize(p.ttsText, p.audioPath);
      process.stdout.write(`\r  Synthesizing: ${++done}/${uncachedParts.length}`);
    }));
    console.log();
    await pool.terminate();
  } else {
    console.log('  All audio cached');
  }
  console.log(`  Stage 3 done (${elapsed(stage3Start)}s)`);

  // ── Stage 4: Assemble clips ──
  const stage4Start = Date.now();
  console.log('\n── Stage 4/4: Assembling video ──');

  const HOLD = config.answerDelay; // post-speech hold added to the last frame

  interface SlideClipDesc {
    path: string;
    frames: FrameSpan[];
    audioPath: string;
    totalDuration: number;
  }

  const slideClipDescs: SlideClipDesc[] = [];

  for (const slide of deck.slides) {
    const sf = slideFramesList[slide.index];
    if (!sf || sf.frames.length === 0) continue;

    const parts = ttsParts.filter(p => p.slideIdx === slide.index);
    if (parts.length === 0) continue;

    let combinedAudioPath: string;
    let frameSpans: FrameSpan[];
    let totalDuration: number;

    if (parts.length === 1) {
      // Single narration chunk → spread visual frames evenly during speech.
      const audioDuration = await getAudioDuration(parts[0].audioPath);
      totalDuration = audioDuration + HOLD;
      combinedAudioPath = parts[0].audioPath;
      const perFrame = audioDuration / sf.frames.length;
      frameSpans = sf.frames.map((f, i) => ({
        imagePath: f,
        durationSec: i < sf.frames.length - 1 ? perFrame : perFrame + HOLD,
      }));
    } else {
      // Multiple segments with [click] markers → each shows its target frame.
      const durations = await Promise.all(parts.map(p => getAudioDuration(p.audioPath)));
      totalDuration = durations.reduce((a, b) => a + b, 0) + HOLD;

      // Concatenate segment audio files into one track.
      const combHash = sha(parts.map(p => p.audioPath).join(':'));
      combinedAudioPath = cachedPath(config.tempDir, `sl_${slide.index}_audio`, combHash, 'wav');
      if (!isCached(combinedAudioPath, force)) {
        await concatenateAudioFiles(parts.map(p => p.audioPath), combinedAudioPath);
      }

      // Sum durations per target frame (clips may exceed frame count → cap to last frame).
      const frameDurations = new Array<number>(sf.frames.length).fill(0);
      for (let j = 0; j < parts.length; j++) {
        const fi = Math.min(parts[j].frameIndex, sf.frames.length - 1);
        frameDurations[fi] += durations[j];
      }
      frameSpans = sf.frames.map((f, i) => ({
        imagePath: f,
        durationSec: frameDurations[i] + (i === sf.frames.length - 1 ? HOLD : 0),
      }));
    }

    const clipHash = sha(
      `slideclip:v1:${slide.index}:${combinedAudioPath}:` +
      frameSpans.map(fs => `${fs.imagePath}:${fs.durationSec.toFixed(3)}`).join(','),
    );
    const clipPath = cachedPath(config.tempDir, `slideclip_${slide.index}`, clipHash, 'mp4');
    slideClipDescs.push({ path: clipPath, frames: frameSpans, audioPath: combinedAudioPath, totalDuration });
  }

  // Encode uncached clips.
  const uncachedClips = slideClipDescs.filter(d => !isCached(d.path, force));
  let encodedCount = 0;
  const clipConcurrency = Math.max(2, Math.floor(cpus().length * 0.5));
  console.log(`  Clips: ${slideClipDescs.length} total, ${uncachedClips.length} to encode (${clipConcurrency} concurrent)`);

  await runConcurrent(
    slideClipDescs.map(desc => async () => {
      if (isCached(desc.path, force)) return;
      await createMultiFrameClip(desc.frames, desc.audioPath, desc.totalDuration, desc.path);
      encodedCount++;
      process.stdout.write(`\r  Encoding: ${encodedCount}/${uncachedClips.length}`);
    }),
    clipConcurrency,
  );
  if (uncachedClips.length > 0) console.log();

  // Interleave slide clips with gap clips.
  const finalClipPaths: string[] = [];
  const finalClipDurations: number[] = [];
  for (let i = 0; i < slideClipDescs.length; i++) {
    finalClipPaths.push(slideClipDescs[i].path);
    finalClipDurations.push(slideClipDescs[i].totalDuration);

    if (i < slideClipDescs.length - 1 && config.cardGap > 0) {
      const lastFrame = slideClipDescs[i].frames[slideClipDescs[i].frames.length - 1].imagePath;
      const gapHash = sha(`slidegap:${lastFrame}:${config.cardGap}`);
      const gapPath = cachedPath(config.tempDir, `slidegap_${i}`, gapHash, 'mp4');
      if (!isCached(gapPath, force)) {
        await createSilentClip(lastFrame, config.cardGap, gapPath);
      }
      finalClipPaths.push(gapPath);
      finalClipDurations.push(config.cardGap);
    }
  }

  process.stdout.write(`  Concatenating: 0/${finalClipPaths.length}`);
  const concatStart = Date.now();
  await concatenateClips(
    finalClipPaths, config.outputPath, config.tempDir, finalClipDurations,
    (current, total) => { process.stdout.write(`\r  Concatenating: ${current}/${total}`); },
  );
  console.log(`\r  Concatenating: ${finalClipPaths.length}/${finalClipPaths.length} done (${elapsed(concatStart)}s)`);
  console.log(`  Stage 4 done (${elapsed(stage4Start)}s)`);

  const totalVideoDuration = finalClipDurations.reduce((a, b) => a + b, 0);
  console.log(`\n══ Slidev Pipeline Complete ══`);
  console.log(`  Output:   ${config.outputPath}`);
  console.log(`  Duration: ~${formatDuration(totalVideoDuration)}`);
  console.log(`  Slides:   ${deck.slides.length}`);
  console.log(`  Time:     ${elapsed(pipelineStart)}s`);
}

