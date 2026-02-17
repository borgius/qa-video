import { createHash } from 'crypto';
import { existsSync, readdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';

/** Short SHA-8 hash of content for cache keys */
export function sha(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 8);
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
