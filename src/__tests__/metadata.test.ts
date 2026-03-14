import { describe, it, expect } from 'vitest';
import { topicFromFilename, generateTitle, generateDescription } from '../metadata.js';
import type { YamlInput } from '../types.js';

const makeInput = (overrides: Partial<YamlInput> = {}): YamlInput => ({
  config: {},
  questions: [
    { question: 'What is CI?', answer: 'Continuous Integration.' },
    { question: 'What is CD?', answer: 'Continuous Delivery.' },
  ],
  ...overrides,
});

describe('topicFromFilename', () => {
  it('converts a simple hyphenated filename to title case', () => {
    expect(topicFromFilename('/qa/devops/core-concepts.yaml')).toBe('Core Concepts');
  });

  it('uppercases known acronyms', () => {
    expect(topicFromFilename('/qa/devops/aws-core.yaml')).toBe('AWS Core');
    expect(topicFromFilename('/qa/devops/ci-cd.yaml')).toBe('CI CD');
    expect(topicFromFilename('/qa/devops/kubernetes-core.yaml')).toBe('Kubernetes Core');
  });

  it('handles DevOps acronym', () => {
    expect(topicFromFilename('devops.yaml')).toBe('DevOps');
  });

  it('handles K8s acronym', () => {
    expect(topicFromFilename('k8s-advanced.yaml')).toBe('K8s Advanced');
  });

  it('handles underscore-separated filenames', () => {
    expect(topicFromFilename('git_version_control.yaml')).toBe('Git Version Control');
  });

  it('strips .yml extension too', () => {
    expect(topicFromFilename('aws-core.yml')).toBe('AWS Core');
  });

  it('capitalises regular words correctly', () => {
    expect(topicFromFilename('terraform-advanced.yaml')).toBe('Terraform Advanced');
  });

  it('handles QA acronym', () => {
    expect(topicFromFilename('qa-fundamentals.yaml')).toBe('QA Fundamentals');
  });
});

describe('generateTitle', () => {
  it('returns config.name when set', () => {
    const data = makeInput({ config: { name: 'My Custom Title' } });
    expect(generateTitle('/any/path.yaml', data)).toBe('My Custom Title');
  });

  it('generates title from filename and question count when name not set', () => {
    const data = makeInput();
    const title = generateTitle('/qa/devops/aws-core.yaml', data);
    expect(title).toBe('AWS Core — QA Flashcards (2 Questions)');
  });

  it('includes the correct question count in generated title', () => {
    const data = makeInput({
      questions: Array.from({ length: 50 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` })),
    });
    const title = generateTitle('/qa/devops/terraform-core.yaml', data);
    expect(title).toContain('50 Questions');
  });
});

describe('generateDescription', () => {
  it('returns config.description with attribution when set', () => {
    const data = makeInput({ config: { description: 'Custom desc' } });
    const desc = generateDescription('/any/path.yaml', data);
    expect(desc).toContain('Custom desc');
    expect(desc).toContain('Generated with qa-video');
  });

  it('generates auto-description when description not set', () => {
    const data = makeInput();
    const desc = generateDescription('/qa/devops/aws-core.yaml', data);
    expect(desc).toContain('AWS Core');
    expect(desc).toContain('What is CI?');
    expect(desc).toContain('What is CD?');
    expect(desc).toContain('Generated with qa-video');
  });

  it('lists at most 15 questions in auto-description', () => {
    const data = makeInput({
      questions: Array.from({ length: 20 }, (_, i) => ({
        question: `Question ${i + 1}`,
        answer: `Answer ${i + 1}`,
      })),
    });
    const desc = generateDescription('/qa/devops/ci-cd.yaml', data);
    expect(desc).toContain('Question 15');
    expect(desc).not.toContain('Question 16');
    expect(desc).toContain('5 more questions');
  });

  it('does not add "more questions" line when all questions fit', () => {
    const data = makeInput();
    const desc = generateDescription('/qa/devops/aws-core.yaml', data);
    expect(desc).not.toContain('more questions');
  });

  it('truncates very long descriptions at 4800 chars', () => {
    // Use a question with a very long text to push over 4800 chars
    const longAnswer = 'A'.repeat(500);
    const data = makeInput({
      questions: Array.from({ length: 15 }, (_, i) => ({
        question: `Q${i} ${'word '.repeat(30)}`,
        answer: longAnswer,
      })),
    });
    const desc = generateDescription('/qa/devops/core-concepts.yaml', data);
    expect(desc.length).toBeLessThanOrEqual(4800);
  });
});
