import { resolve } from 'path';
import { readFileSync } from 'fs';
import { parseCSVRow } from './csv.js';
import { ImportDriver, ImportResult } from './types.js';
import { YamlCard } from '../types.js';

/**
 * Brainscape CSV export: question,answer (no header row).
 * The `brainscape-bene` userscript adds: question,answer,questionHtml,answerHtml,level
 */

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
      const fields = parseCSVRow(line);
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
      config: { questionDelay: 1, answerDelay: 1 },
      questions,
    };
  },
};
