import { resolve } from 'path';
import { readFileSync } from 'fs';
import { ImportDriver, ImportResult } from './types.js';
import { YamlCard } from '../types.js';

/**
 * Knowt uses the Quizlet-compatible TSV format:
 *   term<TAB>definition
 * One card per line. No header row.
 *
 * Also supports semicolon-delimited variants:
 *   term;definition
 */

export const knowtDriver: ImportDriver = {
  name: 'knowt',
  extensions: ['.tsv'],
  description: 'Knowt / Quizlet TSV export (tab-separated term + definition)',

  async extract(filePath: string): Promise<ImportResult> {
    const content = readFileSync(resolve(filePath), 'utf-8');
    const lines = content.split(/\r?\n/).filter(l => l.trim());

    if (lines.length === 0) {
      throw new Error('Empty TSV file');
    }

    // Auto-detect delimiter: tab, semicolon, or comma
    const firstLine = lines[0];
    let delimiter = '\t';
    if (!firstLine.includes('\t')) {
      if (firstLine.includes(';')) delimiter = ';';
      else if (firstLine.includes(',')) delimiter = ',';
    }

    const questions: YamlCard[] = [];

    for (const line of lines) {
      const parts = line.split(delimiter);
      if (parts.length < 2) continue;

      const question = parts[0].trim();
      const answer = parts.slice(1).join(delimiter).trim();

      if (question && answer) {
        questions.push({ question, answer });
      }
    }

    if (questions.length === 0) {
      throw new Error('No Q&A pairs found in Knowt/Quizlet TSV');
    }

    return {
      config: { questionDelay: 1, answerDelay: 1 },
      questions,
    };
  },
};
