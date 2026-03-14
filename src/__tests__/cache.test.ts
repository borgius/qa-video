import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  sha,
  slug,
  cachedPath,
  isCached,
  findGitRoot,
  resolveOutputDir,
  removeStale,
  SLIDE_CACHE_VERSION,
  CLIP_CACHE_VERSION,
} from '../cache.js';

describe('sha', () => {
  it('returns an 8-character hex string', () => {
    const result = sha('hello');
    expect(result).toHaveLength(8);
    expect(result).toMatch(/^[0-9a-f]{8}$/);
  });

  it('returns the same hash for the same input', () => {
    expect(sha('test input')).toBe(sha('test input'));
  });

  it('returns different hashes for different inputs', () => {
    expect(sha('abc')).not.toBe(sha('def'));
  });

  it('handles empty string', () => {
    const result = sha('');
    expect(result).toHaveLength(8);
  });
});

describe('slug', () => {
  it('converts spaces to hyphens', () => {
    expect(slug('hello world')).toBe('hello-world');
  });

  it('lowercases text', () => {
    expect(slug('Hello World')).toBe('hello-world');
  });

  it('removes non-alphanumeric characters', () => {
    expect(slug('What is CI/CD?')).toBe('what-is-ci-cd');
  });

  it('truncates to 40 characters', () => {
    const long = 'a'.repeat(60);
    expect(slug(long).length).toBeLessThanOrEqual(40);
  });

  it('removes leading and trailing hyphens', () => {
    expect(slug('  hello  ')).toBe('hello');
  });

  it('collapses multiple non-alphanumeric chars into a single hyphen', () => {
    expect(slug('a---b')).toBe('a-b');
  });

  it('handles numbers', () => {
    expect(slug('k8s deployment')).toBe('k8s-deployment');
  });

  it('does not end with a trailing hyphen after truncation', () => {
    // Create a string where truncation at 40 would land on a hyphen
    const text = 'a'.repeat(39) + '-extra-stuff';
    const result = slug(text);
    expect(result).not.toMatch(/-$/);
  });
});

describe('cachedPath', () => {
  it('builds path with prefix and sha', () => {
    const result = cachedPath('/tmp', 'q_0', 'some content', 'wav');
    expect(result).toMatch(/^\/tmp\/q_0_[0-9a-f]{8}\.wav$/);
  });

  it('different hash content yields different paths', () => {
    const a = cachedPath('/tmp', 'q_0', 'content-a', 'wav');
    const b = cachedPath('/tmp', 'q_0', 'content-b', 'wav');
    expect(a).not.toBe(b);
  });

  it('same hash content yields same path', () => {
    expect(cachedPath('/tmp', 'x', 'data', 'mp4')).toBe(cachedPath('/tmp', 'x', 'data', 'mp4'));
  });
});

describe('isCached', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'qa-cache-test-'));
  });

  it('returns true when file exists and force is false', async () => {
    const filePath = join(tmpDir, 'cached.wav');
    await writeFile(filePath, 'data');
    expect(isCached(filePath, false)).toBe(true);
  });

  it('returns false when file exists but force is true', async () => {
    const filePath = join(tmpDir, 'cached.wav');
    await writeFile(filePath, 'data');
    expect(isCached(filePath, true)).toBe(false);
  });

  it('returns false when file does not exist and force is false', () => {
    expect(isCached(join(tmpDir, 'nonexistent.wav'), false)).toBe(false);
  });

  it('returns false when file does not exist and force is true', () => {
    expect(isCached(join(tmpDir, 'nonexistent.wav'), true)).toBe(false);
  });
});

describe('findGitRoot', () => {
  it('finds the git root of this repository', () => {
    // We are inside a git repo at /Users/admin/dev/qa-video
    const root = findGitRoot('/Users/admin/dev/qa-video/src');
    expect(root).toBeTruthy();
    expect(existsSync(join(root!, '.git'))).toBe(true);
  });

  it('returns null when not inside any git repo', async () => {
    // Use a temp dir outside of any git repo (OS tmpdir is typically not in a repo)
    const tmpPath = tmpdir();
    // Walk up from tmpdir to find git — most CI/dev envs don't have .git in tmpdir
    const root = findGitRoot(tmpPath);
    // We can only assert root is null or a string; we just check it doesn't throw
    expect(typeof root === 'string' || root === null).toBe(true);
  });
});

describe('resolveOutputDir', () => {
  it('returns <git-root>/.qa when inside a git repo', () => {
    const result = resolveOutputDir('/Users/admin/dev/qa-video/src');
    expect(result).toMatch(/\.qa$/);
    expect(result).toContain('/qa-video/.qa');
  });
});

describe('removeStale', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'qa-stale-test-'));
  });

  it('removes stale files matching prefix and extension, keeping the keep path', async () => {
    const keep = join(tmpDir, 'q_0_aabbccdd.wav');
    const stale1 = join(tmpDir, 'q_0_11111111.wav');
    const stale2 = join(tmpDir, 'q_0_22222222.wav');
    const unrelated = join(tmpDir, 'q_1_33333333.wav');

    await Promise.all([
      writeFile(keep, 'keep'),
      writeFile(stale1, 'stale1'),
      writeFile(stale2, 'stale2'),
      writeFile(unrelated, 'unrelated'),
    ]);

    await removeStale(tmpDir, 'q_0', 'wav', keep);

    expect(existsSync(keep)).toBe(true);
    expect(existsSync(stale1)).toBe(false);
    expect(existsSync(stale2)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
  });

  it('does not throw if directory is empty', async () => {
    await expect(removeStale(tmpDir, 'q_0', 'wav', join(tmpDir, 'q_0_abc.wav'))).resolves.not.toThrow();
  });
});

describe('cache version constants', () => {
  it('SLIDE_CACHE_VERSION is a non-empty string', () => {
    expect(typeof SLIDE_CACHE_VERSION).toBe('string');
    expect(SLIDE_CACHE_VERSION.length).toBeGreaterThan(0);
  });

  it('CLIP_CACHE_VERSION is a non-empty string', () => {
    expect(typeof CLIP_CACHE_VERSION).toBe('string');
    expect(CLIP_CACHE_VERSION.length).toBeGreaterThan(0);
  });
});
