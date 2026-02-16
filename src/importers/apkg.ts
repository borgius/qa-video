import { resolve } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import { ImportDriver, ImportResult } from './types.js';
import { YamlCard } from '../types.js';

/**
 * Clean HTML tags and entities from Anki card fields.
 * Mirrors the Python ApkgExtractor.clean_html() logic.
 */
function cleanHtml(html: string): string {
  if (!html) return '';

  let text = html;

  // Replace common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Remove style and script tags with their content
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Replace block-level tags with newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/li>/gi, '\n');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Clean up whitespace: trim each line, drop empties
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.join('\n').trim();
}

export const apkgDriver: ImportDriver = {
  name: 'apkg',
  extensions: ['.apkg'],
  description: 'Anki package files (AnkiDroid / Anki Desktop)',

  async extract(filePath: string): Promise<ImportResult> {
    const absPath = resolve(filePath);
    const tmpDir = mkdtempSync(join(tmpdir(), 'qa-apkg-'));

    try {
      // .apkg is a ZIP archive
      const zip = new AdmZip(absPath);
      zip.extractAllTo(tmpDir, true);

      // Locate the SQLite collection database
      let dbFile = join(tmpDir, 'collection.anki2');
      const db21 = join(tmpDir, 'collection.anki21');
      const { existsSync } = await import('fs');
      if (!existsSync(dbFile)) dbFile = db21;
      if (!existsSync(dbFile)) {
        throw new Error('No Anki collection database found inside the .apkg file');
      }

      const db = new Database(dbFile, { readonly: true });

      // Notes contain fields separated by 0x1F (Unit Separator)
      const rows = db.prepare('SELECT flds FROM notes').all() as { flds: string }[];

      const questions: YamlCard[] = [];

      for (const row of rows) {
        const fields = row.flds.split('\x1f');
        if (fields.length < 2) continue;

        const question = cleanHtml(fields[0]);
        const answer = cleanHtml(fields[1]);

        if (question && answer) {
          questions.push({ question, answer });
        }
      }

      db.close();

      if (questions.length === 0) {
        throw new Error('No Q&A pairs found in the .apkg file');
      }

      return {
        config: {
          questionDelay: 2,
          answerDelay: 3,
        },
        questions,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  },
};
