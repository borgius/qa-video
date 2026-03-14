import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseYamlFile } from '../parser.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'qa-parser-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeYaml(name: string, content: string): Promise<string> {
  const filePath = join(tmpDir, name);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

describe('parseYamlFile', () => {
  it('parses a valid YAML file with question/answer fields', async () => {
    const filePath = await writeYaml('valid.yaml', `
config:
  name: Test Topic
questions:
  - question: What is CI?
    answer: Continuous Integration.
  - question: What is CD?
    answer: Continuous Delivery.
`);
    const result = await parseYamlFile(filePath);
    expect(result.config.name).toBe('Test Topic');
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0]).toEqual({ question: 'What is CI?', answer: 'Continuous Integration.' });
    expect(result.questions[1]).toEqual({ question: 'What is CD?', answer: 'Continuous Delivery.' });
  });

  it('normalises q/a shorthand fields to question/answer', async () => {
    const filePath = await writeYaml('shorthand.yaml', `
config: {}
questions:
  - q: Short question?
    a: Short answer.
`);
    const result = await parseYamlFile(filePath);
    expect(result.questions[0]).toEqual({ question: 'Short question?', answer: 'Short answer.' });
  });

  it('accepts "cards" as an alternative to "questions"', async () => {
    const filePath = await writeYaml('cards.yaml', `
config: {}
cards:
  - question: Q1?
    answer: A1.
`);
    const result = await parseYamlFile(filePath);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].question).toBe('Q1?');
  });

  it('throws when the file has no questions or cards', async () => {
    const filePath = await writeYaml('empty.yaml', `
config: {}
questions: []
`);
    await expect(parseYamlFile(filePath)).rejects.toThrow('No questions found');
  });

  it('throws when a card is missing a question', async () => {
    const filePath = await writeYaml('missing-question.yaml', `
config: {}
questions:
  - answer: Only an answer.
`);
    await expect(parseYamlFile(filePath)).rejects.toThrow('missing question or answer');
  });

  it('throws when a card is missing an answer', async () => {
    const filePath = await writeYaml('missing-answer.yaml', `
config: {}
questions:
  - question: Only a question?
`);
    await expect(parseYamlFile(filePath)).rejects.toThrow('missing question or answer');
  });

  it('throws when YAML is invalid', async () => {
    const filePath = await writeYaml('bad.yaml', ': invalid: yaml: [[[');
    await expect(parseYamlFile(filePath)).rejects.toThrow();
  });

  it('throws when file does not exist', async () => {
    await expect(parseYamlFile(join(tmpDir, 'nonexistent.yaml'))).rejects.toThrow();
  });

  it('returns empty config when no config key is present', async () => {
    const filePath = await writeYaml('no-config.yaml', `
questions:
  - question: Q?
    answer: A.
`);
    const result = await parseYamlFile(filePath);
    expect(result.config).toEqual({});
  });

  it('trims whitespace from question and answer fields', async () => {
    const filePath = await writeYaml('whitespace.yaml', `
config: {}
questions:
  - question: "  What is CI?  "
    answer: "  Continuous Integration.  "
`);
    const result = await parseYamlFile(filePath);
    expect(result.questions[0].question).toBe('What is CI?');
    expect(result.questions[0].answer).toBe('Continuous Integration.');
  });

  it('returns all optional config fields when present', async () => {
    const filePath = await writeYaml('full-config.yaml', `
config:
  name: Full Config Video
  description: A description
  questionDelay: 2
  answerDelay: 3
  cardGap: 1
  voice: af_heart
  fontSize: 48
questions:
  - question: Q?
    answer: A.
`);
    const result = await parseYamlFile(filePath);
    expect(result.config.name).toBe('Full Config Video');
    expect(result.config.questionDelay).toBe(2);
    expect(result.config.voice).toBe('af_heart');
  });

  it('handles multi-line answer text in YAML', async () => {
    const filePath = await writeYaml('multiline.yaml', `
config: {}
questions:
  - question: Explain CI/CD.
    answer: |
      CI stands for Continuous Integration.
      CD stands for Continuous Delivery.
`);
    const result = await parseYamlFile(filePath);
    expect(result.questions[0].answer).toContain('CI stands for');
    expect(result.questions[0].answer).toContain('CD stands for');
  });
});
