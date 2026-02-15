import { createHash } from 'crypto';
import { existsSync } from 'fs';
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
