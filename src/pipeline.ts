import { mkdirSync, existsSync } from 'fs';
import { parseYamlFile } from './parser.js';
import { initTTS, synthesize, getAudioDuration } from './tts.js';
import { renderSlide } from './renderer.js';
import { createSegmentClip, createSilentClip, concatenateClips } from './assembler.js';
import { Segment, PipelineConfig, DEFAULT_CONFIG } from './types.js';
import { sha, cachedPath, isCached } from './cache.js';

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
  const { force } = config;

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

  // ── Stage 2: Synthesize speech ──
  const stage2Start = Date.now();
  console.log('\n── Stage 2/4: Synthesizing speech ──');

  let ttsInitialized = false;
  const segments: Segment[] = [];
  let totalAudioDuration = 0;
  let cachedAudioCount = 0;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const progress = `[${i + 1}/${cards.length}]`;

    // Question audio — SHA keyed on text + voice
    const qAudioHash = `audio:${card.question}:${config.voice}`;
    const qAudioPath = cachedPath(config.tempDir, `q_${i}`, qAudioHash, 'wav');

    if (isCached(qAudioPath, force)) {
      const qDuration = await getAudioDuration(qAudioPath);
      totalAudioDuration += qDuration;
      console.log(`  ${progress} Q: "${card.question.substring(0, 50)}..." (cached, ${qDuration.toFixed(1)}s)`);
      cachedAudioCount++;
      segments.push({
        type: 'question', text: card.question, cardIndex: i, totalCards: cards.length,
        audioPath: qAudioPath, imagePath: '', audioDuration: qDuration,
        totalDuration: qDuration + config.questionDelay,
      });
    } else {
      if (!ttsInitialized) { await initTTS(config.voice); ttsInitialized = true; }
      const qStart = Date.now();
      process.stdout.write(`  ${progress} Q: "${card.question.substring(0, 50)}..." `);
      await synthesize(card.question, qAudioPath, config.voice);
      const qDuration = await getAudioDuration(qAudioPath);
      totalAudioDuration += qDuration;
      console.log(`(${qDuration.toFixed(1)}s audio, ${elapsed(qStart)}s)`);
      segments.push({
        type: 'question', text: card.question, cardIndex: i, totalCards: cards.length,
        audioPath: qAudioPath, imagePath: '', audioDuration: qDuration,
        totalDuration: qDuration + config.questionDelay,
      });
    }

    // Answer audio
    const aAudioHash = `audio:${card.answer}:${config.voice}`;
    const aAudioPath = cachedPath(config.tempDir, `a_${i}`, aAudioHash, 'wav');

    if (isCached(aAudioPath, force)) {
      const aDuration = await getAudioDuration(aAudioPath);
      totalAudioDuration += aDuration;
      console.log(`  ${progress} A: "${card.answer.substring(0, 50)}..." (cached, ${aDuration.toFixed(1)}s)`);
      cachedAudioCount++;
      segments.push({
        type: 'answer', text: card.answer, cardIndex: i, totalCards: cards.length,
        audioPath: aAudioPath, imagePath: '', audioDuration: aDuration,
        totalDuration: aDuration + config.answerDelay,
      });
    } else {
      if (!ttsInitialized) { await initTTS(config.voice); ttsInitialized = true; }
      const aStart = Date.now();
      process.stdout.write(`  ${progress} A: "${card.answer.substring(0, 50)}..." `);
      await synthesize(card.answer, aAudioPath, config.voice);
      const aDuration = await getAudioDuration(aAudioPath);
      totalAudioDuration += aDuration;
      console.log(`(${aDuration.toFixed(1)}s audio, ${elapsed(aStart)}s)`);
      segments.push({
        type: 'answer', text: card.answer, cardIndex: i, totalCards: cards.length,
        audioPath: aAudioPath, imagePath: '', audioDuration: aDuration,
        totalDuration: aDuration + config.answerDelay,
      });
    }
  }

  console.log(`  Total audio: ${formatDuration(totalAudioDuration)} (${cachedAudioCount}/${segments.length} cached)`);
  console.log(`  Stage 2 done (${elapsed(stage2Start)}s)`);

  // ── Stage 3: Render slides ──
  const stage3Start = Date.now();
  console.log('\n── Stage 3/4: Rendering slides ──');
  let cachedSlideCount = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const slideHash = `slide:${seg.text}:${seg.type}:${seg.cardIndex}:${seg.totalCards}:${config.fontSize}:${config.questionColor}:${config.answerColor}:${config.textColor}`;
    const imagePath = cachedPath(config.tempDir, `slide_${i}`, slideHash, 'png');
    seg.imagePath = imagePath;

    if (isCached(imagePath, force)) {
      cachedSlideCount++;
    } else {
      await renderSlide(imagePath, {
        text: seg.text, type: seg.type, cardIndex: seg.cardIndex,
        totalCards: seg.totalCards, config,
      });
    }
  }

  // Gap slide
  const gapSlideHash = `slide:gap:${config.backgroundColor}:${config.fontSize}:${cards.length}`;
  const gapSlidePath = cachedPath(config.tempDir, 'slide_gap', gapSlideHash, 'png');
  if (!isCached(gapSlidePath, force)) {
    await renderSlide(gapSlidePath, {
      text: '', type: 'question', cardIndex: 0, totalCards: cards.length,
      config: { ...config, questionColor: config.backgroundColor },
    });
  } else {
    cachedSlideCount++;
  }

  console.log(`  Rendered ${segments.length + 1} slides (${cachedSlideCount} cached)`);
  console.log(`  Stage 3 done (${elapsed(stage3Start)}s)`);

  // ── Stage 4: Assemble video ──
  const stage4Start = Date.now();
  console.log('\n── Stage 4/4: Assembling video ──');
  const clipPaths: string[] = [];
  const totalClips = segments.length + (cards.length - 1);
  let cachedClipCount = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    // Clip hash: based on audio hash + slide hash + timing
    const clipHash = `clip:${sha(`audio:${seg.text}:${config.voice}`)}:${sha(`slide:${seg.text}:${seg.type}:${seg.cardIndex}:${seg.totalCards}:${config.fontSize}:${config.questionColor}:${config.answerColor}:${config.textColor}`)}:${seg.totalDuration}`;
    const clipPath = cachedPath(config.tempDir, `clip_${i}`, clipHash, 'mp4');
    const clipNum = clipPaths.length + 1;

    if (isCached(clipPath, force)) {
      console.log(`  [${clipNum}/${totalClips}] ${seg.type} card ${seg.cardIndex + 1} (${seg.totalDuration.toFixed(1)}s) (cached)`);
      cachedClipCount++;
    } else {
      process.stdout.write(`  [${clipNum}/${totalClips}] ${seg.type} card ${seg.cardIndex + 1} (${seg.totalDuration.toFixed(1)}s)... `);
      const clipStart = Date.now();
      await createSegmentClip(seg, clipPath);
      console.log(`done (${elapsed(clipStart)}s)`);
    }
    clipPaths.push(clipPath);

    if (seg.type === 'answer' && seg.cardIndex < seg.totalCards - 1 && config.cardGap > 0) {
      const gapHash = `gap:${sha(gapSlideHash)}:${config.cardGap}`;
      const gapClipPath = cachedPath(config.tempDir, `gap_${i}`, gapHash, 'mp4');
      const gapNum = clipPaths.length + 1;

      if (isCached(gapClipPath, force)) {
        console.log(`  [${gapNum}/${totalClips}] gap (${config.cardGap}s) (cached)`);
        cachedClipCount++;
      } else {
        process.stdout.write(`  [${gapNum}/${totalClips}] gap (${config.cardGap}s)... `);
        const gapStart = Date.now();
        await createSilentClip(gapSlidePath, config.cardGap, gapClipPath);
        console.log(`done (${elapsed(gapStart)}s)`);
      }
      clipPaths.push(gapClipPath);
    }
  }

  process.stdout.write(`  Concatenating ${clipPaths.length} clips... `);
  const concatStart = Date.now();
  await concatenateClips(clipPaths, config.outputPath, config.tempDir);
  console.log(`done (${elapsed(concatStart)}s)`);
  console.log(`  Clips: ${cachedClipCount}/${totalClips} cached`);
  console.log(`  Stage 4 done (${elapsed(stage4Start)}s)`);

  // ── Summary ──
  const estimatedVideoDuration = segments.reduce((sum, s) => sum + s.totalDuration, 0) + (cards.length - 1) * config.cardGap;
  console.log(`\n══ Complete ══`);
  console.log(`  Output:   ${config.outputPath}`);
  console.log(`  Duration: ~${formatDuration(estimatedVideoDuration)}`);
  console.log(`  Cards:    ${cards.length}`);
  console.log(`  Time:     ${elapsed(pipelineStart)}s`);
}
