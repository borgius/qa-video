#!/usr/bin/env node

import { Command } from 'commander';
import { resolve, basename, dirname, join } from 'path';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { rm } from 'fs/promises';
import { createRequire } from 'module';
import { createInterface } from 'readline';
import { runPipeline } from './pipeline.js';
import { PipelineConfig, DEFAULT_CONFIG } from './types.js';
import { ensureDeps } from './ffmpeg-paths.js';
import { parseYamlFile } from './parser.js';
import { generateTitle, generateDescription } from './metadata.js';
import { runAuthFlow, getAuthenticatedClient } from './youtube-auth.js';
import { uploadToYouTube } from './uploader.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const program = new Command();

program
  .name('qa-video')
  .description('Generate flashcard videos from YAML Q&A files with TTS narration')
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
    questionDelay: parseFloat(opts.questionDelay),
    answerDelay: parseFloat(opts.answerDelay),
    cardGap: parseFloat(opts.cardGap),
    fontSize: parseInt(opts.fontSize),
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
    .option('--voice <name>', `TTS voice name`, DEFAULT_CONFIG.voice)
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

// Upload to YouTube
program
  .command('upload')
  .description('Upload a generated video to YouTube')
  .requiredOption('-i, --input <path>', 'Path to source YAML file')
  .option('-v, --video <path>', 'Path to video file (default: output/<name>.mp4)')
  .option('--title <text>', 'Video title (default: auto-generated from YAML)')
  .option('--description <text>', 'Video description (default: auto-generated)')
  .option('--privacy <level>', 'Privacy: public, unlisted, private', 'unlisted')
  .option('--category <id>', 'YouTube category ID', '27')
  .option('--tags <csv>', 'Comma-separated tags', 'interview,qa,flashcards')
  .option('--credentials <path>', 'Path to client_secret.json')
  .option('--dry-run', 'Preview metadata without uploading', false)
  .action(async (opts) => {
    try {
      const inputPath = resolve(opts.input);
      if (!existsSync(inputPath)) {
        console.error(`Error: Input file not found: ${inputPath}`);
        process.exit(1);
      }

      // Resolve video path
      const inputName = basename(inputPath, '.yaml').replace(/\.yml$/, '');
      const videoPath = opts.video
        ? resolve(opts.video)
        : join(dirname(inputPath), '..', 'output', `${inputName}.mp4`);

      if (!existsSync(videoPath)) {
        console.error(`Error: Video not found: ${videoPath}`);
        console.error(`Run "qa-video generate -i ${opts.input}" first.`);
        process.exit(1);
      }

      // Parse YAML for metadata
      const yamlData = await parseYamlFile(inputPath);

      let title = opts.title ?? generateTitle(inputPath, yamlData);
      let description = opts.description ?? generateDescription(inputPath, yamlData);
      const tags = (opts.tags as string).split(',').map((t: string) => t.trim());

      console.log(`\n╔══════════════════════════════════╗`);
      console.log(`║     YouTube Upload               ║`);
      console.log(`╚══════════════════════════════════╝`);
      console.log(`Video:       ${videoPath}`);
      console.log(`Title:       ${title}`);
      console.log(`Privacy:     ${opts.privacy}`);
      console.log(`Tags:        ${tags.join(', ')}`);
      console.log(`\nDescription:\n${description}`);

      if (opts.dryRun) {
        console.log(`\n  --dry-run: No upload performed.\n`);
        return;
      }

      // Interactive confirmation — let user edit title/description before upload
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const prompt = (q: string): Promise<string> =>
        new Promise(resolve => rl.question(q, resolve));

      console.log(`\n─── Confirm before upload ───`);
      const newTitle = await prompt(`Title [Enter to keep]: `);
      if (newTitle.trim()) title = newTitle.trim();

      const newDesc = await prompt(`Description [Enter to keep]: `);
      if (newDesc.trim()) description = newDesc.trim();

      const confirm = await prompt(`\nUpload "${title}"? (y/N): `);
      rl.close();

      if (confirm.toLowerCase() !== 'y') {
        console.log(`\n  Upload cancelled.\n`);
        return;
      }

      const authClient = await getAuthenticatedClient(opts.credentials);
      await uploadToYouTube(authClient, {
        videoPath,
        title,
        description,
        privacy: opts.privacy as 'public' | 'unlisted' | 'private',
        categoryId: opts.category,
        tags,
      });
    } catch (err: any) {
      console.error(`\nError: ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  });

// Only require ffmpeg for generate/batch commands
const cmd = process.argv[2];
if (cmd === 'generate' || cmd === 'batch') {
  await ensureDeps();
}
program.parse();
