import { resolve } from 'path';
import { readFileSync } from 'fs';
import { ImportDriver, ImportResult } from './types.js';
import { YamlCard } from '../types.js';

/**
 * Parse a CSV line handling quoted fields.
 * Brainscape exports: question,answer (no header row).
 * The `brainscape-bene` userscript adds: question,answer,questionHtml,answerHtml,level
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

export const brainscapeDriver: ImportDriver = {
  name: 'brainscape',
  extensions: ['.csv'],
  description: 'Brainscape CSV export (question, answer columns)',

  async extract(filePath: string): Promise<ImportResult> {
    const content = readFileSync(resolve(filePath), 'utf-8');
    const lines = content.split(/\r?\n/).filter(l => l.trim());

    if (lines.length === 0) {
      throw new Error('Empty CSV file');
    }

    const questions: YamlCard[] = [];

    for (const line of lines) {
      const fields = parseCsvLine(line);
      if (fields.length < 2) continue;

      const question = fields[0];
      const answer = fields[1];

      if (question && answer) {
        questions.push({ question, answer });
      }
    }

    if (questions.length === 0) {
      throw new Error('No Q&A pairs found in Brainscape CSV');
    }

    return {
      config: { questionDelay: 2, answerDelay: 3 },
      questions,
    };
  },
};
