import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { YamlInput, YamlCard, YamlConfig } from './types.js';

export async function parseYamlFile(filePath: string): Promise<YamlInput> {
  const content = await readFile(filePath, 'utf-8');
  const data = parse(content);

  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid YAML file: ${filePath}`);
  }

  // Support both "questions" and "cards" array keys
  const questions: YamlCard[] = data.questions || data.cards || [];

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error(`No questions found in: ${filePath}`);
  }

  // Normalize card fields: support both q/a and question/answer.
  // Use nullish coalescing so numeric/boolean YAML values are coerced correctly
  // instead of being skipped by the || operator.
  const normalizedQuestions: YamlCard[] = questions.map((card: any, i: number) => {
    const question = String(card.question ?? card.q ?? '').trim();
    const answer = String(card.answer ?? card.a ?? '').trim();

    if (!question || !answer) {
      throw new Error(`Card ${i + 1} is missing question or answer`);
    }

    return { question, answer };
  });

  const config: YamlConfig = data.config || {};

  return {
    config,
    questions: normalizedQuestions,
  };
}
