import { createHash } from 'crypto';
import { existsSync, readdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { dirname, join } from 'path';

/**
 * Walk up the directory tree from `startDir` looking for a `.git` directory.
 * Returns the git root path, or `null` if not found.
 */
export function findGitRoot(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null; // filesystem root
    dir = parent;
  }
}

/**
 * Resolve the output directory for a given reference directory (the directory
 * containing the YAML file or the QA files directory).
 *
 * Rules:
 *   - If inside a git repo → `<git-root>/.qa`
 *   - Otherwise           → `<referenceDir>/../.qa`  (sibling of the qa dir)
 */
export function resolveOutputDir(referenceDir: string): string {
  const gitRoot = findGitRoot(referenceDir);
  if (gitRoot) return join(gitRoot, '.qa');
  return join(referenceDir, '..', '.qa');
}


export function sha(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 8);
}

/** Convert a question string to a filename-friendly slug (max 40 chars). */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** Build a cache-keyed filename: <prefix>_<sha>.<ext> */
export function cachedPath(tempDir: string, prefix: string, hashContent: string, ext: string): string {
  return join(tempDir, `${prefix}_${sha(hashContent)}.${ext}`);
}

/** Returns true if the file exists and force=false (i.e., cached and valid) */
export function isCached(filePath: string, force: boolean): boolean {
  return !force && existsSync(filePath);
}

/**
 * Remove stale cache files for a given prefix (e.g. "q_0") and extension.
 * Keeps only `keepPath`; deletes any other `<prefix>_*.ext` files in tempDir.
 */
export async function removeStale(tempDir: string, prefix: string, ext: string, keepPath: string): Promise<void> {
  const needle = `${prefix}_`;
  for (const file of readdirSync(tempDir)) {
    if (file.startsWith(needle) && file.endsWith(`.${ext}`)) {
      const full = join(tempDir, file);
      if (full !== keepPath) {
        await unlink(full).catch(() => {});
      }
    }
  }
}
