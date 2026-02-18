import { resolve } from 'path';
import { readFileSync } from 'fs';
import { ImportDriver, ImportResult } from './types.js';
import { YamlCard } from '../types.js';

/**
 * Parse a CSV line handling quoted fields.
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
          i++;
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

/** Normalize header names to detect Q/A column indices */
const Q_HEADERS = ['question', 'front', 'term', 'prompt', 'q'];
const A_HEADERS = ['answer', 'back', 'definition', 'response', 'a'];

function matchHeader(header: string, candidates: string[]): boolean {
  const h = header.toLowerCase().replace(/[^a-z]/g, '');
  return candidates.some(c => h === c || h.startsWith(c));
}

export const gizmoDriver: ImportDriver = {
  name: 'gizmo',
  extensions: ['.csv'],
  description: 'Gizmo CSV export (front/back or question/answer columns)',

  async extract(filePath: string): Promise<ImportResult> {
    const content = readFileSync(resolve(filePath), 'utf-8');
    const lines = content.split(/\r?\n/).filter(l => l.trim());

    if (lines.length === 0) {
      throw new Error('Empty CSV file');
    }

    // Try to detect a header row
    const firstFields = parseCsvLine(lines[0]);
    let qIdx = 0;
    let aIdx = 1;
    let startLine = 0;

    const hasHeader = firstFields.some(f => matchHeader(f, [...Q_HEADERS, ...A_HEADERS]));
    if (hasHeader) {
      qIdx = firstFields.findIndex(f => matchHeader(f, Q_HEADERS));
      aIdx = firstFields.findIndex(f => matchHeader(f, A_HEADERS));
      if (qIdx === -1) qIdx = 0;
      if (aIdx === -1) aIdx = 1;
      startLine = 1;
    }

    const questions: YamlCard[] = [];

    for (let i = startLine; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i]);
      if (fields.length < 2) continue;

      const question = fields[qIdx] ?? '';
      const answer = fields[aIdx] ?? '';

      if (question && answer) {
        questions.push({ question, answer });
      }
    }

    if (questions.length === 0) {
      throw new Error('No Q&A pairs found in Gizmo CSV');
    }

    return {
      config: { questionDelay: 1, answerDelay: 1 },
      questions,
    };
  },
};
