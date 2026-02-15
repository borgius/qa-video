import { basename } from 'path';
import { YamlInput } from './types.js';

const UPPER: Record<string, string> = {
  ci: 'CI', cd: 'CD', iac: 'IaC', aws: 'AWS', gcp: 'GCP',
  api: 'API', ssl: 'SSL', tls: 'TLS', dns: 'DNS', ssh: 'SSH',
  http: 'HTTP', tcp: 'TCP', ip: 'IP', vm: 'VM', os: 'OS',
  qa: 'QA', sql: 'SQL', css: 'CSS', html: 'HTML', js: 'JS',
  ts: 'TS', k8s: 'K8s', devops: 'DevOps',
};

export function topicFromFilename(filePath: string): string {
  const name = basename(filePath).replace(/\.(yaml|yml)$/i, '');
  return name
    .split(/[-_]/)
    .map(w => UPPER[w.toLowerCase()] ?? (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function generateTitle(filePath: string, data: YamlInput): string {
  if (data.config.name) {
    return data.config.name;
  }
  const topic = topicFromFilename(filePath);
  const n = data.questions.length;
  return `${topic} — QA Flashcards (${n} Questions)`;
}

export function generateDescription(filePath: string, data: YamlInput): string {
  if (data.config.description) {
    return data.config.description;
  }

  const topic = topicFromFilename(filePath);
  const questions = data.questions;
  const maxShow = 15;

  let desc = `${topic} — Interview Prep Flashcards\n\n`;
  desc += `This video covers ${questions.length} flashcard-style Q&A cards on ${topic}.\n\n`;
  desc += `Questions covered:\n`;

  const shown = questions.slice(0, maxShow);
  shown.forEach((q, i) => {
    desc += `${i + 1}. ${q.question}\n`;
  });

  if (questions.length > maxShow) {
    desc += `...and ${questions.length - maxShow} more questions.\n`;
  }

  desc += `\nGenerated with qa-video.`;

  // YouTube 5000-char limit
  if (desc.length > 4800) {
    desc = desc.substring(0, 4797) + '...';
  }

  return desc;
}
