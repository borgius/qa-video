# QA Video Generator

Generate flashcard-style videos from YAML Q&A files with offline neural TTS narration. Designed for interview preparation — provide your questions and answers, get a YouTube-ready MP4.

## How it works

1. **Parse** YAML file with questions and answers
2. **Synthesize** speech for each Q&A using [Kokoro TTS](https://github.com/hexgrad/kokoro) (offline, neural, 82M params)
3. **Render** styled slides as 1920x1080 PNGs using Skia canvas
4. **Assemble** video with FFmpeg — H.264 High Profile, AAC audio, YouTube-optimized

Each card shows the question (with voiceover), pauses, then shows the answer (with voiceover), then moves to the next card.

## Prerequisites

- **Node.js** 18+
- **pnpm** (or npm/yarn)
- **FFmpeg** — `brew install ffmpeg`
- **espeak-ng** — `brew install espeak-ng` (required by Kokoro TTS phonemizer)

## Install

```bash
pnpm install
pnpm build
```

## Usage

### Single file

```bash
node dist/index.js generate -i qa/core-concepts.yaml
```

### All files in a directory

```bash
node dist/index.js batch -d qa/
```

### Clear cached artifacts

```bash
node dist/index.js clear              # clear all caches
node dist/index.js clear -i qa/test.yaml  # clear cache for one file
node dist/index.js clear -d qa/          # clear caches for all files in dir
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--voice <name>` | `af_heart` | Kokoro TTS voice |
| `--question-delay <sec>` | `2` | Silence after question speech |
| `--answer-delay <sec>` | `3` | Silence after answer speech |
| `--card-gap <sec>` | `1` | Gap between cards |
| `--font-size <px>` | `52` | Slide text font size |
| `--force` | `false` | Regenerate all artifacts, ignore cache |

## YAML Format

```yaml
config:
  questionDelay: 2
  answerDelay: 3
questions:
- question: What is DevOps?
  answer: DevOps is a set of practices that combine software development and IT operations.
- question: What is Docker?
  answer: Docker is a platform for containerizing applications.
```

Config values in the YAML override defaults but CLI flags take priority.

## Caching

Artifacts (WAV audio, PNG slides, MP4 clips) are cached in `output/.tmp/` with SHA-based filenames. If the pipeline is interrupted, re-running reuses all previously generated artifacts. Only changed questions get regenerated. Use `--force` to bypass the cache or `clear` command to remove it.

## Output

- **Format:** MP4 (H.264 High Profile + AAC)
- **Resolution:** 1920x1080 @ 30fps
- **Audio:** 384kbps stereo, 48kHz
- **Optimized:** `-movflags +faststart`, `-tune stillimage`

Videos are saved to `output/<filename>.mp4`.

## Architecture

```
src/
├── index.ts      # CLI entry point (commander)
├── types.ts      # Shared types & defaults
├── parser.ts     # YAML parser
├── tts.ts        # Kokoro TTS synthesis
├── renderer.ts   # Slide rendering (@napi-rs/canvas)
├── assembler.ts  # FFmpeg video assembly
├── pipeline.ts   # 4-stage orchestration
└── cache.ts      # SHA-based artifact caching
```

## Tech Stack

- **TTS:** [kokoro-js](https://www.npmjs.com/package/kokoro-js) — offline neural TTS, Apache 2.0
- **Canvas:** [@napi-rs/canvas](https://www.npmjs.com/package/@napi-rs/canvas) — Skia-based, zero system deps
- **Video:** [fluent-ffmpeg](https://www.npmjs.com/package/fluent-ffmpeg) + system FFmpeg
- **CLI:** [commander](https://www.npmjs.com/package/commander)

## License

MIT
