#!/usr/bin/env node

import { Command } from 'commander';
import { resolve, basename, dirname, join } from 'path';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { rm } from 'fs/promises';
import { runPipeline } from './pipeline.js';
import { PipelineConfig, DEFAULT_CONFIG } from './types.js';

const program = new Command();

program
  .name('qa-video')
  .description('Generate flashcard videos from YAML Q&A files with TTS narration')
  .version('1.0.0');

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
    const failed = results.length - ok;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  BATCH SUMMARY`);
    console.log(`${'═'.repeat(60)}`);
    for (const r of results) {
      const icon = r.status === 'OK' ? 'OK' : 'FAIL';
      console.log(`  [${icon}] ${r.file} (${r.time})`);
    }
    console.log(`\n  Total: ${ok} succeeded, ${failed} failed, ${totalTime}s elapsed`);

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

program.parse();
