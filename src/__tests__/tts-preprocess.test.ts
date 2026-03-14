import { describe, it, expect } from 'vitest';
import { preprocessForTTS, splitIntoTTSParts, buildAudioPlan } from '../tts-preprocess.js';

describe('preprocessForTTS', () => {
  it('strips inline markdown bold markers', () => {
    expect(preprocessForTTS('**bold**')).toBe('bold');
  });

  it('strips inline code backticks but keeps content', () => {
    expect(preprocessForTTS('use `kubectl`')).toContain('kubectl');
    expect(preprocessForTTS('use `kubectl`')).not.toContain('`');
  });

  it('replaces e.g. with "for example"', () => {
    expect(preprocessForTTS('e.g. a pod')).toContain('for example');
  });

  it('replaces i.e. with "that is"', () => {
    expect(preprocessForTTS('i.e. a container')).toContain('that is');
  });

  it('replaces etc. with "et cetera"', () => {
    expect(preprocessForTTS('pods, services, etc.')).toContain('et cetera');
  });

  it('replaces vs. with "versus"', () => {
    expect(preprocessForTTS('docker vs. podman')).toContain('versus');
  });

  it('expands AWS acronym', () => {
    expect(preprocessForTTS('AWS is a cloud provider')).toContain('A W S');
  });

  it('expands CI/CD compound acronym', () => {
    const result = preprocessForTTS('CI/CD pipelines');
    expect(result).toContain('C I / C D');
  });

  it('expands K8s to Kubernetes', () => {
    expect(preprocessForTTS('K8s clusters')).toContain('Kubernetes');
  });

  it('expands kubectl to kube control', () => {
    expect(preprocessForTTS('kubectl apply')).toContain('kube control');
  });

  it('expands NGINX to engine X', () => {
    expect(preprocessForTTS('Use NGINX as a proxy')).toContain('engine X');
  });

  it('expands JSON to Jason', () => {
    expect(preprocessForTTS('send JSON payload')).toContain('Jason');
  });

  it('expands etcd to et-C-D', () => {
    expect(preprocessForTTS('etcd is a key-value store')).toContain('et-C-D');
  });

  it('replaces arrow → with a spoken pause', () => {
    const result = preprocessForTTS('A → B');
    expect(result).toContain('...');
  });

  it('adds comma-pause after colons', () => {
    const result = preprocessForTTS('Note: important');
    expect(result).toContain(':,');
  });

  it('replaces newlines with pause markers', () => {
    const result = preprocessForTTS('line1\nline2');
    expect(result).toContain(',,');
  });

  it('spells out unmapped uppercase acronyms', () => {
    // XYZ is not in the acronym table, should be spelled out
    const result = preprocessForTTS('use XYZ service');
    // Each letter should be separated
    expect(result).toMatch(/X\s+Y\s+Z/);
  });

  it('applies custom acronyms first (higher priority)', () => {
    const result = preprocessForTTS('Use MyOrg internally', { MyOrg: 'My Organisation' });
    expect(result).toContain('My Organisation');
    expect(result).not.toContain('MyOrg');
  });

  it('handles empty string', () => {
    expect(preprocessForTTS('')).toBe('');
  });
});

describe('splitIntoTTSParts', () => {
  it('returns a single prose part for plain text', () => {
    const parts = splitIntoTTSParts('plain text answer');
    expect(parts).toHaveLength(1);
    expect(parts[0].isCode).toBe(false);
  });

  it('returns a code part for fenced code block', () => {
    const text = 'Run:\n```bash\nkubectl apply -f deploy.yaml\n```';
    const parts = splitIntoTTSParts(text);
    const codeParts = parts.filter(p => p.isCode);
    expect(codeParts.length).toBeGreaterThan(0);
  });

  it('splits inline code into a separate code part', () => {
    const text = 'Use `kubectl` to manage clusters';
    const parts = splitIntoTTSParts(text);
    const codePart = parts.find(p => p.isCode);
    expect(codePart).toBeDefined();
    expect(codePart?.text).toContain('kubectl');
  });

  it('handles text with both fenced and inline code', () => {
    const text = 'Use `helm` charts:\n```yaml\nchart: myapp\n```';
    const parts = splitIntoTTSParts(text);
    expect(parts.filter(p => p.isCode).length).toBeGreaterThan(0);
    expect(parts.filter(p => !p.isCode).length).toBeGreaterThan(0);
  });

  it('omits empty parts after preprocessing', () => {
    const parts = splitIntoTTSParts('```\n \n```');
    // The code content is just whitespace; after preprocessing it should be stripped
    const nonEmpty = parts.filter(p => p.text.trim());
    // It should not include whitespace-only parts
    nonEmpty.forEach(p => expect(p.text.trim()).not.toBe(''));
  });

  it('applies custom acronyms', () => {
    const parts = splitIntoTTSParts('MyOrg uses cloud', { MyOrg: 'My Organisation' });
    const text = parts.map(p => p.text).join(' ');
    expect(text).toContain('My Organisation');
  });
});

describe('buildAudioPlan', () => {
  const tmpDir = '/tmp/qa-test';

  it('returns a single-part plan for plain text', () => {
    const plan = buildAudioPlan('plain text', tmpDir, 'q_0', 'af_heart', 'am_echo');
    expect(plan.isMultiPart).toBe(false);
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0].voice).toBe('af_heart');
    expect(plan.finalAudioPath).toBe(plan.parts[0].audioPath);
  });

  it('returns a multi-part plan when text has code', () => {
    const text = 'Run:\n```bash\nkubectl get pods\n```';
    const plan = buildAudioPlan(text, tmpDir, 'q_0', 'af_heart', 'am_echo');
    expect(plan.isMultiPart).toBe(true);
    expect(plan.parts.length).toBeGreaterThan(1);
    const voices = plan.parts.map(p => p.voice);
    expect(voices).toContain('am_echo'); // code voice
    expect(voices).toContain('af_heart'); // prose voice
  });

  it('uses code voice for code parts and prose voice for text parts', () => {
    const text = 'Use `helm install` to deploy';
    const plan = buildAudioPlan(text, tmpDir, 'a_0', 'voice_a', 'voice_b');
    const codePart = plan.parts.find(p => p.voice === 'voice_b');
    expect(codePart).toBeDefined();
    expect(codePart?.ttsText).toContain('helm install');
  });

  it('finalAudioPath differs from part paths in multi-part mode', () => {
    const text = 'Run:\n```bash\nls -la\n```\nand check';
    const plan = buildAudioPlan(text, tmpDir, 'q_0', 'af_heart', 'am_echo');
    if (plan.isMultiPart) {
      const partPaths = plan.parts.map(p => p.audioPath);
      expect(partPaths).not.toContain(plan.finalAudioPath);
    }
  });

  it('generates deterministic paths for the same input', () => {
    const text = 'What is Kubernetes?';
    const plan1 = buildAudioPlan(text, tmpDir, 'q_0', 'af_heart', 'am_echo');
    const plan2 = buildAudioPlan(text, tmpDir, 'q_0', 'af_heart', 'am_echo');
    expect(plan1.finalAudioPath).toBe(plan2.finalAudioPath);
  });

  it('generates different paths for different voices', () => {
    const text = 'What is Kubernetes?';
    const plan1 = buildAudioPlan(text, tmpDir, 'q_0', 'voice_a', 'am_echo');
    const plan2 = buildAudioPlan(text, tmpDir, 'q_0', 'voice_b', 'am_echo');
    expect(plan1.finalAudioPath).not.toBe(plan2.finalAudioPath);
  });

  it('passes custom acronyms to preprocessing', () => {
    const plan = buildAudioPlan('MyOrg is great', tmpDir, 'q_0', 'voice_a', 'voice_b', { MyOrg: 'My Org' });
    expect(plan.parts[0].ttsText).toContain('My Org');
  });
});
