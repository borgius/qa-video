import { resolve } from 'path';
import { readFileSync } from 'fs';
import { ImportDriver, ImportResult } from './types.js';
import { YamlCard } from '../types.js';

/**
 * RemNote Markdown export uses inline separators for flashcards:
 *   >>  forward card (Q >> A)
 *   ::  concept card (Term :: Definition)
 *   ;;  descriptor card (Property ;; Value)
 *   >>> multi-line forward card (Q >>> \n  - bullet answers)
 *
 * Lines without a separator are skipped (headings, plain notes, etc.)
 */

/** Separator patterns ordered by specificity */
const SEPARATORS = [
  { pattern: /\s*>>>\s*$/, multiline: true },   // multi-line forward
  { pattern: /\s*>>\s+/,   multiline: false },   // forward Q>>A
  { pattern: /\s*<<\s+/,   multiline: false },   // reverse A<<Q (flip)
  { pattern: /\s*<>\s+/,   multiline: false },   // bidirectional
  { pattern: /\s*::\s+/,   multiline: false },   // concept
  { pattern: /\s*;;\s+/,   multiline: false },   // descriptor
];

export const remnoteDriver: ImportDriver = {
  name: 'remnote',
  extensions: ['.md', '.rem'],
  description: 'RemNote Markdown export (>> :: ;; separators)',

  async extract(filePath: string): Promise<ImportResult> {
    const content = readFileSync(resolve(filePath), 'utf-8');
    const lines = content.split(/\r?\n/);
    const questions: YamlCard[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Strip leading bullet/indent markers
      const cleaned = trimmed.replace(/^[-*+]\s+/, '');

      // Try each separator
      let matched = false;
      for (const sep of SEPARATORS) {
        if (sep.multiline) {
          // Multi-line: Q >>> then indented bullets as answer
          const match = cleaned.match(sep.pattern);
          if (match) {
            const question = cleaned.slice(0, match.index!).trim();
            // Collect indented child lines as answer
            const answerLines: string[] = [];
            let j = i + 1;
            while (j < lines.length) {
              const child = lines[j];
              // Must be indented or a bullet under this line
              if (/^\s+/.test(child) && child.trim()) {
                answerLines.push(child.trim().replace(/^[-*+]\s+/, ''));
                j++;
              } else {
                break;
              }
            }
            if (question && answerLines.length > 0) {
              questions.push({ question, answer: answerLines.join('\n') });
              i = j - 1; // skip consumed lines
            }
            matched = true;
            break;
          }
        } else {
          const parts = cleaned.split(sep.pattern);
          if (parts.length >= 2) {
            let question = parts[0].trim();
            let answer = parts.slice(1).join(' ').trim();

            // For reverse cards (<<), flip Q and A
            if (sep.pattern.source.includes('<<') && !sep.pattern.source.includes('<>')) {
              [question, answer] = [answer, question];
            }

            if (question && answer) {
              questions.push({ question, answer });
            }
            matched = true;
            break;
          }
        }
      }
      // Lines without separators are skipped (plain notes)
    }

    if (questions.length === 0) {
      throw new Error('No flashcards found in RemNote export (expected >> :: ;; separators)');
    }

    return {
      config: { questionDelay: 1, answerDelay: 1 },
      questions,
    };
  },
};
