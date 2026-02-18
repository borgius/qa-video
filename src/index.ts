#!/usr/bin/env node

import { Command } from 'commander';
import { resolve, basename, dirname, join } from 'path';
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { readFile, rm, writeFile } from 'fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { createRequire } from 'module';
import { createInterface } from 'readline';
import { runPipeline } from './pipeline.js';
import { PipelineConfig, DEFAULT_CONFIG } from './types.js';
import { ensureDeps } from './ffmpeg-paths.js';
import { parseYamlFile } from './parser.js';
import { generateTitle, generateDescription } from './metadata.js';
import { runAuthFlow, getAuthenticatedClient } from './youtube-auth.js';
import { uploadToYouTube, findVideoByShaTag, ensureVideoHasShaTag } from './uploader.js';
import { sha } from './cache.js';
import { getDriver, listDrivers, driverNames } from './importers/index.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const program = new Command();

program
  .name('qa-video')
  .description('Generate flashcard videos from YAML Q&A files with TTS narration.\n\nImport flashcards from Anki, Brainscape, RemNote, Knowt, Gizmo, or Mochi,\nthen generate YouTube-ready videos with offline neural TTS narration.')
  .version(pkg.version);

function buildConfig(inputPath: string, opts: any): PipelineConfig {
  const inputName = basename(inputPath, '.yaml').replace(/\.yml$/, '');
  const outputPath = opts.output
    ? resolve(opts.output)
    : join(dirname(inputPath), '..', 'output', `${inputName}.mp4`);

  const outputDir = dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });

  const tempDir = opts.tempDir
    ? resolve(opts.tempDir)
    : join(dirname(outputPath), '.tmp', inputName);
  mkdirSync(tempDir, { recursive: true });

  return {
    inputPath,
    outputPath,
    tempDir,
    voice: opts.voice,
    codeVoice: opts.codeVoice ?? DEFAULT_CONFIG.codeVoice,
    questionDelay: parseFloat(opts.questionDelay),
    answerDelay: parseFloat(opts.answerDelay),
    cardGap: parseFloat(opts.cardGap),
    fontSize: parseInt(opts.fontSize, 10),
    backgroundColor: DEFAULT_CONFIG.backgroundColor,
    questionColor: DEFAULT_CONFIG.questionColor,
    answerColor: DEFAULT_CONFIG.answerColor,
    textColor: DEFAULT_CONFIG.textColor,
    width: DEFAULT_CONFIG.width,
    height: DEFAULT_CONFIG.height,
    force: opts.force ?? false,
  };
}

const sharedOptions = (cmd: Command) =>
  cmd
    .option('--voice <name>', `TTS voice name for prose text`, DEFAULT_CONFIG.voice)
    .option('--code-voice <name>', `TTS voice name for code blocks (default: ${DEFAULT_CONFIG.codeVoice})`)
    .option('--question-delay <seconds>', 'Pause after question speech', String(DEFAULT_CONFIG.questionDelay))
    .option('--answer-delay <seconds>', 'Pause after answer speech', String(DEFAULT_CONFIG.answerDelay))
    .option('--card-gap <seconds>', 'Gap between cards', String(DEFAULT_CONFIG.cardGap))
    .option('--font-size <px>', 'Font size for slide text', String(DEFAULT_CONFIG.fontSize))
    .option('--temp-dir <path>', 'Temporary directory for intermediate files', '')
    .option('--force', 'Regenerate all artifacts, ignoring cache', false);

// Single file
sharedOptions(
  program
    .command('generate')
    .description('Generate a video from a single YAML Q&A file')
    .requiredOption('-i, --input <path>', 'Path to YAML file')
    .option('-o, --output <path>', 'Output video file path')
).action(async (opts) => {
  try {
    const inputPath = resolve(opts.input);
    if (!existsSync(inputPath)) {
      console.error(`Error: Input file not found: ${inputPath}`);
      process.exit(1);
    }

    const config = buildConfig(inputPath, opts);

    console.log(`\n╔══════════════════════════════════╗`);
    console.log(`║      QA Video Generator          ║`);
    console.log(`╚══════════════════════════════════╝`);
    console.log(`Input:  ${config.inputPath}`);
    console.log(`Output: ${config.outputPath}`);

    await runPipeline(config);
  } catch (err: any) {
    console.error(`\nError: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
});

// Update: re-render changed slides & reassemble (single file or whole directory)
sharedOptions(
  program
    .command('update')
    .description('Re-render changed slides and reassemble video(s), regenerating only what changed')
    .option('-i, --input <path>', 'Path to a single YAML file')
    .option('-d, --dir <path>', 'Directory of YAML files (updates all)')
    .option('-o, --output <path>', 'Output video path (single-file mode only)')
    .option('--output-dir <path>', 'Output directory (directory mode only)')
).action(async (opts) => {
  try {
    if (!opts.input && !opts.dir) {
      console.error('Error: Provide -i <file> or -d <dir>');
      process.exit(1);
    }

    // ── Single file ──
    if (opts.input) {
      const inputPath = resolve(opts.input);
      if (!existsSync(inputPath)) {
        console.error(`Error: Input file not found: ${inputPath}`);
        process.exit(1);
      }

      const config = buildConfig(inputPath, opts);

      console.log(`\n╔══════════════════════════════════╗`);
      console.log(`║      QA Video — Update           ║`);
      console.log(`╚══════════════════════════════════╝`);
      console.log(`Input:  ${config.inputPath}`);
      console.log(`Output: ${config.outputPath}`);

      await runPipeline(config);
      return;
    }

    // ── Directory ──
    const dirPath = resolve(opts.dir);
    if (!existsSync(dirPath)) {
      console.error(`Error: Directory not found: ${dirPath}`);
      process.exit(1);
    }

    const yamlFiles = readdirSync(dirPath)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();

    if (yamlFiles.length === 0) {
      console.error(`Error: No YAML files found in: ${dirPath}`);
      process.exit(1);
    }

    console.log(`\n╔══════════════════════════════════╗`);
    console.log(`║   QA Video — Update (Batch)      ║`);
    console.log(`╚══════════════════════════════════╝`);
    console.log(`Directory: ${dirPath}`);
    console.log(`Files:     ${yamlFiles.length}`);

    const batchStart = Date.now();
    const results: { file: string; status: string; time: string }[] = [];

    for (let fi = 0; fi < yamlFiles.length; fi++) {
      const file = yamlFiles[fi];
      const inputPath = join(dirPath, file);

      console.log(`\n${'═'.repeat(60)}`);
      console.log(`  FILE ${fi + 1}/${yamlFiles.length}: ${file}`);
      console.log(`${'═'.repeat(60)}`);

      const fileStart = Date.now();
      try {
        const fileOpts = {
          ...opts,
          output: opts.outputDir
            ? join(resolve(opts.outputDir), basename(file, '.yaml').replace(/\.yml$/, '') + '.mp4')
            : undefined,
        };
        const config = buildConfig(inputPath, fileOpts);
        console.log(`Output: ${config.outputPath}`);

        await runPipeline(config);

        const timeStr = ((Date.now() - fileStart) / 1000).toFixed(1) + 's';
        results.push({ file, status: 'OK', time: timeStr });
      } catch (err: any) {
        const timeStr = ((Date.now() - fileStart) / 1000).toFixed(1) + 's';
        results.push({ file, status: `FAILED: ${err.message}`, time: timeStr });
        console.error(`  Error processing ${file}: ${err.message}`);
      }
    }

    const totalTime = ((Date.now() - batchStart) / 1000).toFixed(1);
    const ok = results.filter(r => r.status === 'OK').length;
    const failed = results.length - ok;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  UPDATE SUMMARY`);
    console.log(`${'═'.repeat(60)}`);
    for (const r of results) {
      console.log(`  [${r.status === 'OK' ? 'OK  ' : 'FAIL'}] ${r.file} (${r.time})`);
    }
    console.log(`\n  Total: ${ok} updated, ${failed} failed, ${totalTime}s elapsed`);

    if (failed > 0) process.exit(1);
  } catch (err: any) {
    console.error(`\nError: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
});

// Batch: all files in a directory
sharedOptions(
  program
    .command('batch')
    .description('Generate videos for all YAML files in a directory')
    .requiredOption('-d, --dir <path>', 'Directory containing YAML files')
    .option('-o, --output-dir <path>', 'Output directory for videos')
).action(async (opts) => {
  try {
    const dirPath = resolve(opts.dir);
    if (!existsSync(dirPath)) {
      console.error(`Error: Directory not found: ${dirPath}`);
      process.exit(1);
    }

    const yamlFiles = readdirSync(dirPath)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();

    if (yamlFiles.length === 0) {
      console.error(`Error: No YAML files found in: ${dirPath}`);
      process.exit(1);
    }

    console.log(`\n╔══════════════════════════════════╗`);
    console.log(`║   QA Video Generator — Batch     ║`);
    console.log(`╚══════════════════════════════════╝`);
    console.log(`Directory: ${dirPath}`);
    console.log(`Files:     ${yamlFiles.length}`);
    console.log(`Files:     ${yamlFiles.join(', ')}`);

    const batchStart = Date.now();
    const results: { file: string; status: string; time: string }[] = [];

    for (let fi = 0; fi < yamlFiles.length; fi++) {
      const file = yamlFiles[fi];
      const inputPath = join(dirPath, file);

      console.log(`\n${'═'.repeat(60)}`);
      console.log(`  FILE ${fi + 1}/${yamlFiles.length}: ${file}`);
      console.log(`${'═'.repeat(60)}`);

      const fileStart = Date.now();
      try {
        const fileOpts = {
          ...opts,
          output: opts.outputDir
            ? join(resolve(opts.outputDir), basename(file, '.yaml').replace(/\.yml$/, '') + '.mp4')
            : undefined,
        };
        const config = buildConfig(inputPath, fileOpts);

        if (!opts.force && existsSync(config.outputPath)) {
          console.log(`Output: ${config.outputPath}`);
          console.log(`  Skipped (video already exists, use --force to regenerate)`);
          results.push({ file, status: 'SKIPPED', time: '0.0s' });
          continue;
        }

        console.log(`Output: ${config.outputPath}`);
        await runPipeline(config);

        const timeStr = ((Date.now() - fileStart) / 1000).toFixed(1) + 's';
        results.push({ file, status: 'OK', time: timeStr });
      } catch (err: any) {
        const timeStr = ((Date.now() - fileStart) / 1000).toFixed(1) + 's';
        results.push({ file, status: `FAILED: ${err.message}`, time: timeStr });
        console.error(`  Error processing ${file}: ${err.message}`);
      }
    }

    // Batch summary
    const totalTime = ((Date.now() - batchStart) / 1000).toFixed(1);
    const ok = results.filter(r => r.status === 'OK').length;
    const skipped = results.filter(r => r.status === 'SKIPPED').length;
    const failed = results.length - ok - skipped;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  BATCH SUMMARY`);
    console.log(`${'═'.repeat(60)}`);
    for (const r of results) {
      const icon = r.status === 'OK' ? 'OK' : r.status === 'SKIPPED' ? 'SKIP' : 'FAIL';
      console.log(`  [${icon}] ${r.file} (${r.time})`);
    }
    console.log(`\n  Total: ${ok} succeeded, ${skipped} skipped, ${failed} failed, ${totalTime}s elapsed`);

    if (failed > 0) process.exit(1);
  } catch (err: any) {
    console.error(`\nError: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
});

// Clear cached artifacts
program
  .command('clear')
  .description('Remove cached artifacts (temp files)')
  .option('-d, --dir <path>', 'YAML directory (clears all caches for that dir)')
  .option('-i, --input <path>', 'Single YAML file (clears cache for that file)')
  .option('--output-dir <path>', 'Output directory containing .tmp folder')
  .action(async (opts) => {
    try {
      const targets: string[] = [];

      if (opts.input) {
        const inputPath = resolve(opts.input);
        const inputName = basename(inputPath, '.yaml').replace(/\.yml$/, '');
        const tmpDir = opts.outputDir
          ? join(resolve(opts.outputDir), '.tmp', inputName)
          : join(dirname(inputPath), '..', 'output', '.tmp', inputName);
        targets.push(tmpDir);
      } else if (opts.dir) {
        const dirPath = resolve(opts.dir);
        const yamlFiles = readdirSync(dirPath).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        for (const file of yamlFiles) {
          const inputName = basename(file, '.yaml').replace(/\.yml$/, '');
          const tmpDir = opts.outputDir
            ? join(resolve(opts.outputDir), '.tmp', inputName)
            : join(dirname(join(dirPath, file)), '..', 'output', '.tmp', inputName);
          targets.push(tmpDir);
        }
      } else {
        // Default: clear all .tmp under output/
        const defaultTmp = join(process.cwd(), 'output', '.tmp');
        targets.push(defaultTmp);
      }

      let cleared = 0;
      for (const dir of targets) {
        if (existsSync(dir)) {
          await rm(dir, { recursive: true, force: true });
          console.log(`  Removed: ${dir}`);
          cleared++;
        }
      }

      if (cleared === 0) {
        console.log('  No cached artifacts found.');
      } else {
        console.log(`\n  Cleared ${cleared} cache(s).`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// YouTube auth (one-time setup)
program
  .command('auth')
  .description('Authenticate with YouTube (one-time setup)')
  .option('--credentials <path>', 'Path to client_secret.json (~/.qa-video/client_secret.json)')
  .action(async (opts) => {
    try {
      await runAuthFlow(opts.credentials);
    } catch (err: any) {
      console.error(`\nError: ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  });

// ── Upload helpers ──

/** Save youtube upload info back to the YAML file's config section */
async function saveYoutubeInfo(
  yamlPath: string,
  info: { videoId: string; url: string; privacy: string; contentSha?: string },
) {
  const raw = await readFile(yamlPath, 'utf-8');
  const doc = parseYaml(raw) ?? {};
  if (!doc.config) doc.config = {};
  doc.config.youtube = {
    videoId: info.videoId,
    url: info.url,
    uploadedAt: new Date().toISOString(),
    privacy: info.privacy,
    ...(info.contentSha && { contentSha: info.contentSha }),
  };
  await writeFile(
    yamlPath,
    stringifyYaml(doc, { lineWidth: 120, defaultKeyType: 'PLAIN', defaultStringType: 'PLAIN' }),
    'utf-8',
  );
}

/** Resolve a single input (video path, yaml path, or bare name) to { videoPath, yamlPath? } */
function resolveUploadTarget(input: string): { videoPath: string; yamlPath?: string } {
  let inputPath = resolve(input);

  if (inputPath.endsWith('.mp4')) {
    const videoPath = inputPath;
    const videoName = basename(inputPath, '.mp4');
    const yamlPath = [
      join(process.cwd(), 'qa', `${videoName}.yaml`),
      join(process.cwd(), 'qa', `${videoName}.yml`),
      join(dirname(inputPath), `${videoName}.yaml`),
      join(dirname(inputPath), `${videoName}.yml`),
    ].find(p => existsSync(p));
    if (!existsSync(videoPath)) {
      throw new Error(`Video not found: ${videoPath}`);
    }
    return { videoPath, yamlPath };
  }

  if (inputPath.endsWith('.yaml') || inputPath.endsWith('.yml')) {
    if (!existsSync(inputPath)) throw new Error(`Input file not found: ${inputPath}`);
    const inputName = basename(inputPath, '.yaml').replace(/\.yml$/, '');
    const videoPath = join(dirname(inputPath), '..', 'output', `${inputName}.mp4`);
    return { videoPath, yamlPath: inputPath };
  }

  // No extension — try yaml, yml, mp4
  if (existsSync(inputPath + '.yaml')) {
    return resolveUploadTarget(inputPath + '.yaml');
  }
  if (existsSync(inputPath + '.yml')) {
    return resolveUploadTarget(inputPath + '.yml');
  }
  if (existsSync(inputPath + '.mp4')) {
    return resolveUploadTarget(inputPath + '.mp4');
  }

  throw new Error(`Input file not found: ${inputPath}`);
}

/** Collect all .mp4 files from a directory */
function collectVideosFromDir(dirPath: string): string[] {
  return readdirSync(dirPath)
    .filter(f => f.endsWith('.mp4'))
    .sort()
    .map(f => join(dirPath, f));
}

/** Resolve metadata for a single video */
async function resolveMetadata(
  videoPath: string,
  yamlPath: string | undefined,
  opts: { title?: string; description?: string; tags: string },
) {
  let title: string;
  let description: string;
  let contentSha: string | undefined;
  if (yamlPath && existsSync(yamlPath)) {
    const yamlData = await parseYamlFile(yamlPath);
    title = opts.title ?? generateTitle(yamlPath, yamlData);
    description = opts.description ?? generateDescription(yamlPath, yamlData);
    contentSha = sha(yamlData.questions.map(q => q.question + q.answer).join('\n'));
  } else {
    const videoName = basename(videoPath, '.mp4');
    title = opts.title ?? videoName.replace(/[-_]/g, ' ');
    description = opts.description ?? '';
  }
  const tags = (opts.tags as string).split(',').map((t: string) => t.trim());
  return { title, description, tags, contentSha };
}

/** Prompt with pre-filled editable value */
function promptEditable(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValue: string,
): Promise<string> {
  return new Promise(res => {
    rl.question(`${label}: `, answer => res(answer || defaultValue));
    rl.write(defaultValue);
  });
}

// Upload to YouTube
program
  .command('upload')
  .description('Upload generated video(s) to YouTube')
  .option('-i, --input <path>', 'Video file, YAML file, or directory (default: output/)')
  .option('-v, --video <path>', 'Path to video file (default: output/<name>.mp4)')
  .option('--title <text>', 'Video title (default: auto-generated from YAML)')
  .option('--description <text>', 'Video description (default: auto-generated)')
  .option('--privacy <level>', 'Privacy: public, unlisted, private', 'unlisted')
  .option('--category <id>', 'YouTube category ID', '27')
  .option('--tags <csv>', 'Comma-separated tags', 'interview,qa,flashcards')
  .option('--credentials <path>', 'Path to client_secret.json')
  .option('--no-confirm', 'Skip interactive editing and confirmation prompts')
  .option('--force', 'Force re-upload even if already uploaded')
  .option('--dry-run', 'Preview metadata without uploading', false)
  .action(async (opts) => {
    try {
      // Determine list of videos to upload
      const inputArg = opts.input ?? 'output';
      const resolvedInput = resolve(inputArg);
      let targets: { videoPath: string; yamlPath?: string }[];

      if (existsSync(resolvedInput) && statSync(resolvedInput).isDirectory()) {
        const videos = collectVideosFromDir(resolvedInput);
        if (videos.length === 0) {
          console.error(`Error: No .mp4 files found in: ${resolvedInput}`);
          process.exit(1);
        }
        targets = videos.map(v => {
          const videoName = basename(v, '.mp4');
          const yamlPath = [
            join(process.cwd(), 'qa', `${videoName}.yaml`),
            join(process.cwd(), 'qa', `${videoName}.yml`),
          ].find(p => existsSync(p));
          return { videoPath: v, yamlPath };
        });
      } else {
        const target = opts.video
          ? { ...resolveUploadTarget(inputArg), videoPath: resolve(opts.video) }
          : resolveUploadTarget(inputArg);
        targets = [target];
      }

      const isBatch = targets.length > 1;
      if (isBatch) {
        console.log(`\n╔══════════════════════════════════╗`);
        console.log(`║   YouTube Upload — Batch         ║`);
        console.log(`╚══════════════════════════════════╝`);
        console.log(`Videos: ${targets.length}`);
      }

      let authClient: Awaited<ReturnType<typeof getAuthenticatedClient>> | undefined;
      const results: { file: string; status: string }[] = [];

      for (let i = 0; i < targets.length; i++) {
        const { videoPath, yamlPath } = targets[i];
        const label = basename(videoPath);

        if (isBatch) {
          console.log(`\n${'─'.repeat(50)}`);
          console.log(`  [${i + 1}/${targets.length}] ${label}`);
          console.log(`${'─'.repeat(50)}`);
        }

        if (!existsSync(videoPath)) {
          const msg = `Video not found: ${videoPath}`;
          if (isBatch) {
            console.error(`  ${msg} — skipped.`);
            results.push({ file: label, status: 'MISSING' });
            continue;
          }
          console.error(`Error: ${msg}`);
          console.error(`Run "qa-video generate -i ${inputArg}" first.`);
          process.exit(1);
        }

        let { title, description, tags, contentSha } = await resolveMetadata(videoPath, yamlPath, opts);
        const shaTag = contentSha ? `qavideo-${contentSha}` : undefined;

        // Append SHA tag to the tags list
        if (shaTag) tags.push(shaTag);

        console.log(`${isBatch ? '' : '\n╔══════════════════════════════════╗\n║     YouTube Upload               ║\n╚══════════════════════════════════╝\n'}Video:       ${videoPath}`);
        console.log(`Title:       ${title}`);
        console.log(`Privacy:     ${opts.privacy}`);
        console.log(`Tags:        ${tags.join(', ')}`);
        if (contentSha) console.log(`Content SHA: ${contentSha}`);
        console.log(`\nDescription:\n${description}`);

        if (opts.dryRun) {
          console.log(`\n  --dry-run: skipped.`);
          results.push({ file: label, status: 'DRY-RUN' });
          continue;
        }

        // Check YouTube for existing video with this SHA tag (skip unless --force)
        if (shaTag && !opts.force) {
          if (!authClient) {
            authClient = await getAuthenticatedClient(opts.credentials);
          }

          // Fast path: YAML already has a videoId — verify it on YouTube and patch tag if needed
          let alreadyExists = false;
          if (yamlPath && existsSync(yamlPath)) {
            const raw = await readFile(yamlPath, 'utf-8');
            const doc = parseYaml(raw);
            const knownId = doc?.config?.youtube?.videoId;
            if (knownId) {
              const tagStatus = await ensureVideoHasShaTag(authClient, knownId, shaTag);
              if (tagStatus === 'tagged') {
                console.log(`\n  Already on YouTube: https://youtu.be/${knownId}`);
                results.push({ file: label, status: 'EXISTS' });
                alreadyExists = true;
              } else if (tagStatus === 'added') {
                console.log(`\n  Already on YouTube: https://youtu.be/${knownId} (tag added)`);
                results.push({ file: label, status: 'EXISTS' });
                alreadyExists = true;
              }
              // 'not_found' — video was deleted from YouTube, proceed to re-upload
            }
          }
          if (alreadyExists) continue;

          // Slow path: search all user's videos by SHA tag
          const existing = await findVideoByShaTag(authClient, shaTag);
          if (existing) {
            console.log(`\n  Already on YouTube: ${existing.url}`);
            console.log(`  Use --force to re-upload.`);
            results.push({ file: label, status: 'EXISTS' });
            continue;
          }
        }

        if (opts.confirm) {
          const rl = createInterface({ input: process.stdin, output: process.stdout });

          console.log(`\n─── Confirm before upload ───`);
          title = await promptEditable(rl, 'Title', title);
          description = await promptEditable(rl, 'Description', description);

          const confirm = await new Promise<string>(res =>
            rl.question(`\nUpload "${title}"? (Y/n): `, res),
          );
          rl.close();

          if (confirm.toLowerCase() === 'n') {
            console.log(`\n  Skipped.\n`);
            results.push({ file: label, status: 'SKIPPED' });
            continue;
          }
        }

        if (!authClient) {
          authClient = await getAuthenticatedClient(opts.credentials);
        }

        const uploadResult = await uploadToYouTube(authClient, {
          videoPath,
          title,
          description,
          privacy: opts.privacy as 'public' | 'unlisted' | 'private',
          categoryId: opts.category,
          tags,
        });

        // Save upload info to YAML
        if (yamlPath && existsSync(yamlPath)) {
          await saveYoutubeInfo(yamlPath, {
            videoId: uploadResult.videoId,
            url: uploadResult.url,
            privacy: opts.privacy,
            contentSha,
          });
          console.log(`  Saved to: ${yamlPath}`);
        }

        results.push({ file: label, status: 'OK' });
      }

      // Batch summary
      if (isBatch) {
        const ok = results.filter(r => r.status === 'OK').length;
        const skipped = results.filter(r => r.status !== 'OK').length;
        console.log(`\n${'═'.repeat(50)}`);
        console.log(`  UPLOAD SUMMARY`);
        console.log(`${'═'.repeat(50)}`);
        for (const r of results) {
          console.log(`  [${r.status.padEnd(7)}] ${r.file}`);
        }
        console.log(`\n  ${ok} uploaded, ${skipped} skipped\n`);
      }
    } catch (err: any) {
      console.error(`\nError: ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  });

// Import from external formats
program
  .command('import')
  .description('Import Q&A from Anki, Brainscape, RemNote, Knowt, Gizmo, or Mochi into YAML')
  .requiredOption('-i, --input <path>', 'Source file (.apkg, .csv, .md, .tsv, .mochi)')
  .option('-o, --output <path>', 'Output YAML path (default: qa/<name>.yaml)')
  .option('--from <driver>', `Source format (${driverNames().join(', ')}); auto-detected from extension if omitted`)
  .option('--question-delay <seconds>', 'questionDelay in config', '2')
  .option('--answer-delay <seconds>', 'answerDelay in config', '3')
  .action(async (opts) => {
    try {
      const inputPath = resolve(opts.input);
      if (!existsSync(inputPath)) {
        console.error(`Error: Input file not found: ${inputPath}`);
        process.exit(1);
      }

      // Resolve driver: explicit --from flag, or infer from file extension
      let driverName: string | undefined = opts.from;
      if (!driverName) {
        const ext = inputPath.slice(inputPath.lastIndexOf('.')).toLowerCase().replace(/^\./, '');
        driverName = ext;
      }

      const driver = getDriver(driverName!);
      if (!driver) {
        console.error(`Error: Unknown format "${driverName}".`);
        console.error(`Supported formats: ${driverNames().join(', ')}`);
        console.error(`\nAvailable drivers:`);
        for (const d of listDrivers()) {
          console.error(`  ${d.name} (${d.extensions.join(', ')}) — ${d.description}`);
        }
        process.exit(1);
      }

      console.log(`\n╔══════════════════════════════════╗`);
      console.log(`║        QA Import                 ║`);
      console.log(`╚══════════════════════════════════╝`);
      console.log(`Input:  ${inputPath}`);
      console.log(`Driver: ${driver.name} — ${driver.description}`);

      const result = await driver.extract(inputPath);

      // Override delays from CLI if provided
      result.config.questionDelay = parseFloat(opts.questionDelay);
      result.config.answerDelay = parseFloat(opts.answerDelay);

      // Determine output path
      const inputName = basename(inputPath).replace(/\.[^.]+$/, '');
      const outputPath = opts.output
        ? resolve(opts.output)
        : join(process.cwd(), 'qa', `${inputName}.yaml`);

      mkdirSync(dirname(outputPath), { recursive: true });

      // Build YAML content
      const { stringify } = await import('yaml');
      const yamlContent = stringify(
        { config: result.config, questions: result.questions },
        { lineWidth: 120, defaultKeyType: 'PLAIN', defaultStringType: 'PLAIN' },
      );

      const { writeFileSync } = await import('fs');
      writeFileSync(outputPath, yamlContent, 'utf-8');

      console.log(`\nExtracted ${result.questions.length} Q&A pairs`);
      console.log(`Output:  ${outputPath}`);
      console.log(`\nDone. You can now run:`);
      console.log(`  qa-video generate -i ${outputPath}`);
    } catch (err: any) {
      console.error(`\nError: ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  });

// Serve web app
program
  .command('serve')
  .description('Start the QA Video API and web UI')
  .option('-p, --port <number>', 'API port', '3001')
  .option('--web-port <number>', 'Web UI port', '5173')
  .action(async (opts) => {
    try {
      const apiPort = parseInt(opts.port, 10);
      const webPort = parseInt(opts.webPort, 10);
      const webDir = join(dirname(new URL(import.meta.url).pathname), '..', 'web');

      const { startServer } = await import('./server.js');
      startServer(apiPort);

      const { spawn } = await import('node:child_process');
      const vite = spawn(
        'npx',
        ['vite', '--port', String(webPort)],
        { cwd: webDir, stdio: 'inherit', shell: true },
      );

      vite.on('error', (err) => {
        console.error(`Web server error: ${err.message}`);
      });

      console.log(`\nWeb UI:  http://localhost:${webPort}`);
      console.log(`API:     http://localhost:${apiPort}\n`);

      process.on('SIGINT', () => {
        vite.kill();
        process.exit(0);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error(`\nError: ${msg}`);
      if (process.env.DEBUG) console.error(stack);
      process.exit(1);
    }
  });

// Only require ffmpeg for generate/batch commands
const cmd = process.argv[2];
if (cmd === 'generate' || cmd === 'update' || cmd === 'batch') {
  await ensureDeps();
}
program.parse();
