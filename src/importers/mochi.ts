import { resolve, join } from 'path';
import AdmZip from 'adm-zip';
import { ImportDriver, ImportResult } from './types.js';
import { YamlCard } from '../types.js';

/**
 * Mochi .mochi files are ZIP archives containing:
 *   data.json  (Transit-encoded JSON)  — or —
 *   data.edn   (Clojure EDN format)
 *
 * Card content uses `---` as a side separator:
 *   Question text
 *   ---
 *   Answer text
 */

// --------------- Minimal EDN parser for Mochi data ---------------

function parseEdn(input: string): any {
  let pos = 0;

  function skipWhitespace() {
    while (pos < input.length && /[\s,]/.test(input[pos])) pos++;
    // Skip comments
    if (pos < input.length && input[pos] === ';') {
      while (pos < input.length && input[pos] !== '\n') pos++;
      skipWhitespace();
    }
  }

  function parseValue(): any {
    skipWhitespace();
    if (pos >= input.length) return undefined;

    const ch = input[pos];
    if (ch === '{') return parseMap();
    if (ch === '[') return parseVector();
    if (ch === '(') return parseList();
    if (ch === '"') return parseString();
    if (ch === ':') return parseKeyword();
    if (ch === '#') return parseTagged();
    if (ch === 't' && input.slice(pos, pos + 4) === 'true') { pos += 4; return true; }
    if (ch === 'f' && input.slice(pos, pos + 5) === 'false') { pos += 5; return false; }
    if (ch === 'n' && input.slice(pos, pos + 3) === 'nil') { pos += 3; return null; }
    if (ch === '-' || ch === '+' || /\d/.test(ch)) return parseNumber();
    // Symbol or unknown — consume as string
    return parseSymbol();
  }

  function parseString(): string {
    pos++; // skip opening "
    let result = '';
    while (pos < input.length && input[pos] !== '"') {
      if (input[pos] === '\\') {
        pos++;
        const esc = input[pos];
        if (esc === 'n') result += '\n';
        else if (esc === 't') result += '\t';
        else if (esc === '\\') result += '\\';
        else if (esc === '"') result += '"';
        else result += esc;
      } else {
        result += input[pos];
      }
      pos++;
    }
    pos++; // skip closing "
    return result;
  }

  function parseKeyword(): string {
    pos++; // skip :
    let kw = '';
    while (pos < input.length && /[a-zA-Z0-9_\-?!./+*]/.test(input[pos])) {
      kw += input[pos];
      pos++;
    }
    return kw;
  }

  function parseNumber(): number {
    let num = '';
    if (input[pos] === '-' || input[pos] === '+') { num += input[pos]; pos++; }
    while (pos < input.length && /[\d.eE]/.test(input[pos])) {
      num += input[pos];
      pos++;
    }
    // Skip N/M suffixes (bigint/ratio markers)
    if (pos < input.length && /[NM]/.test(input[pos])) pos++;
    return Number(num);
  }

  function parseSymbol(): string {
    let sym = '';
    while (pos < input.length && /[^\s,\}\]\)]/.test(input[pos])) {
      sym += input[pos];
      pos++;
    }
    return sym;
  }

  function parseMap(): Record<string, any> {
    pos++; // skip {
    const map: Record<string, any> = {};
    while (true) {
      skipWhitespace();
      if (pos >= input.length || input[pos] === '}') { pos++; break; }
      const key = parseValue();
      const val = parseValue();
      if (key !== undefined) {
        map[String(key)] = val;
      }
    }
    return map;
  }

  function parseVector(): any[] {
    pos++; // skip [
    const arr: any[] = [];
    while (true) {
      skipWhitespace();
      if (pos >= input.length || input[pos] === ']') { pos++; break; }
      arr.push(parseValue());
    }
    return arr;
  }

  function parseList(): any[] {
    pos++; // skip (
    const arr: any[] = [];
    while (true) {
      skipWhitespace();
      if (pos >= input.length || input[pos] === ')') { pos++; break; }
      arr.push(parseValue());
    }
    return arr;
  }

  function parseTagged(): any {
    pos++; // skip #
    if (input[pos] === '{') {
      // Set literal #{...}
      pos++;
      const items: any[] = [];
      while (true) {
        skipWhitespace();
        if (pos >= input.length || input[pos] === '}') { pos++; break; }
        items.push(parseValue());
      }
      return items;
    }
    // Tagged value like #inst "..."
    const tag = parseSymbol();
    skipWhitespace();
    const val = parseValue();
    return val; // just return the inner value
  }

  return parseValue();
}

// --------------- Card content parsing ---------------

function extractQA(content: string): { question: string; answer: string } | null {
  if (!content) return null;

  // Split on `---` line separator
  const parts = content.split(/\n---\n/);
  if (parts.length >= 2) {
    const question = parts[0].trim();
    const answer = parts.slice(1).join('\n---\n').trim();
    if (question && answer) return { question, answer };
  }

  // Handle cloze: {{answer}} → extract as Q/A
  const clozeMatch = content.match(/\{\{(.+?)\}\}/);
  if (clozeMatch) {
    const answer = clozeMatch[1].replace(/^\d+::/, ''); // strip numbered cloze prefix
    const question = content.replace(/\{\{.+?\}\}/g, '___');
    if (question.trim() && answer.trim()) {
      return { question: question.trim(), answer: answer.trim() };
    }
  }

  return null;
}

/** Recursively collect cards from decks (they can be nested) */
function collectCards(data: any): YamlCard[] {
  const cards: YamlCard[] = [];

  // Top-level cards array
  const topCards: any[] = data.cards || [];
  for (const card of topCards) {
    const content: string = card.content || '';
    const qa = extractQA(content);
    if (qa) cards.push(qa);
  }

  // Cards nested inside decks
  const decks: any[] = data.decks || [];
  for (const deck of decks) {
    const deckCards: any[] = deck.cards || [];
    for (const card of deckCards) {
      const content: string = card.content || '';
      const qa = extractQA(content);
      if (qa) cards.push(qa);
    }
  }

  return cards;
}

export const mochiDriver: ImportDriver = {
  name: 'mochi',
  extensions: ['.mochi'],
  description: 'Mochi Cards export (.mochi ZIP with EDN or JSON)',

  async extract(filePath: string): Promise<ImportResult> {
    const zip = new AdmZip(resolve(filePath));
    const entries = zip.getEntries();

    let data: any;

    // Prefer data.json over data.edn (faster parsing)
    const jsonEntry = entries.find(e => e.entryName === 'data.json');
    const ednEntry = entries.find(e => e.entryName === 'data.edn');

    if (jsonEntry) {
      const raw = jsonEntry.getData().toString('utf-8');
      data = JSON.parse(raw);
    } else if (ednEntry) {
      const raw = ednEntry.getData().toString('utf-8');
      data = parseEdn(raw);
    } else {
      throw new Error('No data.json or data.edn found inside .mochi archive');
    }

    const questions = collectCards(data);

    if (questions.length === 0) {
      throw new Error('No Q&A pairs found in Mochi export (cards need --- separator or {{cloze}})');
    }

    return {
      config: { questionDelay: 2, answerDelay: 3 },
      questions,
    };
  },
};
